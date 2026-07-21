'use strict';
// live-adapter.test.js — every error path and guard, with a MOCK transport.
// No network, no api key, fully deterministic.

const test = require('node:test');
const assert = require('node:assert/strict');

const text = require('../text');
const { resolvePolicy } = require('../model-policy');
const { createLiveAdapter, redact } = require('../live-adapter');

function policy(model = 'gpt-4o-mini', approved = ['gpt-4o-mini', 'gpt-4o']) {
  return resolvePolicy({}, { approvedModels: approved, tiers: { extraction: { model } } });
}
// chat response helper
function chat(obj, usage) {
  return { status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }], usage: usage || { prompt_tokens: 10, completion_tokens: 5 } } };
}
// queue transport: returns queued responses in order; supports functions
function queue(responses) {
  let i = 0;
  return async () => { const r = responses[Math.min(i, responses.length - 1)]; i++; return typeof r === 'function' ? r() : r; };
}

const SEG = text.canonicalize('Alice will send the report by Friday. Data is still the king. Please subscribe now.');
const { words } = text.tokenize(SEG);
const FULL = [0, words.length - 1];

test('unapproved model is rejected at construction (never substituted)', () => {
  assert.throws(() => createLiveAdapter({ policy: policy('gpt-3.5-weak', ['gpt-4o']), apiKey: 'k' }),
    (e) => e.code === 'UNAPPROVED_MODEL');
});

test('api key is never logged (only a redacted fingerprint)', () => {
  const seen = [];
  createLiveAdapter({ policy: policy(), apiKey: 'sk-proj-SECRET-abcd', logger: (...a) => seen.push(JSON.stringify(a)) });
  const blob = seen.join('|');
  assert.ok(!blob.includes('SECRET'), 'raw key must not appear in logs');
  assert.ok(redact('sk-proj-SECRET-abcd').includes('abcd'));
  assert.ok(!redact('sk-proj-SECRET-abcd').includes('SECRET'));
});

test('extract: exact substrings resolve to ranges; rewritten text is REJECTED (no fuzzy match)', async () => {
  const resp = chat({ items: [
    { kind: 'quote', text: 'Data is still the king' },        // exact -> resolves
    { kind: 'quote', text: 'Data is the greatest king' },     // rewritten -> rejected
    { kind: 'commitment', text: 'Alice will send the report', actorText: 'Alice', commitmentCueText: 'will send' },
  ] });
  const a = createLiveAdapter({ policy: policy(), apiKey: 'k', transport: queue([resp]), __noSleep: true });
  const items = await a.extract({ range: FULL, segmentText: SEG, words });
  assert.equal(items.length, 2, 'rewritten quote dropped, two valid items kept');
  const q = items.find((it) => it.kind === 'quote');
  assert.deepEqual(q.range, text.resolvePhraseRange(words, 'Data is still the king'));
  const c = items.find((it) => it.kind === 'commitment');
  assert.ok(Array.isArray(c.commitmentCueSpan) && Array.isArray(c.actorSpan), 'cue + actor spans resolved');
  assert.ok(a.telemetry.errors.UNRESOLVED >= 1, 'rejected proposal counted');
});

test('extract: missing "items" -> MISSING_FIELDS', async () => {
  const a = createLiveAdapter({ policy: policy(), apiKey: 'k', transport: queue([chat({ notItems: [] })]), __noSleep: true });
  await assert.rejects(a.extract({ range: FULL, segmentText: SEG, words }), (e) => e.code === 'MISSING_FIELDS');
});

test('malformed JSON retries then fails MALFORMED_JSON', async () => {
  const bad = { status: 200, json: { choices: [{ message: { content: 'this is not json {' } }] } };
  const a = createLiveAdapter({ policy: policy(), apiKey: 'k', transport: queue([bad]), retry: { max: 2, baseMs: 1 }, __noSleep: true });
  await assert.rejects(a.profile({ sampleText: 'hi' }), (e) => e.code === 'MALFORMED_JSON');
  assert.ok(a.telemetry.retries >= 1, 'retried before failing');
});

test('429 rate limit retries then succeeds', async () => {
  const a = createLiveAdapter({ policy: policy(), apiKey: 'k', retry: { max: 3, baseMs: 1 }, __noSleep: true,
    transport: queue([{ status: 429 }, { status: 429 }, chat({ contentTypes: [], provisionalPresence: {} })]) });
  const out = await a.profile({ sampleText: 'hi' });
  assert.ok(out, 'eventually succeeded');
  assert.equal(a.telemetry.errors.RATE_LIMITED, 2);
  assert.equal(a.telemetry.calls, 1);
});

test('5xx provider error retries then fails PROVIDER_ERROR', async () => {
  const a = createLiveAdapter({ policy: policy(), apiKey: 'k', retry: { max: 1, baseMs: 1 }, __noSleep: true,
    transport: queue([{ status: 500 }, { status: 503 }]) });
  await assert.rejects(a.profile({ sampleText: 'hi' }), (e) => e.code === 'PROVIDER_ERROR');
});

test('401 auth is NOT retried', async () => {
  let calls = 0;
  const a = createLiveAdapter({ policy: policy(), apiKey: 'k', retry: { max: 5, baseMs: 1 }, __noSleep: true,
    transport: async () => { calls++; return { status: 401 }; } });
  await assert.rejects(a.profile({ sampleText: 'hi' }), (e) => e.code === 'AUTH');
  assert.equal(calls, 1, 'auth failure fails fast, no retry');
});

test('timeout/network error retries then fails TIMEOUT', async () => {
  const a = createLiveAdapter({ policy: policy(), apiKey: 'k', retry: { max: 1, baseMs: 1 }, __noSleep: true,
    transport: queue([{ status: 0, networkError: 'ECONNRESET' }]) });
  await assert.rejects(a.profile({ sampleText: 'hi' }), (e) => e.code === 'TIMEOUT');
});

test('interruption/cancellation -> INTERRUPTED, no retry', async () => {
  let calls = 0;
  const a = createLiveAdapter({ policy: policy(), apiKey: 'k', retry: { max: 5, baseMs: 1 }, __noSleep: true,
    transport: async () => { calls++; return { aborted: true }; } });
  await assert.rejects(a.extract({ range: FULL, segmentText: SEG, words }), (e) => e.code === 'INTERRUPTED');
  assert.equal(calls, 1);
});

test('capabilities: no key -> cannot analyze (transcript-only)', () => {
  const a = createLiveAdapter({ policy: policy(), apiKey: '' });
  assert.equal(a.capabilities().canAnalyze, false);
});

test('telemetry accumulates token usage', async () => {
  const a = createLiveAdapter({ policy: policy(), apiKey: 'k', __noSleep: true,
    transport: queue([chat({ items: [] }, { prompt_tokens: 123, completion_tokens: 45 })]) });
  await a.extract({ range: FULL, segmentText: SEG, words });
  assert.equal(a.telemetry.inputTokens, 123);
  assert.equal(a.telemetry.outputTokens, 45);
});
