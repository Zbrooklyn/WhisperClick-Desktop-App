import { chromium } from 'playwright';
const OUT = 'C:/Users/EDWAR/AppData/Local/Temp/claude/C--Users-EDWAR-Dropbox-Claude-Folder-Brain/eda818a5-cdf6-4821-a514-915844af83ea/scratchpad';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 720 }, deviceScaleFactor: 3, colorScheme: 'light' });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://127.0.0.1:8793/');
await page.mouse.click(50, 50);
await page.waitForTimeout(2200);
await page.evaluate(() => { document.documentElement.classList.remove('dark'); if (typeof openDetailModal === 'function') openDetailModal('1784482585916-9dec9e6c629e'); });
await page.waitForTimeout(1000);
await page.evaluate(() => { if (typeof setDetailTab === 'function') setDetailTab('summary'); });
await page.waitForTimeout(500);
await page.evaluate(() => {
  document.documentElement.classList.remove('dark');
  const sec = document.getElementById('detail-sec-speakers');
  const body = document.getElementById('detail-speakers-body');
  window._activeDetailId = '1784482585916-9dec9e6c629e';
  body._spkExpanded = false;
  const d = { segments: [
    { speaker: 'Speaker 1', text: "Okay, let's start. First item is the launch date — I'm proposing next Tuesday." },
    { speaker: 'Speaker 2', text: "I can own the marketing email. When do you need it by?" },
    { speaker: 'Speaker 1', text: "Friday would be ideal so we have a buffer before launch." },
    { speaker: 'Speaker 3', text: "And the API rate-limit bug is still open. It needs a fix before we ship." },
  ], labels: { 'Speaker 1': 'Sarah' }, suggestions: [{ speaker: 'Speaker 2', name: 'John', reason: 'x' }] };
  window.renderDiarization(body, d);
  sec.classList.remove('hidden'); sec.scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(400);
const sec = await page.$('#detail-sec-speakers');
if (sec) await sec.screenshot({ path: OUT + '/fin-light.png' });
console.log('ERRS', JSON.stringify(errs)); await browser.close(); console.log('done');
