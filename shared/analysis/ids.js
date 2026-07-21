// ids.js — typed identifiers.
//
// Contract amendment (spec §0.2): the five id kinds are DISTINCT types and must
// never be interchanged. An item id is not an evidence id. Every id carries a
// type prefix so a mix-up is caught structurally rather than silently accepted.
//
//   analysisRunId    arun_...
//   renderArtifactId rart_...
//   itemId           item_...
//   evidenceId       evid_...
//   segmentId        seg_...
//
// The mint function is injectable (rand) so tests are deterministic; production
// uses crypto.randomUUID.

'use strict';

const crypto = require('crypto');

const PREFIX = Object.freeze({
  analysisRun: 'arun',
  renderArtifact: 'rart',
  item: 'item',
  evidence: 'evid',
  segment: 'seg',
});

const PREFIX_TO_KIND = Object.freeze(
  Object.fromEntries(Object.entries(PREFIX).map(([k, v]) => [v, k]))
);

// createIdFactory({ rand }) — rand() returns a unique string. Defaults to a UUID.
function createIdFactory(opts = {}) {
  let seq = 0;
  const rand = opts.rand || (() => crypto.randomUUID());
  const mint = (kind) => {
    const p = PREFIX[kind];
    if (!p) throw new Error(`unknown id kind: ${kind}`);
    // seq guarantees uniqueness even if a deterministic rand repeats.
    seq += 1;
    return `${p}_${rand()}_${seq.toString(36)}`;
  };
  return {
    analysisRunId: () => mint('analysisRun'),
    renderArtifactId: () => mint('renderArtifact'),
    itemId: () => mint('item'),
    evidenceId: () => mint('evidence'),
    segmentId: () => mint('segment'),
  };
}

function kindOf(id) {
  if (typeof id !== 'string') return null;
  const p = id.split('_')[0];
  return PREFIX_TO_KIND[p] || null;
}

function isId(id, kind) {
  return kindOf(id) === kind;
}

// assertId — throws unless id is the expected kind. Use at every boundary where
// an id crosses from one contract to another.
function assertId(id, kind, where) {
  if (!isId(id, kind)) {
    throw new TypeError(
      `${where || 'id'}: expected ${kind} id (${PREFIX[kind]}_…), got ${JSON.stringify(id)}`
    );
  }
  return id;
}

module.exports = { PREFIX, createIdFactory, kindOf, isId, assertId };
