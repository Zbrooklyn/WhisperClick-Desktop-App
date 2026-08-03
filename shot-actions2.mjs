import { chromium } from 'playwright';
const OUT = 'C:/Users/EDWAR/AppData/Local/Temp/claude/C--Users-EDWAR-Dropbox-Claude-Folder-Brain/eda818a5-cdf6-4821-a514-915844af83ea/scratchpad';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 760 }, deviceScaleFactor: 3, colorScheme: 'dark' });
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
    const tabsOnly = '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:6px">' +
      SP.map((s, i) => '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:' + s.c + '">' + dot(s.c) + s.n +
        (i === 1 ? '<span style="display:inline-flex;align-items:center;gap:3px;margin-left:5px;padding:1px 7px 1px 5px;border-radius:999px;font-size:10.5px;border:1px dashed rgba(124,176,163,0.6);color:' + s.c + '">✦ John?</span>' : '') + '</span>').join('') + '</div>';
    const barInner = '<div style="flex:1;display:flex;height:8px;border-radius:999px;overflow:hidden;background:rgba(120,113,108,0.22)"><div style="width:42%;background:' + SP[0].c + '"></div><div style="width:30%;background:' + SP[1].c + '"></div><div style="width:28%;background:' + SP[2].c + '"></div></div>';
    const talkLabel = '<span style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:' + MUT + ';font-weight:600;flex:0 0 auto">Talk time</span>';
    const body = turns.map(([i, t]) => { const s = SP[i]; return '<div style="margin-bottom:11px;font-size:13.5px;line-height:1.55;color:' + TXT + '"><span style="font-weight:700;color:' + s.c + ';margin-right:7px">' + s.n + '</span>' + t + '</div>'; }).join('');
    const hair = (m) => '<div style="height:1px;background:' + HAIR + ';margin:' + (m || '10px 0') + '"></div>';
    const kebabBtn = (active) => '<button style="flex:0 0 auto;width:26px;height:26px;border:none;border-radius:8px;background:' + (active ? 'rgba(192,122,78,0.14)' : 'transparent') + ';color:' + (active ? ACC : MUT) + ';font-size:17px;line-height:1;cursor:pointer">⋯</button>';
    const menu = (top) => { const item = (ic, label, hl) => '<div style="display:flex;align-items:center;gap:11px;padding:9px 13px;font-size:12.5px;color:' + TXT + ';cursor:pointer;' + (hl ? 'background:rgba(120,113,108,0.14);border-radius:8px;' : '') + '"><span style="color:' + MUT + ';display:inline-flex">' + ic + '</span>' + label + '</div>';
      return '<div style="position:absolute;top:' + top + ';right:0;z-index:5;min-width:186px;background:#2b2521;border:1px solid rgba(120,113,108,0.3);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);padding:4px">' + item(ICON.sum, 'Speaker summaries', true) + item(ICON.merge, 'Merge speakers') + item(ICON.copy, 'Copy transcript') + '</div>'; };

    const el = document.getElementById('detail-speakers-body');
    el.style.position = 'relative';
    let html = '';

    if (v === 'd') {
      // D — actions as plain text LINKS in a footer under the transcript. Editorial, no buttons.
      const talk = '<div style="display:flex;align-items:center;gap:10px;margin:12px 0">' + talkLabel + barInner + '</div>';
      const foot = '<div style="margin-top:6px;display:flex;justify-content:flex-end;gap:14px;font-size:11.5px;color:' + MUT + '">' +
        '<span style="cursor:pointer">Speaker summaries</span><span style="opacity:.4">·</span><span style="cursor:pointer">Merge</span><span style="opacity:.4">·</span><span style="cursor:pointer;color:' + ACC + '">Copy transcript</span></div>';
      html = tabsOnly + hair() + talk + '<div style="margin-top:2px">' + body + '</div>' + hair('14px 0 0') + foot;
    } else if (v === 'e') {
      // E — ONE control row: talk-time bar + ⋯ on the same line. Header = pure identity. ⋯ opens the menu.
      const ctrlRow = '<div style="display:flex;align-items:center;gap:10px;margin:12px 0">' + talkLabel + barInner + kebabBtn(true) + '</div>';
      html = tabsOnly + hair() + ctrlRow + '<div style="margin-top:2px">' + body + '</div>' + menu('86px');
    } else if (v === 'f') {
      // F — bottom TOOLBAR: a footer strip of icon+label actions, set off by a hairline.
      const talk = '<div style="display:flex;align-items:center;gap:10px;margin:12px 0">' + talkLabel + barInner + '</div>';
      const tool = (ic, label, primary) => '<button style="display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ' + (primary ? ACC : 'rgba(120,113,108,0.3)') + ';background:' + (primary ? ACC : 'transparent') + ';color:' + (primary ? '#fff' : MUT) + '">' + ic + label + '</button>';
      const bar = '<div style="margin-top:6px;display:flex;gap:8px;align-items:center">' + tool(ICON.sum, 'Summaries') + tool(ICON.merge, 'Merge') + '<span style="margin-left:auto">' + tool(ICON.copy, 'Copy', true) + '</span></div>';
      html = tabsOnly + hair() + talk + '<div style="margin-top:2px">' + body + '</div>' + hair('14px 0') + bar;
    } else if (v === 'g') {
      // G — talk-time row carries a labeled Copy + ⋯. Copy (frequent) visible, rest in the menu.
      const copyPill = '<button style="flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;font-size:11.5px;font-weight:600;cursor:pointer;border:1px solid rgba(120,113,108,0.3);background:transparent;color:' + MUT + '">' + ICON.copy + 'Copy</button>';
      const ctrlRow = '<div style="display:flex;align-items:center;gap:9px;margin:12px 0">' + talkLabel + barInner + copyPill + kebabBtn(false) + '</div>';
      html = tabsOnly + hair() + ctrlRow + '<div style="margin-top:2px">' + body + '</div>';
    }
    el.innerHTML = html;
  }, v);
  await page.waitForTimeout(300);
  const sec = await page.$('#detail-sec-speakers');
  if (sec) await sec.screenshot({ path: OUT + '/act2-' + v + '.png' });
}

for (const v of ['d', 'e', 'f', 'g']) await render(v);
console.log('ERRS', JSON.stringify(errs));
await browser.close(); console.log('done');
