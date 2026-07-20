// schema.js — versioned contracts + the SINGLE source of the field sets that
// web and Electron must persist.
//
// Contract amendments (spec §0.2):
//  - AnalysisRun and RenderedArtifact are SEPARATE contracts. An AnalysisRun is
//    template-independent transcript-derived analysis; a RenderedArtifact is a
//    presentation of one AnalysisRun and must NOT carry transcript extraction.
//  - Web/Electron parity: both platforms import THIS module. Because the field
//    sets and serializers live in one place, parity is structural, not a promise
//    to be re-checked per platform.

'use strict';

const SCHEMA_VERSION = '0.1.0';

// The persisted column/field sets. Frozen so a platform cannot diverge locally.
const ANALYSIS_RUN_FIELDS = Object.freeze([
  'analysis_run_id', 'note_id', 'raw_version', 'normalized_version', 'schema_version',
  'analysis_status', 'processing_coverage', 'cao_json', 'model_policy', 'created_at',
]);

const RENDERED_ARTIFACT_FIELDS = Object.freeze([
  'render_artifact_id', 'analysis_run_id', 'note_id', 'template_id', 'template_version',
  'depth', 'language', 'presentation', 'rendered_sections', 'user_modifications',
  'pinned', 'created_at',
]);

// Item / evidence public contracts (what a consumer of the CAO can rely on).
const EVIDENCE_FIELDS = Object.freeze(['evidenceId', 'rawWordRange', 'derived', 'rawText', 'matchState']);
const ITEM_FIELDS = Object.freeze(['itemId', 'kind', 'evidence', 'text', 'structureUnitId']);

const ANALYSIS_STATUS = Object.freeze(['pending', 'partial', 'complete', 'failed']);

// ---- validators (hand-rolled; no ajv dependency) ----

function fail(errors, msg) { errors.push(msg); return errors; }

function validateAnalysisRun(run) {
  const errors = [];
  if (!run || typeof run !== 'object') return { ok: false, errors: ['not an object'] };
  if (!isId(run.analysis_run_id, 'arun')) fail(errors, 'analysis_run_id must be an arun_ id');
  if (!run.note_id) fail(errors, 'note_id required');
  if (run.schema_version !== SCHEMA_VERSION) fail(errors, `schema_version must be ${SCHEMA_VERSION}`);
  if (!ANALYSIS_STATUS.includes(run.analysis_status)) fail(errors, 'analysis_status invalid');
  if (!run.processing_coverage || typeof run.processing_coverage !== 'object') fail(errors, 'processing_coverage required');
  if (!run.cao_json || typeof run.cao_json !== 'object') fail(errors, 'cao_json required');
  // Separation guard: an AnalysisRun must NOT carry template/presentation fields.
  for (const forbidden of ['template_id', 'rendered_sections', 'presentation', 'depth', 'language']) {
    if (forbidden in run) fail(errors, `AnalysisRun must not carry RenderedArtifact field "${forbidden}"`);
  }
  return { ok: errors.length === 0, errors };
}

function validateRenderedArtifact(art) {
  const errors = [];
  if (!art || typeof art !== 'object') return { ok: false, errors: ['not an object'] };
  if (!isId(art.render_artifact_id, 'rart')) fail(errors, 'render_artifact_id must be a rart_ id');
  if (!isId(art.analysis_run_id, 'arun')) fail(errors, 'analysis_run_id must reference an arun_ id');
  if (!art.template_id) fail(errors, 'template_id required');
  // Separation guard: a RenderedArtifact must NOT carry raw transcript extraction.
  for (const forbidden of ['cao_json', 'processing_coverage', 'raw_version']) {
    if (forbidden in art) fail(errors, `RenderedArtifact must not carry AnalysisRun field "${forbidden}"`);
  }
  return { ok: errors.length === 0, errors };
}

function validateEvidence(ev, wordCount) {
  const errors = [];
  if (!ev || !Array.isArray(ev.rawWordRange)) return { ok: false, errors: ['rawWordRange required (primary anchor)'] };
  const [a, b] = ev.rawWordRange;
  if (!(Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= a)) fail(errors, 'rawWordRange malformed');
  if (typeof wordCount === 'number' && b >= wordCount) fail(errors, 'rawWordRange out of bounds');
  if (!ev.derived || typeof ev.derived !== 'object') fail(errors, 'derived offsets required');
  if (!['transcriptMatched', 'audioMapped', 'audioVerified'].includes(ev.matchState)) fail(errors, 'matchState invalid');
  return { ok: errors.length === 0, errors };
}

// minimal, dependency-free id-prefix check (mirrors ids.js without importing it
// so schema.js stays a leaf module both platforms can load cheaply).
function isId(id, prefix) {
  return typeof id === 'string' && id.startsWith(prefix + '_');
}

module.exports = {
  SCHEMA_VERSION,
  ANALYSIS_RUN_FIELDS, RENDERED_ARTIFACT_FIELDS, EVIDENCE_FIELDS, ITEM_FIELDS,
  ANALYSIS_STATUS,
  validateAnalysisRun, validateRenderedArtifact, validateEvidence,
};
