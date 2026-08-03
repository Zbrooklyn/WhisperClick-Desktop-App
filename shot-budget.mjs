import { chromium } from 'playwright';
const OUT = 'C:/Users/EDWAR/AppData/Local/Temp/claude/C--Users-EDWAR-Dropbox-Claude-Folder-Brain/eda818a5-cdf6-4821-a514-915844af83ea/scratchpad';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 720 }, deviceScaleFactor: 3, colorScheme: 'dark' });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://127.0.0.1:8793/');
await page.mouse.click(50, 50);
await page.waitForTimeout(2200);
await page.evaluate(() => { if (typeof openDetailModal === 'function') openDetailModal('1784482585916-9dec9e6c629e'); });
await page.waitForTimeout(1000);
await page.evaluate(() => { if (typeof setDetailTab === 'function') setDetailTab('summary'); });
await page.waitForTimeout(500);
await page.evaluate(() => { const s = document.getElementById('detail-sec-speakers'); if (s) { s.classList.remove('hidden'); s.scrollIntoView({ block: 'start' }); } });

async function render(v) {
  await page.evaluate((v) => {
    const TXT = '#d6d3d1', MUT = '#a8a29e';
    const tint = (hex, a) => { const h = hex.replace('#', ''); return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'; };
    const SP = [{ n: 'Sarah', c: '#cf9673', p: 43 }, { n: 'Speaker 2', c: '#7cb0a3', p: 30 }, { n: 'Speaker 3', c: '#cbab6b', p: 27 }];
    const turns = [[0, "Okay, let's start. First item is the launch date — next Tuesday."], [1, "I can own the marketing email. When do you need it by?"], [0, "Friday would be ideal so we have a buffer."], [2, "And the API rate-limit bug is still open. Needs a fix before we ship."]];
    const dot = (c, s) => '<span style="display:inline-block;width:' + (s || 7) + 'px;height:' + (s || 7) + 'px;border-radius:50%;background:' + c + ';flex:0 0 auto"></span>';
    const sugg = '<span style="display:inline-flex;align-items:center;gap:3px;margin-left:5px;padding:1px 7px 1px 5px;border-radius:999px;font-size:10.5px;border:1px dashed rgba(124,176,163,0.6);color:#7cb0a3">✦ John?</span>';
    const body = turns.map(([i, t]) => { const s = SP[i]; return '<div style="margin-bottom:11px;font-size:13.5px;line-height:1.55;color:' + TXT + '"><span style="font-weight:700;color:' + s.c + ';margin-right:7px">' + s.n + '</span>' + t + '</div>'; }).join('');

    let headerHtml = '';
    if (v === 'a') {
      // A — talk-time baked into the tabs as a muted % after each name. No extra line.
      headerHtml = '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px">' +
        SP.map((s, i) => '<span style="display:inline-flex;align-items:baseline;gap:6px;font-size:12.5px;font-weight:600;color:' + s.c + '">' + dot(s.c) + s.n +
          '<span style="color:' + MUT + ';font-weight:600;font-size:11px;font-variant-numeric:tabular-nums">' + s.p + '%</span>' + (i === 1 ? sugg : '') + '</span>').join('') + '</div>';
    } else if (v === 'b') {
      // B — plain tabs + the one-line proportional bar, actions removed entirely.
      const tabs = '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:9px">' +
        SP.map((s, i) => '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:' + s.c + '">' + dot(s.c) + s.n + (i === 1 ? sugg : '') + '</span>').join('') + '</div>';
      const bar = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><span style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:' + MUT + ';font-weight:600;flex:0 0 auto">Talk time</span>' +
        '<div style="flex:1;display:flex;height:8px;border-radius:999px;overflow:hidden;background:rgba(120,113,108,0.22)">' + SP.map(s => '<div style="width:' + s.p + '%;background:' + s.c + '"></div>').join('') + '</div></div>';
      headerHtml = tabs + bar;
    } else if (v === 'c') {
      // C — each tab pill is itself the talk-time bar: a proportional fill behind the name.
      headerHtml = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px">' +
        SP.map((s, i) => '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:' + s.c + ';padding:4px 11px;border-radius:999px;border:1px solid ' + tint(s.c, 0.3) + ';background:linear-gradient(90deg,' + tint(s.c, 0.30) + ' ' + s.p + '%,' + tint(s.c, 0.06) + ' ' + s.p + '%)">' + dot(s.c) + s.n + '</span>' + (i === 1 ? sugg : '')).join('') + '</div>';
    }
    document.getElementById('detail-speakers-body').innerHTML = headerHtml + body;
  }, v);
  await page.waitForTimeout(300);
  const sec = await page.$('#detail-sec-speakers');
  if (sec) await sec.screenshot({ path: OUT + '/bud-' + v + '.png' });
}

for (const v of ['a', 'b', 'c']) await render(v);
console.log('ERRS', JSON.stringify(errs));
await browser.close(); console.log('done');
