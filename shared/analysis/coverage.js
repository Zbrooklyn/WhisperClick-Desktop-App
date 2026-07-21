// coverage.js — processing coverage tracking.
//
// Contract amendment (spec §0.2): the old "guaranteed recall" claim is renamed
// to PROCESSING COVERAGE and means exactly, and only, this:
//   - every raw word is assigned to at least one segment,
//   - every segment reaches a terminal status (merged | failed),
//   - every successful segment is merged,
//   - every failed range is VISIBLE (never silently dropped),
//   - there is no silent missing range.
// It does NOT claim the model understood or recalled everything — that is a
// corpus question, not a coverage question.
//
// This tracker is also what makes a run resumable: a run whose report is not
// `complete` lists precisely which segments are still pending/failed and which
// word ranges are uncovered, so a resume knows what remains.

'use strict';

// createCoverage(totalWords)
function createCoverage(totalWords) {
  const segments = new Map(); // segmentId -> { range:[a,b], status, merged }

  function assign(segmentId, range, status = 'pending') {
    segments.set(segmentId, { range: [range[0], range[1]], status, merged: false });
  }
  function setStatus(segmentId, status) {
    const s = segments.get(segmentId);
    if (s) s.status = status;
  }
  function markMerged(segmentId) {
    const s = segments.get(segmentId);
    if (s) { s.merged = true; s.status = 'merged'; }
  }
  function markFailed(segmentId) {
    const s = segments.get(segmentId);
    if (s) s.status = 'failed';
  }

  function report() {
    // Build a per-word "covered by a terminal, successful segment" bitmap.
    const coveredOk = new Array(totalWords).fill(false);
    const failedWords = new Array(totalWords).fill(false);
    let pending = 0;
    for (const s of segments.values()) {
      const [a, b] = s.range;
      const terminalOk = s.status === 'merged';
      const failed = s.status === 'failed';
      if (s.status === 'pending') pending++;
      for (let i = a; i <= b && i < totalWords; i++) {
        if (terminalOk) coveredOk[i] = true;
        if (failed) failedWords[i] = true;
      }
    }
    const unassignedRanges = collapse(coveredOk, false, totalWords);
    const failedRanges = collapse(failedWords, true, totalWords);
    const assignedWords = coveredOk.filter(Boolean).length;

    const complete =
      pending === 0 &&
      unassignedRanges.length === 0 &&
      failedRanges.length === 0;

    return {
      totalWords,
      assignedWords,
      pendingSegments: pending,
      unassignedRanges, // words with no successful terminal segment
      failedRanges,     // words whose only coverage was a failed segment
      segments: [...segments.entries()].map(([id, s]) => ({ segmentId: id, range: s.range, status: s.status, merged: s.merged })),
      complete,
      status: complete ? 'complete' : (failedRanges.length ? 'failed' : 'partial'),
    };
  }

  // resumePlan() -> the segments a resume must still run (pending or failed).
  function resumePlan() {
    return [...segments.entries()]
      .filter(([, s]) => s.status === 'pending' || s.status === 'failed')
      .map(([id, s]) => ({ segmentId: id, range: s.range, status: s.status }));
  }

  return { assign, setStatus, markMerged, markFailed, report, resumePlan };
}

// collapse(bitmap, wantValue, n) -> list of [start,end] ranges where bitmap===wantValue
function collapse(bitmap, wantValue, n) {
  const ranges = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (bitmap[i] === wantValue) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      ranges.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) ranges.push([start, n - 1]);
  return ranges;
}

module.exports = { createCoverage };
