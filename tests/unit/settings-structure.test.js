// Guards the settings screen against reverting to the pre-2026-07-29 design.
//
// The old settings panel was a stack of collapsible accordions. Each group
// carried `data-open`, and its heading was a `<button>` calling
// `toggleSettingsSection()` with a chevron that rotated as the body hid. The
// redesign kept the `data-section` / `.section-body` wrappers as inert
// grouping hooks but removed the toggling entirely: every section is flat and
// always expanded, and the headings are plain text.
//
// That distinction is the whole point of these tests. A revert would look
// almost identical in a diff — same wrappers, same section names — so the
// assertions below target the accordion *mechanics*, not the container names.
//
// These are text assertions on the shipped markup. They prove the accordion is
// gone and the card layout is present. They do not prove the screen looks
// good — that stays a human judgement.

const fs = require('fs');
const path = require('path');

const INDEX = path.join(__dirname, '..', '..', 'shared', 'frontend', 'index.html');
const LICENSE_UI = path.join(
  __dirname, '..', '..', 'platforms', 'electron', 'premium', 'pro-license-ui.js'
);
const SHELL = path.join(__dirname, '..', '..', 'shared', 'frontend', 'wc-shell.js');

const html = fs.readFileSync(INDEX, 'utf8');

describe('settings screen structure', () => {
  test('nothing collapses settings sections any more', () => {
    expect(html).not.toMatch(/toggleSettingsSection/);
    expect(html).not.toMatch(/\bdata-open\b/);
  });

  test('every settings section heading is plain text, not a toggle button', () => {
    // Only the markup — `data-section` also appears in a CSS selector and in a
    // querySelectorAll call, neither of which has a heading to check.
    const sections = [...html.matchAll(/<div[^>]*\sdata-section="([^"]+)"[^>]*>/g)];
    // Guard the guard: if the sections vanish, this test must not pass vacuously.
    expect(sections.length).toBeGreaterThanOrEqual(6);

    for (const m of sections) {
      // The heading occupies the markup between the section open tag and its
      // body. An accordion put a <button> there; the flat design puts a <div>.
      const head = html.slice(m.index, html.indexOf('section-body', m.index));
      expect({ section: m[1], head }).toEqual(
        expect.objectContaining({ head: expect.not.stringContaining('<button') })
      );
      expect({ section: m[1], head }).toEqual(
        expect.objectContaining({ head: expect.not.stringContaining('chevron') })
      );
    }
  });

  test('the flat card layout is present', () => {
    // Counts are floors, not exact values — sections may be added.
    const count = (re) => (html.match(re) || []).length;
    expect(count(/\bwc-set-card\b/g)).toBeGreaterThanOrEqual(10);
    expect(count(/\bwc-set-row\b/g)).toBeGreaterThanOrEqual(20);
    expect(count(/\bwc-set-label\b/g)).toBeGreaterThanOrEqual(20);
  });
});

describe('tier labels', () => {
  // The stored token is still 'complete' so keys issued before the rename keep
  // working. Only the customer-facing word changed.
  test('the "complete" tier displays as Max, never Complete', () => {
    expect(html).toMatch(/WC_TIER === 'complete'\) return 'Max'/);

    const licenseUi = fs.readFileSync(LICENSE_UI, 'utf8');
    expect(licenseUi).toMatch(/t === 'complete'\) return 'Max'/);
    expect(licenseUi).not.toMatch(/return 'Complete'/);
  });

  test('the title-bar suffix reads the real tier, never a hardcoded word', () => {
    // It was `const TIER = 'Pro'`, so a Max customer saw "WhisperClick Pro" in
    // the one place they look to confirm what they paid for.
    const shell = fs.readFileSync(SHELL, 'utf8');
    expect(shell).not.toMatch(/const\s+TIER\s*=/);
    expect(shell).toMatch(/window\.WC_TIER === 'complete'\).*'Max'/);
  });
});
