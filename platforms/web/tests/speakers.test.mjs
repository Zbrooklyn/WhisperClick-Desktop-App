// Unit tests for the diarization speaker-ID foundation (no key, no model needed):
//   - people-store: enroll / match voiceprints by cosine similarity, rename
//   - speaker-suggest: name guesses from self-intro + direct-address cues
//
// Run: node --test platforms/web/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createPeopleStore, cosine } = require('../people-store.js');
const { suggestSpeakers } = require('../speaker-suggest.js');

function tmpDb() {
  const p = path.join(os.tmpdir(), `wc-people-test-${Date.now()}-${Math.floor(performance.now())}.db`);
  return p;
}

test('cosine: identical=1, orthogonal=0, opposite=-1', () => {
  assert.equal(cosine([1, 2, 3], [1, 2, 3]).toFixed(4), '1.0000');
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.ok(cosine([1, 1], [-1, -1]) < -0.99);
  assert.equal(cosine([1, 2], []), 0); // no signal, never a false match
});

test('people-store: ensure is idempotent by name', () => {
  const db = tmpDb(); const store = createPeopleStore(db);
  const a = store.ensure('David', 1000);
  const b = store.ensure('david', 2000); // case-insensitive
  assert.equal(a.id, b.id);
  assert.equal(store.list().length, 1);
  store.close(); fs.rmSync(db, { force: true });
});

test('people-store: enrolled voiceprint matches its own voice, rejects a stranger', () => {
  const db = tmpDb(); const store = createPeopleStore(db);
  // Two distinct "voiceprints" (unit-ish vectors pointing different directions).
  const davidVoice = [0.9, 0.1, 0.2, 0.05];
  const sarahVoice = [0.05, 0.8, 0.1, 0.6];
  store.enroll('David', davidVoice, 1000);
  store.enroll('Sarah', sarahVoice, 1000);

  // A new sample close to David's print → matches David.
  const davidAgain = [0.88, 0.12, 0.22, 0.04];
  const m = store.match(davidAgain, { threshold: 0.75 });
  assert.ok(m, 'should find a match');
  assert.equal(m.person.name, 'David');
  assert.ok(m.score > 0.9);

  // An unrelated voice → no confident match.
  const stranger = [-0.3, 0.2, -0.9, 0.1];
  assert.equal(store.match(stranger, { threshold: 0.75 }), null);
  store.close(); fs.rmSync(db, { force: true });
});

test('people-store: multiple prints per person, rename', () => {
  const db = tmpDb(); const store = createPeopleStore(db);
  store.enroll('David', [1, 0, 0], 1000);
  store.enroll('David', [0.9, 0.1, 0], 2000);
  const p = store.getByName('David');
  assert.equal(p.embeddings.length, 2);
  store.rename(p.id, 'David C.', 3000);
  assert.equal(store.getByName('David C.').id, p.id);
  store.close(); fs.rmSync(db, { force: true });
});

test('speaker-suggest: self-introduction names the speaker', () => {
  const out = suggestSpeakers([
    { speaker: 'Speaker 1', text: 'Alright, let us get started.' },
    { speaker: 'Speaker 2', text: 'Hey everyone, this is David from the design team.' },
  ]);
  const david = out.find((s) => s.name === 'David');
  assert.ok(david, 'David suggested');
  assert.equal(david.speaker, 'Speaker 2');
  assert.ok(david.confidence >= 0.8);
});

test('speaker-suggest: direct address maps to the next speaker', () => {
  const out = suggestSpeakers([
    { speaker: 'Speaker 1', text: 'Hi David, can you walk us through the numbers?' },
    { speaker: 'Speaker 2', text: 'Sure, happy to. Revenue is up twelve percent.' },
  ]);
  const david = out.find((s) => s.name === 'David');
  assert.ok(david, 'David suggested from address');
  assert.equal(david.speaker, 'Speaker 2'); // the one who replied
});

test('speaker-suggest: trusts known names, ignores plain capitalised words', () => {
  const out = suggestSpeakers([
    { speaker: 'A', text: 'Thanks sarah for joining on Monday from the London office.' },
    { speaker: 'B', text: 'Glad to be here.' },
  ], { knownNames: ['Sarah'] });
  const sarah = out.find((s) => s.name === 'Sarah');
  assert.ok(sarah, 'known name Sarah recognised even lowercase');
  assert.equal(sarah.speaker, 'B');
  // "Monday" / "London" must NOT become speaker names.
  assert.ok(!out.some((s) => ['Monday', 'London'].includes(s.name)));
});

test('speaker-suggest: no cues → no guesses (never invents names)', () => {
  const out = suggestSpeakers([
    { speaker: 'A', text: 'The quarterly review is scheduled for three o clock.' },
    { speaker: 'B', text: 'I will bring the updated roadmap.' },
  ]);
  assert.equal(out.length, 0);
});
