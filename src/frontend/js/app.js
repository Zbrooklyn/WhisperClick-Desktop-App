/* ============================================================
   WhisperClick — Frontend Application Logic
   ============================================================ */

(function () {
  'use strict';

  /* ---------- State ---------- */
  const State = {
    IDLE:       'IDLE',
    RECORDING:  'RECORDING',
    PROCESSING: 'PROCESSING',
    DONE:       'DONE',
  };

  const app = {
    state:            State.IDLE,
    pywebviewReady:   false,
    settings:         null,
    history:          [],
    currentText:      '',
    recordingStart:   null,
    timerInterval:    null,
    levelPollId:      null,
    levelRafId:       null,
    downloadPollId:   null,
    settingsOpen:     false,
    historyOpen:      false,
    exportMenuOpen:   false,
    onboardingModel:  null,
    processingCancelled: false,
    dropdowns:        {},   // CustomDropdown instances
  };

  /* ---------- Toolbar Selector (inline accordion panel) ---------- */
  class ToolbarSelector {
    constructor(id, onChange) {
      this.el = document.getElementById(id);
      this.trigger = this.el.querySelector('.dropdown-trigger');
      this.onChange = onChange;
      this._value = null;
      this._items = [];
      this._name = id;

      this.trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });
    }

    get value() { return this._value; }

    toggle() {
      const panel = document.getElementById('selector-panel');
      const isOpen = panel.classList.contains('open') && panel.dataset.owner === this._name;
      this._closePanel();
      if (!isOpen) this._openPanel();
    }

    _openPanel() {
      // Close other toolbar selectors first
      Object.values(app.dropdowns).forEach(d => {
        if (d !== this && d instanceof ToolbarSelector) d._closePanel();
      });
      const panel = document.getElementById('selector-panel');
      const container = document.getElementById('selector-panel-items');
      container.innerHTML = '';

      this._items.forEach(item => {
        const chip = document.createElement('button');
        chip.className = 'selector-chip' + (item.value === this._value ? ' selected' : '');
        chip.textContent = item.label;
        chip.addEventListener('click', () => {
          this.select(item.value, item.label);
        });
        container.appendChild(chip);
      });

      panel.dataset.owner = this._name;
      panel.classList.remove('collapsed');
      panel.classList.add('open');
    }

    _closePanel() {
      const panel = document.getElementById('selector-panel');
      if (panel.dataset.owner === this._name || !panel.dataset.owner) {
        panel.classList.remove('open');
        panel.classList.add('collapsed');
        panel.dataset.owner = '';
      }
    }

    select(value, label) {
      this._value = value;
      this._updateTriggerLabel(label);
      this._closePanel();
      if (this.onChange) this.onChange(value);
    }

    setValue(value) {
      const item = this._items.find(i => i.value === value);
      if (item) {
        this._value = value;
        this._updateTriggerLabel(item.label);
      }
    }

    populate(items, selectedValue) {
      this._items = items;
      if (selectedValue !== undefined) {
        this._value = selectedValue;
        const sel = items.find(i => i.value === selectedValue);
        if (sel) this._updateTriggerLabel(sel.label);
      }
    }

    _updateTriggerLabel(label) {
      const svgs = this.trigger.querySelectorAll('svg');
      const chevron = svgs.length > 0 ? ' ' + svgs[svgs.length - 1].outerHTML : '';
      if (this._name === 'mic-dropdown') {
        const micIcon = svgs.length > 1 ? svgs[0].outerHTML + ' ' : '';
        const short = label.length > 20 ? label.substring(0, 20) + '\u2026' : label;
        this.trigger.innerHTML = micIcon + escapeHtml(short) + ' ' + chevron;
      } else {
        const labelSpan = this.trigger.querySelector('.dropdown-label');
        const labelPrefix = labelSpan ? labelSpan.outerHTML + ' ' : '';
        this.trigger.innerHTML = labelPrefix + escapeHtml(label) + chevron;
      }
    }

    setVisible(visible) {
      this.el.style.display = visible ? '' : 'none';
      if (!visible) this._closePanel();
    }

    close() { this._closePanel(); }
  }

  /* ---------- Custom Dropdown Class ---------- */
  class CustomDropdown {
    constructor(id, onChange) {
      this.el = document.getElementById(id);
      this.trigger = this.el.querySelector('.dropdown-trigger');
      this.menu = this.el.querySelector('.dropdown-menu');
      this.onChange = onChange;
      this.open = false;
      this._value = null;

      // Read initial selected value
      const sel = this.menu.querySelector('.dropdown-item.selected');
      if (sel) this._value = sel.dataset.value;

      this.trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });

      this.menu.addEventListener('click', (e) => {
        const item = e.target.closest('.dropdown-item');
        if (!item) return;
        this.select(item.dataset.value, item.textContent.replace(/^\u2713\s*/, ''));
      });
    }

    get value() { return this._value; }

    toggle() {
      this.open ? this.close() : this.show();
    }

    show() {
      Object.values(app.dropdowns).forEach(d => { if (d !== this) d.close(); });
      this.menu.classList.remove('hidden');
      this.open = true;
    }

    close() {
      this.menu.classList.add('hidden');
      this.open = false;
    }

    select(value, label, silent) {
      this._value = value;
      // Update selected state
      this.menu.querySelectorAll('.dropdown-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.value === value);
      });
      // Rebuild trigger text, preserving prefix elements (label spans, icons)
      const svgs = this.trigger.querySelectorAll('svg');
      const chevron = svgs.length > 0 ? ' ' + svgs[svgs.length - 1].outerHTML : '';
      const labelSpan = this.trigger.querySelector('.dropdown-label');
      const labelPrefix = labelSpan ? labelSpan.outerHTML + ' ' : '';
      if (this.el.id === 'mic-dropdown') {
        const micIcon = svgs.length > 1 ? svgs[0].outerHTML + ' ' : '';
        const short = label.length > 20 ? label.substring(0, 20) + '\u2026' : label;
        this.trigger.innerHTML = micIcon + escapeHtml(short) + ' ' + chevron;
      } else {
        this.trigger.innerHTML = labelPrefix + escapeHtml(label) + chevron;
      }
      this.close();
      // Only fire onChange for user-initiated selections, not programmatic setValue
      if (!silent && this.onChange) this.onChange(value);
    }

    setValue(value) {
      const item = this.menu.querySelector(`.dropdown-item[data-value="${value}"]`);
      if (item) {
        this.select(value, item.textContent.replace(/^\u2713\s*/, ''), true);
      }
    }

    populate(items, selectedValue) {
      this.menu.innerHTML = '';
      items.forEach(item => {
        const el = document.createElement('div');
        el.className = 'dropdown-item' + (item.value === selectedValue ? ' selected' : '');
        el.dataset.value = item.value;
        el.textContent = item.label;
        this.menu.appendChild(el);
      });
      if (selectedValue !== undefined) {
        this._value = selectedValue;
        const sel = items.find(i => i.value === selectedValue);
        if (sel) {
          const svgs = this.trigger.querySelectorAll('svg');
          const chevron = svgs.length > 0 ? ' ' + svgs[svgs.length - 1].outerHTML : '';
          if (this.el.id === 'mic-dropdown') {
            const micIcon = svgs.length > 1 ? svgs[0].outerHTML + ' ' : '';
            const short = sel.label.length > 20 ? sel.label.substring(0, 20) + '\u2026' : sel.label;
            this.trigger.innerHTML = micIcon + escapeHtml(short) + ' ' + chevron;
          } else {
            this.trigger.innerHTML = escapeHtml(sel.label) + chevron;
          }
        }
      }
    }

    setVisible(visible) {
      this.el.style.display = visible ? '' : 'none';
    }
  }

  /* ---------- DOM References ---------- */
  const dom = {};

  function cacheDom() {
    // Header
    dom.settingsBtn       = document.getElementById('settings-btn');
    dom.minimizeBtn       = document.getElementById('minimize-btn');
    dom.closeBtn          = document.getElementById('close-btn');

    // Mode switch
    dom.modeSwitch        = document.getElementById('mode-switch');

    // Record
    dom.recordBtn         = document.getElementById('record-btn');
    dom.recordIconMic     = document.getElementById('record-icon-mic');
    dom.recordIconStop    = document.getElementById('record-icon-stop');
    dom.recordTimer       = document.getElementById('record-timer');
    dom.recordStateLabel  = document.getElementById('record-state-label');
    dom.audioBars         = document.getElementById('audio-bars');
    dom.autoCopyToggle    = document.getElementById('auto-copy-toggle');

    // Transcription
    dom.transcriptionSection = document.getElementById('transcription-section');
    dom.transcriptionText    = document.getElementById('transcription-text');
    dom.processingIndicator  = document.getElementById('processing-indicator');
    dom.cancelProcessingBtn  = document.getElementById('cancel-processing-btn');
    dom.copyBtn              = document.getElementById('copy-btn');
    dom.exportBtn            = document.getElementById('export-btn');
    dom.exportMenu           = document.getElementById('export-menu');

    // History
    dom.historyToggle     = document.getElementById('history-toggle');
    dom.historyPanel      = document.getElementById('history-panel');
    dom.historyList       = document.getElementById('history-list');
    dom.historyCount      = document.getElementById('history-count');
    dom.historyActions    = document.getElementById('history-actions');
    dom.clearHistoryBtn   = document.getElementById('clear-history-btn');

    // Settings
    dom.settingsDrawer    = document.getElementById('settings-drawer');
    dom.settingsBackdrop  = document.getElementById('settings-backdrop');
    dom.settingsCloseBtn  = document.getElementById('settings-close-btn');
    dom.settingsTheme     = document.getElementById('settings-theme-toggle');
    dom.settingsStartup   = document.getElementById('settings-startup-toggle');
    dom.settingsHotkey    = document.getElementById('settings-hotkey-display');
    dom.hotkeyEditBtn     = document.getElementById('settings-hotkey-edit-btn');
    dom.hotkeyCaptureArea = document.getElementById('hotkey-capture-area');
    dom.hotkeyCaptureDisp = document.getElementById('hotkey-capture-display');
    dom.hotkeySaveBtn     = document.getElementById('hotkey-save-btn');
    dom.hotkeyCancelBtn   = document.getElementById('hotkey-cancel-btn');
    dom.settingsModelList = document.getElementById('settings-model-list');
    dom.settingsDownloadProgress = document.getElementById('settings-download-progress');
    dom.settingsProgressBar      = document.getElementById('settings-progress-bar');
    dom.settingsProgressText     = document.getElementById('settings-progress-text');

    dom.settingsCloseBehavior = document.getElementById('settings-close-behavior');
    dom.settingsSound         = document.getElementById('settings-sound-toggle');
    dom.settingsAlwaysOnTop   = document.getElementById('settings-always-on-top-toggle');
    dom.settingsPillWidget    = document.getElementById('settings-pill-widget-toggle');

    // Status
    dom.statusDot         = document.getElementById('status-indicator');
    dom.statusText        = document.getElementById('status-text');
    dom.connectionStatus  = document.getElementById('connection-status');

    // Onboarding
    dom.onboardingOverlay     = document.getElementById('onboarding-overlay');
    dom.onboardingModelList   = document.getElementById('onboarding-model-list');
    dom.onboardingProgressArea = document.getElementById('onboarding-progress-area');
    dom.onboardingProgressBar  = document.getElementById('onboarding-progress-bar');
    dom.onboardingProgressText = document.getElementById('onboarding-progress-text');
    dom.onboardingSkipBtn      = document.getElementById('onboarding-skip-btn');

    // Toast
    dom.toastContainer = document.getElementById('toast-container');
  }

  /* ---------- pywebview Bridge ---------- */
  function api() {
    return window.pywebview && window.pywebview.api;
  }

  async function callApi(method, ...args) {
    if (!api()) {
      console.warn(`[WhisperClick] pywebview API not available. Skipping: ${method}`);
      return null;
    }
    if (typeof api()[method] !== 'function') {
      console.warn(`[WhisperClick] API method not found: ${method}`);
      return null;
    }
    try {
      return await api()[method](...args);
    } catch (err) {
      console.error(`[WhisperClick] API call failed: ${method}`, err);
      showToast(`Error: ${err.message || method + ' failed'}`, 'error');
      return null;
    }
  }

  /* ---------- Toast Notifications ---------- */
  function showToast(message, type = 'info', duration = 3000) {
    const iconPaths = {
      success: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
      error:   '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
      info:    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
      warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <svg class="toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        ${iconPaths[type] || iconPaths.info}
      </svg>
      <span>${escapeHtml(message)}</span>
    `;
    dom.toastContainer.appendChild(toast);

    const timer = setTimeout(() => dismissToast(toast), duration);
    toast._timer = timer;
  }

  function dismissToast(toast) {
    if (!toast || !toast.parentNode) return;
    clearTimeout(toast._timer);
    toast.classList.add('dismissing');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }

  /* ---------- Utility ---------- */
  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function formatTimestamp(ts) {
    try {
      const d = new Date(ts);
      return d.toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return ts;
    }
  }

  function formatDuration(sec) {
    if (!sec || sec < 1) return '< 1s';
    if (sec < 60) return `${Math.round(sec)}s`;
    return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  }

  function formatSize(mb) {
    if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
    return `${Math.round(mb)} MB`;
  }

  /* ---------- State Machine ---------- */
  function setState(newState) {
    const prev = app.state;
    app.state = newState;
    updateUI(prev, newState);
  }

  function updateUI(prev, next) {
    // Record button
    const isRecording = next === State.RECORDING;
    dom.recordBtn.classList.toggle('recording', isRecording);
    dom.recordIconMic.classList.toggle('hidden', isRecording);
    dom.recordIconStop.classList.toggle('hidden', !isRecording);

    // Disable record button during processing
    dom.recordBtn.disabled = (next === State.PROCESSING);

    // State label
    const labels = {
      [State.IDLE]:       'Press to record',
      [State.RECORDING]:  'Recording... click to stop',
      [State.PROCESSING]: 'Processing audio...',
      [State.DONE]:       'Press to record again',
    };
    dom.recordStateLabel.textContent = labels[next] || '';

    // Processing indicator
    const isProcessing = next === State.PROCESSING;
    dom.processingIndicator.classList.toggle('hidden', !isProcessing);
    if (isProcessing) {
      dom.transcriptionSection.classList.remove('hidden');
      dom.transcriptionText.textContent = '';
    }

    // Status bar
    dom.statusDot.className = 'status-dot';
    if (next === State.RECORDING) {
      dom.statusDot.classList.add('recording');
      dom.statusText.textContent = 'Recording';
    } else if (next === State.PROCESSING) {
      dom.statusDot.classList.add('processing');
      dom.statusText.textContent = 'Processing';
    } else {
      dom.statusText.textContent = 'Ready';
    }

    // Audio bars reset when not recording
    if (next !== State.RECORDING) {
      dom.audioBars.classList.remove('active');
      const bars = dom.audioBars.querySelectorAll('.audio-bar');
      bars.forEach(bar => { bar.style.height = '4px'; });
    }
  }

  /* ---------- Recording ---------- */
  async function toggleRecording() {
    if (app.state === State.IDLE || app.state === State.DONE) {
      await startRecording();
    } else if (app.state === State.RECORDING) {
      await stopRecording();
    }
    // Do nothing if processing
  }

  async function startRecording() {
    dom.recordBtn.disabled = true;
    const result = await callApi('start_recording');
    dom.recordBtn.disabled = false;
    if (!result || !result.success) {
      const errMsg = (result && result.error) ? result.error : 'Unable to start recording';
      setState(State.IDLE);
      showToast(errMsg, 'warning');
      return;
    }

    setState(State.RECORDING);
    app.recordingStart = Date.now();
    dom.recordTimer.textContent = '00:00';

    // Timer
    app.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - app.recordingStart) / 1000);
      dom.recordTimer.textContent = formatTime(elapsed);
    }, 1000);

    // Audio level polling
    startLevelPolling();
  }

  async function stopRecording() {
    // Stop timers first
    clearInterval(app.timerInterval);
    app.timerInterval = null;
    stopLevelPolling();

    const duration = (Date.now() - app.recordingStart) / 1000;
    app.processingCancelled = false;
    setState(State.PROCESSING);

    const result = await callApi('stop_recording');

    // If user cancelled during processing, discard the result
    if (app.processingCancelled) {
      app.processingCancelled = false;
      return;
    }

    if (result && result.success && result.text) {
      app.currentText = result.text;
      dom.transcriptionText.textContent = app.currentText;
      dom.processingIndicator.classList.add('hidden');
      dom.transcriptionSection.classList.remove('hidden');
      setState(State.DONE);

      // Show processing time
      if (result.transcription_time) {
        showToast(`Processed in ${formatDuration(result.transcription_time)}`, 'info', 3000);
      }

      // Auto-copy
      if (dom.autoCopyToggle.checked && app.currentText.trim()) {
        await callApi('copy_to_clipboard', app.currentText);
        showToast('Copied to clipboard!', 'success', 2000);
      }

      // Refresh history
      await loadHistory();
    } else if (result && result.cancelled) {
      setState(State.IDLE);
    } else {
      setState(State.IDLE);
      const errMsg = (result && result.error) ? result.error : 'No transcription result';
      showToast(errMsg, 'warning');
    }
  }

  async function cancelProcessing() {
    if (app.state !== State.PROCESSING) return;
    await callApi('cancel_processing');
    app.processingCancelled = true;
    dom.processingIndicator.classList.add('hidden');
    setState(State.IDLE);
    showToast('Cancelling transcription...', 'info', 2000);
  }

  /* ---------- Audio Level Polling (Bars) ---------- */
  let _currentLevel = 0;

  function startLevelPolling() {
    stopLevelPolling();
    dom.audioBars.classList.add('active');

    // Poll audio level from backend
    app.levelPollId = setInterval(async () => {
      if (app.state !== State.RECORDING) {
        stopLevelPolling();
        return;
      }
      const level = await callApi('get_audio_level');
      if (level !== null && level !== undefined) {
        _currentLevel = Math.min(Math.max(parseFloat(level), 0), 1);
      }
    }, 50);

    // Animate bars with requestAnimationFrame
    const bars = dom.audioBars.querySelectorAll('.audio-bar');
    function animateBars() {
      if (app.state !== State.RECORDING) return;
      bars.forEach((bar, i) => {
        // Base height from level + slight per-bar randomization
        const rand = 0.7 + Math.random() * 0.6;
        const h = Math.max(4, _currentLevel * 22 * rand);
        bar.style.height = h + 'px';
      });
      app.levelRafId = requestAnimationFrame(animateBars);
    }
    app.levelRafId = requestAnimationFrame(animateBars);
  }

  function stopLevelPolling() {
    if (app.levelPollId) {
      clearInterval(app.levelPollId);
      app.levelPollId = null;
    }
    if (app.levelRafId) {
      cancelAnimationFrame(app.levelRafId);
      app.levelRafId = null;
    }
    _currentLevel = 0;
  }

  /* ---------- Mode Toggle ---------- */
  function initModeSwitch() {
    const buttons = dom.modeSwitch.querySelectorAll('.pill-option');
    buttons.forEach(btn => {
      btn.addEventListener('click', async () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        dom.modeSwitch.dataset.active = mode;

        // Show/hide model dropdown in toolbar
        if (app.dropdowns.model) {
          app.dropdowns.model.setVisible(mode === 'local');
        }

        await callApi('set_mode', mode);
      });
    });
  }

  /* ---------- Custom Dropdowns Init ---------- */
  function initCustomDropdowns() {
    app.dropdowns.model = new ToolbarSelector('model-dropdown', async (value) => {
      await callApi('set_model', value);
    });

    app.dropdowns.mic = new ToolbarSelector('mic-dropdown', async (value) => {
      if (value) await callApi('set_microphone', value);
    });

    app.dropdowns.language = new CustomDropdown('language-dropdown', async (value) => {
      await callApi('set_language', value);
      await saveCurrentSettings();
    });

    // Close panels/dropdowns on outside click
    document.addEventListener('click', (e) => {
      Object.values(app.dropdowns).forEach(d => {
        if (d instanceof ToolbarSelector) {
          if (!d.el.contains(e.target) && !document.getElementById('selector-panel').contains(e.target)) {
            d._closePanel();
          }
        } else if (d.open && !d.el.contains(e.target)) {
          d.close();
        }
      });
    });
  }

  /* ---------- Load Toolbar Options ---------- */
  async function loadModelOptions() {
    const models = await callApi('get_models');
    if (!models || models.length === 0) {
      app.dropdowns.model.populate([{ value: 'base', label: 'base' }], 'base');
      return;
    }

    const items = models.map(model => ({ value: model.name, label: model.name }));
    const preferred = app.settings && app.settings.model;
    const fallback = app.dropdowns.model && app.dropdowns.model.value;
    const selected = items.some(i => i.value === preferred)
      ? preferred
      : (items.some(i => i.value === fallback) ? fallback : items[0].value);

    app.dropdowns.model.populate(items, selected);
  }

  /* ---------- Load Microphones ---------- */
  async function loadMicrophones() {
    const mics = await callApi('get_microphones');
    if (mics && mics.length > 0) {
      const items = mics.map(mic => ({ value: String(mic.id), label: mic.name }));
      app.dropdowns.mic.populate(items, items[0].value);
    } else {
      app.dropdowns.mic.populate([{ value: '', label: 'No microphones found' }], '');
    }
  }

  /* ---------- Copy & Export ---------- */
  function initTranscriptionActions() {
    dom.copyBtn.addEventListener('click', async () => {
      if (!app.currentText) return;
      await callApi('copy_to_clipboard', app.currentText);
      showToast('Copied to clipboard!', 'success', 2000);
    });

    dom.exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      app.exportMenuOpen = !app.exportMenuOpen;
      dom.exportMenu.classList.toggle('hidden', !app.exportMenuOpen);
    });

    dom.exportMenu.querySelectorAll('.export-option').forEach(opt => {
      opt.addEventListener('click', async () => {
        const format = opt.dataset.format;
        dom.exportMenu.classList.add('hidden');
        app.exportMenuOpen = false;
        if (!app.currentText) return;
        await callApi('export_transcription', app.currentText, format);
        showToast(`Export saved as ${format.toUpperCase()}`, 'success');
      });
    });

    // Close export menu on outside click
    document.addEventListener('click', (e) => {
      if (app.exportMenuOpen && !dom.exportBtn.contains(e.target) && !dom.exportMenu.contains(e.target)) {
        dom.exportMenu.classList.add('hidden');
        app.exportMenuOpen = false;
      }
    });
  }

  /* ---------- History ---------- */
  async function loadHistory() {
    const items = await callApi('get_history');
    app.history = items || [];
    renderHistory();
  }

  function renderHistory() {
    dom.historyCount.textContent = app.history.length;
    dom.historyActions.classList.toggle('hidden', app.history.length === 0);

    if (app.history.length === 0) {
      dom.historyList.innerHTML = '<div class="history-empty"><p>No transcriptions yet.</p></div>';
      return;
    }

    dom.historyList.innerHTML = '';
    app.history.forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';
      el.dataset.id = item.id;
      const durationParts = [formatDuration(item.duration)];
      if (item.transcription_time) {
        durationParts.push(`processed in ${formatDuration(item.transcription_time)}`);
      }
      el.innerHTML = `
        <div class="history-item-header">
          <span class="history-item-time">${escapeHtml(formatTimestamp(item.timestamp))}</span>
          <span class="history-item-duration">${escapeHtml(durationParts.join(' \u2022 '))}</span>
        </div>
        <div class="history-item-preview">${escapeHtml(item.text)}</div>
        <div class="history-item-actions hidden">
          <button class="btn btn-sm history-copy-btn">Copy</button>
          <button class="btn btn-sm btn-danger history-delete-btn">Delete</button>
        </div>
      `;

      // Click to expand/collapse
      el.addEventListener('click', (e) => {
        if (e.target.closest('.history-item-actions')) return;
        el.classList.toggle('expanded');
        el.querySelector('.history-item-actions').classList.toggle('hidden');
      });

      // Copy
      el.querySelector('.history-copy-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        await callApi('copy_to_clipboard', item.text);
        showToast('Copied!', 'success', 2000);
      });

      // Delete
      el.querySelector('.history-delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        await callApi('delete_history', item.id);
        await loadHistory();
        showToast('Deleted', 'info', 2000);
      });

      dom.historyList.appendChild(el);
    });
  }

  function initHistory() {
    dom.historyToggle.addEventListener('click', () => {
      app.historyOpen = !app.historyOpen;
      dom.historyPanel.classList.toggle('collapsed', !app.historyOpen);
    });

    dom.clearHistoryBtn.addEventListener('click', async () => {
      await callApi('clear_history');
      await loadHistory();
      showToast('History cleared', 'info');
    });
  }

  /* ---------- Settings Drawer ---------- */
  function openSettings() {
    app.settingsOpen = true;
    dom.settingsDrawer.classList.add('open');
    dom.settingsBackdrop.classList.remove('hidden');
    refreshSettingsModels();
  }

  function closeSettings() {
    app.settingsOpen = false;
    dom.settingsDrawer.classList.remove('open');
    dom.settingsBackdrop.classList.add('hidden');
  }

  function initSettings() {
    dom.settingsBtn.addEventListener('click', openSettings);
    dom.settingsCloseBtn.addEventListener('click', closeSettings);
    dom.settingsBackdrop.addEventListener('click', closeSettings);

    // Window controls (frameless mode)
    if (dom.minimizeBtn) {
      dom.minimizeBtn.addEventListener('click', () => callApi('minimize'));
    }
    if (dom.closeBtn) {
      dom.closeBtn.addEventListener('click', () => callApi('close'));
    }

    // Theme toggle
    dom.settingsTheme.addEventListener('change', async () => {
      const theme = dom.settingsTheme.checked ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', theme);
      await saveCurrentSettings();
    });

    // Start with windows
    dom.settingsStartup.addEventListener('change', async () => {
      await saveCurrentSettings();
    });

    // Close behavior
    dom.settingsCloseBehavior.addEventListener('change', async () => {
      await saveCurrentSettings();
    });

    // Sound effects
    dom.settingsSound.addEventListener('change', async () => {
      await saveCurrentSettings();
    });

    // Always on top
    dom.settingsAlwaysOnTop.addEventListener('change', async () => {
      await saveCurrentSettings();
    });

    // Pill widget
    dom.settingsPillWidget.addEventListener('change', async () => {
      await saveCurrentSettings();
    });
  }

  async function loadSettings() {
    const s = await callApi('get_settings');
    if (!s) return;
    app.settings = s;

    // Apply theme
    const theme = s.theme || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    dom.settingsTheme.checked = theme === 'light';

    // Auto-copy
    if (s.auto_copy !== undefined) {
      dom.autoCopyToggle.checked = s.auto_copy;
    }

    // Start with windows
    if (s.start_with_windows !== undefined) {
      dom.settingsStartup.checked = s.start_with_windows;
    }

    // Hotkey
    if (s.hotkey) {
      dom.settingsHotkey.textContent = s.hotkey;
      const hint = document.querySelector('.hotkey-hint');
      if (hint) hint.textContent = s.hotkey;
    }

    // Close behavior
    if (s.close_behavior) {
      dom.settingsCloseBehavior.value = s.close_behavior;
    }

    // Sound effects
    dom.settingsSound.checked = s.sound_enabled !== false;

    // Always on top
    dom.settingsAlwaysOnTop.checked = !!s.always_on_top;

    // Pill widget
    dom.settingsPillWidget.checked = !!s.show_pill_widget;

    // Mode
    if (s.mode) {
      const buttons = dom.modeSwitch.querySelectorAll('.pill-option');
      buttons.forEach(b => {
        b.classList.toggle('active', b.dataset.mode === s.mode);
      });
      dom.modeSwitch.dataset.active = s.mode;
      if (app.dropdowns.model) {
        app.dropdowns.model.setVisible(s.mode === 'local');
      }
    }

    // Model
    if (s.model && app.dropdowns.model) {
      app.dropdowns.model.setValue(s.model);
    }

    // Language
    if (s.language && app.dropdowns.language) {
      app.dropdowns.language.setValue(s.language);
    }
  }

  async function saveCurrentSettings() {
    const settings = {
      theme: dom.settingsTheme.checked ? 'light' : 'dark',
      auto_copy: dom.autoCopyToggle.checked,
      start_with_windows: dom.settingsStartup.checked,
      language: app.dropdowns.language ? app.dropdowns.language.value : 'auto',
      mode: dom.modeSwitch.dataset.active || 'local',
      model: app.dropdowns.model ? app.dropdowns.model.value : 'base',
      close_behavior: dom.settingsCloseBehavior.value,
      sound_enabled: dom.settingsSound.checked,
      always_on_top: dom.settingsAlwaysOnTop.checked,
      show_pill_widget: dom.settingsPillWidget.checked,
    };
    await callApi('save_settings', settings);
  }

  // Auto-copy toggle also saves settings
  function initAutoCopy() {
    dom.autoCopyToggle.addEventListener('change', async () => {
      await saveCurrentSettings();
    });
  }

  /* ---------- Model Management ---------- */
  async function refreshSettingsModels() {
    const models = await callApi('get_models');
    if (!models) return;
    renderModelList(dom.settingsModelList, models, 'settings');
    await loadModelOptions();
  }

  function renderModelList(container, models, context) {
    container.innerHTML = '';
    models.forEach(model => {
      const el = document.createElement('div');
      el.className = 'model-item';
      el.innerHTML = `
        <div class="model-item-info">
          <span class="model-item-name">${escapeHtml(model.name)}</span>
          <span class="model-item-size">${escapeHtml(formatSize(model.size_mb))}${model.description ? ' \u2014 ' + escapeHtml(model.description) : ''}</span>
        </div>
        <div class="model-item-right"></div>
      `;

      const right = el.querySelector('.model-item-right');

      if (model.downloaded) {
        const badge = document.createElement('span');
        badge.className = 'model-item-badge';
        badge.textContent = 'Downloaded';
        right.appendChild(badge);

        if (context === 'settings') {
          const delBtn = document.createElement('button');
          delBtn.className = 'btn btn-sm btn-danger';
          delBtn.textContent = 'Delete';
          delBtn.style.marginLeft = '8px';
          delBtn.addEventListener('click', async () => {
            await callApi('delete_model', model.name);
            showToast(`Model "${model.name}" deleted`, 'info');
            await refreshSettingsModels();
          });
          right.appendChild(delBtn);
        }
      } else {
        const dlBtn = document.createElement('button');
        dlBtn.className = 'btn btn-sm btn-primary';
        dlBtn.textContent = 'Download';
        dlBtn.addEventListener('click', async () => {
          dlBtn.disabled = true;
          dlBtn.textContent = 'Starting...';
          const started = await startModelDownload(model.name, context);
          if (!started) {
            dlBtn.disabled = false;
            dlBtn.textContent = 'Download';
          }
        });
        right.appendChild(dlBtn);
      }

      container.appendChild(el);
    });
  }

  async function startModelDownload(modelName, context) {
    const startResult = await callApi('download_model', modelName);
    if (!startResult || !startResult.success) {
      const err = startResult && startResult.error ? startResult.error : 'Failed to start download';
      showToast(err, 'error');
      return false;
    }

    const progressArea = context === 'settings'
      ? dom.settingsDownloadProgress
      : dom.onboardingProgressArea;
    const progressBar = context === 'settings'
      ? dom.settingsProgressBar
      : dom.onboardingProgressBar;
    const progressText = context === 'settings'
      ? dom.settingsProgressText
      : dom.onboardingProgressText;

    progressArea.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = 'Starting download...';

    let polling = false;
    let finished = false;

    function finishDownload() {
      if (finished) return;
      finished = true;
      clearInterval(app.downloadPollId);
      app.downloadPollId = null;
      progressBar.style.width = '100%';
      progressText.textContent = 'Complete!';

      setTimeout(() => {
        progressArea.classList.add('hidden');
        showToast(`Model "${modelName}" downloaded!`, 'success');
        if (context === 'settings') {
          refreshSettingsModels();
        } else {
          loadModelOptions();
          dom.onboardingOverlay.classList.add('hidden');
        }
      }, 500);
    }

    app.downloadPollId = setInterval(async () => {
      if (polling || finished) return;
      polling = true;
      try {
        const prog = await callApi('get_download_progress');
        if (!prog || prog.progress >= 1 || prog.status === 'complete') {
          finishDownload();
          return;
        }
        if (prog.status && prog.status.startsWith('error:')) {
          finished = true;
          clearInterval(app.downloadPollId);
          app.downloadPollId = null;
          progressArea.classList.add('hidden');
          showToast(prog.status, 'error');
          return;
        }
        const pct = Math.round((prog.progress || 0) * 100);
        progressBar.style.width = pct + '%';
        progressText.textContent = `Downloading... ${pct}%`;
      } finally {
        polling = false;
      }
    }, 500);
    return true;
  }

  /* ---------- Onboarding ---------- */
  async function checkOnboarding() {
    const result = await callApi('check_onboarding');
    if (!result || !result.needs_setup) return;

    dom.onboardingOverlay.classList.remove('hidden');

    const models = await callApi('get_models');
    if (!models) return;

    const recommended = models.filter(m => ['tiny', 'base', 'small'].includes(m.name));
    const others = models.filter(m => !['tiny', 'base', 'small'].includes(m.name));
    const allModels = [...recommended, ...others];

    dom.onboardingModelList.innerHTML = '';
    allModels.forEach((model, idx) => {
      const el = document.createElement('div');
      el.className = 'onboarding-model-option' + (idx === 1 ? ' selected' : '');
      el.innerHTML = `
        <div class="model-item-info">
          <span class="model-item-name">${escapeHtml(model.name)}</span>
          <span class="model-item-size">${escapeHtml(formatSize(model.size_mb))}${model.description ? ' \u2014 ' + escapeHtml(model.description) : ''}</span>
        </div>
        <button class="btn btn-sm btn-primary onboarding-dl-btn">Download</button>
      `;

      el.addEventListener('click', (e) => {
        if (e.target.closest('.onboarding-dl-btn')) return;
        dom.onboardingModelList.querySelectorAll('.onboarding-model-option').forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
        app.onboardingModel = model.name;
      });

      el.querySelector('.onboarding-dl-btn').addEventListener('click', async () => {
        app.onboardingModel = model.name;
        await startModelDownload(model.name, 'onboarding');
      });

      dom.onboardingModelList.appendChild(el);
    });

    app.onboardingModel = allModels.length > 1 ? allModels[1].name : allModels[0]?.name;

    dom.onboardingSkipBtn.addEventListener('click', () => {
      dom.onboardingOverlay.classList.add('hidden');
    });
  }

  /* ---------- Keyboard Shortcuts ---------- */
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (app.settingsOpen) {
          closeSettings();
        }
        if (app.exportMenuOpen) {
          dom.exportMenu.classList.add('hidden');
          app.exportMenuOpen = false;
        }
        // Close any open custom dropdowns / selector panels
        Object.values(app.dropdowns).forEach(d => d.close());
      }
    });
  }

  /* ---------- Connection Status ---------- */
  function updateConnectionStatus(connected) {
    if (connected) {
      dom.connectionStatus.className = 'connection-status connected';
      dom.connectionStatus.innerHTML = '<span class="connection-dot"></span>Connected';
    } else {
      dom.connectionStatus.className = 'connection-status disconnected';
      dom.connectionStatus.innerHTML = '<span class="connection-dot"></span>Disconnected';
    }
  }

  /* ---------- Custom Hotkey Capture ---------- */
  function initHotkeyCapture() {
    let capturedKeys = null;

    dom.hotkeyEditBtn.addEventListener('click', () => {
      capturedKeys = null;
      dom.hotkeyCaptureArea.classList.remove('hidden');
      dom.hotkeyCaptureDisp.textContent = 'Waiting...';
      dom.hotkeyCaptureDisp.classList.add('recording');
      dom.hotkeySaveBtn.disabled = true;
    });

    dom.hotkeyCancelBtn.addEventListener('click', () => {
      dom.hotkeyCaptureArea.classList.add('hidden');
      dom.hotkeyCaptureDisp.classList.remove('recording');
    });

    dom.hotkeyCaptureArea.addEventListener('keydown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Win');

      const key = e.key;
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
        parts.push(key.length === 1 ? key.toUpperCase() : key);
      }

      if (parts.length > 0) {
        const display = parts.join(' + ');
        dom.hotkeyCaptureDisp.textContent = display;
        if (parts.length >= 2 && !['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
          capturedKeys = display;
          dom.hotkeySaveBtn.disabled = false;
          dom.hotkeyCaptureDisp.classList.remove('recording');
        }
      }
    });

    dom.hotkeyCaptureArea.setAttribute('tabindex', '0');

    dom.hotkeySaveBtn.addEventListener('click', async () => {
      if (!capturedKeys) return;
      dom.settingsHotkey.textContent = capturedKeys;
      dom.hotkeyCaptureArea.classList.add('hidden');

      const hint = document.querySelector('.hotkey-hint');
      if (hint) hint.textContent = capturedKeys;

      await callApi('save_settings', { hotkey: capturedKeys });
      showToast('Hotkey updated! Restart app to apply.', 'success');
    });
  }

  /* ---------- Initialization ---------- */
  async function initApp() {
    cacheDom();
    initCustomDropdowns();
    initModeSwitch();
    initTranscriptionActions();
    initHistory();
    initSettings();
    initAutoCopy();
    initKeyboardShortcuts();

    // Record button handler
    dom.recordBtn.addEventListener('click', toggleRecording);

    // Cancel processing button
    dom.cancelProcessingBtn.addEventListener('click', cancelProcessing);

    // Hotkey capture
    initHotkeyCapture();

    // Wait for pywebview
    if (window.pywebview && window.pywebview.api) {
      app.pywebviewReady = true;
      await bootstrap();
    } else {
      window.addEventListener('pywebviewready', async () => {
        app.pywebviewReady = true;
        updateConnectionStatus(true);
        await bootstrap();
      });
      setTimeout(() => {
        if (!app.pywebviewReady) {
          updateConnectionStatus(false);
          console.warn('[WhisperClick] pywebview not detected. Running in standalone mode.');
        }
      }, 3000);
    }
  }

  async function bootstrap() {
    updateConnectionStatus(true);
    await loadSettings();
    await loadModelOptions();
    await loadMicrophones();
    await loadHistory();
    await checkOnboarding();
  }

  // Expose toggleRecording globally for pywebview evaluate_js calls
  window.toggleRecording = toggleRecording;

  // Expose openSettings globally so external callers can open the settings drawer
  window.openSettings = function() {
    app.settingsOpen = true;
    dom.settingsDrawer.classList.add('open');
    dom.settingsBackdrop.classList.remove('hidden');
    refreshSettingsModels();
  };

  /* ---------- Start ---------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
