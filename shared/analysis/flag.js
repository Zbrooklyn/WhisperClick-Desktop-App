// flag.js — the single Phase-0 feature gate.
//
// The entire summary-system-v2 foundation lives behind WC_ANALYSIS_V2. It is
// DEFAULT OFF. Nothing in this module reads or writes production data, and the
// visible Review experience must not change while the flag is off.
//
// Reading order: env var wins; otherwise an explicit opts override; otherwise
// off. Kept deliberately dumb so both the web server and the Electron main
// process resolve the flag identically (parity requirement).

'use strict';

const FLAG_NAME = 'WC_ANALYSIS_V2';

function truthy(v) {
  if (v === true) return true;
  if (typeof v === 'number') return v === 1;
  if (typeof v !== 'string') return false;
  return ['1', 'true', 'on', 'yes'].includes(v.trim().toLowerCase());
}

// enabled({ env, override }) — env defaults to process.env. override, when a
// boolean, forces the answer (used by tests and by an explicit user setting).
function enabled(opts = {}) {
  if (typeof opts.override === 'boolean') return opts.override;
  const env = opts.env || process.env || {};
  return truthy(env[FLAG_NAME]);
}

module.exports = { FLAG_NAME, enabled, truthy };
