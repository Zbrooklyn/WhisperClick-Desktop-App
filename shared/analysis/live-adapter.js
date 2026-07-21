// live-adapter.js — the real model adapter (OpenAI-compatible chat completions).
//
// Contract points:
//  - Model selection is CONFIGURATION (model-policy.js). No model id is written
//    here; the adapter is told a tier and asks the policy for the model.
//  - The model proposes items by their exact TEXT; the backend resolves each to
//    a raw-word range by EXACT normalized match (text.resolvePhraseRangeWithin).
//    A proposal whose wording is not literally present is REJECTED, never fuzzy-
//    matched. This is the anti-corruption guarantee (the RY->ROI class of defect
//    cannot occur: a rewritten quote fails to resolve and is dropped).
//  - Robust error taxonomy with typed codes; ret/backoff on transient failures;
//    never substitutes a weaker model; never logs the api key.
//
// The transport is injectable so every error path is unit-tested with NO network
// and NO api key. The default transport uses global fetch.

'use strict';

const text = require('./text');
const segment = require('./segment');
const { requireTier } = require('./model-policy');
const { EVENT_TYPES } = require('./events');

// Structure detection runs in windows over the whole document rather than one
// truncated whole-document prompt (see detectStructure).
const STRUCTURE_WINDOW_WORDS = 1200;

// How far from an item we will look for its actor / cue / due evidence. Big
// enough for a speaker label ("Marcus:") immediately before the utterance,
// small enough to stay inside one speaker turn.
const RELATION_WINDOW_WORDS = 40;

const STRUCTURE_SYSTEM =
  'Identify EVERY distinct structural unit that BEGINS in this excerpt (chapters, agenda items, or the ' +
  'individual questions in a Q&A). Be exhaustive and enumerate them ALL, in order — do not merge related ' +
  'units, do not skip any, and do not summarise. This is an excerpt of a longer document: only report units ' +
  'that start here, and do not invent ones that are not present. ' +
  'Reply ONLY as JSON: {"units":[{"title":string,"startPhrase":string}]} where startPhrase is an EXACT ' +
  'verbatim phrase (3-8 words) copied from THIS excerpt that BEGINS the unit. Do not paraphrase startPhrase.';

const ALLOWED_KINDS = new Set(['quote', 'task', 'decision', 'commitment', 'advice', 'cta', 'question', 'risk']);

function typedError(code, message, extra) {
  const e = new Error(message);
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}

// redact(key) -> a safe fingerprint for logs. Never returns the key itself.
function redact(key) {
  if (!key) return '(none)';
  const s = String(key);
  return `sk-…${s.slice(-4)} (len ${s.length})`;
}

