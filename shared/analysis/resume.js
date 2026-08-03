// resume.js — durable, resumable analysis execution.
//
// The Phase-0 pipeline.buildAnalysisRun() is the ephemeral path (one shot, all
// in memory). THIS is the durable path: it persists every completed stage before
// the run finishes, so an interrupted run can be resumed without re-paying for
// work already done.
//
// Guarantees:
//  - Successful segments are persisted BEFORE the run completes.
//  - A resume retries ONLY failed/missing segments. Completed segments are never
//    re-sent to the model (never re-billed). Profile + structure are likewise
//    persisted after their first success and skipped on resume.
//  - The SAME analysisRunId is preserved across resumes (the contract's
//    "preserve the same id" option).
//  - Merge + validation re-run over the full item set after recovered segments
//    arrive — a resume produces a properly consolidated analysis, not a patch.
//  - The run stays visibly `partial` until every segment reaches a successful
//    terminal state. Repeated failure keeps it partial; it is never presented as
//    complete.
//  - Segment identity is (runId, segmentIndex) — deterministic, so state
//    survives a process restart and an app restart.
//  - Cancellation via AbortSignal leaves already-completed segments persisted.

'use strict';

const text = require('./text');
const segmentMod = require('./segment');
const profileMod = require('./profile');
const extract = require('./extract');
const merge = require('./merge');
const { createCoverage } = require('./coverage');
const { createIdFactory } = require('./ids');
const schema = require('./schema');
const { buildEvidence } = require('./evidence');
const { constructQuote } = require('./quotes');
const { makeEvent, EVENT_TYPES, classifyCommitmentRelevance } = require('./events');
const { deriveTasks } = require('./assemble');
const validate = require('./validate');

class CancelledError extends Error {
  constructor() { super('analysis cancelled'); this.code = 'CANCELLED'; }
}

// executeRun(opts) -> { run, resumed, segmentsRun, cancelled }
//   opts: { store, noteId, rawTranscript, adapter, ids?, now?, analysisRunId?,
//           signal?, windowTokens?, asrTimings? }
//   Call it once to start; call it again with the same analysisRunId to resume.
async function executeRun(opts) {
  const {
    store, noteId, rawTranscript, adapter, signal,
    windowTokens, asrTimings = null, now = Date.now,
  } = opts;
  const ids = opts.ids || createIdFactory();

  const canonical = text.canonicalize(rawTranscript);
  const { cps, words } = text.tokenize(canonical);
  const rawVersion = text.rawContentVersion(canonical);
  const segs = segmentMod.windowSegments(words, { windowTokens });
  // Semantic-event mode is used whenever the adapter can report speech events.
  const useEvents = typeof adapter.extractEvents === 'function';
  const sourceKind = opts.sourceKind || 'unknown';

  // --- locate or create the run -------------------------------------------
  let run = opts.analysisRunId ? store.getRun(opts.analysisRunId) : null;
  const resumed = !!run;

  if (run && run.analysis_status === 'complete') {
    // Duplicate resume of a finished run: no work, no model calls.
    return { run, resumed: true, segmentsRun: 0, cancelled: false, noop: true };
  }

  if (!run) {
    run = store.putRun({
      analysis_run_id: ids.analysisRunId(),
      note_id: noteId,
      raw_version: rawVersion,
      normalized_version: `nfc-lf@${rawVersion}`,
      schema_version: schema.SCHEMA_VERSION,
      analysis_status: 'partial',           // visibly partial from the very start
      processing_coverage: { complete: false, totalWords: words.length, status: 'partial' },
      cao_json: { schema_version: schema.SCHEMA_VERSION, structure: [], items: [], presence: {}, profile: null, validation: { issues: [] } },
      model_policy: adapter.modelPolicy || null,
      created_at: now(),
    });
    // seed every segment as pending so the plan is durable
    for (const s of segs) {
      store.putSegment(run.analysis_run_id, { segment_index: s.index, range: s.range, status: 'pending', attempts: 0 });
    }
  }

  const runId = run.analysis_run_id;
  const throwIfCancelled = () => { if (signal && signal.aborted) throw new CancelledError(); };

  // --- stage 1: profile (persisted; skipped on resume) ---------------------
  let cao = run.cao_json || {};
  let cancelled = false;
  let segmentsRun = 0;

  try {
    throwIfCancelled();
    if (!cao.profile) {
      const sample = sampleText(canonical);
      const p = profileMod.normalizeProfile(await adapter.profile({ sampleText: sample }, { signal }));
      cao = { ...cao, profile: p };
      persistCao(store, run, cao, 'partial', now);
    }

    // --- stage 2: structure (persisted; skipped on resume) -----------------
    throwIfCancelled();
    if (!Array.isArray(cao.structure) || cao.structure.length === 0) {
      let units = [];
      try {
        const candidates = await adapter.detectStructure({ text: canonical, words }, { signal });
        units = segmentMod.mergeStructureUnits(candidates, words.length);
      } catch (e) {
        if (e && e.code === 'CANCELLED') throw e;
        units = []; // structure is best-effort; its absence does not fail the run
      }
      cao = { ...cao, structure: units };
      persistCao(store, run, cao, 'partial', now);
    }

    // --- stage 3: segments (only the ones not already merged) --------------
    for (const s of segs) {
      throwIfCancelled();
      const persisted = store.getSegments(runId).find((x) => x.segment_index === s.index);
      if (persisted && persisted.status === 'merged') continue; // never re-bill

      const attempts = (persisted && persisted.attempts) || 0;
      try {
        // Phase 1B: prefer the semantic-event path when the adapter offers it.
        const call = useEvents ? adapter.extractEvents.bind(adapter) : adapter.extract.bind(adapter);
        const items = await call({
          range: s.range,
          segmentText: text.rawTextForRange(cps, words, s.range[0], s.range[1]),
          words,
        }, { signal });
        segmentsRun++;
        store.putSegment(runId, { segment_index: s.index, range: s.range, status: 'merged', items, attempts: attempts + 1 });
      } catch (e) {
        if (e instanceof CancelledError || (e && e.code === 'INTERRUPTED')) {
          store.putSegment(runId, { segment_index: s.index, range: s.range, status: persisted ? persisted.status : 'pending', attempts, error_code: 'CANCELLED' });
          throw new CancelledError();
        }
        segmentsRun++;
        store.putSegment(runId, {
          segment_index: s.index, range: s.range, status: 'failed',
          attempts: attempts + 1, error_code: (e && e.code) || 'PROVIDER_ERROR',
        });
      }
    }
  } catch (e) {
    if (e instanceof CancelledError) cancelled = true;
    else throw e;
  }

  // --- consolidation: re-run merge + validation over ALL merged segments ---
  const finalRun = consolidate({ store, runId, cao, cps, words, asrTimings, ids, now, mode: useEvents ? 'events' : 'items', sourceKind });
  return { run: finalRun, resumed, segmentsRun, cancelled };
}

