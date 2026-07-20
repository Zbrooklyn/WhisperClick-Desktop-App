// corpus/scoring.js — metrics + strong-section gates for the bake-off.
//
// Scores a produced AnalysisRun against a fixture's gold labels. Gold anchors are
// resolved to raw-word ranges with the same tokenizer the pipeline uses; a
// produced item matches gold when kinds agree and word ranges overlap.
//
// Design rule: severe failures are never averaged away. Aggregates are reported
// alongside the FULL list of individual failures, and the gates below are
// absolute (a single fabricated owner fails the gate regardless of the mean).

'use strict';

const text = require('../text');

const KIND_OF = { decisions: 'decision', commitments: 'commitment', tasks: 'task', advice: 'advice', ctas: 'cta', risks: 'risk' };

function overlap(a, b) { return a && b && a[0] <= b[1] && b[0] <= a[1]; }
function itemRange(it) { return it.evidence && it.evidence.rawWordRange; }

// resolveGold(fixture) -> { decisions:[range], commitments:[...], tasks:[{range,owner,due}], ... }
function resolveGold(fixture) {
  const canonical = text.canonicalize(fixture.text);
  const { cps, words } = text.tokenize(canonical);
  const res = (anchor) => text.resolvePhraseRangeWithin(words, anchor, 0, words.length - 1);
  const list = (arr) => (arr || []).map((a) => ({ anchor: a, range: res(a) })).filter((x) => x.range);
  const g = fixture.gold || {};
  return {
    cps, words, canonical,
    decisions: list(g.decisions), commitments: list(g.commitments),
    advice: list(g.advice), ctas: list(g.ctas), risks: list(g.risks),
    tasks: (g.tasks || []).map((t) => ({ ...t, range: res(t.anchor) })).filter((t) => t.range),
    mustNotProduce: g.mustNotProduce || {},
    structureUnits: g.structureUnits,
  };
}

// prf(producedRanges, goldRanges) -> { tp, fp, fn, precision, recall }
function prf(produced, gold) {
  const usedGold = new Set();
  let tp = 0;
  for (const p of produced) {
    const gi = gold.findIndex((g, i) => !usedGold.has(i) && overlap(p, g.range));
    if (gi >= 0) { usedGold.add(gi); tp++; }
  }
  const fp = produced.length - tp;
  const fn = gold.length - usedGold.size;
  const precision = (tp + fp) === 0 ? 1 : tp / (tp + fp);
  const recall = (tp + fn) === 0 ? 1 : tp / (tp + fn);
  return { tp, fp, fn, precision, recall };
}

