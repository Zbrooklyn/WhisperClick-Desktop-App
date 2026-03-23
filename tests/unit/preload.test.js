const { contextBridge, ipcRenderer } = require('electron');

// Capture the API exposed via contextBridge
let api;

beforeAll(() => {
  contextBridge._reset();
  require('../../platforms/electron/preload');
  const pywebview = contextBridge._getExposed('pywebview');
  api = pywebview.api;
});

beforeEach(() => {
  ipcRenderer.invoke.mockClear();
});

// ── Settings: snake_case → camelCase (V3 → Electron) ───────────────────

describe('snake_case → camelCase translation', () => {
  test('auto_copy → autoPaste', async () => {
    await api.save_settings({ auto_copy: true });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual(expect.objectContaining({ autoPaste: true }));
  });

  test('start_with_windows → autoStart', async () => {
    await api.save_settings({ start_with_windows: true });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual(expect.objectContaining({ autoStart: true }));
  });

  test('close_behavior → closeBehavior', async () => {
    await api.save_settings({ close_behavior: 'quit' });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual(expect.objectContaining({ closeBehavior: 'quit' }));
  });

  test('api_provider → provider', async () => {
    await api.save_settings({ api_provider: 'gemini' });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual(expect.objectContaining({ provider: 'gemini' }));
  });

  test('model → localModel', async () => {
    await api.save_settings({ model: 'small' });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual(expect.objectContaining({ localModel: 'small' }));
  });

  test('sound_enabled → soundEnabled', async () => {
    await api.save_settings({ sound_enabled: false });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual(expect.objectContaining({ soundEnabled: false }));
  });

  test('always_on_top → alwaysOnTop', async () => {
    await api.save_settings({ always_on_top: true });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual(expect.objectContaining({ alwaysOnTop: true }));
  });

  test('show_pill_widget → showPill', async () => {
    await api.save_settings({ show_pill_widget: false });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual(expect.objectContaining({ showPill: false }));
  });

  test('api_model → apiModel', async () => {
    await api.save_settings({ api_model: 'gpt-4o-transcribe' });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual(expect.objectContaining({ apiModel: 'gpt-4o-transcribe' }));
  });

  test('output_mode → outputMode', async () => {
    await api.save_settings({ output_mode: 'translate' });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual(expect.objectContaining({ outputMode: 'translate' }));
  });

  test('target_language → targetLanguage', async () => {
    await api.save_settings({ target_language: 'es' });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual(expect.objectContaining({ targetLanguage: 'es' }));
  });

  test('source_language → sourceLanguage', async () => {
    await api.save_settings({ source_language: 'fr' });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual(expect.objectContaining({ sourceLanguage: 'fr' }));
  });

  test('api_base_url → customBaseUrl', async () => {
    await api.save_settings({ api_base_url: 'http://localhost:8080' });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual(expect.objectContaining({ customBaseUrl: 'http://localhost:8080' }));
  });

  test('audio_retention_days maps to audioRetentionDays', async () => {
    await api.save_settings({ audio_retention_days: 7 });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual(expect.objectContaining({ audioRetentionDays: 7 }));
  });

  test('unmapped keys pass through unchanged', async () => {
    await api.save_settings({ theme: 'light' });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual(expect.objectContaining({ theme: 'light' }));
  });

  test('multiple keys translated in one patch', async () => {
    await api.save_settings({ auto_copy: true, close_behavior: 'quit', theme: 'light' });
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual({ autoPaste: true, closeBehavior: 'quit', theme: 'light' });
  });

  test('save_settings returns success', async () => {
    const result = await api.save_settings({ theme: 'dark' });
    expect(result).toEqual({ success: true });
  });
});

// ── Settings: camelCase → snake_case (Electron → V3) ───────────────────

describe('camelCase → snake_case translation', () => {
  test('autoPaste → auto_copy', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ autoPaste: true });
    const result = await api.get_settings();
    expect(result.auto_copy).toBe(true);
  });

  test('autoStart → start_with_windows', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ autoStart: false });
    const result = await api.get_settings();
    expect(result.start_with_windows).toBe(false);
  });

  test('closeBehavior → close_behavior', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ closeBehavior: 'tray' });
    const result = await api.get_settings();
    expect(result.close_behavior).toBe('tray');
  });

  test('localModel → model', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ localModel: 'base' });
    const result = await api.get_settings();
    expect(result.model).toBe('base');
  });

  test('provider → api_provider', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ provider: 'gemini' });
    const result = await api.get_settings();
    expect(result.api_provider).toBe('gemini');
  });

  test('soundEnabled → sound_enabled', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ soundEnabled: true });
    const result = await api.get_settings();
    expect(result.sound_enabled).toBe(true);
  });

  test('alwaysOnTop → always_on_top', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ alwaysOnTop: false });
    const result = await api.get_settings();
    expect(result.always_on_top).toBe(false);
  });

  test('showPill → show_pill_widget', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ showPill: true });
    const result = await api.get_settings();
    expect(result.show_pill_widget).toBe(true);
  });
});

