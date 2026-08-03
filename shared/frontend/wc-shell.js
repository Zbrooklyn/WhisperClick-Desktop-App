/* ============================================================================
   WhisperClick Premium — sheet/page framework + Pro surfaces (web).
   Self-contained, mounts above the frozen free app. Vanilla JS, no build step.
   ============================================================================ */
(function () {
  'use strict';
  if (window.WCShell) return;

  // ---- tiny DOM + icon helpers -------------------------------------------
  const ICONS = {
    sparkles:'<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
    type:'<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
    link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    play:'<path d="M6 3 20 12 6 21Z" fill="currentColor" stroke="none"/>',
    more:'<circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none"/>',
    grip:'<circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none"/>',
    search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    plus:'<path d="M12 5v14"/><path d="M5 12h14"/>',
    back:'<path d="M15 18l-6-6 6-6"/>',
    chev:'<path d="M9 18l6-6-6-6"/>',
    x:'<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
    check:'<path d="M20 6 9 17l-5-5"/>',
    alert:'<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    mic:'<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    globe:'<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20 15.3 15.3 0 0 1 0-20z"/>',
    layers:'<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    send:'<path d="M14.54 21.69a.5.5 0 0 0 .94-.02l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0-.02.94l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.94"/>',
    rotate:'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    settings:'<path d="M20 7h-7"/><path d="M11 17H4"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    crown:'<path d="M11.56 3.69a.5.5 0 0 1 .88 0l2.54 4.66 5.1-1.2a.5.5 0 0 1 .6.63l-2.3 7.7a1 1 0 0 1-.96.72H6.98a1 1 0 0 1-.96-.72l-2.3-7.7a.5.5 0 0 1 .6-.63l5.1 1.2z"/><path d="M5 20h14"/>',
    trash:'<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    download:'<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    cpu:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    smartphone:'<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  };
  function icon(name, cls) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = ICONS[name] || '';
    if (cls) svg.setAttribute('class', cls);
    return svg;
  }
  function el(tag, cls, opts) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    opts = opts || {};
    if (opts.text != null) n.textContent = opts.text;
    if (opts.html != null) n.innerHTML = opts.html;
    if (opts.on) for (const k in opts.on) n.addEventListener(k, opts.on[k]);
    if (opts.attr) for (const k in opts.attr) n.setAttribute(k, opts.attr[k]);
    if (opts.css) for (const k in opts.css) n.style[k] = opts.css[k];
    if (opts.kids) opts.kids.forEach(c => c && n.appendChild(c));
    return n;
  }

  // ---- persistence (net-new Pro data) ------------------------------------
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} },
  };
  const uid = () => 'x' + Math.abs((Date.now() ^ (performance.now() * 1000)) | 0).toString(36) + (store._n = (store._n || 0) + 1);


  // ---- layer manager (sheets + pages stack over one backdrop) -------------
  const WCShell = { icon, el };
  let root = null;
  const stack = []; // {el, backdrop}

  function ensureRoot() {
    if (root && document.body.contains(root)) return root;
    const host = document.getElementById('app-frame') || document.body;
    root = document.getElementById('wc-pro-root') || el('div', '', { attr: { id: 'wc-pro-root' } });
    root.classList.add('wc-pro');
    if (!root.parentNode) host.appendChild(root);
    return root;
  }

  function addBackdrop(onTap) {
    const b = el('div', 'wc-backdrop', { on: { click: onTap } });
    ensureRoot().appendChild(b);
    requestAnimationFrame(() => b.classList.add('wc-in'));
    return b;
  }

  function dismissTop() {
    const top = stack[stack.length - 1];
    if (top) closeLayer(top);
  }

  function closeLayer(layer) {
    const idx = stack.indexOf(layer);
    if (idx === -1) return;
    stack.splice(idx, 1);
    layer.el.classList.remove('wc-in');
    if (layer.backdrop) layer.backdrop.classList.remove('wc-in');
    const under = stack[stack.length - 1];
    if (under && under.el.classList.contains('wc-page')) under.el.classList.remove('wc-under');
    setTimeout(() => { layer.el.remove(); if (layer.backdrop) layer.backdrop.remove(); if (layer.onClose) { try { layer.onClose(); } catch (e) {} } }, 320);
  }
  WCShell.close = dismissTop;
  WCShell.closeAll = () => { while (stack.length) closeLayer(stack[stack.length - 1]); };

  // header builder
  function header(title, { badge, onClose, onBack, right } = {}) {
    const h = el('div', 'wc-head');
    if (onBack) h.appendChild(el('button', 'wc-iconbtn', { on: { click: onBack }, kids: [icon('back')], attr: { 'aria-label': 'Back' } }));
    const t = el('div', 'wc-head__title', { text: title });
    h.appendChild(t);
    if (badge) h.appendChild(el('span', 'wc-badge', { text: badge }));
    if (right) h.appendChild(right);
    if (onClose) h.appendChild(el('button', 'wc-iconbtn', { on: { click: onClose }, kids: [icon('x')], attr: { 'aria-label': 'Close' } }));
    return h;
  }

  // ---- open a slide-up sheet ----------------------------------------------
  WCShell.openSheet = function (opts) {
    opts = opts || {};
    ensureRoot();
    const size = opts.size || 'half'; // half | three | full
    // A sheet the user must not dismiss — batch progress, say — has to drop all
    // three exits, not just the backdrop. It previously kept its grab handle and
    // its close button, so dragging or tapping the X still tore it down.
    const dismissable = opts.dismissable !== false;
    const backdrop = addBackdrop(() => { if (dismissable) closeLayer(layer); });
    const sheet = el('div', 'wc-sheet wc-sheet--' + size);
    const grab = dismissable ? el('div', 'wc-sheet__grab', { kids: [el('i')] }) : null;
    if (grab) sheet.appendChild(grab);
    const layer = { el: sheet, backdrop, onClose: opts.onClose };
    const close = () => closeLayer(layer);
    if (opts.title != null) sheet.appendChild(header(opts.title, { badge: opts.badge, onClose: dismissable ? close : null, right: opts.headerRight }));
    const body = el('div', 'wc-body');
    sheet.appendChild(body);
    // Sheets with a committing action want it pinned below the scroll, not
    // chased to the bottom of a long list. Appended now so it sits under the
    // body, but filled after build() — a footer button usually needs to reach
    // something the body just created.
    const foot = opts.foot ? el('div', 'wc-sheet__foot') : null;
    if (foot) sheet.appendChild(foot);
    if (opts.build) opts.build(body, { close, sheet });
    if (foot) opts.foot(foot, { close, sheet, body });
    ensureRoot().appendChild(sheet);
    stack.push(layer);
    requestAnimationFrame(() => sheet.classList.add('wc-in'));
    if (grab) enableDragDismiss(grab, sheet, close);
    return { el: sheet, body, close };
  };

  // ---- ask a question and wait for the answer -----------------------------
  // The app hand-rolled this shape four times, each with its own pair of
  // open/close functions doing the same three class toggles against its own
  // cached element handles, none of them on the tokens. One primitive:
  //
  //   if (!await WCShell.confirm({ title, message, destructive:true })) return;
  //
  // Resolves true on confirm, false on cancel / backdrop / Escape — a dismissed
  // dialog is a "no", never a hang.
  WCShell.confirm = function (opts) {
    opts = opts || {};
    ensureRoot();
    return new Promise((resolve) => {
      let settled = false;                       // backdrop + Escape can both fire
      const returnFocus = document.activeElement;
      const titleId = 'wc-dlg-' + uid();

      const finish = (answer) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        closeLayer(layer);
        if (returnFocus && returnFocus.focus) { try { returnFocus.focus(); } catch (e) {} }
        resolve(answer);
      };

      const backdrop = addBackdrop(() => finish(false));
      const card = el('div', 'wc-dialog' + (opts.wide ? ' wc-dialog--wide' : ''), {
        attr: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      });
      const layer = { el: card, backdrop };

      const body = el('div', 'wc-dialog__body', {
        kids: [
          el('h3', 'wc-dialog__title', { text: opts.title || '', attr: { id: titleId } }),
          opts.message ? el('p', 'wc-dialog__msg', { text: opts.message }) : null,
        ],
      });
      // Anything the question itself needs — the factory-reset checkbox, say.
      if (opts.build) {
        const extra = el('div', 'wc-dialog__extra');
        opts.build(extra);
        body.appendChild(extra);
      }
      card.appendChild(body);

      const cancel = btn(opts.cancelLabel || 'Cancel', { variant: 'ghost', onClick: () => finish(false) });
      const go = btn(opts.confirmLabel || 'Confirm', {
        variant: opts.destructive ? 'destroy' : 'primary',
        onClick: () => finish(true),
      });
      // A dismiss-only dialog (a guide, an explanation) gets one button, and it
      // reads as the way out rather than as agreeing to something.
      card.appendChild(el('div', 'wc-btnrow', { kids: opts.dismissOnly ? [go] : [cancel, go] }));

      // A dialog owns the keyboard while it is up: Escape answers no, and Tab
      // cannot walk out of it into the page behind.
      const onKey = (e) => {
        // Every open dialog listens on the document, so without this a single
        // Escape would answer "no" to the whole stack at once.
        if (stack[stack.length - 1] !== layer) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); return; }
        if (e.key !== 'Tab') return;
        const f = [].slice.call(card.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'))
          .filter(n => !n.disabled && n.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      };
      document.addEventListener('keydown', onKey, true);

      ensureRoot().appendChild(card);
      stack.push(layer);
      requestAnimationFrame(() => card.classList.add('wc-in'));
      // Land on Cancel when the confirm button destroys something — a stray
      // Enter should not be what erases the user's history.
      ((opts.destructive && !opts.dismissOnly) ? cancel : go).focus();
    });
  };

  // ---- open a full-screen page (push/back) --------------------------------
  WCShell.openPage = function (opts) {
    opts = opts || {};
    ensureRoot();
    const backdrop = stack.length ? null : addBackdrop(() => {});
    const under = stack[stack.length - 1];
    if (under && under.el.classList.contains('wc-page')) under.el.classList.add('wc-under');
    const page = el('div', 'wc-page');
    const layer = { el: page, backdrop, onClose: opts.onClose };
    const close = () => closeLayer(layer);
    const canBack = stack.length > 0;
    page.appendChild(header(opts.title, {
      badge: opts.badge,
      onClose: canBack ? null : close,
      onBack: canBack ? close : null,
      right: opts.headerRight,
    }));
    const body = el('div', 'wc-body' + (opts.padBody ? ' wc-body--pad' : ''));
    page.appendChild(body);
    if (opts.build) opts.build(body, { close, page });
    ensureRoot().appendChild(page);
    stack.push(layer);
    requestAnimationFrame(() => page.classList.add('wc-in'));
    return { el: page, body, close };
  };

  // drag-to-dismiss for sheets
  function enableDragDismiss(handle, sheet, close) {
    let startY = 0, cur = 0, dragging = false;
    const down = (y) => { startY = y; dragging = true; sheet.style.transition = 'none'; };
    const move = (y) => { if (!dragging) return; cur = Math.max(0, y - startY); sheet.style.transform = 'translateY(' + cur + 'px)'; };
    const up = () => { if (!dragging) return; dragging = false; sheet.style.transition = ''; if (cur > 90) { sheet.style.transform = ''; close(); } else { sheet.style.transform = ''; } cur = 0; };
    handle.addEventListener('touchstart', e => down(e.touches[0].clientY), { passive: true });
    handle.addEventListener('touchmove', e => move(e.touches[0].clientY), { passive: true });
    handle.addEventListener('touchend', up);
    handle.addEventListener('mousedown', e => { down(e.clientY); const mm = e2 => move(e2.clientY); const mu = () => { up(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); }; document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu); });
  }

  // ---- component helpers --------------------------------------------------
  function tile(name, soft) { return el('div', 'wc-tile' + (soft ? ' wc-tile--soft' : ''), { kids: [icon(name)] }); }
  function sectionLabel(label, count, spacerKids) {
    const s = el('div', 'wc-sec', { kids: [el('span', 'wc-sec__l', { text: label })] });
    if (count != null) s.appendChild(el('span', 'wc-sec__count', { text: String(count) }));
    if (spacerKids) { s.appendChild(el('span', 'wc-sec__spacer')); spacerKids.forEach(k => s.appendChild(k)); }
    return s;
  }
  function row({ iconName, soft, title, sub, run, chevron, grip, onClick, onRun }) {
    const main = el('div', 'wc-row__main', { kids: [el('div', 'wc-row__title', { text: title })] });
    if (sub) main.appendChild(el('div', 'wc-row__sub', { text: sub }));
    const trail = el('div', 'wc-row__trail');
    if (run) trail.appendChild(el('button', 'wc-run', { kids: [icon('play')], on: { click: e => { e.stopPropagation(); onRun && onRun(); } } }));
    if (chevron) trail.appendChild(el('span', 'wc-chev', { kids: [icon('chev')] }));
    const kids = [];
    if (grip) kids.push(el('span', 'wc-grip', { kids: [icon('grip')] }));
    kids.push(tile(iconName || 'sparkles', soft), main, trail);
    return el('button', 'wc-row', { kids, on: onClick ? { click: onClick } : {} });
  }
  function btn(label, { variant = 'primary', iconName, block, onClick } = {}) {
    const kids = []; if (iconName) kids.push(icon(iconName)); kids.push(el('span', '', { text: label }));
    return el('button', 'wc-btn wc-btn--' + variant + (block ? ' wc-btn--block' : ''), { kids, on: { click: onClick || (() => {}) } });
  }
  WCShell.tile = tile; WCShell.row = row; WCShell.btn = btn; WCShell.sectionLabel = sectionLabel; WCShell.header = header;

  // =========================================================================
  //  SURFACES
  // =========================================================================


  // ---- toast ---------------------------------------------------------------
  // ONE notification design, one implementation.
  //
  // There used to be two. index.html owned showToast() — a docked top banner
  // with a type, an icon and a dismiss button — and this file owned a separate
  // bottom-pill toast with none of that. Which one a user saw depended on
  // nothing they could perceive: whichever module happened to raise the message.
  // 133 calls went to the banner and 5 to the pill, so the same app taught two
  // different notification languages.
  //
  // The banner won on merit and moved here, where every surface can reach it.
  // Nothing was dropped in the move: type, icon, the dismiss control, and
  // errors persisting until dismissed all survive verbatim.
  //
  // Host: #banner-container is index.html's docked slot, directly under the
  // header. Surfaces without that slot (the pill window, a premium overlay
  // opened standalone) fall back to the shell's own overlay root, so a message
  // is never silently swallowed for want of a container.
  function toast(message, type = 'success') {
    const host = document.getElementById('banner-container') || ensureRoot();
    const iconName = type === 'error' ? 'alert-circle' : type === 'success' ? 'check' : 'info';
    const isError = type === 'error';

    const banner = document.createElement('div');
    banner.className = `flex items-center gap-2.5 px-4 py-2 text-xs font-medium pointer-events-auto
                bg-stone-100/95 dark:bg-stone-800/95 backdrop-blur-sm
                border-b border-stone-200 dark:border-stone-700
                text-stone-700 dark:text-stone-200
                shadow-sm animate-banner-in`;
    const bIcon = document.createElement('i');
    bIcon.setAttribute('data-lucide', iconName);
    bIcon.className = 'w-3.5 h-3.5 text-accent shrink-0';
    const bMsg = document.createElement('span');
    bMsg.textContent = message;
    bMsg.className = 'truncate flex-1';
    banner.appendChild(bIcon);
    banner.appendChild(bMsg);

    const dismissBanner = () => {
      banner.classList.replace('animate-banner-in', 'animate-banner-out');
      setTimeout(() => banner.remove(), 250);
    };

    // Every toast gets a dismiss (X) button. Non-error toasts also keep
    // auto-dismissing after 6s; the X just lets the user clear it sooner.
    const closeBtn = document.createElement('button');
    closeBtn.className = 'shrink-0 p-0.5 rounded hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors';
    closeBtn.innerHTML = '<i data-lucide="x" class="w-3 h-3 text-stone-400 dark:text-stone-500"></i>';
    closeBtn.onclick = dismissBanner;
    banner.appendChild(closeBtn);
    if (!isError) {
      setTimeout(dismissBanner, 6000);
    }

    host.appendChild(banner);
    // Guarded, unlike the index.html original: this file now also runs in the
    // pill window, which does not load lucide. An unresolved <i data-lucide>
    // renders as nothing; an unguarded call would throw and lose the message.
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
    return banner;
  }
  WCShell.toast = toast;

  // ---- Unified Settings (ALL settings, free + premium, one navigation) -----
  // Reuses the app's real, wired section bodies — moved into pages/subpages and
  // restored on close — so every control keeps working. Opened from the gear.
  const SETTINGS_META = {
    'quick-settings': ['settings', 'Quick settings', 'Appearance, hotkey, sounds', 'GENERAL'],
    'provider': ['lock', 'Providers & API keys', 'OpenAI / Gemini keys & model', 'GENERAL'],
    'language': ['globe', 'Language & output', 'Languages and output format', 'GENERAL'],
    'premium': ['crown', 'Premium features', 'Speech, capture, formatting, AI', 'PREMIUM'],
    'advanced': ['cpu', 'Advanced', 'Power-user options', 'SYSTEM'],
    'updates': ['download', 'Updates', 'App version & updates', 'SYSTEM'],
    'debug': ['type', 'Debug', 'Diagnostics & logs', 'SYSTEM'],
    'danger': ['alert', 'Danger zone', 'Reset & clear data', 'SYSTEM'],
  };
  const SETTINGS_GROUPS = ['GENERAL', 'PREMIUM', 'SYSTEM'];

  WCShell.settings = function () {
    const drawer = document.getElementById('settings-drawer');
    if (!drawer) return;
    WCShell.openPage({ title: 'Settings', padBody: true, build(body) {
      SETTINGS_GROUPS.forEach(g => {
        // Free tier shows the SAME polished shell but NONE of the paid settings.
        // The PREMIUM group (Speech intelligence, Capture modes, Formatting, AI
        // cleanup, Integrations) renders only when the license is actually Pro.
        // In the FREE build the line above is gone and so is the premium markup it
        // was guarding: the [data-section="premium"] block never ships, so the keys
        // filter below finds nothing and the PREMIUM header is skipped by absence.
        const keys = Object.keys(SETTINGS_META).filter(k => SETTINGS_META[k][3] === g && drawer.querySelector('[data-section="' + k + '"] .section-body'));
        if (!keys.length) return;
        body.appendChild(sectionLabel(g));
        keys.forEach(k => {
          // Premium's sub-blocks are surfaced DIRECTLY in the menu (no intake row),
          // so they sit alongside every other category under the PREMIUM header.
          if (k === 'premium') {
            const secBody = drawer.querySelector('[data-section="premium"] .section-body');
            const cards = secBody ? [].slice.call(secBody.querySelectorAll('#premium-groups > .wc-set-card')) : [];
            if (cards.length) {
              cards.forEach(card => {
                const head = card.querySelector('.wc-set-head');
                const label = head ? head.textContent.trim() : 'Feature';
                body.appendChild(row({ iconName: premiumIcon(label), title: label, sub: premiumSub(label), chevron: true, onClick: () => adoptInto(card, label) }));
              });
              return;
            }
          }
          const m = SETTINGS_META[k];
          body.appendChild(row({ iconName: m[0], title: m[1], sub: m[2], chevron: true, onClick: () => openCategory(k, m[1]) }));
        });
      });
    } });
    // adopt an arbitrary live node into a page and restore it to its exact spot on close
    // Group the plain label|control rows into iOS-style grouped lists. Where a
    // section defines semantic buckets (below) the rows are re-clustered under
    // labeled sub-headers; otherwise consecutive rows share one container. Choice
    // controls (<select>) become "menu rows" (value + chevron → picker sheet) so
    // they visually rhyme with the toggles. Block cards / helper text stay standalone.
    // Fully reversible on close.
    const NATIVE_GROUPS = {
      'quick-settings': [
        ['APPEARANCE', ['#theme-toggle', '#pill-widget-toggle']],
        ['DICTATION OUTPUT', ['#auto-paste-toggle', '#auto-enter-mode-select']],
        ['SOUND', ['#sound-toggle', '#recording-sound-select']],
        ['SYSTEM', ['#start-with-windows-toggle', '#tray-click-action-select']],
        ['SHORTCUT', ['#hotkey-display', '#hotkey-input']],
      ],
    };
    function isNativeRow(k) {
      return k.nodeType === 1 && (k.classList.contains('wc-set-row') || (k.matches('.flex') && k.matches('.items-center')));
    }
    // Some selects own a richer custom picker (the app hijacks their tap). We give
    // them the menu-row LOOK but route the tap to their own picker instead of ours,
    // and hide their now-redundant sibling trigger button (e.g. "Preview").
    // map: select id -> selector of the custom popup it owns (which we must lift
    // above our z:900 Settings layer, since the app parks it on <body> at z:210).
    const CUSTOM_PICKERS = { 'viz-style-select': '#viz-preview-popup' };
    // choice control -> menu row (value + chevron; tap opens a picker)
    function toMenuRow(sel, node) {
      const row = sel.parentElement;
      const custom = CUSTOM_PICKERS[sel.id];
      const t = el('span', 'wc-menuval__t');
      const disp = el('button', 'wc-menuval', { kids: [t], attr: { type: 'button' } });
      const sync = () => { const o = sel.options[sel.selectedIndex]; t.textContent = o ? o.text : ''; };
      sync();
      sel._wcSync = sync;
      sel.addEventListener('change', sync);
      disp.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (custom) sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); // the app opens its own picker
        else openSelectPicker(sel, row);
      });
      sel.classList.add('wc-hidden-sel');
      row.insertBefore(disp, sel);
      sel._wcDisp = disp;
      if (custom) {
        const pop = document.querySelector(custom);   // lift the app's popup above our Settings layer
        if (pop) pop.style.zIndex = '100000';
        // the whole row now opens the picker — hide the redundant trigger button
        const trig = [].slice.call(row.querySelectorAll('button')).find(b => b !== disp && /^Preview$/i.test(b.textContent.trim()));
        if (trig) { trig.style.display = 'none'; sel._wcTrig = trig; }
      }
      (node._wcSelects = node._wcSelects || []).push(sel);
    }
    function fromMenuRow(sel) {
      if (sel._wcDisp) { sel._wcDisp.remove(); delete sel._wcDisp; }
      if (sel._wcTrig) { sel._wcTrig.style.display = ''; delete sel._wcTrig; }
      sel.classList.remove('wc-hidden-sel');
      if (sel._wcSync) { sel.removeEventListener('change', sel._wcSync); delete sel._wcSync; }
    }
    function openSelectPicker(sel, row) {
      const label = (row.querySelector('span') || {}).textContent || 'Select';
      WCShell.openSheet({ title: label, size: 'half', build(body) {
        [].slice.call(sel.options).forEach(opt => {
          const r = el('button', 'wc-pick' + (opt.selected ? ' wc-pick--on' : ''), { text: opt.text, attr: { type: 'button' } });
          if (opt.disabled) { r.setAttribute('disabled', ''); }
          else r.addEventListener('click', () => {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            if (sel._wcSync) sel._wcSync();
            WCShell.close();
          });
          body.appendChild(r);
        });
      } });
    }
    function groupifyNative(node, key) {
      if (!node || node._wcGrouped) return;
      node._wcOrigOrder = [].slice.call(node.childNodes);
      const kids = [].slice.call(node.children);
      const buckets = NATIVE_GROUPS[key];
      // Rows are NOT always direct children of `node`. The drawer wraps a section's
      // rows in a .wc-set-card (index.html:954), so re-clustering them into labeled
      // groups moves them ACROSS parents — and _wcOrigOrder, which only records
      // node's own children, cannot put them back. Record each donor parent's
      // original child order too.
      const donors = new Map();
      const rememberDonor = (row) => {
        const p = row.parentNode;
        if (p && p !== node && !donors.has(p)) donors.set(p, [].slice.call(p.childNodes));
      };
      if (buckets) {
        // semantic buckets: re-cluster rows under labeled sub-headers, in bucket order
        const used = new Set();
        buckets.forEach(([label, sels]) => {
          const rows = [];
          sels.forEach(s => {
            const ctl = node.querySelector(s);
            if (!ctl) return;
            // The row that OWNS the control — never an ancestor that merely contains
            // it. The old `kids.find(k => k.matches(s) || k.querySelector(s))` took
            // whichever direct child held the control, so once the rows were wrapped
            // in a card the whole 9-row card was handed to .wc-grp, and
            // `.wc-grp > * {display:flex}` laid all nine rows out side by side in a
            // single 122px band instead of stacking them.
            const row = ctl.closest('.wc-set-row') || kids.find(k => k === ctl || k.contains(ctl));
            if (!row || used.has(row) || !node.contains(row)) return;
            used.add(row); rememberDonor(row); rows.push(row);
          });
          if (!rows.length) return;
          node.appendChild(el('div', 'wc-gsection', { kids: [el('div', 'wc-glabel', { text: label }), el('div', 'wc-grp', { kids: rows })] }));
        });
        // Leftovers (blocks, hidden helpers) stay standalone — except a donor we just
        // emptied, which would otherwise render as a bare bordered box.
        kids.forEach(k => {
          if (used.has(k)) return;
          if (donors.has(k) && !k.children.length) { k.classList.add('hidden'); k._wcEmptied = true; return; }
          node.appendChild(k);
        });
      } else {
        // default: one container per run of consecutive rows
        let run = [];
        const flush = () => { if (!run.length) return; const grp = el('div', 'wc-grp'); node.insertBefore(grp, run[0]); run.forEach(r => grp.appendChild(r)); run = []; };
        kids.forEach(k => { if (isNativeRow(k)) run.push(k); else flush(); });
        flush();
      }
      node._wcOrigParents = donors;
      [].slice.call(node.querySelectorAll('.wc-grp select')).forEach(s => {
        if (s.parentElement && getComputedStyle(s.parentElement).display === 'none') return;  // skip hidden rows (e.g. #pill-monitor-row)
        toMenuRow(s, node);
      });
      node._wcGrouped = true;
    }
    function ungroupifyNative(node) {
      if (!node || !node._wcGrouped) return;
      (node._wcSelects || []).forEach(fromMenuRow);
      node._wcSelects = [];
      // Donors first: rows go back into the cards they were lifted out of, in their
      // original order. Must run BEFORE the .wc-gsection removal below, which is
      // where those rows currently live.
      (node._wcOrigParents || new Map()).forEach((order, p) => {
        order.forEach(n => p.appendChild(n));
        if (p._wcEmptied) { p.classList.remove('hidden'); delete p._wcEmptied; }
      });
      node._wcOrigOrder.forEach(n => node.appendChild(n));   // pulls rows back out, restores original order
      [].slice.call(node.querySelectorAll(':scope > .wc-gsection, :scope > .wc-grp')).forEach(g => g.remove());
      delete node._wcGrouped; delete node._wcOrigOrder; delete node._wcOrigParents;
    }
    function adoptInto(node, title, key) {
      const wasHidden = node.classList.contains('hidden');
      const anchor = document.createComment('wc-adopt');
      node.parentNode.insertBefore(anchor, node);
      node.classList.remove('hidden');
      WCShell.openPage({
        title, padBody: true,
        onClose() { ungroupifyNative(node); if (anchor.parentNode) { anchor.parentNode.insertBefore(node, anchor); anchor.remove(); } if (wasHidden) node.classList.add('hidden'); },
        build(pbody) { pbody.appendChild(el('div', 'wc-native', { kids: [node] })); groupifyNative(node, key); },
      });
    }
    function premiumIcon(label) {
      const l = label.toLowerCase();
      if (l.indexOf('speech') >= 0) return 'sparkles';
      if (l.indexOf('capture') >= 0) return 'mic';
      if (l.indexOf('format') >= 0) return 'type';
      if (l.indexOf('integration') >= 0) return 'send';
      if (l.indexOf('cleanup') >= 0 || l.indexOf('ai') >= 0) return 'sparkles';
      return 'settings';
    }
    function premiumSub(label) {
      const l = label.toLowerCase();
      if (l.indexOf('speech') >= 0) return 'Punctuation, commands, corrections';
      if (l.indexOf('capture') >= 0) return 'Streaming, continuous, wake word';
      if (l.indexOf('format') >= 0) return 'Vocabulary & snippet template';
      if (l.indexOf('cleanup') >= 0 || l.indexOf('ai') >= 0) return 'Post-processing & writing context';
      if (l.indexOf('integration') >= 0) return 'Webhook, Slack, Notion';
      return '';
    }
    function openCategory(key, title) {
      const section = drawer.querySelector('[data-section="' + key + '"]');
      const secBody = section && section.querySelector('.section-body');
      if (!secBody) return;
      // Premium is itself many feature blocks — give it a sub-menu, one page per block.
      if (key === 'premium') {
        const cards = [].slice.call(secBody.querySelectorAll('#premium-groups > .wc-set-card'));
        if (cards.length > 1) {
          WCShell.openPage({ title, padBody: true, build(body) {
            body.appendChild(sectionLabel('PREMIUM FEATURES', cards.length));
            cards.forEach(card => {
              const head = card.querySelector('.wc-set-head');
              const label = head ? head.textContent.trim() : 'Feature';
              body.appendChild(row({ iconName: premiumIcon(label), title: label, chevron: true, onClick: () => adoptInto(card, label) }));
            });
          } });
          return;
        }
      }
      adoptInto(secBody, title, key);
    }
  };

  // ---- Upgrade / License (¾ sheet) — the real license surface -------------
  //      Not licensed → benefits + a key field that activates against the
  //      server-side verifier. Licensed → shows your tier + remove-license.
  //      Premium in full, even though it lives in the shared shell file: the free
  //      build has nothing to sell and no key to accept, and shipping a "Paste your
  //      license key" field in the open-source app is an invitation, not a feature.

  // ---- entry point: tier in the wordmark (subscriber) OR a compact upgrade
  //      button (free). Additive; free layout otherwise untouched. -----------
  function clearEntry() {
    ['wc-pro-suffix', 'wc-pro-upgrade'].forEach(id => { const n = document.getElementById(id); if (n) n.remove(); });
    const bar = document.getElementById('title-bar');
    const nm = bar && bar.querySelector('[data-app-name]');
    if (nm) { const g = nm.parentNode; if (g) { if (g._wcTap) { g.removeEventListener('click', g._wcTap); g._wcTap = null; } g.classList.remove('wc-wordmark-tap'); g.removeAttribute('title'); } }
  }
  // route the app's Settings gear to the unified Settings surface (single point of navigation)
  function hookGear() {
    const gear = document.querySelector('#title-bar button[data-tooltip="Settings"]');
    if (!gear || gear._wcHooked) return;
    gear._wcHooked = true;
    gear.removeAttribute('onclick'); // was toggleSettings() → the accordion drawer
    gear.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); WCShell.settings(); });
  }

  function renderEntry() {
    hookGear();
    const bar = document.getElementById('title-bar');
    const nm = bar && bar.querySelector('[data-app-name]');
    if (!bar || !nm) return;
    clearEntry();
    // Free tier: NOTHING is added — no upgrade button, no Pro suffix, no Pro
    // mention anywhere in the free app. (clearEntry() above already stripped any
    // prior affordance.) Premium is sold outside the free product, not in it.
  }

  window.WCShell = WCShell;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderEntry);
  else renderEntry();
  setTimeout(renderEntry, 1200); // re-apply if the app re-renders its chrome
})();