// resumeRun — convenience wrapper; requires an existing run id.
async function resumeRun(opts) {
  if (!opts.analysisRunId) throw new Error('resumeRun requires analysisRunId');
  return executeRun(opts);
}

// consolidate — rebuild the CAO from persisted segments and set the run status.
// Runs after every execution attempt, so a partially-recovered run always
// reflects exactly what has succeeded so far.
function consolidate({ store, runId, cao, cps, words, asrTimings, ids, now, mode = 'items', sourceKind = 'unknown' }) {
  const persisted = store.getSegments(runId);
  const coverage = createCoverage(words.length);
  const rawItems = [];

  for (const seg of persisted) {
    const segKey = `seg_${seg.segment_index}`;
    coverage.assign(segKey, seg.range, seg.status === 'merged' ? 'merged' : seg.status);
    if (seg.status === 'merged') { coverage.markMerged(segKey); for (const it of seg.items) rawItems.push(it); }
    else if (seg.status === 'failed') coverage.markFailed(segKey);
  }

  const finalized = mode === 'events'
    ? consolidateEvents(rawItems, { cps, words, asrTimings, ids, sourceKind })
    : merge.finalizeItems(extract.normalizeExtraction(rawItems, { ids, cps, words, asrTimings }), words);
  const cov = coverage.report();

  const nextCao = {
    ...cao,
    schema_version: cao.schema_version || require('./schema').SCHEMA_VERSION,
    items: finalized.items,
    presence: finalized.presence,
    validation: finalized.validation,
    counts: { words: words.length, structureUnits: (cao.structure || []).length, items: finalized.items.length },
  };

  const existing = store.getRun(runId);
  const updated = store.putRun({
    ...existing,
    analysis_status: cov.complete ? 'complete' : 'partial',
    processing_coverage: cov,
    cao_json: nextCao,
    created_at: existing.created_at, // stable
  });
  return { ...updated, resumePlan: coverage.resumePlan() };
}

