// assemble.js — deterministic derivation of operational tasks from grounded
// speech events (Phase 1B §2, §3, §4).
//
// The model never decides "is this a task". It reports what was said. THIS file
// decides what those utterances add up to, using explicit rules that can be
// unit-tested and audited. A derived task may cite evidence from several
// speaker turns — that is the whole point, and it is why the Phase-1A
// requirement that all relationship evidence live inside one span was wrong.
//
// Supported derivations:
//   selfCommitment                      -> status committed, owner = speaker
//   assignmentRequest + acceptance      -> status committed, owner = accepting speaker
//   assignmentRequest alone             -> status requested, proposed owner only
//                                          if directly addressed, NEVER a due date
//   decline / cancellation              -> status declined / cancelled (not active)
//   completionClaim                     -> status completed
//
// Non-operational events (audienceAdvice, promotionalCTA, recommendation) can
// NEVER produce a task, regardless of imperative phrasing. That is the
// structural fix for "advice persisted as an assigned task".

'use strict';

const { isNonOperational, classifyCommitmentRelevance } = require('./events');

const STATUS = Object.freeze(['committed', 'requested', 'declined', 'cancelled', 'completed']);

// How far after a request we will look for its acceptance, in raw words. Wide
// enough for a normal adjacency pair, narrow enough that unrelated later turns
// cannot be captured.
const PAIRING_WINDOW_WORDS = 250;

const OWNER_MIN_CONFIDENCE = 0.6;

const start = (e) => (e.evidence && e.evidence.rawWordRange ? e.evidence.rawWordRange[0] : -1);
const sameActor = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// dueValueGrounded — a due may only be carried when its own span's wording
// supports it (the Phase-1A rule, retained).
function dueValueGrounded(ev) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const spanText = norm(ev && ev.dueEvidence && ev.dueEvidence.rawText);
  const value = norm(ev && ev.dueText);
  if (!spanText || !value) return false;
  return spanText.includes(value) || value.includes(spanText);
}

// deriveTasks(events, ctx) -> { tasks, commitments, decisions, unused }
function deriveTasks(events, ctx = {}) {
  const ordered = [...events].filter((e) => start(e) >= 0).sort((a, b) => start(a) - start(b));
  const consumed = new Set();
  const tasks = [];

  const requests = ordered.filter((e) => e.type === 'assignmentRequest');
  const responses = ordered.filter((e) => ['acceptance', 'decline'].includes(e.type));

  // ---- pattern 1 + 3 + 4: assignmentRequest, optionally answered -----------
  for (const req of requests) {
    const answer = findResponse(req, responses, consumed);
    if (answer) {
      consumed.add(answer.eventId);
      consumed.add(req.eventId);
      if (answer.type === 'decline') {
        tasks.push(buildTask({
          status: 'declined', request: req, response: answer, ctx,
          statusEvidence: answer.evidence,
        }));
      } else {
        tasks.push(buildTask({
          status: 'committed', request: req, response: answer, ctx,
          statusEvidence: answer.evidence,
        }));
      }
    } else {
      consumed.add(req.eventId);
      // Requested-only: a proposed owner is allowed ONLY when the request
      // directly addresses a grounded person, and NO due date may be taken —
      // an unanswered request has no agreed deadline.
      tasks.push(buildTask({ status: 'requested', request: req, response: null, ctx, statusEvidence: req.evidence }));
    }
  }

  // ---- pattern 2: standalone self-commitments ------------------------------
  for (const ev of ordered) {
    if (ev.type !== 'selfCommitment' || consumed.has(ev.eventId)) continue;
    const relevance = ev.relevance || classifyCommitmentRelevance(ev, ctx);
    // Only operational commitments become tasks. Promotional / editorial /
    // future-content / conversational commitments stay recorded as commitments.
    if (relevance !== 'operational') continue;
    consumed.add(ev.eventId);
    tasks.push(buildTask({ status: 'committed', request: null, response: null, commitment: ev, ctx, statusEvidence: ev.evidence }));
  }

  // ---- cancellation / completion overrides --------------------------------
  for (const ev of ordered) {
    if (ev.type === 'cancellation') applyOverride(tasks, ev, 'cancelled');
    if (ev.type === 'completionClaim') applyOverride(tasks, ev, 'completed');
  }

  // ---- commitments preserved as facts (with relevance) --------------------
  const commitments = ordered
    .filter((e) => e.type === 'selfCommitment' || e.type === 'acceptance')
    .map((e) => ({
      eventId: e.eventId,
      evidence: e.evidence,
      speaker: e.speaker,
      relevance: e.relevance || classifyCommitmentRelevance(e, ctx),
      taskEligible: (e.relevance || classifyCommitmentRelevance(e, ctx)) === 'operational',
    }));

  const decisions = ordered.filter((e) => e.type.startsWith('decision'));
  const unused = ordered.filter((e) => !consumed.has(e.eventId) && !isNonOperational(e));

  return { tasks, commitments, decisions, unused };
}

