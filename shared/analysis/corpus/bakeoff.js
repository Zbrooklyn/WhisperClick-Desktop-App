#!/usr/bin/env node
'use strict';
// corpus/bakeoff.js — real-model bake-off.
//
// Runs the full gold-labelled corpus against each candidate extraction model,
// N times per fixture (nondeterminism is the point — a model is never selected
// on one lucky pass). Produces a reviewable report containing the model policy,
// date, corpus/fixture versions, run count, every metric, and EVERY individual
// failure. Aggregates never hide a severe failure: the gates are absolute.
//
// Requires a live API key and is therefore NEVER part of CI.
//   node shared/analysis/corpus/bakeoff.js --models gpt-4o-mini,gpt-4o --runs 3
//
// Safety: the key is read from the environment or the gitignored .env and is
// never printed or written into the report. Only authored corpus fixtures and
// the already-committed audit transcript are sent to the provider.

const fs = require('fs');
const path = require('path');

const { resolvePolicy } = require('../model-policy');
const { createLiveAdapter } = require('../live-adapter');
const { createAnalysisStore } = require('../store');
const { createIdFactory } = require('../ids');
const { executeRun } = require('../resume');
const { allFixtures, CORPUS_VERSION } = require('./fixtures');
const { scoreFixture, evaluateGates } = require('./scoring');

// Pricing lives in VERSIONED EVALUATION CONFIG, not in this source file, and is
// recorded in every report (source, version, as-of date, rates). Cost is
// reporting only — it never overrides a correctness gate.
const PRICING_CONFIG = require('./pricing.json');
const PRICING = PRICING_CONFIG.models;

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

// Load the gitignored .env only if the key is not already in the environment.
function loadKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const p = path.resolve(__dirname, '../../../.env');
  if (!fs.existsSync(p)) return '';
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^OPENAI_API_KEY=(.*)$/);
    if (m) return m[1].trim();
  }
  return '';
}

function mean(xs) { const v = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }

