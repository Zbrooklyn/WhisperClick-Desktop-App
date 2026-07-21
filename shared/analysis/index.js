// index.js — public surface of the Phase-0 analysis foundation.
//
// Everything here is behind the WC_ANALYSIS_V2 flag at the call sites (web
// server / Electron main). Importing this module has no side effects and does
// not touch production data.

'use strict';

module.exports = {
  flag: require('./flag'),
  ids: require('./ids'),
  text: require('./text'),
  evidence: require('./evidence'),
  quotes: require('./quotes'),
  validate: require('./validate'),
  coverage: require('./coverage'),
  segment: require('./segment'),
  profile: require('./profile'),
  extract: require('./extract'),
  merge: require('./merge'),
  schema: require('./schema'),
  modelAdapter: require('./model-adapter'),
  store: require('./store'),
  migrate: require('./migrate'),
  pipeline: require('./pipeline'),
};