// findResponse — pair a request with its acceptance/decline.
//   Accepts an explicit reference (best), or the nearest following response
//   within the pairing window whose speaker matches the addressee (when the
//   addressee is known). A response by someone other than the addressee is not
//   paired — that is how "Dana, can you…" avoids being answered by Marcus.
function findResponse(req, responses, consumed) {
  const reqStart = start(req);
  let best = null;
  for (const r of responses) {
    if (consumed.has(r.eventId)) continue;
    const explicit = Array.isArray(r.refs) && r.refs.includes(req.eventId);
    const rStart = start(r);
    if (!explicit) {
      if (rStart <= reqStart) continue;
      if (rStart - reqStart > PAIRING_WINDOW_WORDS) continue;
      if (req.addressee && r.speaker && !sameActor(req.addressee, r.speaker)) continue;
      if (req.addressee && !r.speaker) continue; // cannot confirm who answered
    }
    if (!best || start(r) < start(best)) best = r;
    if (explicit) { best = r; break; }
  }
  return best;
}

// applyOverride — a cancellation/completion may only change a task's status when
// it is EXPLICITLY linked to that task, either by event reference or by clear
// topical overlap with the task's own wording.
//
// The earlier "nearest preceding task" fallback was unsafe: a live run had
// "It's half done." (a completionClaim about a different item) silently flip an
// unrelated task to `completed`. Telling someone work is finished when nobody
// said so is precisely the fabrication class this system exists to prevent, so
// an unlinked override now changes nothing and is recorded instead.
function applyOverride(tasks, ev, status) {
  const refIds = Array.isArray(ev.refs) ? ev.refs : [];
  let target = tasks.find((t) => refIds.some((id) => t.assignmentEventId === id || t.commitmentEventId === id || t.acceptanceEventId === id || t.declineEventId === id));

  if (!target) {
    // topical fallback: require substantial content-word overlap with the task
    const evWords = contentWords(ev.evidence && ev.evidence.rawText);
    if (evWords.size >= 2) {
      let best = null; let bestScore = 0;
      for (const t of tasks) {
        const tw = contentWords(t.description);
        let shared = 0;
        for (const w of evWords) if (tw.has(w)) shared++;
        const score = shared / Math.max(1, Math.min(evWords.size, tw.size));
        if (score > bestScore) { bestScore = score; best = t; }
      }
      if (bestScore >= 0.5) target = best;
    }
  }

  if (!target) return { applied: false, reason: 'override-unlinked→ignored' };
  target.status = status;
  target.statusEvidence = ev.evidence;
  return { applied: true };
}

