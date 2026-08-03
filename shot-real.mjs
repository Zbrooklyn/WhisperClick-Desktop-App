import { chromium } from 'playwright';
const OUT = 'C:/Users/EDWAR/AppData/Local/Temp/claude/C--Users-EDWAR-Dropbox-Claude-Folder-Brain/eda818a5-cdf6-4821-a514-915844af83ea/scratchpad';
const ID = '1784482585916-9dec9e6c629e';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 3, colorScheme: 'dark' });
await page.goto('http://127.0.0.1:8793/');
await page.mouse.click(50, 50);
await page.waitForTimeout(2500);

// open the note detail + Review tab
await page.evaluate((id) => { if (typeof openDetailModal === 'function') openDetailModal(id); }, ID);
await page.waitForTimeout(1000);
await page.evaluate(() => { if (typeof setDetailTab === 'function') setDetailTab('summary'); });
await page.waitForTimeout(700);

// locate the review-style-bar; report what exists
const info = await page.evaluate(() => {
  const bar = document.getElementById('review-style-bar');
  const pane = document.getElementById('dpane-summary') || document.getElementById('detail-content');
  return { hasBar: !!bar, barHTMLlen: bar ? bar.innerHTML.length : -1, paneId: pane ? pane.id : null };
});
console.log('INFO', JSON.stringify(info));

const paneSel = '#dpane-summary';
async function shot(name) {
  const el = await page.$(paneSel) || await page.$('#detail-content');
  if (el) await el.screenshot({ path: OUT + '/real-' + name + '.png' });
  else await page.screenshot({ path: OUT + '/real-' + name + '.png' });
}

// 0) baseline (current filled pills)
await shot('now');

// Inject variant markup into #review-style-bar. Uses the app's real accent + fonts.
const ACC = '#cf9673';
// A — quiet dropdowns
await page.evaluate((acc) => {
  const bar = document.getElementById('review-style-bar');
  if (!bar) return;
  bar.style.cssText = 'display:flex;align-items:center;gap:18px;padding:12px 16px 0;flex-wrap:wrap;';
  bar.innerHTML =
    '<span style="display:inline-flex;align-items:center;gap:7px"><span style="font-size:12px;color:#8f8272">Length</span>' +
    '<button style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid #443a32;border-radius:8px;background:#1f1a16;color:#f1ebe3;font-size:12.5px;font-weight:600;cursor:pointer">Bullets<svg width=12 height=12 viewBox="0 0 24 24" fill=none stroke="#8f8272" stroke-width=2.4><path d="m6 9 6 6 6-6"/></svg></button></span>' +
    '<span style="display:inline-flex;align-items:center;gap:7px"><span style="font-size:12px;color:#8f8272">Type</span>' +
    '<button style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid #443a32;border-radius:8px;background:#1f1a16;color:#f1ebe3;font-size:12.5px;font-weight:600;cursor:pointer">Meeting<svg width=12 height=12 viewBox="0 0 24 24" fill=none stroke="#8f8272" stroke-width=2.4><path d="m6 9 6 6 6-6"/></svg></button></span>';
}, ACC);
await page.waitForTimeout(250);
await shot('A-dropdowns');

// B — ghost segmented
await page.evaluate((acc) => {
  const bar = document.getElementById('review-style-bar');
  if (!bar) return;
  bar.style.cssText = 'padding:12px 16px 0;';
  bar.innerHTML =
    '<div style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#78716c;margin-bottom:7px">Length</div>' +
    '<div style="position:relative;display:inline-flex;background:#292320;border:1px solid #38302a;border-radius:10px;padding:3px">' +
      '<span style="position:absolute;z-index:1;left:3px;top:3px;bottom:3px;width:78px;transform:translateX(64px);border-radius:8px;background:#1f1a16;box-shadow:0 1px 2px rgba(0,0,0,.3)"></span>' +
      '<button style="position:relative;z-index:2;border:none;background:transparent;padding:6px 14px;font-size:12px;font-weight:600;color:#8f8272;cursor:pointer">Brief</button>' +
      '<button style="position:relative;z-index:2;border:none;background:transparent;padding:6px 14px;font-size:12px;font-weight:600;color:' + acc + ';cursor:pointer">Bullets</button>' +
      '<button style="position:relative;z-index:2;border:none;background:transparent;padding:6px 14px;font-size:12px;font-weight:600;color:#8f8272;cursor:pointer">Detailed</button>' +
    '</div>';
}, ACC);
await page.waitForTimeout(250);
await shot('B-segmented');

// C — inline on demand (collapsed)
await page.evaluate((acc) => {
  const bar = document.getElementById('review-style-bar');
  if (!bar) return;
  bar.style.cssText = 'padding:14px 16px 0;';
  bar.innerHTML =
    '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:#8f8272;cursor:pointer">' +
    'Showing <b style="color:' + acc + ';font-weight:600">Bullets</b> · <b style="color:' + acc + ';font-weight:600">Meeting</b>' +
    '<svg width=13 height=13 viewBox="0 0 24 24" fill=none stroke="#78716c" stroke-width=2.2><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span>';
}, ACC);
await page.waitForTimeout(250);
await shot('C-inline');

await browser.close();
console.log('done');
