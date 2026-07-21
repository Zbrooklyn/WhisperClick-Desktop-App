// speaker-suggest.js — lightweight, no-dependency speaker-name guesser.
//
// Given diarized segments [{ speaker, text, start, end }], it proposes a name for
// each speaker from what's actually said, using two everyday cues:
//   1. self-introduction  — "this is David", "David here", "I'm David"
//   2. direct address     — "hi David", "thanks David", "David, what do you think?"
//      → the person who SPEAKS NEXT (a different speaker) is probably David.
// A supplied list of known names (from the people-store) is trusted first, so a
// person you've named before is recognised even from a casual mention.
//
// Output: one best suggestion per speaker: { speaker, name, confidence, reason }.
// It never invents certainty — every suggestion is a tap-to-confirm hint, not a
// decision. Pure function; fully unit-testable.

// Words that look capitalised mid-sentence but are not names.
const STOP = new Set(['I', "I'm", 'Im', 'The', 'A', 'An', 'And', 'But', 'So', 'Ok', 'Okay',
  'Yeah', 'Yes', 'No', 'Hi', 'Hey', 'Hello', 'Thanks', 'Thank', 'Please', 'Sure', 'Well',
  'Mr', 'Mrs', 'Ms', 'Dr', 'God', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
  'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December', 'Today', 'Tomorrow']);

function titleCase(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

// Is `w` a plausible first name? Known names always win; otherwise it must look
// like a capitalised, alphabetic, non-stopword token.
function nameLike(w, known) {
  if (!w) return null;
  const bare = w.replace(/[^A-Za-z'-]/g, '');
  if (bare.length < 2) return null;
  const hit = known.find((k) => k.toLowerCase() === bare.toLowerCase());
  if (hit) return hit; // trust the user's own spelling
  if (STOP.has(bare)) return null;
  if (!/^[A-Z][a-z'-]+$/.test(bare)) return null; // Capitalised, not ALLCAPS/lowercase
  return titleCase(bare);
}

// Pull a name out of a phrase after an address/intro cue.
function afterCue(text, cueRe, known) {
  const m = text.match(cueRe);
  if (!m) return null;
  return nameLike(m[1], known);
}

const SELF_CUES = [
  /\bthis is ([A-Za-z'-]+)/i,
  /\b([A-Za-z'-]+) here\b/i,
  /\bi'?m ([A-Za-z'-]+)/i,
  /\bmy name is ([A-Za-z'-]+)/i,
  /\b([A-Za-z'-]+) speaking\b/i,
];
const ADDRESS_CUES = [
  /\b(?:hi|hey|hello|thanks|thank you|welcome|bye|goodbye)[,]?\s+([A-Za-z'-]+)/i,
  /\bover to you[,]?\s+([A-Za-z'-]+)/i,
  /\bwhat do you think[,]?\s+([A-Za-z'-]+)/i,
];

function suggestSpeakers(segments, opts = {}) {
  const known = (opts.knownNames || []).filter(Boolean);
  const segs = (Array.isArray(segments) ? segments : []).filter((s) => s && s.text);
  // votes[speaker][name] = accumulated confidence
  const votes = {};
  const bump = (spk, name, conf, reason) => {
    if (spk == null || !name) return;
    votes[spk] = votes[spk] || {};
    const cur = votes[spk][name];
    if (!cur || conf > cur.confidence) votes[spk][name] = { confidence: conf, reason };
    else cur.confidence = Math.min(0.99, cur.confidence + conf * 0.25); // repeated mention → firmer
  };

  segs.forEach((seg, i) => {
    const text = String(seg.text);
    // 1. self-introduction → this speaker IS the name (strongest signal)
    for (const re of SELF_CUES) {
      const nm = afterCue(text, re, known);
      if (nm) bump(seg.speaker, nm, 0.9, 'self-introduction: "' + text.trim().slice(0, 40) + '"');
    }
    // 2. direct address → the NEXT different speaker is probably the name
    for (const re of ADDRESS_CUES) {
      const nm = afterCue(text, re, known);
      if (!nm) continue;
      const next = segs.slice(i + 1).find((s) => s.speaker !== seg.speaker);
      if (next) bump(next.speaker, nm, 0.6, 'addressed as "' + nm + '" then replied');
    }
  });

  // Resolve one best name per speaker; drop collisions where two speakers claim
  // the same name by keeping the higher-confidence one.
  const chosen = [];
  for (const spk of Object.keys(votes)) {
    let best = null;
    for (const name of Object.keys(votes[spk])) {
      const v = votes[spk][name];
      if (!best || v.confidence > best.confidence) best = { name, ...v };
    }
    if (best) chosen.push({ speaker: spk, name: best.name, confidence: +best.confidence.toFixed(2), reason: best.reason });
  }
  const byName = {};
  for (const c of chosen.sort((a, b) => b.confidence - a.confidence)) {
    if (byName[c.name.toLowerCase()]) continue; // first (highest-conf) wins the name
    byName[c.name.toLowerCase()] = c;
  }
  return Object.values(byName);
}

module.exports = { suggestSpeakers, nameLike };