const STOPWORDS = new Set(['the', 'a', 'an', 'that', 'this', 'it', 'is', 'are', 'was', 'were', 'to', 'of', 'and', 'or', 'we', 'i', 'you', 'he', 'she', 'they', 'on', 'in', 'for', 'with', 'be', 'been', 'its', 'not', 'no', 'do', 'does', 'did', 'so', 'up', 'out']);
function contentWords(s) {
  const out = new Set();
  for (const w of String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    if (w.length > 2 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

// buildTask — assembles the task object with MULTI-SPAN relationship evidence.
function buildTask({ status, request, response, commitment, ctx, statusEvidence }) {
  const source = commitment || response || request;
  const taskEvidence = (request || commitment || response).evidence;

  // --- owner resolution -----------------------------------------------------
  let owner = null; let actorEvidence = null; let addresseeEvidence = null; let proposedOwner = null;
  if (commitment) {
    // self-commitment: the speaker owns it
    if (commitment.speaker && commitment.speakerEvidence) { owner = commitment.speaker; actorEvidence = commitment.speakerEvidence; }
  } else if (response && response.type === 'acceptance') {
    // assignment + acceptance: the accepting speaker owns it
    if (response.speaker && response.speakerEvidence) { owner = response.speaker; actorEvidence = response.speakerEvidence; }
    else if (request.addressee && request.addresseeEvidence) { owner = request.addressee; actorEvidence = request.addresseeEvidence; }
    if (request && request.addresseeEvidence) addresseeEvidence = request.addresseeEvidence;
  } else if (request) {
    // request only: a PROPOSED owner, never a confirmed one
    if (request.addressee && request.addresseeEvidence) { proposedOwner = request.addressee; addresseeEvidence = request.addresseeEvidence; }
  }

  // --- due resolution -------------------------------------------------------
  // Only an accepted/committed task may carry a deadline, and only from an event
  // whose own due span supports the value.
  let due = null; let dueEvidence = null;
  if (status === 'committed') {
    const dueSource = [response, commitment, request].find((e) => e && e.dueEvidence && dueValueGrounded(e));
    if (dueSource) { due = dueSource.dueText; dueEvidence = dueSource.dueEvidence; }
  }

  // --- relationship confidence ---------------------------------------------
  let rc = 0.5;
  if (request && response) {
    rc = 0.6;
    if (Array.isArray(response.refs) && response.refs.includes(request.eventId)) rc += 0.2;
    if (request.addressee && response.speaker && sameActor(request.addressee, response.speaker)) rc += 0.2;
  } else if (commitment) {
    rc = 0.6;
    if (commitment.speakerEvidence) rc += 0.2;
  } else if (request) {
    rc = 0.4; // unanswered request: deliberately below the owner-assertion bar
    if (request.addresseeEvidence) rc += 0.15;
  }
  if (dueEvidence) rc += 0.1;
  rc = Math.min(1, Number(rc.toFixed(2)));

  // Owner is only ASSERTED above the confidence bar; below it, it degrades to a
  // proposal rather than being silently dropped (information is kept, not hidden).
  if (owner && rc < OWNER_MIN_CONFIDENCE) { proposedOwner = owner; owner = null; }

  return {
    kind: 'task',
    status,
    description: (taskEvidence && taskEvidence.rawText) || '',
    owner,
    proposedOwner,
    due,
    // multi-span relationship evidence (Phase 1B §4)
    assignmentEventId: request ? request.eventId : null,
    acceptanceEventId: response && response.type === 'acceptance' ? response.eventId : null,
    commitmentEventId: commitment ? commitment.eventId : (response && response.type === 'acceptance' ? response.eventId : null),
    declineEventId: response && response.type === 'decline' ? response.eventId : null,
    actorEvidence,
    addresseeEvidence,
    taskEvidence,
    dueEvidence,
    statusEvidence: statusEvidence || null,
    relationshipConfidence: rc,
    sourceTurns: [request, response, commitment].filter(Boolean).map((e) => e.eventId),
  };
}

module.exports = { deriveTasks, buildTask, findResponse, STATUS, PAIRING_WINDOW_WORDS, OWNER_MIN_CONFIDENCE, dueValueGrounded };