// scoreFixture({ fixture, run, telemetry, pricing }) -> metrics + failures
function scoreFixture({ fixture, run, telemetry, pricing }) {
  const gold = resolveGold(fixture);
  const failures = [];
  const items = (run.cao_json && run.cao_json.items) || [];
  const byKind = (k) => items.filter((it) => it.kind === k);
  const rangesOf = (k) => byKind(k).map(itemRange).filter(Boolean);

  // --- per-category precision / recall ---
  const cat = {};
  for (const [goldKey, kind] of Object.entries(KIND_OF)) {
    cat[goldKey] = prf(rangesOf(kind), gold[goldKey] || []);
  }

  // --- absolute "must not produce" traps ---
  const mnp = gold.mustNotProduce;
  for (const [goldKey, anchors] of Object.entries(mnp)) {
    if (goldKey === 'owners') continue;
    const kind = KIND_OF[goldKey];
    if (!kind) continue;
    const produced = byKind(kind);
    if (anchors.includes('*')) {
      for (const p of produced) failures.push({ type: 'forbidden-item', kind, text: snippet(p), range: itemRange(p) });
    } else {
      for (const a of anchors) {
        const r = text.resolvePhraseRangeWithin(gold.words, a, 0, gold.words.length - 1);
        for (const p of produced) if (overlap(itemRange(p), r)) failures.push({ type: 'forbidden-item', kind, anchor: a, text: snippet(p) });
      }
    }
  }

  // --- cross-classification (advice/CTA vs task, CTA vs commitment) ---
  const misclass = { adviceAsTask: 0, ctaAsTask: 0, ctaAsCommitment: 0, adviceAsCommitment: 0 };
  for (const t of byKind('task')) {
    if (gold.advice.some((g) => overlap(itemRange(t), g.range))) { misclass.adviceAsTask++; failures.push({ type: 'advice-as-task', text: snippet(t) }); }
    if (gold.ctas.some((g) => overlap(itemRange(t), g.range))) { misclass.ctaAsTask++; failures.push({ type: 'cta-as-task', text: snippet(t) }); }
  }
  for (const c of byKind('commitment')) {
    if (gold.ctas.some((g) => overlap(itemRange(c), g.range))) { misclass.ctaAsCommitment++; failures.push({ type: 'cta-as-commitment', text: snippet(c) }); }
    if (gold.advice.some((g) => overlap(itemRange(c), g.range))) { misclass.adviceAsCommitment++; failures.push({ type: 'advice-as-commitment', text: snippet(c) }); }
  }

  // --- owner / due correctness ---
  const owners = { produced: 0, correct: 0, invented: 0, goldTotal: gold.tasks.filter((t) => t.owner).length, recalled: 0 };
  const dues = { produced: 0, correct: 0, invented: 0, goldTotal: gold.tasks.filter((t) => t.due).length, recalled: 0 };
  const forbiddenOwners = (mnp.owners || []).map((o) => o.toLowerCase());
  for (const t of byKind('task')) {
    const g = gold.tasks.find((x) => overlap(itemRange(t), x.range));
    if (t.owner != null) {
      owners.produced++;
      const ok = g && g.owner && String(t.owner).toLowerCase().includes(String(g.owner).toLowerCase());
      if (ok) { owners.correct++; owners.recalled++; }
      else { owners.invented++; failures.push({ type: 'invented-owner', owner: t.owner, text: snippet(t) }); }
      if (forbiddenOwners.some((f) => String(t.owner).toLowerCase().includes(f))) {
        failures.push({ type: 'forbidden-owner', owner: t.owner, text: snippet(t) });
      }
    }
    if (t.due != null) {
      dues.produced++;
      const ok = g && g.due && String(t.due).toLowerCase().includes(String(g.due).toLowerCase());
      if (ok) { dues.correct++; dues.recalled++; } else { dues.invented++; failures.push({ type: 'invented-due', due: t.due, text: snippet(t) }); }
    }
  }

  // --- quote-range validity (constructed text must equal the transcript slice) ---
  const quotes = byKind('quote');
  let validQuotes = 0;
  for (const q of quotes) {
    const r = itemRange(q);
    const slice = r ? text.rawTextForRange(gold.cps, gold.words, r[0], r[1]) : null;
    if (slice != null && slice === q.rawText) validQuotes++;
    else failures.push({ type: 'invalid-quote-range', text: snippet(q) });
  }
  const quoteRangeValidity = quotes.length ? validQuotes / quotes.length : 1;

  // --- evidence-range validity (all items in bounds) ---
  const n = gold.words.length;
  const inBounds = items.filter((it) => { const r = itemRange(it); return r && r[0] >= 0 && r[1] < n && r[1] >= r[0]; }).length;
  const evidenceValidity = items.length ? inBounds / items.length : 1;

  // --- structure ---
  const producedUnits = ((run.cao_json && run.cao_json.structure) || []).length;
  const structure = { produced: producedUnits, gold: gold.structureUnits, exact: gold.structureUnits == null ? null : producedUnits === gold.structureUnits };
  if (structure.exact === false) failures.push({ type: 'structure-count', produced: producedUnits, expected: gold.structureUnits });

  // --- coverage ---
  const cov = run.processing_coverage || {};
  const coverage = { complete: !!cov.complete, status: cov.status, failedRanges: (cov.failedRanges || []).length, unassignedRanges: (cov.unassignedRanges || []).length };
  const silentlyOmitted = !coverage.complete && coverage.failedRanges === 0 && coverage.unassignedRanges === 0;
  if (silentlyOmitted) failures.push({ type: 'silent-omission' });

  // --- rates ---
  const v = (run.cao_json && run.cao_json.validation) || { issues: [], dropped: [] };
  const suppressed = (v.issues || []).reduce((a, i) => a + ((i.issues || []).length), 0);
  const unresolved = (telemetry && telemetry.errors && telemetry.errors.UNRESOLVED) || 0;
  const proposed = items.length + suppressed + unresolved;
  const unsupportedRate = proposed ? (suppressed + unresolved) / proposed : 0;
  const tasks = byKind('task');
  const abstentionRate = tasks.length ? tasks.filter((t) => t.ownerAbstained || t.dueAbstained).length / tasks.length : null;

  // --- cost / latency ---
  const t = telemetry || { latencyMs: [], inputTokens: 0, outputTokens: 0, retries: 0, attempts: 0, errors: {} };
  const lat = [...(t.latencyMs || [])].sort((a, b) => a - b);
  const perf = {
    calls: t.calls || 0,
    attempts: t.attempts || 0,
    retries: t.retries || 0,
    parseRetryRate: t.attempts ? ((t.errors && t.errors.MALFORMED_JSON) || 0) / t.attempts : 0,
    latencyP50: lat.length ? lat[Math.floor(lat.length / 2)] : 0,
    latencyTotal: lat.reduce((a, b) => a + b, 0),
    inputTokens: t.inputTokens || 0,
    outputTokens: t.outputTokens || 0,
    estCostUsd: pricing ? ((t.inputTokens || 0) / 1e6) * pricing.inPerM + ((t.outputTokens || 0) / 1e6) * pricing.outPerM : null,
  };

  return {
    fixtureId: fixture.id, family: fixture.family,
    categories: cat, misclass, owners, dues,
    quoteRangeValidity, quotesProduced: quotes.length,
    evidenceValidity, structure, coverage, unsupportedRate, abstentionRate,
    perf, failures,
    presence: (run.cao_json && run.cao_json.presence) || {},
    analysisStatus: run.analysis_status,
  };
}