// consolidateEvents — Phase 1B reduce stage.
//   raw event records -> grounded events -> DERIVED tasks -> template-compatible
//   items. The model's job ended at "what was said"; everything below is
//   deterministic and auditable.
function consolidateEvents(rawRecords, { cps, words, asrTimings, ids, sourceKind }) {
  const issues = [];
  const events = [];
  const quotes = [];
  let n = 0;

  const evidenceFor = (range) => buildEvidence({ evidenceId: ids.evidenceId(), rawWordRange: range, cps, words, asrTimings });

  for (const rec of rawRecords || []) {
    if (!rec || !Array.isArray(rec.range)) continue;
    const [a, b] = rec.range;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a || b >= words.length) {
      issues.push({ issues: ['event-ungrounded→dropped'] }); continue;
    }
    if (rec.type === 'quote') {
      quotes.push(constructQuote({
        itemId: ids.itemId(), evidenceId: ids.evidenceId(), rawWordRange: rec.range,
        cps, words, asrTimings, corrections: rec.corrections || [],
      }));
      continue;
    }
    if (!EVENT_TYPES.includes(rec.type)) continue;

    const evidence = evidenceFor(rec.range);
    // Defence in depth: a decision event whose wording is hedged/conditional is
    // suppressed here even if the model labelled it as settled.
    if (rec.type === 'decisionAgreement' || rec.type === 'decisionRevision') {
      if (validate.hasHypotheticalModality({ evidence })) {
        issues.push({ issues: ['decision-hypothetical→suppressed'] });
        continue;
      }
    }
    const spec = {
      eventId: `event_${++n}`,
      type: rec.type,
      evidence,
      confidence: rec.confidence,
      turnIndex: rec.turnIndex,
    };
    if (rec.speaker && rec.speakerSpan) { spec.speaker = rec.speaker; spec.speakerEvidence = evidenceFor(rec.speakerSpan); }
    if (rec.addressee && rec.addresseeSpan) { spec.addressee = rec.addressee; spec.addresseeEvidence = evidenceFor(rec.addresseeSpan); }
    if (rec.dueText && rec.dueSpan) { spec.dueText = rec.dueText; spec.dueEvidence = evidenceFor(rec.dueSpan); }
    if (rec.cueSpan) spec.cueEvidence = evidenceFor(rec.cueSpan);
    const event = makeEvent(spec);
    event.relevance = classifyCommitmentRelevance(event, { sourceKind });
    events.push(event);
  }

  const derived = deriveTasks(events, { sourceKind });

  // Map back onto the item shape templates and scoring already understand.
  const items = [...quotes];
  for (const t of derived.tasks) {
    items.push({
      itemId: ids.itemId(), kind: 'task', status: t.status,
      text: t.description, evidence: t.taskEvidence,
      owner: t.owner || undefined, proposedOwner: t.proposedOwner || undefined,
      due: t.due || undefined,
      assignmentEventId: t.assignmentEventId, acceptanceEventId: t.acceptanceEventId,
      commitmentEventId: t.commitmentEventId, declineEventId: t.declineEventId,
      actorEvidence: t.actorEvidence, addresseeEvidence: t.addresseeEvidence,
      dueEvidence: t.dueEvidence, statusEvidence: t.statusEvidence,
      relationshipConfidence: t.relationshipConfidence,
    });
  }
  for (const c of derived.commitments) {
    items.push({ itemId: ids.itemId(), kind: 'commitment', text: c.evidence.rawText, evidence: c.evidence, relevance: c.relevance, taskEligible: c.taskEligible, speaker: c.speaker || undefined });
  }
  for (const e of events) {
    const map = {
      audienceAdvice: 'advice', promotionalCTA: 'cta', recommendation: 'advice',
      risk: 'risk', question: 'question',
      decisionAgreement: 'decision', decisionRevision: 'decision', decisionRescission: 'decision',
      decisionProposal: 'decisionProposal',
    };
    const kind = map[e.type];
    if (!kind) continue;
    items.push({ itemId: ids.itemId(), kind, text: e.evidence.rawText, evidence: e.evidence, lifecycle: kind === 'decision' ? lifecycleFor(e.type) : undefined });
  }

  const has = (k) => items.some((i) => i.kind === k);
  const presence = {
    decisions: has('decision'),
    commitments: has('commitment'),
    actions: derived.tasks.some((t) => t.status === 'committed' || t.status === 'requested'),
    quotes: quotes.length > 0,
    risks: has('risk'),
    questions: has('question'),
    advice: has('advice'),
    ctas: has('cta'),
  };

  return { items, presence, validation: { issues, dropped: [], needsAdjudication: [] }, events, derivedTasks: derived.tasks };
}

function lifecycleFor(type) {
  return { decisionAgreement: 'agreed', decisionRevision: 'revised', decisionRescission: 'rescinded' }[type] || 'proposed';
}

function persistCao(store, run, cao, status, now) {
  const existing = store.getRun(run.analysis_run_id);
  store.putRun({ ...existing, analysis_status: status, cao_json: cao, created_at: existing.created_at });
}

function sampleText(canonical) {
  const cps = Array.from(canonical);
  const n = cps.length;
  if (n <= 4500) return canonical;
  const slice = (a, b) => cps.slice(a, b).join('');
  return [slice(0, 1500), slice(Math.floor(n / 2) - 750, Math.floor(n / 2) + 750), slice(n - 1500, n)].join('\n…\n');
}

module.exports = { executeRun, resumeRun, consolidate, CancelledError };