// ── Security: API keys stripped ─────────────────────────────────────────

describe('security', () => {
  test('API keys stripped from get_settings (all forms)', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({
      openaiApiKey: 'sk-secret',
      geminiApiKey: 'AIza-secret',
      theme: 'dark',
    });
    const result = await api.get_settings();
    expect(result.openai_api_key).toBeUndefined();
    expect(result.gemini_api_key).toBeUndefined();
    expect(result.openaiApiKey).toBeUndefined();
    expect(result.geminiApiKey).toBeUndefined();
  });

  test('non-key fields preserved after stripping', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({
      theme: 'dark',
      mode: 'api',
      openaiApiKey: 'sk-secret',
    });
    const result = await api.get_settings();
    expect(result.theme).toBe('dark');
    expect(result.mode).toBe('api');
  });
});

// ── API key routing ─────────────────────────────────────────────────────

describe('API key routing', () => {
  test('set_api_key openai → openaiApiKey', async () => {
    await api.set_api_key('openai', 'sk-test');
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual({ openaiApiKey: 'sk-test' });
  });

  test('set_api_key gemini → geminiApiKey', async () => {
    await api.set_api_key('gemini', 'AIza-test');
    const call = ipcRenderer.invoke.mock.calls.find(c => c[0] === 'save-settings');
    expect(call[1]).toEqual({ geminiApiKey: 'AIza-test' });
  });

  test('get_api_keys returns both keys', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({
      openaiApiKey: 'sk-abc',
      geminiApiKey: 'AIza-xyz',
    });
    const result = await api.get_api_keys();
    expect(result).toEqual({ success: true, openai: 'sk-abc', gemini: 'AIza-xyz' });
  });

  test('get_api_keys returns empty strings when no keys', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({});
    const result = await api.get_api_keys();
    expect(result.openai).toBe('');
    expect(result.gemini).toBe('');
  });

  test('verify_api_key passes provider, key, and baseUrl', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ valid: true });
    await api.verify_api_key('openai', 'sk-test', 'http://custom');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('verify-api-key', 'openai', 'sk-test', 'http://custom');
  });

  test('verify_api_key returns valid result', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ valid: true });
    const result = await api.verify_api_key('openai', 'sk-test');
    expect(result.success).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('verify_api_key returns invalid with error', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ valid: false, message: 'Bad key' });
    const result = await api.verify_api_key('openai', 'bad');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Bad key');
  });
});

// ── Factory reset ───────────────────────────────────────────────────

describe('factory reset', () => {
  test('reset_settings invokes reset-settings', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ success: true });
    const result = await api.reset_settings();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('reset-settings');
    expect(result).toEqual({ success: true });
  });
});

// ── Recording ───────────────────────────────────────────────────────────

describe('recording', () => {
  test('start_recording invokes start-recording', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ success: true });
    const result = await api.start_recording();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('start-recording');
    expect(result).toEqual({ success: true });
  });

  test('stop_recording invokes stop-recording', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ success: true, text: 'hello' });
    const result = await api.stop_recording();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('stop-recording');
    expect(result.text).toBe('hello');
  });

  test('cancel_processing invokes cancel-processing', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ success: true });
    const result = await api.cancel_processing();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('cancel-processing');
  });

  test('get_recording_state transforms recording state', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ state: 'recording' });
    const result = await api.get_recording_state();
    expect(result).toEqual({
      is_recording: true,
      is_processing: false,
      cancel_requested: false,
    });
  });

  test('get_recording_state transforms processing state', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ state: 'processing' });
    const result = await api.get_recording_state();
    expect(result).toEqual({
      is_recording: false,
      is_processing: true,
      cancel_requested: false,
    });
  });

  test('get_recording_state transforms dormant state', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ state: 'dormant' });
    const result = await api.get_recording_state();
    expect(result).toEqual({
      is_recording: false,
      is_processing: false,
      cancel_requested: false,
    });
  });
});

// ── Models ──────────────────────────────────────────────────────────────