function snippet(it) {
  const s = it.displayText || it.rawText || it.text || '';
  return String(s).slice(0, 90);
}

// ---------------------------------------------------------------- GATES

// evaluateGates(results) — results: [{ model, run, metrics }]
// Absolute, corpus-wide minimum gates. A single violation fails the gate.
function evaluateGates(results) {
  const all = results.map((r) => r.metrics);
  const sum = (f) => all.reduce((a, m) => a + f(m), 0);
  const failuresOfType = (t) => results.flatMap((r) => r.metrics.failures.filter((f) => f.type === t).map((f) => ({ fixture: r.metrics.fixtureId, ...f })));

  const gates = [];
  const push = (name, ok, detail, offenders) => gates.push({ name, ok, detail, offenders: offenders || [] });

  push('zero invented owners', sum((m) => m.owners.invented) === 0, `${sum((m) => m.owners.invented)} invented`, failuresOfType('invented-owner').concat(failuresOfType('forbidden-owner')));
  push('zero invented due dates', sum((m) => m.dues.invented) === 0, `${sum((m) => m.dues.invented)} invented`, failuresOfType('invented-due'));
  push('zero promotional CTAs persisted as commitments', sum((m) => m.misclass.ctaAsCommitment) === 0, null, failuresOfType('cta-as-commitment'));
  push('zero audience advice persisted as assigned tasks', sum((m) => m.misclass.adviceAsTask) === 0, null, failuresOfType('advice-as-task'));
  push('every exact quote from a valid raw-word range', all.every((m) => m.quoteRangeValidity === 1), null, failuresOfType('invalid-quote-range'));
  push('every successful run has complete processing coverage',
    results.every((r) => r.metrics.analysisStatus !== 'complete' || r.metrics.coverage.complete), null, []);
  push('no failed segment silently omitted', failuresOfType('silent-omission').length === 0, null, failuresOfType('silent-omission'));
  push('decisions favour precision (no fabricated decisions)', all.every((m) => m.categories.decisions.precision === 1),
    `min precision ${Math.min(...all.map((m) => m.categories.decisions.precision)).toFixed(2)}`,
    failuresOfType('forbidden-item').filter((f) => f.kind === 'decision'));
  push('commitments favour precision (no fabricated commitments)', all.every((m) => m.categories.commitments.precision === 1),
    `min precision ${Math.min(...all.map((m) => m.categories.commitments.precision)).toFixed(2)}`,
    failuresOfType('forbidden-item').filter((f) => f.kind === 'commitment'));

  // The contract asks for no FABRICATED decisions/commitments on this fixture
  // (precision), not for the absence of any commitment - the transcript does
  // contain one genuine first-person commitment (see corpus correction).
  const ashRuns = all.filter((m) => m.fixtureId === 'ashley-gross-ai-consultant');
  const ashOk = ashRuns.length > 0 && ashRuns.every((a) =>
    a.structure.produced === 10 && !a.presence.decisions &&
    a.categories.decisions.precision === 1 && a.categories.commitments.precision === 1);
  push('Ashley Gross: 10 structural units, no fabricated decisions/commitments',
    ashOk,
    ashRuns.length ? `units=[${ashRuns.map((a) => a.structure.produced).join(',')}] decisionsPresent=${ashRuns.some((a) => a.presence.decisions)}` : 'fixture missing', []);

  return { gates, passed: gates.every((g) => g.ok), failedGates: gates.filter((g) => !g.ok) };
}

module.exports = { scoreFixture, evaluateGates, resolveGold, prf };
