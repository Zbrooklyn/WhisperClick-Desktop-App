// model-adapter.js — the seam between the deterministic foundation and the
// (non-deterministic) model.
//
// Contract amendments (spec §0.1 #1, #3):
//  - Models are chosen by CAPABILITY TIER, never by hard-coded model id. An
//    adapter advertises which tiers it can serve; the pipeline asks for a tier.
//  - With no cloud key and no capable local model the system must degrade to
//    transcript-only mode with an explicit setup state — the null adapter models
//    exactly that (capabilities().canAnalyze === false).
//
// Phase 0 ships two adapters:
//   createFixtureAdapter(recorded) — deterministic, offline; replays a recorded
//     model output. This is what the corpus/tests run against so the foundation
//     is proven without live, non-deterministic calls.
//   createNullAdapter() — the transcript-only / setup-required state.
// The live HTTP adapter to the Python engine is a Phase-1 seam and intentionally
// throws here so nothing accidentally makes real calls during Phase 0.

'use strict';

const TIERS = Object.freeze(['reasoning', 'extraction', 'cleanup']);

// createFixtureAdapter(recorded)
//   recorded = { modelPolicy?, profile, structureUnits, items }
//   items[].range is a GLOBAL word range [a,b]; extract() returns those whose
//   start falls inside the requested segment range.
function createFixtureAdapter(recorded) {
  const r = recorded || {};
  return {
    kind: 'fixture',
    modelPolicy: r.modelPolicy || { provider: 'fixture', tiers: { reasoning: 'fixture', extraction: 'fixture', cleanup: 'fixture' } },
    capabilities() { return { canAnalyze: true, reason: 'fixture adapter' }; },
    async profile() { return r.profile || { contentTypes: [], provisionalPresence: {} }; },
    async detectStructure() { return (r.structureUnits || []).map((u) => ({ ...u })); },
    async extract({ range }) {
      const [a, b] = range;
      return (r.items || [])
        .filter((it) => Array.isArray(it.range) && it.range[0] >= a && it.range[0] <= b)
        .map((it) => ({ ...it }));
    },
  };
}

// createFixtureEventAdapter(recorded) — the Phase-1B deterministic adapter.
//   recorded.events[] are raw event records with GLOBAL ranges, exactly as the
//   live adapter would return them after resolving spans. Lets the whole
//   events -> derived-tasks path be proven offline.
function createFixtureEventAdapter(recorded) {
  const r = recorded || {};
  const base = createFixtureAdapter(r);
  return {
    ...base,
    kind: 'fixture-events',
    async extractEvents({ range }) {
      const [a, b] = range;
      return (r.events || [])
        .filter((e) => Array.isArray(e.range) && e.range[0] >= a && e.range[0] <= b)
        .map((e) => ({ ...e }));
    },
  };
}

// createNullAdapter() — no analysis capability. Reaching for any model op throws
// a typed SETUP_REQUIRED so callers can present the transcript-only state.
function createNullAdapter() {
  const err = () => {
    const e = new Error('analysis unavailable: no cloud key and no capable local model configured');
    e.code = 'SETUP_REQUIRED';
    return e;
  };
  return {
    kind: 'null',
    modelPolicy: { provider: 'none', tiers: {} },
    capabilities() { return { canAnalyze: false, reason: 'no configured model' }; },
    async profile() { throw err(); },
    async detectStructure() { throw err(); },
    async extract() { throw err(); },
  };
}

// createLiveAdapter — the real implementation lives in live-adapter.js (Phase
// 1A). Re-exported here so callers have one adapter entry point. It is still
// only reachable behind WC_ANALYSIS_V2 and requires an explicitly configured,
// approved model + api key.
const { createLiveAdapter } = require('./live-adapter');

module.exports = { TIERS, createFixtureAdapter, createFixtureEventAdapter, createNullAdapter, createLiveAdapter };
