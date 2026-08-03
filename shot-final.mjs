import { chromium } from 'playwright';
const OUT = 'C:/Users/EDWAR/AppData/Local/Temp/claude/C--Users-EDWAR-Dropbox-Claude-Folder-Brain/eda818a5-cdf6-4821-a514-915844af83ea/scratchpad';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 920 }, deviceScaleFactor: 3, colorScheme: 'dark' });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://127.0.0.1:8793/');
await page.mouse.click(50, 50);
await page.waitForTimeout(2200);
await page.evaluate(() => { if (typeof openDetailModal === 'function') openDetailModal('1784482585916-9dec9e6c629e'); });
await page.waitForTimeout(1000);
await page.evaluate(() => { if (typeof setDetailTab === 'function') setDetailTab('summary'); });
await page.waitForTimeout(500);

const DATA = {
  segments: [
    { speaker: 'Speaker 1', text: "Okay, let's start. First item is the launch date — I'm proposing next Tuesday." },
    { speaker: 'Speaker 2', text: "I can own the marketing email. When do you need it by?" },
    { speaker: 'Speaker 1', text: "Friday would be ideal so we have a buffer before launch." },
    { speaker: 'Speaker 3', text: "And the API rate-limit bug is still open. It needs a fix before we ship." },
    { speaker: 'Speaker 2', text: "Got it. I'll also loop design in on the onboarding flow this week." },
    { speaker: 'Speaker 1', text: "Perfect. Let's also lock the pricing page copy by Thursday." },
    { speaker: 'Speaker 3', text: "I'll send the QA checklist tonight so everyone's aligned." },
  ],
  labels: { 'Speaker 1': 'Sarah' },
  suggestions: [{ speaker: 'Speaker 2', name: 'John', reason: 'said this is John' }],
};
async function reveal(data) {
  await page.evaluate((d) => {
    const sec = document.getElementById('detail-sec-speakers');
    const body = document.getElementById('detail-speakers-body');
    window._activeDetailId = '1784482585916-9dec9e6c629e';
    body._spkExpanded = false;
    window.renderDiarization(body, JSON.parse(JSON.stringify(d)));
    sec.classList.remove('hidden'); sec.scrollIntoView({ block: 'start' });
  }, data);
  await page.waitForTimeout(350);
}
async function shot(name) { const sec = await page.$('#detail-sec-speakers'); if (sec) await sec.screenshot({ path: OUT + '/' + name + '.png' }); }

// multi collapsed
await reveal(DATA);
await shot('fin-multi-collapsed');
// multi expanded — click the ⋯
await page.evaluate(() => { const b = document.getElementById('detail-speakers-body'); const more = b.querySelector('button[title="Talk time & actions"]'); if (more) more.click(); });
await page.waitForTimeout(350);
await shot('fin-multi-expanded');
// single speaker
await reveal({ segments: [
  { speaker: 'A', text: "Okay, let's start the meeting. First item, we need to finalize the launch date for next Tuesday." },
  { speaker: 'A', text: "Sarah will own the marketing email and John will handle the pricing page update by Friday." },
  { speaker: 'A', text: "Second item, the API rate limit bug is still open and needs a fix before we ship." },
], labels: { A: 'Sarah' } });
await shot('fin-single');

console.log('ERRS', JSON.stringify(errs));
await browser.close(); console.log('done');
