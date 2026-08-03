import { chromium } from 'playwright';
const OUT = 'C:/Users/EDWAR/AppData/Local/Temp/claude/C--Users-EDWAR-Dropbox-Claude-Folder-Brain/eda818a5-cdf6-4821-a514-915844af83ea/scratchpad';
const ID = '1784482585916-9dec9e6c629e';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 3, colorScheme: 'dark' });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://127.0.0.1:8793/');
await page.mouse.click(50, 50);
await page.waitForTimeout(2200);

await page.evaluate((id) => { if (typeof openDetailModal === 'function') openDetailModal(id); }, ID);
await page.waitForTimeout(1200);
await page.evaluate(() => { if (typeof setDetailTab === 'function') setDetailTab('summary'); });
await page.waitForTimeout(700);

// Fetch the item's speaker data straight from the API, then render.
const spk = await page.evaluate(async (id) => {
  const r = await fetch('/api/history?limit=50');
  const j = await r.json();
  const rows = j.items || j.rows || j.history || j;
  const it = (Array.isArray(rows) ? rows : []).find(i => i.id === id);
  return it && it.speakers ? it.speakers : null;
}, ID);

const info = await page.evaluate((args) => {
  const { id, spk } = args;
  const sec = document.getElementById('detail-sec-speakers');
  const body = document.getElementById('detail-speakers-body');
  window._activeDetailId = id;
  if (spk && window.renderDiarization) {
    const d = JSON.parse(JSON.stringify(spk));
    const keys = [...new Set(d.segments.map(s => String(s.speaker)))];
    d.labels = d.labels || {};
    if (keys[0]) d.labels[keys[0]] = 'Sarah';          // named (green) state
    d.suggestions = keys[1] ? [{ speaker: keys[1], name: 'John', reason: 'said "this is John"' }] : [];
    window.renderDiarization(body, d);
    sec.classList.remove('hidden');
  }
  if (sec) sec.scrollIntoView({ block: 'start' });
  return { hasSpk: !!spk, secShown: sec ? !sec.classList.contains('hidden') : false };
}, { id: ID, spk });
console.log('INFO', JSON.stringify(info));
await page.waitForTimeout(600);

const sec = await page.$('#detail-sec-speakers');
if (sec) await sec.screenshot({ path: OUT + '/spk-now.png' });
else await page.screenshot({ path: OUT + '/spk-now.png' });

console.log('ERRS', JSON.stringify(errs));
await browser.close();
console.log('done');
