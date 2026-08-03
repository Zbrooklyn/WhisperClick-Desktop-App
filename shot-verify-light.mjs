import { chromium } from 'playwright';
const OUT = 'C:/Users/EDWAR/AppData/Local/Temp/claude/C--Users-EDWAR-Dropbox-Claude-Folder-Brain/eda818a5-cdf6-4821-a514-915844af83ea/scratchpad';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2.5, colorScheme: 'light' });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://127.0.0.1:8793/');
await page.evaluate(()=>document.documentElement.classList.remove('dark'));await page.mouse.click(50, 50);
await page.waitForTimeout(2200);
await page.evaluate(() => { if (typeof openDetailModal === 'function') openDetailModal('1784482585916-9dec9e6c629e'); });
await page.waitForTimeout(1300);
await page.evaluate(() => { if (typeof setDetailTab === 'function') setDetailTab('summary'); });
await page.waitForTimeout(800);
// inject multi-speaker into the speakers section so we see tabs+bar+inline (real note is single-speaker)
await page.evaluate(() => {
  const sec = document.getElementById('detail-sec-speakers');
  const body = document.getElementById('detail-speakers-body');
  window._activeDetailId = '1784482585916-9dec9e6c629e';
  const d = { segments: [
    { speaker: 'Speaker 1', text: "Okay, let's start. First item is the launch date — I'm proposing next Tuesday." },
    { speaker: 'Speaker 2', text: "I can own the marketing email. When do you need it by?" },
    { speaker: 'Speaker 1', text: "Friday would be ideal so we have a buffer before launch." },
    { speaker: 'Speaker 3', text: "And the API rate-limit bug is still open. It needs a fix before we ship." },
  ], labels: { 'Speaker 1': 'Sarah' }, suggestions: [{ speaker: 'Speaker 2', name: 'John', reason: 'x' }] };
  document.documentElement.classList.remove('dark');window.renderDiarization(body, d);
  sec.classList.remove('hidden');
  const el = document.getElementById('detail-sec-speakers'); if (el) el.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(500);
const modal = await page.$('#detail-modal');
if (modal) await modal.screenshot({ path: OUT + '/vf-review-light.png' });

// open the Actions menu to confirm the Speakers group is there
await page.evaluate(() => { if (window.toggleActionsMenu) toggleActionsMenu(); });
await page.waitForTimeout(400);
if (modal) await modal.screenshot({ path: OUT + '/vf-actions-light.png' });
// close menu
await page.evaluate(() => { const m = document.getElementById('actions-menu'); if (m) m.classList.add('hidden'); });

// Ask tab
await page.evaluate(() => { if (typeof setDetailTab === 'function') setDetailTab('ask'); });
await page.waitForTimeout(1500);
if (modal) await modal.screenshot({ path: OUT + '/vf-ask-light.png' });

console.log('ERRS', JSON.stringify(errs));
await browser.close(); console.log('done');