// defaultTransport — thin fetch wrapper with timeout + abort. Returns a plain
// { status, json?, text?, aborted } object; it does NOT throw for HTTP status.
async function defaultTransport({ url, method = 'POST', headers, bodyObj, timeoutMs = 30000, signal }) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body: JSON.stringify(bodyObj), signal: ctrl.signal });
    const t = await res.text();
    let json = null; try { json = JSON.parse(t); } catch {}
    return { status: res.status, json, text: t, aborted: false };
  } catch (e) {
    if (e && (e.name === 'AbortError' || ctrl.signal.aborted)) return { status: 0, aborted: true };
    return { status: 0, networkError: String(e && e.message || e), aborted: false };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// createLiveAdapter(opts)
//   opts: { policy, apiKey, transport?, logger?, retry?, opsTier?, timeoutMs? }
//   opsTier: which capability tier this adapter exercises for ALL ops (so a
//   bake-off can pin one model end-to-end). Default 'extraction'.
function createLiveAdapter(opts) {
  const { policy } = opts;
  const apiKey = opts.apiKey || '';
  const transport = opts.transport || defaultTransport;
  const logger = opts.logger || (() => {});
  const opsTier = opts.opsTier || 'extraction';
  const timeoutMs = opts.timeoutMs || 30000;
  const retry = Object.assign({ max: 3, baseMs: 250 }, opts.retry || {});

  // Resolve the tier NOW so an unapproved/unconfigured model fails fast.
  const tier = requireTier(policy, opsTier);

  const telemetry = { calls: 0, attempts: 0, retries: 0, inputTokens: 0, outputTokens: 0, latencyMs: [], errors: {}, model: tier.model };

  function bump(code) { telemetry.errors[code] = (telemetry.errors[code] || 0) + 1; }

  // callChat(messages, {signal}) -> parsed JSON object. Throws typed errors.
  async function callChat(messages, { signal } = {}) {
    const body = {
      model: tier.model,
      messages,
      response_format: { type: 'json_object' },
      ...tier.params,
    };
    const url = policy.baseUrl.replace(/\/$/, '') + '/chat/completions';
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };

    let lastErr = null;
    for (let attempt = 0; attempt <= retry.max; attempt++) {
      telemetry.attempts++;
      if (attempt > 0) telemetry.retries++;
      const t0 = process.hrtime.bigint();
      const r = await transport({ url, headers, bodyObj: body, timeoutMs, signal });
      telemetry.latencyMs.push(Number((process.hrtime.bigint() - t0) / 1000000n));

      if (r.aborted) { bump('INTERRUPTED'); throw typedError('INTERRUPTED', 'request interrupted/cancelled'); }
      if (r.status === 0) { lastErr = typedError('TIMEOUT', r.networkError ? `network error: ${r.networkError}` : 'request timed out'); bump(lastErr.code); if (retriable(lastErr.code, attempt)) { await backoff(attempt); continue; } throw lastErr; }
      if (r.status === 401 || r.status === 403) { bump('AUTH'); throw typedError('AUTH', `auth rejected (status ${r.status})`); }
      if (r.status === 429) { lastErr = typedError('RATE_LIMITED', 'rate limited (429)'); bump('RATE_LIMITED'); if (retriable('RATE_LIMITED', attempt)) { await backoff(attempt); continue; } throw lastErr; }
      if (r.status >= 500) { lastErr = typedError('PROVIDER_ERROR', `provider error (status ${r.status})`); bump('PROVIDER_ERROR'); if (retriable('PROVIDER_ERROR', attempt)) { await backoff(attempt); continue; } throw lastErr; }
      if (r.status < 200 || r.status >= 300) { bump('PROVIDER_ERROR'); throw typedError('PROVIDER_ERROR', `unexpected status ${r.status}`); }

      // success HTTP — extract content + usage
      const usage = r.json && r.json.usage;
      if (usage) { telemetry.inputTokens += usage.prompt_tokens || 0; telemetry.outputTokens += usage.completion_tokens || 0; }
      const content = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.content;
      if (typeof content !== 'string') { lastErr = typedError('MALFORMED_JSON', 'no message content in response'); bump('MALFORMED_JSON'); if (retriable('MALFORMED_JSON', attempt)) { await backoff(attempt); continue; } throw lastErr; }
      const parsed = safeParse(content);
      if (parsed === undefined) { lastErr = typedError('MALFORMED_JSON', 'response content was not valid JSON'); bump('MALFORMED_JSON'); if (retriable('MALFORMED_JSON', attempt)) { await backoff(attempt); continue; } throw lastErr; }
      telemetry.calls++;
      return parsed;
    }
    throw lastErr || typedError('PROVIDER_ERROR', 'exhausted retries');
  }

  function retriable(code, attempt) {
    return attempt < retry.max && ['RATE_LIMITED', 'PROVIDER_ERROR', 'MALFORMED_JSON', 'TIMEOUT'].includes(code);
  }
  function backoff(attempt) {
    const ms = retry.baseMs * Math.pow(2, attempt);
    return new Promise((res) => setTimeout(res, opts.__noSleep ? 0 : ms));
  }

  return {
    kind: 'live',
    modelPolicy: policy.sanitized(),
    telemetry,
    capabilities() {
      if (!apiKey) return { canAnalyze: false, reason: 'no api key' };
      return { canAnalyze: true, reason: `live:${tier.model}` };
    },

    async profile({ sampleText }, ctx = {}) {
      const messages = [
        { role: 'system', content: 'Classify this transcript SAMPLE. Reply ONLY as JSON: {"contentTypes":[{"type":string,"confidence":number}],"provisionalPresence":{"decisions":boolean,"commitments":boolean,"ctas":boolean,"risks":boolean,"questions":boolean}}. These are hints from a sample; do not assert absence for the whole document.' },
        { role: 'user', content: String(sampleText).slice(0, 6000) },
      ];
      const out = await callChat(messages, ctx);
      return { contentTypes: Array.isArray(out.contentTypes) ? out.contentTypes : [], provisionalPresence: out.provisionalPresence || {} };
    },

    // detectStructure — runs over the COMPLETE source.
    //
    // It deliberately does NOT send one truncated whole-document prompt. The
    // first bake-off proved why: a single call capped at 14k chars silently drops
    // the tail of an 18.6k-char transcript, so the last structural units simply
    // cannot be found (Ashley returned 8-9 of 10). That is the same silent-
    // truncation defect the original audit found. Instead we detect LOCAL units
    // per window and merge globally, which is what the contract requires for
    // long inputs.
    async detectStructure({ text: fullText, words }, ctx = {}) {
      const cps = Array.from(text.canonicalize(fullText));
      const chunks = segment.windowSegments(words, { windowTokens: STRUCTURE_WINDOW_WORDS, sentenceOverlap: 0 });
      const starts = [];
      for (const c of chunks) {
        const chunkText = text.rawTextForRange(cps, words, c.range[0], c.range[1]);
        const messages = [
          { role: 'system', content: STRUCTURE_SYSTEM },
          { role: 'user', content: chunkText },
        ];
        let out;
        try { out = await callChat(messages, ctx); }
        catch (e) { if (e && e.code === 'INTERRUPTED') throw e; continue; } // a bad chunk must not lose the others
        const units = Array.isArray(out.units) ? out.units : [];
        for (const u of units) {
          if (!u || typeof u.startPhrase !== 'string') continue;
          // resolve WITHIN this chunk so an ambiguous phrase cannot bind elsewhere
          const r = text.resolvePhraseRangeWithin(words, u.startPhrase, c.range[0], c.range[1]);
          if (r) starts.push({ title: u.title || null, start: r[0] });
        }
      }
      // global merge: order, de-duplicate identical starts, span each unit to the next
      starts.sort((a, b) => a.start - b.start);
      const deduped = starts.filter((s, i) => i === 0 || s.start !== starts[i - 1].start);
      const result = [];
      for (let i = 0; i < deduped.length; i++) {
        const end = i + 1 < deduped.length ? deduped[i + 1].start - 1 : words.length - 1;
        if (end >= deduped[i].start) result.push({ title: deduped[i].title, kind: 'unit', range: [deduped[i].start, end] });
      }
      return result;
    },

    // extractEvents — the Phase-1B path. The model reports PRIMITIVE SPEECH
    // EVENTS (what was said, by whom, to whom); operational tasks are derived
    // deterministically afterwards by assemble.js. The model never decides
    // "is this a task", which is what made owner recall collapse in Phase 1A.
    async extractEvents({ range, segmentText, words }, ctx = {}) {
      const [lo, hi] = range;
      const out = await callChat([
        { role: 'system', content: EXTRACT_EVENTS_SYSTEM },
        { role: 'user', content: String(segmentText).slice(0, 12000) },
      ], ctx);
      const raw = Array.isArray(out.events) ? out.events : undefined;
      if (raw === undefined) throw typedError('MISSING_FIELDS', 'extractEvents response missing "events" array');

      const results = [];
      for (const e of raw) {
        const type = asText(e && e.type);
        const body = asText(e && e.text);
        if (!type || !body) { telemetry.errors.UNRESOLVED = (telemetry.errors.UNRESOLVED || 0) + 1; continue; }
        if (type !== 'quote' && !EVENT_TYPES.includes(type)) { telemetry.errors.UNRESOLVED = (telemetry.errors.UNRESOLVED || 0) + 1; continue; }
        const span = text.resolvePhraseRangeWithin(words, body, lo, hi);
        if (!span) { telemetry.errors.UNRESOLVED = (telemetry.errors.UNRESOLVED || 0) + 1; continue; } // rejected, never fuzzy-matched
        const rec = { type, range: span };
        const rlo = Math.max(lo, span[0] - RELATION_WINDOW_WORDS);
        const rhi = Math.min(hi, span[1] + RELATION_WINDOW_WORDS);
        // speaker / addressee are only carried when their names are literally
        // present nearby — never inferred.
        mapNearest(rec, 'speakerSpan', asText(e.speakerText), words, rlo, rhi, span[0]);
        mapNearest(rec, 'addresseeSpan', asText(e.addresseeText), words, rlo, rhi, span[0]);
        mapNearest(rec, 'dueSpan', asText(e.dueText), words, rlo, rhi, span[0]);
        mapNearest(rec, 'cueSpan', asText(e.cueText), words, rlo, rhi, span[0]);
        if (rec.speakerSpan) rec.speaker = asText(e.speakerText);
        if (rec.addresseeSpan) rec.addressee = asText(e.addresseeText);
        if (rec.dueSpan) rec.dueText = asText(e.dueText);
        if (e.confidence != null) rec.confidence = Number(e.confidence);
        if (Array.isArray(e.corrections)) {
          rec.corrections = e.corrections
            .map((c) => { const cr = text.resolvePhraseRangeWithin(words, asText(c.fromText) || '', span[0], span[1]); return cr ? { rawWordRange: cr, to: asText(c.to), reason: c.reason || 'normalization' } : null; })
            .filter((c) => c && c.to);
        }
        results.push(rec);
      }
      return results;
    },

    async extract({ range, segmentText, words }, ctx = {}) {
      const [lo, hi] = range;
      const messages = [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content: String(segmentText).slice(0, 12000) },
      ];
      const out = await callChat(messages, ctx);
      const rawItems = Array.isArray(out.items) ? out.items : (Array.isArray(out) ? out : undefined);
      if (rawItems === undefined) throw typedError('MISSING_FIELDS', 'extract response missing "items" array');

      const resolved = [];
      for (const it of rawItems) {
        if (!it || typeof it.kind !== 'string' || !ALLOWED_KINDS.has(it.kind) || typeof it.text !== 'string') { telemetry.errors.UNRESOLVED = (telemetry.errors.UNRESOLVED || 0) + 1; continue; }
        const span = text.resolvePhraseRangeWithin(words, it.text, lo, hi);
        if (!span) { telemetry.errors.UNRESOLVED = (telemetry.errors.UNRESOLVED || 0) + 1; continue; } // rejected, not fuzzy-matched
        const mapped = { kind: it.kind, range: span };
        // Relationship / cue spans are resolved within the enclosing SEGMENT,
        // not strictly inside the item's own span, and we take the occurrence
        // nearest to (preferably preceding) the item.
        //
        // Why: the actor is normally the speaker label that sits immediately
        // BEFORE the utterance ("Marcus: I will write the migration plan by
        // Friday."). Requiring the speaker's name to appear inside their own
        // sentence is wrong by construction — the first bake-off showed it
        // abstaining every correctly-identified owner. The span is still an
        // exact, grounded raw-word range; only the search window widened.
        // Bounded to a LOCAL neighbourhood: wide enough to reach the speaker
        // label just before the utterance, narrow enough that evidence cannot be
        // borrowed from a different speaker's turn. An unbounded (whole-segment)
        // search let "by Wednesday" from Dana's reply attach itself to Priya's
        // question, and let hypothetical statements borrow unrelated cues.
        const rlo = Math.max(lo, span[0] - RELATION_WINDOW_WORDS);
        const rhi = Math.min(hi, span[1] + RELATION_WINDOW_WORDS);
        mapNearest(mapped, 'actorSpan', asText(it.actorText), words, rlo, rhi, span[0]);
        mapNearest(mapped, 'taskSpan', asText(it.taskText), words, rlo, rhi, span[0]);
        mapNearest(mapped, 'dueSpan', asText(it.dueText), words, rlo, rhi, span[0]);
        mapNearest(mapped, 'commitmentCueSpan', asText(it.commitmentCueText), words, rlo, rhi, span[0]);
        mapNearest(mapped, 'decisionCueSpan', asText(it.decisionCueText), words, rlo, rhi, span[0]);
        if (it.kind === 'task' && !mapped.taskSpan) mapped.taskSpan = span; // task defaults to its own span
        // Providers sometimes return owner/due as an OBJECT ({name:"Marcus"}).
        // String() would turn that into the literal "[object Object]" and
        // persist it as a person's name, so coerce carefully and drop anything
        // we cannot read as text.
        const owner = asText(it.owner);
        const due = asText(it.due);
        if (owner) mapped.owner = owner;
        if (due) mapped.due = due;
        if (it.relationshipConfidence != null) mapped.relationshipConfidence = Number(it.relationshipConfidence);
        if (it.lifecycle != null) mapped.lifecycle = String(it.lifecycle);
        if (it.stance != null) mapped.stance = String(it.stance);
        if (it.topicKey != null) mapped.topicKey = String(it.topicKey);
        if (Array.isArray(it.corrections)) {
          mapped.corrections = it.corrections
            .map((c) => { const cr = text.resolvePhraseRangeWithin(words, c.fromText || '', span[0], span[1]); return cr ? { rawWordRange: cr, to: String(c.to), reason: c.reason || 'normalization' } : null; })
            .filter(Boolean);
        }
        resolved.push(mapped);
      }
      return resolved;
    },
  };

  // mapNearest — resolve `phrase` anywhere in [lo,hi] and keep the occurrence
  // closest to `anchor`, preferring one that starts at or before it (speaker
  // labels and cues precede the utterance they attribute).
  function mapNearest(target, field, phrase, words, lo, hi, anchor) {
    if (typeof phrase !== 'string' || !phrase.trim()) return;
    let best = null; let bestScore = Infinity;
    let cursor = lo;
    while (cursor <= hi) {
      const r = text.resolvePhraseRangeWithin(words, phrase, cursor, hi);
      if (!r) break;
      // preceding occurrences are preferred: penalise ones after the anchor
      const dist = Math.abs(r[0] - anchor) + (r[0] > anchor ? 1000 : 0);
      if (dist < bestScore) { bestScore = dist; best = r; }
      cursor = r[0] + 1;
    }
    if (best) target[field] = best;
  }
  // expose redacted key fingerprint through the logger only
  logger('live-adapter ready', { model: tier.model, key: redact(apiKey), base: policy.baseUrl });
}