(async () => {
  const apiKey = loadKey();
  if (!apiKey) { console.error('No OPENAI_API_KEY available. The bake-off requires live credentials and is intentionally excluded from CI.'); process.exit(3); }

  const models = String(arg('models', 'gpt-4o-mini,gpt-4o')).split(',').map((s) => s.trim()).filter(Boolean);
  const runs = parseInt(arg('runs', '3'), 10);
  const outDir = path.resolve(__dirname, '../../../', arg('out', 'docs/analysis-bakeoff'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fixtures = allFixtures();

  console.log(`bake-off: ${models.length} model(s) x ${fixtures.length} fixture(s) x ${runs} run(s)\n`);

  const perModel = [];
  for (const model of models) {
    const policy = resolvePolicy({}, { approvedModels: models, tiers: { extraction: { model } } });
    const results = [];
    for (const fixture of fixtures) {
      for (let r = 1; r <= runs; r++) {
        const adapter = createLiveAdapter({ policy, apiKey, opsTier: 'extraction', timeoutMs: 60000, retry: { max: 3, baseMs: 500 } });
        const store = createAnalysisStore(':memory:', { now: (() => { let n = 1; return () => n++; })() });
        let run, error = null;
        try {
          const out = await executeRun({ store, noteId: `${fixture.id}#${r}`, rawTranscript: fixture.text, adapter, ids: createIdFactory() });
          run = out.run;
        } catch (e) {
          error = { code: e.code || 'ERROR', message: String(e.message).slice(0, 200) };
          run = { analysis_status: 'failed', processing_coverage: {}, cao_json: { items: [], structure: [], presence: {}, validation: { issues: [] } } };
        }
        const metrics = scoreFixture({ fixture, run, telemetry: adapter.telemetry, pricing: PRICING[model] });
        if (error) metrics.failures.push({ type: 'run-error', ...error });
        metrics.runIndex = r;
        results.push({ model, fixtureId: fixture.id, runIndex: r, metrics });
        process.stdout.write(`  ${model} ${fixture.id} run${r}: ${metrics.analysisStatus} ` +
          `dP=${metrics.categories.decisions.precision.toFixed(2)} cP=${metrics.categories.commitments.precision.toFixed(2)} ` +
          `fails=${metrics.failures.length}\n`);
      }
    }
    const gateResult = evaluateGates(results);
    perModel.push({ model, policy: policy.sanitized(), results, gateResult, summary: summarize(results) });
    console.log(`  -> gates ${gateResult.passed ? 'PASS' : 'FAIL'} for ${model}\n`);
  }

  // selection: cheapest model (by estimated cost) whose gates all pass
  const passing = perModel.filter((m) => m.gateResult.passed);
  const selected = passing.sort((a, b) => (a.summary.totalCostUsd || 0) - (b.summary.totalCostUsd || 0))[0] || null;

  const report = {
    generatedAt: new Date().toISOString(),
    corpusVersion: CORPUS_VERSION,
    pricing: {
      version: PRICING_CONFIG.pricingVersion,
      source: PRICING_CONFIG.source,
      asOfDate: PRICING_CONFIG.asOfDate,
      currency: PRICING_CONFIG.currency,
      unit: PRICING_CONFIG.unit,
      rates: PRICING_CONFIG.models,
      note: PRICING_CONFIG.note,
    },
    runsPerFixture: runs,
    fixtures: fixtures.map((f) => ({ id: f.id, family: f.family, kind: f.kind, words: f.text.split(/\s+/).length })),
    models: perModel.map((m) => ({
      model: m.model, policy: m.policy, summary: m.summary,
      gates: m.gateResult.gates, passed: m.gateResult.passed,
      failures: m.results.flatMap((r) => r.metrics.failures.map((f) => ({ fixture: r.fixtureId, run: r.runIndex, ...f }))),
      perFixture: m.results.map((r) => ({ fixture: r.fixtureId, run: r.runIndex, metrics: stripFailures(r.metrics) })),
    })),
    selectedModel: selected ? selected.model : null,
    conclusion: selected ? `selected ${selected.model}` : 'NO candidate model passed all strong-section gates',
  };

  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `bakeoff-${stamp}.json`);
  const mdPath = path.join(outDir, `bakeoff-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(report));
  console.log(`\nreport: ${path.relative(process.cwd(), mdPath)}\n        ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`conclusion: ${report.conclusion}`);
  process.exit(selected ? 0 : 1);
})().catch((e) => { console.error('bakeoff crashed:', e); process.exit(2); });

function summarize(results) {
  const m = results.map((r) => r.metrics);
  return {
    runs: results.length,
    decisionPrecision: mean(m.map((x) => x.categories.decisions.precision)),
    decisionRecall: mean(m.map((x) => x.categories.decisions.recall)),
    commitmentPrecision: mean(m.map((x) => x.categories.commitments.precision)),
    commitmentRecall: mean(m.map((x) => x.categories.commitments.recall)),
    taskPrecision: mean(m.map((x) => x.categories.tasks.precision)),
    taskRecall: mean(m.map((x) => x.categories.tasks.recall)),
    advicePrecision: mean(m.map((x) => x.categories.advice.precision)),
    adviceRecall: mean(m.map((x) => x.categories.advice.recall)),
    ctaPrecision: mean(m.map((x) => x.categories.ctas.precision)),
    ctaRecall: mean(m.map((x) => x.categories.ctas.recall)),
    adviceAsTask: m.reduce((a, x) => a + x.misclass.adviceAsTask, 0),
    ctaAsTask: m.reduce((a, x) => a + x.misclass.ctaAsTask, 0),
    ctaAsCommitment: m.reduce((a, x) => a + x.misclass.ctaAsCommitment, 0),
    inventedOwners: m.reduce((a, x) => a + x.owners.invented, 0),
    inventedDues: m.reduce((a, x) => a + x.dues.invented, 0),
    ownerRecall: (() => { const g = m.reduce((a, x) => a + x.owners.goldTotal, 0); return g ? m.reduce((a, x) => a + x.owners.recalled, 0) / g : null; })(),
    dueRecall: (() => { const g = m.reduce((a, x) => a + x.dues.goldTotal, 0); return g ? m.reduce((a, x) => a + x.dues.recalled, 0) / g : null; })(),
    quoteRangeValidity: mean(m.map((x) => x.quoteRangeValidity)),
    evidenceValidity: mean(m.map((x) => x.evidenceValidity)),
    coverageCompleteRate: m.filter((x) => x.coverage.complete).length / m.length,
    unsupportedRate: mean(m.map((x) => x.unsupportedRate)),
    abstentionRate: mean(m.map((x) => x.abstentionRate).filter((v) => v != null)),
    parseRetryRate: mean(m.map((x) => x.perf.parseRetryRate)),
    latencyP50: mean(m.map((x) => x.perf.latencyP50)),
    totalInputTokens: m.reduce((a, x) => a + x.perf.inputTokens, 0),
    totalOutputTokens: m.reduce((a, x) => a + x.perf.outputTokens, 0),
    totalCostUsd: m.reduce((a, x) => a + (x.perf.estCostUsd || 0), 0),
    totalFailures: m.reduce((a, x) => a + x.failures.length, 0),
  };
}
function stripFailures(m) { const { failures, ...rest } = m; return rest; }

function renderMarkdown(rep) {
  const L = [];
  L.push('# Summary System v2 — real-model bake-off');
  L.push('');
  L.push(`**Generated:** ${rep.generatedAt} · **Corpus version:** ${rep.corpusVersion} · **Runs per fixture:** ${rep.runsPerFixture}`);
  L.push('');
  if (rep.pricing) {
    L.push(`**Pricing config:** ${rep.pricing.version} (source: ${rep.pricing.source}, as of ${rep.pricing.asOfDate}, ${rep.pricing.currency} ${rep.pricing.unit})`);
    for (const [m, r] of Object.entries(rep.pricing.rates)) L.push(`- \`${m}\` — in ${r.inPerM} / out ${r.outPerM}`);
    L.push('');
    L.push(`_${rep.pricing.note}_`);
    L.push('');
  }
  L.push('## Fixtures');
  for (const f of rep.fixtures) L.push(`- \`${f.id}\` — ${f.family}/${f.kind}, ~${f.words} words`);
  L.push('');
  for (const m of rep.models) {
    L.push(`## Model: \`${m.model}\``);
    L.push('');
    L.push(`Policy: provider=${m.policy.provider} · tier(extraction)=${m.policy.tiers.extraction} · approved=[${m.policy.approvedModels.join(', ')}]`);
    L.push('');
    L.push(`**Gates: ${m.passed ? 'PASS' : 'FAIL'}**`);
    L.push('');
    for (const g of m.gates) L.push(`- ${g.ok ? 'PASS' : 'FAIL'} — ${g.name}${g.detail ? ' (' + g.detail + ')' : ''}`);
    L.push('');
    const s = m.summary;
    L.push('Metrics (mean across runs):');
    L.push('');
    const f2 = (v) => (v == null ? 'n/a' : (typeof v === 'number' ? v.toFixed(3) : String(v)));
    L.push(`1. decision precision ${f2(s.decisionPrecision)} · recall ${f2(s.decisionRecall)}`);
    L.push(`2. commitment precision ${f2(s.commitmentPrecision)} · recall ${f2(s.commitmentRecall)}`);
    L.push(`3. task precision ${f2(s.taskPrecision)} · recall ${f2(s.taskRecall)}`);
    L.push(`4. advice precision ${f2(s.advicePrecision)} · recall ${f2(s.adviceRecall)}`);
    L.push(`5. cta precision ${f2(s.ctaPrecision)} · recall ${f2(s.ctaRecall)}`);
    L.push(`6. misclassification — advice-as-task ${s.adviceAsTask} · cta-as-task ${s.ctaAsTask} · cta-as-commitment ${s.ctaAsCommitment}`);
    L.push(`7. invented owners ${s.inventedOwners} · invented due dates ${s.inventedDues} · owner recall ${f2(s.ownerRecall)} · due recall ${f2(s.dueRecall)}`);
    L.push(`8. quote-range validity ${f2(s.quoteRangeValidity)} · evidence validity ${f2(s.evidenceValidity)}`);
    L.push(`9. coverage-complete rate ${f2(s.coverageCompleteRate)} · unsupported-item rate ${f2(s.unsupportedRate)} · abstention rate ${f2(s.abstentionRate)}`);
    L.push(`10. parse/retry rate ${f2(s.parseRetryRate)} · latency p50 ${f2(s.latencyP50)} ms`);
    L.push(`11. tokens in ${s.totalInputTokens} · out ${s.totalOutputTokens} · est. cost $${(s.totalCostUsd || 0).toFixed(4)}`);
    L.push('');
    L.push(`### Individual failures (${m.failures.length})`);
    L.push('');
    if (!m.failures.length) L.push('None.');
    else m.failures.forEach((f, i) => L.push(`${i + 1}. \`${f.fixture}\` run${f.run} — **${f.type}** ${f.text ? '· "' + String(f.text).replace(/\n/g, ' ') + '"' : ''}${f.owner ? ' · owner=' + f.owner : ''}${f.due ? ' · due=' + f.due : ''}${f.produced != null ? ' · produced=' + f.produced + ' expected=' + f.expected : ''}`));
    L.push('');
  }
  L.push('## Conclusion');
  L.push('');
  L.push(rep.conclusion);
  L.push('');
  return L.join('\n');
}
