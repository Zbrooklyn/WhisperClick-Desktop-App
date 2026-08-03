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

// Reveal the speakers section so it's visible/screenshottable.
await page.evaluate(() => {
  const sec = document.getElementById('detail-sec-speakers');
  if (sec) { sec.classList.remove('hidden'); sec.scrollIntoView({ block: 'start' }); }
});

async function render(variant) {
  await page.evaluate((v) => {
    const TXT = '#d6d3d1', MUT = '#a8a29e', HAIR = 'rgba(120,113,108,0.18)';
    const SP = [{ name: 'Sarah', c: '#cf9673' }, { name: 'John', c: '#7cb0a3' }, { name: 'Maya', c: '#cbab6b' }];
    const turns = [
      [0, "Okay, let's start. First item is the launch date — I'm proposing next Tuesday."],
      [1, "I can own the marketing email. When do you need it by?"],
      [0, "Friday would be ideal so we have a buffer before launch."],
      [2, "And the API rate-limit bug is still open. It needs a fix before we ship."],
      [1, "Got it. I'll also loop design in on the onboarding flow this week."],
      [0, "Perfect. Let's also lock the pricing page copy by Thursday."],
      [2, "I'll send the QA checklist tonight so everyone's aligned."],
    ];
    const dot = (c, sz) => '<span style="display:inline-block;width:' + (sz || 7) + 'px;height:' + (sz || 7) + 'px;border-radius:50%;background:' + c + ';flex:0 0 auto"></span>';
    const kebab = '<span style="margin-left:auto;color:' + MUT + ';cursor:pointer;font-size:17px;line-height:1;letter-spacing:1px">⋯</span>';

    // ---- headers (control-density options) ----
    const H = {
      names: '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;font-size:12.5px">' +
        SP.map(s => '<span style="color:' + s.c + ';font-weight:600;cursor:pointer">' + s.name + '</span>').join('') + kebab + '</div>',
      minimal: '<div style="display:flex;align-items:center;margin-bottom:14px;font-size:12px;color:' + MUT + '"><span>3 speakers · 4:12</span>' + kebab + '</div>',
      pills: '<div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;font-size:11.5px">' +
        SP.map(s => '<span style="display:inline-flex;align-items:center;gap:5px;color:' + s.c + ';font-weight:600;cursor:pointer">' + dot(s.c, 6) + s.name + '</span>').join('') + kebab + '</div>',
      talk: '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:11.5px;flex-wrap:wrap">' +
        '<span style="color:' + SP[0].c + ';font-weight:600">Sarah 43%</span><span style="color:' + MUT + '">·</span>' +
        '<span style="color:' + SP[1].c + ';font-weight:600">John 34%</span><span style="color:' + MUT + '">·</span>' +
        '<span style="color:' + SP[2].c + ';font-weight:600">Maya 23%</span>' + kebab + '</div>',
    };

    // ---- bodies (inline transcript treatments) ----
    let body = '';
    if (v === 1) {
      // Inline prefix, hanging indent — densest, name leads the line.
      body = turns.map(([i, t]) => {
        const s = SP[i];
        return '<div style="text-indent:-58px;padding-left:58px;margin-bottom:9px;font-size:13.5px;line-height:1.5;color:' + TXT + '">' +
          '<span style="color:' + s.c + ';font-weight:700">' + s.name + '</span>&nbsp;&nbsp;' + t + '</div>';
      }).join('');
    } else if (v === 2) {
      // Aligned gutter — names in a fixed left column, interview/script feel.
      body = turns.map(([i, t]) => {
        const s = SP[i];
        return '<div style="display:flex;gap:12px;margin-bottom:9px">' +
          '<span style="flex:0 0 52px;text-align:right;color:' + s.c + ';font-weight:700;font-size:12px;line-height:1.5">' + s.name + '</span>' +
          '<span style="flex:1;min-width:0;color:' + TXT + ';font-size:13.5px;line-height:1.5">' + t + '</span></div>';
      }).join('');
    } else if (v === 3) {
      // Colored rail — thin left border per turn, name inline.
      body = turns.map(([i, t]) => {
        const s = SP[i];
        return '<div style="border-left:2px solid ' + s.c + ';padding:1px 0 1px 12px;margin-bottom:9px;line-height:1.5">' +
          '<span style="color:' + s.c + ';font-weight:700;font-size:12.5px">' + s.name + '</span>' +
          '<span style="color:' + TXT + ';font-size:13.5px">&nbsp; ' + t + '</span></div>';
      }).join('');
    } else if (v === 4) {
      // Compact chat — small colored name label above, tight text.
      body = turns.map(([i, t]) => {
        const s = SP[i];
        return '<div style="margin-bottom:11px">' +
          '<div style="color:' + s.c + ';font-weight:700;font-size:11px;letter-spacing:.02em;margin-bottom:1px">' + s.name + '</div>' +
          '<div style="color:' + TXT + ';font-size:13.5px;line-height:1.45">' + t + '</div></div>';
      }).join('');
    }

    const header = v === 1 ? H.names : v === 2 ? H.minimal : v === 3 ? H.pills : H.talk;
    const bodyEl = document.getElementById('detail-speakers-body');
    bodyEl.innerHTML = header + '<div style="height:1px;background:' + HAIR + ';margin:0 0 14px"></div>' + body;
  }, variant);
  await page.waitForTimeout(300);
  const sec = await page.$('#detail-sec-speakers');
  if (sec) await sec.screenshot({ path: OUT + '/spk-v' + variant + '.png' });
}

for (const v of [1, 2, 3, 4]) await render(v);
console.log('ERRS', JSON.stringify(errs));
await browser.close();
console.log('done');
