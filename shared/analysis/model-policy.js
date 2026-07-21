// model-policy.js — capability-tier configuration.
//
// Contract amendment (spec §0.1 #1): models are chosen by CAPABILITY TIER, never
// by hard-coded model id inside pipeline logic. Provider and model selection are
// CONFIGURATION and live here (or in env), not in pipeline.js / live-adapter.js.
//
// Guards:
//  - An "approved models" allow-list. Requesting a model outside it throws
//    UNAPPROVED_MODEL — the system never silently substitutes a weaker model.
//  - A tier with no configured model throws TIER_NOT_CONFIGURED rather than
//    guessing.

'use strict';

const TIERS = Object.freeze(['reasoning', 'extraction', 'cleanup']);

// The config-layer defaults. These are the ONLY place model ids appear, and even
// here they are overridable by env. Pipeline logic must never name a model.
const DEFAULTS = Object.freeze({
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  approvedModels: ['gpt-4o', 'gpt-4o-mini'],
  tiers: {
    reasoning: { model: 'gpt-4o', params: { temperature: 0.1 } },
    extraction: { model: 'gpt-4o-mini', params: { temperature: 0.1 } },
    cleanup: { model: 'gpt-4o-mini', params: { temperature: 0.2 } },
  },
});

function csv(v) { return String(v || '').split(',').map((s) => s.trim()).filter(Boolean); }

// resolvePolicy(env, overrides) -> a frozen policy object (NO api key inside).
function resolvePolicy(env = process.env, overrides = {}) {
  const provider = overrides.provider || env.WC_ANALYSIS_PROVIDER || DEFAULTS.provider;
  const baseUrl = overrides.baseUrl || env.WC_ANALYSIS_BASE_URL || DEFAULTS.baseUrl;
  const apiKeyEnv = overrides.apiKeyEnv || env.WC_ANALYSIS_KEY_ENV || DEFAULTS.apiKeyEnv;
  const approved = new Set(
    overrides.approvedModels || (env.WC_ANALYSIS_APPROVED_MODELS ? csv(env.WC_ANALYSIS_APPROVED_MODELS) : DEFAULTS.approvedModels)
  );

  const tierModel = (name, envKey, dflt) =>
    (overrides.tiers && overrides.tiers[name] && overrides.tiers[name].model) || env[envKey] || dflt;

  const tiers = {
    reasoning: { model: tierModel('reasoning', 'WC_MODEL_REASONING', DEFAULTS.tiers.reasoning.model), params: DEFAULTS.tiers.reasoning.params },
    extraction: { model: tierModel('extraction', 'WC_MODEL_EXTRACTION', DEFAULTS.tiers.extraction.model), params: DEFAULTS.tiers.extraction.params },
    cleanup: { model: tierModel('cleanup', 'WC_MODEL_CLEANUP', DEFAULTS.tiers.cleanup.model), params: DEFAULTS.tiers.cleanup.params },
  };

  return Object.freeze({
    provider, baseUrl, apiKeyEnv,
    approvedModels: approved,
    tiers: Object.freeze(tiers),
    // sanitized() strips nothing sensitive (there is no key here) but returns a
    // plain, loggable/persistable descriptor.
    sanitized() {
      return {
        provider, baseUrl, apiKeyEnv,
        approvedModels: [...approved],
        tiers: { reasoning: tiers.reasoning.model, extraction: tiers.extraction.model, cleanup: tiers.cleanup.model },
      };
    },
  });
}

// requireTier(policy, tierName) -> { model, params } or throws.
function requireTier(policy, tierName) {
  if (!TIERS.includes(tierName)) throw typedError('UNKNOWN_TIER', `unknown tier: ${tierName}`);
  const t = policy.tiers[tierName];
  if (!t || !t.model) throw typedError('TIER_NOT_CONFIGURED', `no model configured for tier "${tierName}"`);
  assertApproved(policy, t.model);
  return t;
}

// assertApproved — the anti-substitution guard.
function assertApproved(policy, model) {
  if (!policy.approvedModels.has(model)) {
    throw typedError('UNAPPROVED_MODEL', `model "${model}" is not in the approved allow-list [${[...policy.approvedModels].join(', ')}]`);
  }
  return model;
}

function typedError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

module.exports = { TIERS, DEFAULTS, resolvePolicy, requireTier, assertApproved, typedError };
