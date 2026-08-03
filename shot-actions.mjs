import { chromium } from 'playwright';
const OUT = 'C:/Users/EDWAR/AppData/Local/Temp/claude/C--Users-EDWAR-Dropbox-Claude-Folder-Brain/eda818a5-cdf6-4821-a514-915844af83ea/scratchpad';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 740 }, deviceScaleFactor: 3, colorScheme: 'dark' });
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
    const TXT = '#d6d3d1', MUT = '#a8a29e', ACC = '#c07a4e', HAIR = 'rgba(120,113,108,0.18)';
    const SP = [{ n: 'Sarah', c: '#cf9673' }, { n: 'Speaker 2', c: '#7cb0a3' }, { n: 'Speaker 3', c: '#cbab6b' }];
    const turns = [[0, "Okay, let's start. First item is the launch date — next Tuesday."], [1, "I can own the marketing email. When do you need it by?"], [0, "Friday would be ideal so we have a buffer."]];
    const dot = (c, s) => '<span style="display:inline-block;width:' + (s || 7) + 'px;height:' + (s || 7) + 'px;border-radius:50%;background:' + c + ';flex:0 0 auto"></span>';
    const ICON = {
      sum: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h12M4 18h7"/></svg>',
      merge: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 9v3a6 6 0 0 0 6 6h3"/></svg>',
      copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    };
    const tabs = SP.map((s, i) => '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:' + s.c + '">' + dot(s.c) + s.n +
      (i === 1 ? '<span style="display:inline-flex;align-items:center;gap:3px;margin-left:5px;padding:1px 7px 1px 5px;border-radius:999px;font-size:10.5px;border:1px dashed rgba(124,176,163,0.6);color:' + s.c + '">✦ John?</span>' : '') + '</span>').join('');
    const talk = '<div style="display:flex;align-items:center;gap:10px;margin:12px 0"><span style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:' + MUT + ';font-weight:600;flex:0 0 auto">Talk time</span>' +
      '<div style="flex:1;display:flex;height:8px;border-radius:999px;overflow:hidden;background:rgba(120,113,108,0.22)"><div style="width:42%;background:' + SP[0].c + '"></div><div style="width:30%;background:' + SP[1].c + '"></div><div style="width:28%;background:' + SP[2].c + '"></div></div></div>';
    const body = turns.map(([i, t]) => { const s = SP[i]; return '<div style="margin-bottom:11px;font-size:13.5px;line-height:1.55;color:' + TXT + '"><span style="font-weight:700;color:' + s.c + ';margin-right:7px">' + s.n + '</span>' + t + '</div>'; }).join('');
    const hair = '<div style="height:1px;background:' + HAIR + ';margin:10px 0 0"></div>';

    let html = '';
    const el = document.getElementById('detail-speakers-body');
    el.style.position = 'relative';

    if (v === 'a') {
      // A — ⋯ opens a dropdown MENU (actions as list items). Talk time lives in the menu open state below tabs.
      const kebab = '<button style="margin-left:auto;flex:0 0 auto;width:26px;height:26px;border:none;border-radius:8px;background:rgba(192,122,78,0.14);color:' + ACC + ';font-size:17px;line-height:1;cursor:pointer">⋯</button>';
      const header = '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:6px">' + tabs + kebab + '</div>';
      const item = (ic, label) => '<div style="display:flex;align-items:center;gap:11px;padding:9px 13px;font-size:12.5px;color:' + TXT + ';cursor:pointer"><span style="color:' + MUT + ';display:inline-flex">' + ic + '</span>' + label + '</div>';
      const menu = '<div style="position:absolute;top:34px;right:0;z-index:5;min-width:186px;background:#2b2521;border:1px solid rgba(120,113,108,0.3);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);overflow:hidden;padding:4px">' +
        '<div style="background:rgba(120,113,108,0.14);border-radius:8px">' + item(ICON.sum, 'Speaker summaries') + '</div>' + item(ICON.merge, 'Merge speakers') + item(ICON.copy, 'Copy transcript') + '</div>';
      html = header + hair + '<div style="margin-top:14px">' + body + '</div>' + menu;
    } else if (v === 'b') {
      // B — three quiet ICON buttons always in the header, no ⋯, no panel. Talk time always inline.
      const ib = (ic, title) => '<button title="' + title + '" style="width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:' + MUT + ';display:inline-flex;align-items:center;justify-content:center;cursor:pointer">' + ic + '</button>';
      const actions = '<span style="margin-left:auto;display:inline-flex;gap:2px;flex:0 0 auto">' + ib(ICON.sum, 'Speaker summaries') + ib(ICON.merge, 'Merge speakers') + ib(ICON.copy, 'Copy transcript') + '</span>';
      const header = '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:6px">' + tabs + actions + '</div>';
      html = header + hair + talk + '<div style="margin-top:2px">' + body + '</div>';
    } else if (v === 'c') {
      // C — one primary action visible (Copy icon), the two rare ones behind ⋯. Talk time always inline.
      const copyBtn = '<button title="Copy transcript" style="width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:' + MUT + ';display:inline-flex;align-items:center;justify-content:center;cursor:pointer">' + ICON.copy + '</button>';
      const kebab = '<button style="width:26px;height:26px;border:none;border-radius:8px;background:transparent;color:' + MUT + ';font-size:17px;line-height:1;cursor:pointer">⋯</button>';
      const actions = '<span style="margin-left:auto;display:inline-flex;align-items:center;gap:2px;flex:0 0 auto">' + copyBtn + kebab + '</span>';
      const header = '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:6px">' + tabs + actions + '</div>';
      html = header + hair + talk + '<div style="margin-top:2px">' + body + '</div>';
    }
    el.innerHTML = html;
  }, v);
  await page.waitForTimeout(300);
  const sec = await page.$('#detail-sec-speakers');
  if (sec) await sec.screenshot({ path: OUT + '/act-' + v + '.png' });
}

for (const v of ['a', 'b', 'c']) await render(v);
console.log('ERRS', JSON.stringify(errs));
await browser.close(); console.log('done');
