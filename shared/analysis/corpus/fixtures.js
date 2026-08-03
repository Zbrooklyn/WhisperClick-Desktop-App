// corpus/fixtures.js — the gold-labelled evaluation corpus.
//
// Two families:
//   BASE        — content the system must handle correctly (educational monologue,
//                 real meeting with genuine decisions/commitments/owners/dates).
//   ADVERSARIAL — content designed to trigger the exact failure modes the audit
//                 found: hypothetical language that looks like a decision,
//                 promotional CTAs that look like commitments, audience advice
//                 that looks like assigned tasks, and a name/date co-occurring
//                 with no real ownership relation.
//
// Gold labels are ANCHOR PHRASES (exact verbatim substrings). Scoring resolves
// them to raw-word ranges against the same tokenizer the pipeline uses, so a
// produced item "matches" gold when their word ranges overlap.
//
// The synthetic transcripts here are authored for this corpus (no customer or
// private data), so they are safe to commit and to send to a provider.

'use strict';

const CORPUS_VERSION = '1.0.0';

// ---------------------------------------------------------------- BASE: meeting
const MEETING_TEXT = `Sprint planning, March 4th. Present: Priya, Marcus, Dana.

Priya: Let's start with the billing migration. Where are we?
Marcus: It's half done. Honestly I think we should push it to the next sprint.
Priya: Okay. Agreed, we are moving the billing migration to sprint twelve.
Marcus: Works for me. I will write the migration plan by Friday.
Priya: Good. Dana, can you take the schema review?
Dana: Yes. I'll have the schema review finished by Wednesday.
Priya: One more thing. We decided to keep the old billing endpoint alive until April so partners have time to cut over.
Marcus: Sarah mentioned the compliance deadline is Friday, but she is out next week.
Priya: Noted. That's not ours to own this sprint.
Dana: Should we also rewrite the invoice templates?
Priya: Let's not decide that today. We'll revisit it next week.
Marcus: Fine. Last thing, the staging database keeps running out of disk. That's a real risk before launch.
Priya: Right. Nothing else? Then we're done.`;

// ------------------------------------------------- ADVERSARIAL: decision lookalike
const HYPOTHETICAL_TEXT = `We could decide to ship on Monday if the tests go green.
If we decided to move the date, we would need approval from legal first.
I'm not saying we should ship Monday. Somebody suggested we might drop the feature entirely.
Let's think about whether to rewrite the parser. Nothing is decided yet.
Maybe we should consider a second beta, or maybe not. We'll talk again on Thursday.`;

// ------------------------------------------------------ ADVERSARIAL: promotional CTA
const CTA_TEXT = `Before we wrap up, make sure you subscribe to the channel.
Hit the like button if this was useful. Join my newsletter at the link below.
Follow me on LinkedIn for more of these breakdowns.
And go download the free template from my website.`;

// ----------------------------------------------------- ADVERSARIAL: audience advice
const ADVICE_TEXT = `You should focus on data quality before you touch model selection.
Teams ought to invest in evaluation harnesses early.
It's worth learning SQL properly if you work anywhere near analytics.
The best thing you can do is talk to your users every single week.
Don't over-engineer your first version.`;

const FIXTURES = [
  {
    id: 'meeting-sprint-planning',
    family: 'base',
    kind: 'meeting',
    text: MEETING_TEXT,
    gold: {
      structureUnits: null, // free-form meeting; structure count not gated
      decisions: [
        'we are moving the billing migration to sprint twelve',
        'We decided to keep the old billing endpoint alive until April',
      ],
      commitments: [
        'I will write the migration plan by Friday',
        "I'll have the schema review finished by Wednesday",
      ],
      tasks: [
        { anchor: 'I will write the migration plan by Friday', owner: 'Marcus', due: 'Friday' },
        { anchor: "I'll have the schema review finished by Wednesday", owner: 'Dana', due: 'Wednesday' },
      ],
      advice: [],
      ctas: [],
      risks: ['the staging database keeps running out of disk'],
      mustNotProduce: {
        // Sarah is mentioned next to a date but owns nothing here.
        owners: ['Sarah'],
        // explicitly deferred - not a decision
        decisions: ["Let's not decide that today"],
      },
    },
  },
  {
    id: 'adversarial-hypothetical',
    family: 'adversarial',
    kind: 'discussion',
    text: HYPOTHETICAL_TEXT,
    gold: {
      structureUnits: null,
      decisions: [],       // NOTHING here is a decision — that is what this fixture tests
      // CORPUS CORRECTION (2026-07-20 bake-off, justified by the SOURCE): the
      // closing line IS an ordinary first-person commitment. This fixture exists
      // to test hypothetical DECISIONS; blanket-banning commitments was a
      // labelling error on my part, not a model failure.
      commitments: ["We'll talk again on Thursday"],
      tasks: [],
      advice: [],
      ctas: [],
      mustNotProduce: { decisions: ['*'] },
    },
  },
  {
    id: 'adversarial-promotional-cta',
    family: 'adversarial',
    kind: 'promotional',
    text: CTA_TEXT,
    gold: {
      structureUnits: null,
      decisions: [],
      commitments: [],     // a CTA is never a speaker commitment
      tasks: [],           // and never an assigned task
      advice: [],
      ctas: [
        'make sure you subscribe to the channel',
        'Join my newsletter at the link below',
        'Follow me on LinkedIn',
      ],
      mustNotProduce: { commitments: ['*'], tasks: ['*'], decisions: ['*'] },
    },
  },
  {
    id: 'adversarial-audience-advice',
    family: 'adversarial',
    kind: 'educational',
    text: ADVICE_TEXT,
    gold: {
      structureUnits: null,
      decisions: [],
      commitments: [],
      tasks: [],           // audience advice is never an assigned task
      advice: [
        'You should focus on data quality',
        'Teams ought to invest in evaluation harnesses early',
        "It's worth learning SQL properly",
      ],
      ctas: [],
      mustNotProduce: { tasks: ['*'], commitments: ['*'], decisions: ['*'] },
    },
  },
];

// The real audited transcript is loaded lazily (it lives under docs/) and gets
// the same gold shape.
function ashleyFixture() {
  const ashley = require('./ashley-gross');
  const built = ashley.build();
  return {
    id: 'ashley-gross-ai-consultant',
    family: 'base',
    kind: 'educational',
    text: built.canonical,
    gold: {
      structureUnits: 10,
      decisions: [],
      // CORPUS CORRECTION (found by the 2026-07-20 bake-off, justified by the
      // SOURCE not by model output): the transcript does contain exactly one
      // genuine first-person commitment. gpt-4o-mini identified it correctly and
      // the original gold label (zero commitments) was wrong. The contract's
      // requirement is "no FABRICATED commitments" - a truly stated commitment
      // is a correct extraction, so it belongs in gold.
      commitments: ['I will be putting out a lot more announcements about this'],
      tasks: [],
      advice: ['Business analysis, data strategy', 'one to three real world projects'],
      ctas: ['make sure you subscribe'],
      mustNotProduce: { decisions: ['*'] },
    },
  };
}

function allFixtures() {
  return [ashleyFixture(), ...FIXTURES];
}

module.exports = { CORPUS_VERSION, FIXTURES, ashleyFixture, allFixtures };
