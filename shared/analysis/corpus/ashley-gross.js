// corpus/ashley-gross.js — the educational-video golden fixture.
//
// This turns the REAL audited transcript into a deterministic corpus case. The
// model-dependent stages (structure detection, extraction) are represented by a
// RECORDED output expressed as anchor PHRASES; the harness resolves each phrase
// to a stable word range against the real tokenization. That proves the
// deterministic foundation (raw-word anchoring, backend-constructed quotes,
// validators, suppression, coverage) end-to-end on real text, without a live,
// non-deterministic model call. (The live-model corpus bake-off is Phase 1.)
//
// The transcript is an educational monologue: it contains ADVICE and CTAs, but
// NO meeting decisions and NO speaker commitments. The fixture also injects two
// ADVERSARIAL hallucinations (a phantom "decision" and a phantom "commitment"
// with no cue evidence) to prove the suppression path drops them.

'use strict';

const fs = require('fs');
const path = require('path');
const text = require('../text');

const TRANSCRIPT_PATH = path.resolve(__dirname, '../../../docs/summary-audit/fixtures/ashley-gross-ai-consultant.txt');

// The 10 questions, each anchored to a distinctive phrase in the transcript.
const STRUCTURE_ANCHORS = [
  { title: 'Q1 — skills needed', anchor: 'what skills do I need to become an AI consultant' },
  { title: 'Q2 — degree required?', anchor: 'Do I need a degree in AI to become a consultant' },
  { title: 'Q3 — industries in demand', anchor: 'what industries are most in demand for AI consulting' },
  { title: 'Q4 — building a portfolio', anchor: 'How do I start building a portfolio as an AI consultant' },
  { title: 'Q5 — best tools and platforms', anchor: 'what are the best tools and platforms for an AI consultant to use' },
  { title: 'Q6 — finding the first client', anchor: 'how do I find my first client as an AI consultant' },
  { title: 'Q7 — pricing', anchor: 'how much should I charge for AI consulting services' },
  { title: 'Q8 — staying updated', anchor: 'stay updated on AI trends and technologies' },
  { title: 'Q9 — legal & ethical', anchor: 'what legal and ethical considerations should I keep in mind as an AI consultant' },
  { title: 'Q10 — differentiation', anchor: 'How can I differentiate myself in the competitive AI consulting market' },
];

// Recorded extraction. Each item carries an anchor phrase (-> primary evidence
// range). Quotes may carry corrections anchored to a sub-phrase within the quote.
const ITEM_SPECS = [
  { kind: 'quote', anchor: 'Data is still the king' },
  {
    kind: 'quote',
    anchor: 'you need to be able to prove RY',
    corrections: [{ within: 'RY', to: 'ROI', reason: 'ASR error: "RY" is a mis-transcription of "ROI"' }],
  },
  { kind: 'advice', anchor: 'Business analysis, data strategy' },
  { kind: 'advice', anchor: 'one to three real world projects' },
  { kind: 'cta', anchor: 'make sure you subscribe' },
  { kind: 'cta', anchor: 'use LinkedIn' },
  // --- adversarial hallucinations (must be suppressed) ---
  { kind: 'decision', anchor: 'healthcare finance marketing', displayText: 'The team decided healthcare is the primary vertical', adversarial: true },
  { kind: 'commitment', anchor: 'the link is in the comments below', displayText: 'I will send the slides by Friday', adversarial: true },
];

const EXPECT = {
  structureUnits: 10,
  presence: { decisions: false, commitments: false, actions: false, advice: true, ctas: true, quotes: true },
  suppressed: ['decision-uncued→suppressed', 'commitment-uncued→suppressed'],
  // exact evidence-linked quote assertions
  quoteRawContains: 'Data is still the king',
  royRawContains: 'RY',
  royDisplayContains: 'ROI',
};

// resolveWithin(words, [lo,hi], phrase) -> absolute [a,b] within the span, or null.
function resolveWithin(words, span, phrase) {
  const norm = (s) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const target = String(phrase).split(/\s+/).map(norm).filter(Boolean);
  if (!target.length) return null;
  const lo = span ? span[0] : 0;
  const hi = span ? span[1] : words.length - 1;
  for (let i = lo; i + target.length - 1 <= hi; i++) {
    let ok = true;
    for (let k = 0; k < target.length; k++) if (norm(words[i + k].text) !== target[k]) { ok = false; break; }
    if (ok) return [i, i + target.length - 1];
  }
  return null;
}

// build() -> { canonical, words, recorded, expectations }
function build() {
  const raw = fs.readFileSync(TRANSCRIPT_PATH, 'utf8');
  const canonical = text.canonicalize(raw);
  const { words } = text.tokenize(canonical);

  const structureUnits = [];
  for (const s of STRUCTURE_ANCHORS) {
    const range = text.resolvePhraseRange(words, s.anchor);
    if (!range) throw new Error(`structure anchor not found: "${s.anchor}"`);
    structureUnits.push({ title: s.title, kind: 'question', range });
  }

  const items = [];
  for (const spec of ITEM_SPECS) {
    const range = text.resolvePhraseRange(words, spec.anchor);
    if (!range) throw new Error(`item anchor not found: "${spec.anchor}"`);
    const item = { kind: spec.kind, range };
    if (spec.displayText) item.displayText = spec.displayText;
    if (spec.corrections) {
      item.corrections = spec.corrections.map((c) => {
        const cr = resolveWithin(words, range, c.within);
        if (!cr) throw new Error(`correction anchor not found within quote: "${c.within}"`);
        return { rawWordRange: cr, to: c.to, reason: c.reason };
      });
    }
    // adversarial items are intentionally emitted WITHOUT cue spans so the
    // validator must suppress them.
    items.push(item);
  }

  return {
    canonical,
    words,
    recorded: {
      modelPolicy: { provider: 'fixture', tiers: { reasoning: 'fixture', extraction: 'fixture' } },
      profile: {
        contentTypes: [{ type: 'educational', confidence: 0.9 }, { type: 'monologue', confidence: 0.8 }],
        provisionalPresence: { decisions: false, commitments: false, ctas: true },
      },
      structureUnits,
      items,
    },
    expectations: EXPECT,
  };
}

module.exports = { build, TRANSCRIPT_PATH, STRUCTURE_ANCHORS, ITEM_SPECS, EXPECT };
