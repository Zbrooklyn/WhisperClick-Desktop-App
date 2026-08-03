import { chromium } from 'playwright';
const OUT = 'C:/Users/EDWAR/AppData/Local/Temp/claude/C--Users-EDWAR-Dropbox-Claude-Folder-Brain/eda818a5-cdf6-4821-a514-915844af83ea/scratchpad';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 3, colorScheme: 'dark' });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://127.0.0.1:8793/');
await page.mouse.click(50, 50);
await page.waitForTimeout(2200);

// open a real note so the detail modal (which contains the speakers section) is visible
await page.evaluate(() => { if (typeof openDetailModal === 'function') openDetailModal('1784482585916-9dec9e6c629e'); });
await page.waitForTimeout(1000);
await page.evaluate(() => { if (typeof setDetailTab === 'function') setDetailTab('summary'); });
await page.waitForTimeout(600);

const info = await page.evaluate(() => {
  const sec = document.getElementById('detail-sec-speakers');
  const body = document.getElementById('detail-speakers-body');
  window._activeDetailId = 'demo';
  const d = {
    segments: [
      { speaker: 'Speaker 1', text: 'Okay, let us start. First item is the launch date for next Tuesday.' },
      { speaker: 'Speaker 2', text: 'I can own the marketing email. When do you need it by?' },
      { speaker: 'Speaker 1', text: 'Friday would be ideal so we have a buffer.' },
      { speaker: 'Speaker 3', text: 'And the API rate-limit bug is still open. It needs a fix before we ship.' },
      { speaker: 'Speaker 2', text: 'Got it. I will also loop in design on the onboarding flow.' },
    ],
    labels: { 'Speaker 1': 'Sarah' },   // named → green
    suggestions: [{ speaker: 'Speaker 2', name: 'John', reason: 'said "this is John"' }], // amber pill
    // Speaker 3 stays plain → peach
  };
  window.renderDiarization(body, d);
  sec.classList.remove('hidden');
  sec.scrollIntoView({ block: 'start' });
  return { secShown: !sec.classList.contains('hidden') };
});
console.log('INFO', JSON.stringify(info));
await page.waitForTimeout(600);

const sec = await page.$('#detail-sec-speakers');
if (sec) await sec.screenshot({ path: OUT + '/spk-multi-now.png' });
console.log('ERRS', JSON.stringify(errs));
await browser.close();
console.log('done');
