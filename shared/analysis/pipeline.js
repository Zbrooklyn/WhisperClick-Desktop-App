// pipeline.js — the flagged orchestrator.
//
// Wires the deterministic foundation to the model adapter:
//   canonicalize -> tokenize -> profile(provisional) -> detect+merge structure
//   -> window-segment (full coverage) -> extract per segment -> construct quotes
//   -> validate + reconcile + dedupe -> derive FINAL presence -> coverage report
//   -> assemble AnalysisRun.  render() then presents an AnalysisRun WITHOUT any
//   further model calls, and openAnalysis() reads persisted state with ZERO
//   adapter calls (the zero-generation-on-open guarantee).
//
// Nothing here runs unless a caller behind the WC_ANALYSIS_V2 flag invokes it.

'use strict';

const text = require('./text');
const segment = require('./segment');
const profileMod = require('./profile');
const extract = require('./extract');
const merge = require('./merge');
const { createCoverage } = require('./coverage');
const { createIdFactory } = require('./ids');
const schema = require('./schema');

// buildAnalysisRun(opts) -> AnalysisRun (unpersisted) | { setupRequired }
async function buildAnalysisRun(opts) {
  const {
    noteId, rawTranscript, adapter, asrTimings = null,
    windowTokens, now = Date.now,
  } = opts;
  const ids = opts.ids || createIdFactory();

  // Degrade to transcript-only when no model can analyze (spec §0.1 #3).
  const cap = adapter.capabilities ? adapter.capabilities() : { canAnalyze: false };
  if (!cap.canAnalyze) {
    return {
      setupRequired: true,
      reason: cap.reason || 'no configured model',
      note_id: noteId,
    };
  }

  const canonical = text.canonicalize(rawTranscript);
  const { cps, words } = text.tokenize(canonical);

  // 1) provisional profile from a representative sample (NOT authoritative).
  const sample = sampleText(canonical);
  const profile = profileMod.normalizeProfile(await adapter.profile({ sampleText: sample }));

  // 2) structure across the COMPLETE source, then global merge.
  let structureUnits = [];
  try {
    const candidates = await adapter.detectStructure({ text: canonical, words });
    structureUnits = segment.mergeStructureUnits(candidates, words.length);
  } catch { structureUnits = []; }

  // 3) window-segment the whole document (guarantees full coverage).
  const segs = segment.windowSegments(words, { windowTokens });
  const coverage = createCoverage(words.length);
  const rawItems = [];
  for (const s of segs) {
    const segId = ids.segmentId();
    coverage.assign(segId, s.range, 'pending');
    try {
      const got = await adapter.extract({
        range: s.range,
        segmentText: text.rawTextForRange(cps, words, s.range[0], s.range[1]),
        words,
      });
      for (const it of got) rawItems.push(it);
      coverage.markMerged(segId);
    } catch {
      coverage.markFailed(segId); // failure stays VISIBLE (resumable)
    }
  }

  // 4) normalize -> construct quotes/evidence -> validate/reconcile/dedupe.
  const typed = extract.normalizeExtraction(rawItems, { ids, cps, words, asrTimings });
  const finalized = merge.finalizeItems(typed, words);

  const cov = coverage.report();
  const status = cov.complete ? 'complete' : 'partial';

  const rawVersion = text.rawContentVersion(canonical);
  const cao = {
    schema_version: schema.SCHEMA_VERSION,
    structure: structureUnits,
    items: finalized.items,
    presence: finalized.presence,          // FINAL, post-validation, whole-source
    profile,                               // provisional, retained + labeled
    validation: finalized.validation,
    counts: {
      words: words.length,
      structureUnits: structureUnits.length,
      items: finalized.items.length,
    },
  };

  return {
    analysis_run_id: ids.analysisRunId(),
    note_id: noteId,
    raw_version: rawVersion,
    normalized_version: `nfc-lf@${rawVersion}`, // phase 0: canonicalization only
    schema_version: schema.SCHEMA_VERSION,
    analysis_status: status,
    processing_coverage: cov,
    cao_json: cao,
    model_policy: adapter.modelPolicy || null,
    created_at: now(),
    resumePlan: coverage.resumePlan(),      // non-persisted helper for a resume
  };
}

// renderArtifact(opts) -> RenderedArtifact. Presents an existing AnalysisRun; it
// makes NO model calls and does NOT re-extract. A template change re-renders
// from the same run.
function renderArtifact(opts) {
  const { analysisRun, templateId = 'default', templateVersion = '1', depth = 'standard', language = 'en' } = opts;
  const ids = opts.ids || createIdFactory();
  const cao = analysisRun.cao_json;
  const eligible = profileMod.eligiblePresentation(cao.profile || {});
  const presence = cao.presence || {};

  const sections = {};
  const byKind = (k) => cao.items.filter((it) => it.kind === k);
  if (presence.decisions) sections.decisions = byKind('decision');
  if (presence.actions) sections.actions = byKind('task');
  if (presence.quotes && eligible.showQuotes) sections.quotes = byKind('quote');
  if (presence.advice && eligible.showAdvice) sections.advice = byKind('advice');
  if (presence.ctas && eligible.showCtas) sections.ctas = byKind('cta');
  if (presence.questions) sections.questions = byKind('question');
  if (presence.risks) sections.risks = byKind('risk');
  sections.structure = cao.structure;

  return {
    render_artifact_id: ids.renderArtifactId(),
    analysis_run_id: analysisRun.analysis_run_id,
    note_id: analysisRun.note_id,
    template_id: templateId,
    template_version: templateVersion,
    depth,
    language,
    presentation: { leadWith: eligible.leadWithDecisions ? 'decisions' : 'overview' },
    rendered_sections: sections,
    user_modifications: {},
    pinned: false,
    created_at: opts.now ? opts.now() : Date.now(),
  };
}

// openAnalysis(store, noteId) -> { run, artifact } | null
//   The read path for opening a note. Takes NO adapter and makes ZERO model
//   calls — this is the zero-generation-on-open guarantee, enforced by the fact
//   that `adapter` is not even a parameter here.
function openAnalysis(store, noteId) {
  const run = store.latestCompleteRun(noteId);
  if (!run) return null;
  const artifact = store.latestArtifact(noteId);
  return { run, artifact };
}

function sampleText(canonical) {
  // Representative sample: head + middle + tail (never the whole thing — that is
  // the point of a "sample"). Enough to hint content type, not to declare it.
  const cps = Array.from(canonical);
  const n = cps.length;
  if (n <= 4500) return canonical;
  const slice = (a, b) => cps.slice(a, b).join('');
  return [slice(0, 1500), slice(Math.floor(n / 2) - 750, Math.floor(n / 2) + 750), slice(n - 1500, n)].join('\n…\n');
}

module.exports = { buildAnalysisRun, renderArtifact, openAnalysis, sampleText };