const EXTRACT_EVENTS_SYSTEM =
  'Report the SPEECH EVENTS in this transcript segment. Do NOT decide whether something is a "task" — ' +
  'just report what was said, by whom, to whom. Reply ONLY as JSON: ' +
  '{"events":[{"type":string,"text":string, ...optional}]}.\n' +
  'type is one of: assignmentRequest (asking someone to do work), acceptance (agreeing to do it), ' +
  'selfCommitment ("I will…", "I\'ll…"), decline (refusing), cancellation (dropping work), ' +
  'completionClaim (saying it is already done), recommendation (suggesting an approach), ' +
  'audienceAdvice (general guidance to an audience/viewer, not to a named participant), ' +
  'promotionalCTA (subscribe/follow/visit a link), decisionProposal (proposing a choice), ' +
  'decisionAgreement (a settled choice: "agreed", "we decided"), decisionRevision (changing an earlier ' +
  'decision), decisionRescission (cancelling a decision), risk, question, or quote (a notable verbatim line).\n' +
  '"text" MUST be an EXACT verbatim substring copied from the segment — never paraphrase, correct, or rewrite it.\n' +
  'Optional, and ONLY when the words literally appear in the transcript: "speakerText" (the speaker label/name), ' +
  '"addresseeText" (the person directly addressed), "cueText" (the exact phrase that makes it this event type), ' +
  '"dueText" (the exact deadline wording such as "by Friday" — never convert it to a calendar date, and never ' +
  'state a year the transcript does not contain), and "confidence" 0-1.\n' +
  'Critical distinctions: general guidance to an audience ("you should focus on data quality") is audienceAdvice, ' +
  'NOT an assignmentRequest — an assignmentRequest requires a named participant being asked. ' +
  'Hypothetical or conditional talk ("we could decide…", "if we decided…") is NOT decisionAgreement. ' +
  'Never invent people, deadlines, decisions, or commitments. When unsure, omit the field or the event.';

