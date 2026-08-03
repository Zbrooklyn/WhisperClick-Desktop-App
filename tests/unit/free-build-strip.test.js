// Guards the FREE build's premium strip.
//
// electron-builder.free.json excludes the premium *directories*. That is only
// half the paid layer: ~1,790 lines live inside shared files fenced with
    if (!skipping) out.push(line);
  }
  return { text: out.join('\n'), unterminated: skipping };
}

const SHIPPED = [
  'platforms/electron/main.js',
  'platforms/electron/preload.js',
  'platforms/electron/sidecar.js',
  'shared/frontend/index.html',
  'shared/frontend/wc-shell.js',
  'shared/frontend/css/wc-shell.css',
];

describe('free build premium strip', () => {
  test('every premium region is closed', () => {
    for (const f of SHIPPED) {
      const src = read(f);
      expect({ file: f, starts, ends }).toEqual({ file: f, starts, ends: starts });
      expect({ file: f, unterminated: strip(src).unterminated })
        .toEqual({ file: f, unterminated: false });
    }
  });

  test('the strip removes every paid surface a free user could touch', () => {
    // Each string is something a free user would have seen on screen or a
    // control they could have clicked in the pre-strip free build.
    const forbidden = [
      'wc-lic-input', 'Paste your license key', 'Activate license',
      'WCShell.upgrade', 'wcRequirePro', 'wcTierAllows',
    ];
    for (const f of SHIPPED) {
      const stripped = strip(read(f)).text;
      for (const s of forbidden) {
        expect({ file: f, leaked: stripped.includes(s) ? s : null })
          .toEqual({ file: f, leaked: null });
      }
    }
  });

  test('the strip keeps what the free build needs', () => {
    const stripped = strip(read('shared/frontend/index.html')).text;
    // The edition badge derives "Free" from the ABSENCE of window.WC_TIER, so
    // it must stay outside every region — it is the one piece the free build
    // most needs, and stripping it would leave the badge blank.
    expect(stripped).toMatch(/function wcEditionLabel\(\)/);
    expect(stripped).toMatch(/return 'Free'/);
    // Settings itself is not premium.
    expect(strip(read('shared/frontend/wc-shell.js')).text).toMatch(/WCShell\.settings/);
  });

  test('the free build scripts route through the strip', () => {
    // Calling electron-builder directly here is the exact bug this replaced:
    // it packages the working tree, premium regions and all.
    const scripts = JSON.parse(read('package.json')).scripts;
    for (const name of ['pack:free', 'dist:win:free', 'dist:mac:free', 'dist:linux:free']) {
      expect({ name, cmd: scripts[name] }).toEqual({
        name, cmd: expect.stringContaining('tools/pack-free.js'),
      });
    }
  });
});