describe('models', () => {
  test('get_models returns array when sidecar returns array', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce([
      { name: 'base', downloaded: true },
    ]);
    const result = await api.get_models();
    expect(result).toEqual([{ name: 'base', downloaded: true }]);
  });

  test('get_models extracts models from object', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({
      models: [{ name: 'tiny' }, { name: 'base' }],
    });
    const result = await api.get_models();
    expect(result).toHaveLength(2);
  });

  test('get_models returns empty array on error', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ error: 'Sidecar not running' });
    const result = await api.get_models();
    expect(result).toEqual([]);
  });

  test('get_models returns empty array on null', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce(null);
    const result = await api.get_models();
    expect(result).toEqual([]);
  });

  test('set_model saves as localModel setting', async () => {
    await api.set_model('small');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('save-settings', { localModel: 'small' });
  });

  test('download_model returns success', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ result: 'ok' });
    const result = await api.download_model('base');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('download-model', 'base');
    expect(result).toEqual({ success: true });
  });

  test('download_model returns error', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ error: 'Disk full' });
    const result = await api.download_model('large');
    expect(result).toEqual({ success: false, error: 'Disk full' });
  });

  test('delete_model returns success', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ result: 'ok' });
    const result = await api.delete_model('tiny');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('delete-model', 'tiny');
    expect(result).toEqual({ success: true });
  });

  test('delete_model returns error', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ error: 'Model in use' });
    const result = await api.delete_model('base');
    expect(result).toEqual({ success: false, error: 'Model in use' });
  });

  test('get_download_progress returns default when no progress', async () => {
    const result = await api.get_download_progress();
    expect(result).toEqual(expect.objectContaining({ status: 'idle', progress: 0 }));
  });

  test('get_download_progress returns latest after event', async () => {
    // Trigger the ipcRenderer.on('model-download-progress') listener
    const listeners = ipcRenderer._listeners['model-download-progress'];
    expect(listeners).toBeDefined();
    listeners[0]({}, { current: 75, total: 100, model: 'base' });

    const result = await api.get_download_progress();
    expect(result.progress).toBe(0.75);
    expect(result.status).toBe('downloading');
  });
});

// ── Microphones ─────────────────────────────────────────────────────────

describe('microphones', () => {
  test('get_microphones returns array directly', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce([{ id: 0, name: 'Mic 1' }]);
    const result = await api.get_microphones();
    expect(result).toEqual([{ id: 0, name: 'Mic 1' }]);
  });

  test('get_microphones extracts from mics property', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ mics: [{ id: 0, name: 'Mic 1' }] });
    const result = await api.get_microphones();
    expect(result).toEqual([{ id: 0, name: 'Mic 1' }]);
  });

  test('get_microphones extracts from devices property', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ devices: [{ id: 0, name: 'Mic 1' }] });
    const result = await api.get_microphones();
    expect(result).toEqual([{ id: 0, name: 'Mic 1' }]);
  });

  test('get_microphones returns empty on error', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ error: 'Sidecar not running' });
    const result = await api.get_microphones();
    expect(result).toEqual([]);
  });

  test('get_microphones returns empty on null', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce(null);
    const result = await api.get_microphones();
    expect(result).toEqual([]);
  });

  test('set_microphone returns success', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ result: 'ok' });
    const result = await api.set_microphone(1);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('set-mic', 1);
    expect(result).toEqual({ success: true });
  });

  test('set_microphone returns error', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ error: 'Device not found' });
    const result = await api.set_microphone(99);
    expect(result).toEqual({ success: false, error: 'Device not found' });
  });
});

// ── History ─────────────────────────────────────────────────────────────

describe('history', () => {
  test('get_history returns history array', async () => {
    const entries = [{ id: '1', text: 'hello' }];
    ipcRenderer.invoke.mockResolvedValueOnce(entries);
    const result = await api.get_history();
    expect(result).toEqual(entries);
  });

  test('get_history returns empty array', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce([]);
    const result = await api.get_history();
    expect(result).toEqual([]);
  });

  test('delete_history sends id', async () => {
    const result = await api.delete_history('123');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('delete-history', '123');
    expect(result).toEqual({ success: true });
  });

  test('clear_history clears all', async () => {
    const result = await api.clear_history();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('clear-history');
    expect(result).toEqual({ success: true });
  });
});

// ── Clipboard ───────────────────────────────────────────────────────────

describe('clipboard', () => {
  test('copy_to_clipboard sends text', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ success: true });
    const result = await api.copy_to_clipboard('test text');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('copy-to-clipboard', 'test text');
  });

  test('paste_last_transcript invokes paste', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ success: true, text: 'hello' });
    const result = await api.paste_last_transcript();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('paste-last-transcript');
    expect(result.text).toBe('hello');
  });
});

