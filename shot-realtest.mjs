import { chromium } from 'playwright';
const OUT = 'C:/Users/EDWAR/AppData/Local/Temp/claude/C--Users-EDWAR-Dropbox-Claude-Folder-Brain/eda818a5-cdf6-4821-a514-915844af83ea/scratchpad';
const ID = '1784499018527-7925f3df0090';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2.5, colorScheme: 'dark' });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://127.0.0.1:8793/');
await page.mouse.click(50, 50);
await page.waitForTimeout(2500);
await page.evaluate((id) => openDetailModal(id), ID);
await page.waitForTimeout(1500);
const modal = await page.$('#detail-modal');

// Transcript tab (proves import+transcribe)
await page.evaluate(() => setDetailTab('transcript'));
await page.waitForTimeout(800);
if (modal) await modal.screenshot({ path: OUT + '/rt-transcript.png' });

// Review tab + real enrichments via the app's own functions
await page.evaluate(() => setDetailTab('summary'));
await page.waitForTimeout(500);
const step = async (label, fn, wait) => { const r = await page.evaluate(fn).catch(e=>'ERR:'+e); console.log(label, JSON.stringify(r)); await page.waitForTimeout(wait); };
await step('summarize', async () => { if (window.summarizeDetail) { await window.summarizeDetail(); return 'ok'; } return 'no-fn'; }, 3000);
await step('quotes', async () => { if (window.loadKeyQuotes) { await window.loadKeyQuotes(); return 'ok'; } return 'no-fn'; }, 3000);
await step('diarize', async () => {
  const btns = Array.from(document.querySelectorAll('#detail-action-bar button'));
  const sp = btns.find(b => /speakers/i.test(b.textContent||''));
  if (sp) { sp.click(); return 'clicked'; } return 'no-btn';
}, 12000);
await step('followups', async () => {
  const it = (window.historyData||[]).find(i=>i.id===window._activeDetailId);
  if (window.loadFollowups) { await window.loadFollowups(it && it.summary || ''); return 'ok'; } return 'no-fn';
}, 4000);

await page.evaluate(() => { const el = document.getElementById('detail-review'); if (el) el.scrollTop = 0; });
await page.waitForTimeout(500);
if (modal) await modal.screenshot({ path: OUT + '/rt-review-top.png' });
await page.evaluate(() => { const el = document.getElementById('detail-sec-speakers'); if (el) el.scrollIntoView({block:'start'}); });
await page.waitForTimeout(500);
if (modal) await modal.screenshot({ path: OUT + '/rt-review-speakers.png' });

// Ask tab (follow-ups)
await page.evaluate(() => setDetailTab('ask'));
await page.waitForTimeout(1200);
if (modal) await modal.screenshot({ path: OUT + '/rt-ask.png' });

console.log('ERRS', JSON.stringify(errs));
await browser.close(); console.log('done');