const EXTRACT_SYSTEM =
  'Extract structured items from this transcript segment. Reply ONLY as JSON: ' +
  '{"items":[{"kind":string,"text":string, ...optional fields}]}. ' +
  'kind is one of: quote, task, decision, commitment, advice, cta, question, risk. ' +
  '"text" MUST be an EXACT verbatim substring copied from the segment (do not paraphrase, correct, or rewrite it). ' +
  'Distinguish carefully: advice = a general recommendation to the audience; cta = a call to take a specific external action (subscribe, visit a link, attend); task = a concrete to-do that an identifiable owner is responsible for; ' +
  'commitment = a speaker\'s own promise ("I will…", "we\'ll…"). ' +
  'Only use kind=decision when there is EXPLICIT decision language, and include "decisionCueText" (the exact cue). ' +
  'Only use kind=commitment when there is an explicit first-person promise, and include "commitmentCueText" and "actorText". ' +
  'If you set "owner" you MUST also supply BOTH "actorText" (the exact verbatim name or speaker label as it ' +
  'appears in the transcript, e.g. "Marcus") AND "commitmentCueText" (the exact verbatim phrase that assigns ' +
  'or promises the work, e.g. "I will", "I\'ll", "can you take"), plus "taskText" and "relationshipConfidence" 0-1. ' +
  'If you cannot copy BOTH of those verbatim from the transcript, omit "owner" entirely. ' +
  'If a deadline is stated, supply "dueText" as the exact verbatim wording ("by Friday") and set "due" to that same ' +
  'wording — do NOT convert it to a calendar date, and never state a year the transcript does not contain. ' +
  'NEVER invent owners, due dates, decisions, or commitments. When unsure, omit the field or the item.';

// asText — read a model field as a plain string, or null. Never produces
// "[object Object]": an unreadable value is dropped so the validators treat the
// field as absent (and abstain) rather than persisting garbage as a name.
function asText(v) {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object') {
    for (const k of ['name', 'text', 'value', 'owner', 'label']) {
      if (typeof v[k] === 'string' && v[k].trim()) return v[k].trim();
    }
  }
  return null;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch {}
  // tolerate leading/trailing prose: grab the outermost {...}
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  return undefined;
}

module.exports = { createLiveAdapter, defaultTransport, redact, ALLOWED_KINDS, EXTRACT_SYSTEM };