// ── Window controls ─────────────────────────────────────────────────────

describe('window controls', () => {
  test('minimize invokes window-minimize', async () => {
    await api.minimize();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('window-minimize');
  });

  test('close invokes window-close', async () => {
    await api.close();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('window-close');
  });

  test('toggle_maximize invokes window-maximize', async () => {
    await api.toggle_maximize();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('window-maximize');
  });

  test('is_maximized returns boolean', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce(true);
    const result = await api.is_maximized();
    expect(result).toBe(true);
  });

  test('drag_start is a no-op', async () => {
    const result = await api.drag_start();
    expect(result).toBeUndefined();
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
  });

  test('nc_resize_start is a no-op', async () => {
    const result = await api.nc_resize_start();
    expect(result).toBeUndefined();
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
  });
});

// ── App info ────────────────────────────────────────────────────────────

describe('app info', () => {
  test('get_version returns version and dev flag', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ version: '2.0.1', isDev: true });
    const result = await api.get_version();
    expect(result).toEqual({ version: '2.0.1', dev: true });
  });

  test('get_version maps isDev to dev', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ version: '2.0.1', isDev: false });
    const result = await api.get_version();
    expect(result.dev).toBe(false);
  });
});

// ── Monitors / Pill ─────────────────────────────────────────────────────

describe('monitors and pill', () => {
  test('get_monitors transforms display list', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce([
      { id: 1, label: 'Display 1 (1920x1080)' },
      { id: 2, label: 'Display 2 (2560x1440)' },
    ]);
    const result = await api.get_monitors();
    expect(result).toEqual([
      { index: 1, label: 'Display 1 (1920x1080)' },
      { index: 2, label: 'Display 2 (2560x1440)' },
    ]);
  });

  test('set_pill_display invokes move-pill-to-display', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ success: true });
    await api.set_pill_display(2);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('move-pill-to-display', 2);
  });

  test('toggle_pill invokes toggle-pill', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce(true);
    const result = await api.toggle_pill();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('toggle-pill');
    expect(result).toBe(true);
  });
});

// ── Audio ───────────────────────────────────────────────────────────────

describe('audio', () => {
  test('get_audio passes historyId', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: 'base64data', mime: 'audio/wav' });
    const result = await api.get_audio('12345');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-audio', '12345');
    expect(result.data).toBe('base64data');
  });

  test('get_audio returns error for missing audio', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ success: false, error: 'No audio file' });
    const result = await api.get_audio('99999');
    expect(result.success).toBe(false);
  });
});

// ── Export ───────────────────────────────────────────────────────────────

describe('export', () => {
  test('export_transcription passes text and format', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ success: true, path: '/tmp/out.txt' });
    const result = await api.export_transcription('hello world', 'txt');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('export-transcription', 'hello world', 'txt');
    expect(result.success).toBe(true);
  });

  test('export_transcription handles cancel', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ success: false, error: 'Cancelled' });
    const result = await api.export_transcription('text', 'txt');
    expect(result.success).toBe(false);
  });
});

// ── Auto-updater ────────────────────────────────────────────────────────

describe('auto-updater', () => {
  test('check_for_updates invokes check-for-updates', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({});
    await api.check_for_updates();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('check-for-updates');
  });

  test('download_update invokes download-update', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({});
    await api.download_update();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('download-update');
  });

  test('install_update invokes install-update', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce(undefined);
    await api.install_update();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('install-update');
  });

  test('set_update_channel invokes set-update-channel', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ success: true, channel: 'stable' });
    const result = await api.set_update_channel('stable');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('set-update-channel', 'stable');
    expect(result.channel).toBe('stable');
  });

  test('get_update_channel invokes get-update-channel', async () => {
    ipcRenderer.invoke.mockResolvedValueOnce({ channel: 'beta' });
    const result = await api.get_update_channel();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-update-channel');
    expect(result.channel).toBe('beta');
  });

  test('get_update_status returns idle by default', async () => {
    const result = await api.get_update_status();
    expect(result).toEqual({ status: 'idle' });
  });

  test('get_update_status returns latest after event', async () => {
    const listeners = ipcRenderer._listeners['update-status'];
    expect(listeners).toBeDefined();
    listeners[0]({}, { status: 'available', version: '2.2.0' });

    const result = await api.get_update_status();
    expect(result.status).toBe('available');
    expect(result.version).toBe('2.2.0');
  });
});
