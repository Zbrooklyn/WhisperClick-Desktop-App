// wc-api.js — Fully-functional WhisperClick web backend.
//
// Serves the real frontend (with a browser bridge shim injected) AND drives the
// real Python transcription engine (shared/engine/engine.py) over its JSON
// stdin/stdout protocol. The browser captures phone-mic audio and uploads it;
// this server converts it to WAV (ffmpeg) and feeds the engine's transcribe_file
// command — the same path Electron uses for both Local (faster-whisper) and
// Cloud (API) modes, switchable at runtime.
//
//   Browser  --audio blob-->  /api/transcribe  --wav-->  engine.transcribe_file
//                                                            |
//   Browser  <--transcript JSON--  (transcription event)  <-+
//
// Run:  node wc-api.js   (listens 0.0.0.0:8791)

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');

// Repo root is two levels up from platforms/web/.
const ROOT = path.resolve(__dirname, '..', '..');
const ENGINE_DIR = path.join(ROOT, 'shared', 'engine');
const ENGINE_PY = path.join(ENGINE_DIR, 'engine.py');
const VENV_PY = process.platform === 'win32'
  ? path.join(ENGINE_DIR, '.venv', 'Scripts', 'python.exe')
  : path.join(ENGINE_DIR, '.venv', 'bin', 'python');
const FRONTEND = path.join(ROOT, 'shared', 'frontend', 'index.html');
const PORT = Number(process.env.WC_PORT || 8791);

const FFMPEG = (() => {
  if (process.env.WC_FFMPEG && fs.existsSync(process.env.WC_FFMPEG)) return process.env.WC_FFMPEG;
  const guess = 'C:/Users/EDWAR/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.1-full_build/bin/ffmpeg.exe';
  if (fs.existsSync(guess)) return guess;
  return 'ffmpeg'; // rely on PATH
})();

const TMP = process.env.WC_DATA_DIR ? path.resolve(process.env.WC_DATA_DIR) : path.join(os.tmpdir(), 'wc-web');
fs.mkdirSync(TMP, { recursive: true });
const AUDIO_STORE = path.join(TMP, 'audio');
fs.mkdirSync(AUDIO_STORE, { recursive: true });
const SETTINGS_FILE = path.join(TMP, 'settings.json');
const HISTORY_FILE = path.join(TMP, 'history.json');

// ---------------------------------------------------------------------------
// Persistent state (settings + history)
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  mode: 'local',          // 'local' | 'api'
  model: 'base',          // local faster-whisper model
  api_provider: 'openai', // 'openai' | 'gemini'
  api_model: 'whisper-1',
  api_base_url: '',
  openai_api_key: '',
  gemini_api_key: '',
  language: 'auto',
  output_mode: 'transcribe',
  target_language: 'en',
  source_language: 'auto',
  theme: 'dark',
  onboardingComplete: true, // web build skips the desktop onboarding by default
  sound_enabled: false,
  // --- Premium (Pro plugin) features — applied by the engine per-transcription ---
  custom_vocabulary: '',        // proper-noun spelling hints
  smart_punctuation: false,     // punctuation from speech-pause gaps
  voice_commands: false,        // spoken punctuation/editing ("period", "new line")
  voice_corrections: false,     // spoken edits ("replace X with Y", "undo")
  active_snippet: '',           // template wrapping {{text}}
  word_confidence: false,       // per-word confidence highlighting
  post_processing_enabled: false, // LLM cleanup pass (needs an API key)
  post_processing_prompt: '',
  live_streaming: false,          // browser-side streaming partials (beta)
};

function loadJson(file, fallback) {
  try { return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch { return { ...fallback }; }
}
function saveJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch {}
}

let settings = loadJson(SETTINGS_FILE, DEFAULT_SETTINGS);

// Load the per-project .env (managed by the `env` skill) so an API key entered
// there powers the app — the standard way keys are provided, never typed in chat.
// Zero-dep KEY=VALUE parse; a key the user already set in the app wins; values
// are never logged.
(function loadDotEnvKeys() {
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v && process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch (e) { /* ignore — .env is optional */ }
  if (!settings.openai_api_key && process.env.OPENAI_API_KEY) settings.openai_api_key = process.env.OPENAI_API_KEY;
  if (!settings.gemini_api_key && process.env.GEMINI_API_KEY) settings.gemini_api_key = process.env.GEMINI_API_KEY;
})();
// Local history now lives in an embedded SQLite database (Node's built-in
// node:sqlite — zero dependencies). Unlimited entries, sub-millisecond writes,
// paginated reads. On first run it migrates any old history.json and keeps it
// as a .migrated.bak backup so nothing is ever lost.
const { createHistoryStore } = require('./history-store');
const proLicense = require('./pro-license');
const DB_FILE = path.join(TMP, 'history.db');
const store = createHistoryStore(DB_FILE);

// Known-speakers registry (diarization people-memory + voiceprints).
const { createPeopleStore } = require('./people-store');
const { suggestSpeakers } = require('./speaker-suggest');
const peopleStore = createPeopleStore(path.join(TMP, 'people.db'));
try {
  const m = store.migrateFromJson(HISTORY_FILE);
  if (m.migrated) console.log(`[history] migrated ${m.migrated} recordings from JSON → SQLite (backup kept)`);
} catch (e) { console.error('[history] migration failed:', e.message); }

// Public view: strip the internal on-disk wav path from what the browser sees.
function publicItem(h) { if (!h) return h; const c = { ...h }; delete c._wav; return c; }

// ---------------------------------------------------------------------------
// Engine bridge — spawn engine.py, JSON over stdin/stdout
// ---------------------------------------------------------------------------

class Engine {
  constructor() {
    this.proc = null;
    this.rl = null;
    this.pending = new Map();
    this.nextId = 1;
    this.listeners = new Map();   // event -> Set(fn)
    this.ready = false;
    this.lastDownloadProgress = { status: 'idle', progress: 0 };
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }
  emit(event, data) {
    this.listeners.get(event)?.forEach((fn) => { try { fn(data); } catch {} });
  }

  start() {
    if (this.proc) return;
    const cmd = fs.existsSync(VENV_PY) ? VENV_PY : 'python';
    this.proc = spawn(cmd, ['-u', ENGINE_PY], { stdio: ['pipe', 'pipe', 'pipe'], cwd: ENGINE_DIR });
    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on('line', (line) => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (msg.event) {
        if (msg.event === 'model-download-progress' || msg.event === 'download_progress') {
          const d = msg.data || {};
          const prog = d.total > 0 ? d.current / d.total : 0;
          this.lastDownloadProgress = { status: prog >= 0.999 ? 'complete' : 'downloading', progress: prog, model: d.model };
        }
        this.emit(msg.event, msg.data);
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.status === 'error' || msg.error) reject(new Error(msg.error || 'engine error'));
        else resolve(msg);
      }
    });
    this.proc.stderr.on('data', (d) => process.stderr.write('[engine] ' + d));
    this.proc.on('exit', (code) => {
      console.error('[engine] exited code=' + code + ' — restarting in 1s');
      this.proc = null; this.ready = false;
      for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error('engine exited')); }
      this.pending.clear();
      setTimeout(() => { this.start(); this.configure(); }, 1000);
    });
    this.ready = true;
  }

  send(command, payload = {}, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      if (!this.proc) return reject(new Error('engine not running'));
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('engine timeout: ' + command)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, command, ...payload }) + '\n');
    });
  }

  // Push the current settings into the engine (mode/model/credentials/language).
  async configure() {
    const key = settings.api_provider === 'gemini' ? settings.gemini_api_key : settings.openai_api_key;
    // Never leave the user stuck in a broken state: if they're in API mode but
    // haven't added a key for the active provider, transcribe with the local
    // model instead of failing every recording. (The UI still shows API; this
    // is a silent, working fallback rather than an error.)
    const effectiveMode = (settings.mode === 'api' && !key) ? 'local' : settings.mode;
    this._effectiveMode = effectiveMode;
    try {
      await this.send('configure', {
        mode: effectiveMode,
        model: settings.model,
        language: settings.language,
        provider: settings.api_provider,
        api_key: key || '',
        api_model: settings.api_model,
        base_url: settings.api_base_url || '',
        output_mode: settings.output_mode,
        target_language: settings.target_language,
        source_language: settings.source_language,
        sound_enabled: false,
        // Premium (Pro plugin) keys — the plugin absorbs these; unset = off.
        custom_vocabulary: settings.custom_vocabulary || '',
        smart_punctuation: !!settings.smart_punctuation,
        voice_commands: !!settings.voice_commands,
        voice_corrections: !!settings.voice_corrections,
        active_snippet: settings.active_snippet || '',
        word_confidence: !!settings.word_confidence,
        post_processing_enabled: !!settings.post_processing_enabled,
        post_processing_prompt: settings.post_processing_prompt || '',
      }, 30000);
    } catch (e) { console.error('[engine] configure failed:', e.message); }
  }

  // Transcribe a WAV file on disk. Resolves with the engine's transcription
  // event payload (text lives on the event, not the command reply).
  transcribeFile(wavPath, timeoutMs = 180000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const off = this.on('transcription', (data) => {
        if (done) return; done = true; off(); offErr(); clearTimeout(timer);
        resolve(data || {});
      });
      const offErr = this.on('error', (data) => {
        if (done) return; done = true; off(); offErr(); clearTimeout(timer);
        reject(new Error((data && data.message) || 'transcription failed'));
      });
      const timer = setTimeout(() => { if (done) return; done = true; off(); offErr(); reject(new Error('transcription timeout')); }, timeoutMs);
      this.send('transcribe_file', { path: wavPath }, timeoutMs).catch((e) => {
        if (done) return; done = true; off(); offErr(); clearTimeout(timer); reject(e);
      });
    });
  }
}

const engine = new Engine();

// ---------------------------------------------------------------------------
// Audio: browser blob (webm/opus, mp4, ogg) -> 16k mono WAV via ffmpeg
// ---------------------------------------------------------------------------

// URL/media helpers now live in the shared module so web + Electron share ONE
// copy (parameterized by this platform's ffmpeg + python). Behavior unchanged.
const { createUrlImport } = require('../../shared/media/url-import');
const PY_CMD = fs.existsSync(VENV_PY) ? VENV_PY : 'python';
const { toWav, urlPreview, ytdlpAvailable, ytdlpExtractAudio, MEDIA_EXT_RE } =
  createUrlImport({ ffmpeg: FFMPEG, pyCmd: PY_CMD });

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.ico':'image/x-icon','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.wav':'audio/wav','.mp3':'audio/mpeg','.webmanifest':'application/manifest+json' };

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function readBody(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Public settings view for the frontend (strip raw keys; expose booleans).
function publicSettings() {
  const s = { ...settings };
  s.has_openai_key = !!settings.openai_api_key;
  s.has_gemini_key = !!settings.gemini_api_key;
  delete s.openai_api_key; delete s.gemini_api_key;
  // License: expose the resolved tier only; never leak the raw token/key.
  const lic = proLicense.getLicenseStatus(settings);
  s.license_tier = lic.tier;
  s.license_valid = lic.valid;
  s.license_email = lic.email || null;
  delete s.license_token; delete s.license_key;
  return s;
}

// Tier gate: returns a tier_locked response object if the current license does
// NOT meet minTier, else null. Paid endpoints call this first so enforcement is
// real (server-side), not just a cosmetic client flag.
function tierLocked(minTier) {
  const lic = proLicense.getLicenseStatus(settings);
  if (proLicense.meetsTier(lic, minTier)) return null;
  return {
    success: false, tier_locked: true, required_tier: minTier, current_tier: lic.tier,
    error: 'This is a WhisperClick Pro feature. Add your license key in Settings to unlock it.',
  };
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

async function handleApi(req, res, url) {
  const p = url.pathname;
  try {
    if (p === '/api/status' && req.method === 'GET') {
      return sendJson(res, 200, { ready: !!engine.proc, mode: settings.mode });
    }

    if (p === '/api/pwa-link' && req.method === 'GET') {
      // LiveSync (Pro): the phone-reachable URLs for this running app, so a QR
      // can point a phone at the SAME backend (synced notes/meetings). Prefer a
      // Tailscale address (100.64.0.0/10 — reachable anywhere) over LAN Wi-Fi.
      const ifaces = os.networkInterfaces();
      const cands = [];
      for (const nm of Object.keys(ifaces)) {
        for (const a of ifaces[nm] || []) {
          if (a.family !== 'IPv4' || a.internal) continue;
          const ts = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address);
          cands.push({ ip: a.address, tailscale: ts });
        }
      }
      cands.sort((a, b) => (b.tailscale ? 1 : 0) - (a.tailscale ? 1 : 0));
      const pagePath = '/shared/frontend/index.html';
      const urls = cands.map(c => ({ label: c.tailscale ? 'Tailscale (works anywhere)' : 'This Wi‑Fi network', url: `http://${c.ip}:${PORT}${pagePath}`, tailscale: c.tailscale }));
      // Prefer an HTTPS public URL (Tailscale serve) when configured. REQUIRED for
      // the microphone on a phone — getUserMedia only works in a secure context
      // (https or localhost), never on a plain http:// IP. Without this the QR would
      // hand phones a link where the mic is dead.
      if (process.env.WC_PUBLIC_HTTPS) {
        urls.unshift({ label: 'Tailscale HTTPS — mic works on phone', url: process.env.WC_PUBLIC_HTTPS.replace(/\/+$/, '') + pagePath, tailscale: true, https: true });
      }
      return sendJson(res, 200, { urls, port: PORT, best: urls[0] ? urls[0].url : null });
    }

    if (p === '/api/settings' && req.method === 'GET') {
      return sendJson(res, 200, publicSettings());
    }

    if (p === '/api/settings' && req.method === 'POST') {
      const patch = JSON.parse((await readBody(req)).toString() || '{}');
      // Map incoming api key fields (frontend sends set_api_key separately, but
      // accept inline too).
      Object.assign(settings, patch);
      saveJson(SETTINGS_FILE, settings);
      await engine.configure();
      return sendJson(res, 200, { success: true, settings: publicSettings() });
    }

    if (p === '/api/license' && req.method === 'GET') {
      // Current tier status (offline-verified). Never returns the raw token.
      return sendJson(res, 200, proLicense.getLicenseStatus(settings));
    }

    if (p === '/api/license/activate' && req.method === 'POST') {
      // Paste a signed license key/token → verify offline → persist tier.
      const { key } = JSON.parse((await readBody(req)).toString() || '{}');
      const status = proLicense.activate(settings, key);
      saveJson(SETTINGS_FILE, settings);
      return sendJson(res, 200, status);
    }

    if (p === '/api/license/deactivate' && req.method === 'POST') {
      const status = proLicense.deactivate(settings);
      saveJson(SETTINGS_FILE, settings);
      return sendJson(res, 200, status);
    }

    if (p === '/api/api-key' && req.method === 'POST') {
      const { provider, key } = JSON.parse((await readBody(req)).toString() || '{}');
      if (provider === 'gemini') settings.gemini_api_key = key || '';
      else settings.openai_api_key = key || '';
      saveJson(SETTINGS_FILE, settings);
      await engine.configure();
      return sendJson(res, 200, { success: true });
    }

    if (p === '/api/api-keys' && req.method === 'GET') {
      return sendJson(res, 200, {
        success: true,
        openai: settings.openai_api_key || '',
        gemini: settings.gemini_api_key || '',
      });
    }

    if (p === '/api/verify-key' && req.method === 'POST') {
      const { provider, key, baseUrl } = JSON.parse((await readBody(req)).toString() || '{}');
      const r = await engine.send('verify_key', { provider, api_key: key, base_url: baseUrl || '' }, 15000);
      return sendJson(res, 200, { success: true, valid: !!r.valid, error: r.valid ? undefined : (r.error || 'Verification failed') });
    }

    if (p === '/api/models' && req.method === 'GET') {
      const r = await engine.send('list_models', {}, 15000);
      return sendJson(res, 200, r.models || []);
    }

    if (p === '/api/delete-model' && req.method === 'POST') {
      const { model } = JSON.parse((await readBody(req)).toString() || '{}');
      try {
        await engine.send('delete_model', { model_name: model }, 30000);
        return sendJson(res, 200, { success: true });
      } catch (e) {
        return sendJson(res, 200, { success: false, error: e.message });
      }
    }

    if (p === '/api/download-model' && req.method === 'POST') {
      const { model } = JSON.parse((await readBody(req)).toString() || '{}');
      engine.send('download_model', { model_name: model }, 600000).catch(() => {});
      return sendJson(res, 200, { success: true });
    }

    if (p === '/api/download-progress' && req.method === 'GET') {
      return sendJson(res, 200, engine.lastDownloadProgress);
    }

    if (p === '/api/history' && req.method === 'GET') {
      // Backward-compatible: the current frontend renders this whole array, so
      // return the most-recent 200 in ascending order (matching the old cap).
      // The store keeps everything; /api/history/page surfaces the rest.
      return sendJson(res, 200, store.page({ limit: 200 }).reverse().map(publicItem));
    }

    if (p === '/api/history/page' && req.method === 'GET') {
      // Paginated, newest-first, optional ?q= text search. For scale.
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const query = url.searchParams.get('q') || '';
      return sendJson(res, 200, {
        items: store.page({ limit, offset, query }).map(publicItem),
        total: store.count(query),
        offset, limit,
      });
    }

    if (p === '/api/history/count' && req.method === 'GET') {
      return sendJson(res, 200, { total: store.count(url.searchParams.get('q') || '') });
    }

    if (p === '/api/history/clear' && req.method === 'POST') {
      store.clear();
      return sendJson(res, 200, { success: true });
    }

    if (p === '/api/history/delete' && req.method === 'POST') {
      const { id } = JSON.parse((await readBody(req)).toString() || '{}');
      store.delete(id);
      return sendJson(res, 200, { success: true });
    }

    if (p === '/api/history/update' && req.method === 'POST') {
      // Persist an edited transcript (redo/manual edits) AND the review
      // enrichment fields — summary, action items, speakers, title — so the
      // coherent meeting review survives a reopen and a restart. Only whitelisted
      // fields are written; everything else is ignored. The store keeps unknown
      // fields in its `extra` JSON column, so no schema change is needed.
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const { id } = body;
      const patch = {};
      if (typeof body.text === 'string') { patch.text = body.text; patch.edited = true; }
      if (typeof body.title === 'string') patch.title = body.title;
      if (typeof body.summary === 'string') patch.summary = body.summary;
      if (Array.isArray(body.action_items)) patch.action_items = body.action_items;
      if (body.speakers && typeof body.speakers === 'object') patch.speakers = body.speakers;
      if (typeof body.chapters === 'string') patch.chapters = body.chapters;
      if (!Object.keys(patch).length) return sendJson(res, 200, { success: true });
      const updated = store.update(id, patch);
      if (!updated) return sendJson(res, 200, { success: false, error: 'Not found.' });
      return sendJson(res, 200, { success: true });
    }

    if (p.startsWith('/api/audio/') && req.method === 'GET') {
      const id = decodeURIComponent(p.slice('/api/audio/'.length));
      const item = store.get(id);
      if (!item || !item._wav || !fs.existsSync(item._wav)) { res.writeHead(404); return res.end('no audio'); }
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Access-Control-Allow-Origin': '*' });
      return fs.createReadStream(item._wav).pipe(res);
    }

    if (p === '/api/transcribe-partial' && req.method === 'POST') {
      // Streaming preview: transcribe the audio-so-far and return text only.
      // No history entry, no stored wav — this fires repeatedly during a take.
      const buf = await readBody(req);
      if (!buf.length) return sendJson(res, 200, { success: true, text: '' });
      const stamp = crypto.randomBytes(6).toString('hex');
      const ct = (req.headers['content-type'] || '').toLowerCase();
      const ext = ct.includes('mp4') || ct.includes('m4a') ? '.mp4' : ct.includes('ogg') ? '.ogg' : ct.includes('wav') ? '.wav' : '.webm';
      const rawPath = path.join(TMP, `part-${stamp}${ext}`);
      const wavPath = path.join(TMP, `part-${stamp}.wav`);
      fs.writeFileSync(rawPath, buf);
      try {
        toWav(rawPath, wavPath);
        const result = await engine.transcribeFile(wavPath, 60000);
        return sendJson(res, 200, { success: true, text: (result.text || '').trim() });
      } catch (e) {
        return sendJson(res, 200, { success: false, text: '', error: e.message });
      } finally {
        try { fs.unlinkSync(rawPath); } catch {}
        try { fs.unlinkSync(wavPath); } catch {}
      }
    }

    if (p === '/api/transcribe' && req.method === 'POST') {
      // Bigger cap here than the default: uploaded audio/video files (meetings,
      // lectures) are far larger than a browser-recorded take.
      const buf = await readBody(req, 500 * 1024 * 1024);
      if (!buf.length) return sendJson(res, 400, { success: false, error: 'empty audio' });
      // Optional trim window (seconds) — transcribe only start..end of the file.
      const upStart = Number(url.searchParams.get('start')), upEnd = Number(url.searchParams.get('end'));
      const upRange = ((Number.isFinite(upStart) && upStart > 0) || (Number.isFinite(upEnd) && upEnd > 0))
        ? { start: Number.isFinite(upStart) ? upStart : 0, end: Number.isFinite(upEnd) ? upEnd : 0 } : null;
      const stamp = crypto.randomBytes(6).toString('hex');
      const ct = (req.headers['content-type'] || '').toLowerCase();
      const ext = ct.includes('mp4') || ct.includes('m4a') ? '.mp4' : ct.includes('ogg') ? '.ogg' : ct.includes('wav') ? '.wav' : '.webm';
      const rawPath = path.join(TMP, `rec-${stamp}${ext}`);
      const wavPath = path.join(AUDIO_STORE, `rec-${stamp}.wav`);
      fs.writeFileSync(rawPath, buf);
      try {
        toWav(rawPath, wavPath, upRange);
      } catch (e) {
        try { fs.unlinkSync(rawPath); } catch {}
        return sendJson(res, 500, { success: false, error: 'audio conversion failed: ' + e.message });
      }
      let result;
      try {
        result = await engine.transcribeFile(wavPath);
      } catch (e) {
        try { fs.unlinkSync(rawPath); } catch {}
        return sendJson(res, 500, { success: false, error: e.message });
      }
      try { fs.unlinkSync(rawPath); } catch {}
      const text = (result.text || '').trim();
      const item = {
        id: `${Date.now()}-${stamp}`,
        text,
        duration: result.duration || 0,
        transcription_time: result.transcription_time || 0,
        timestamp: new Date().toISOString(),
        provider: result.provider || settings.mode,
        model: result.model || settings.model,
        language: result.language || null,
        words: Array.isArray(result.words) && result.words.length ? result.words : null,
        audio_file: null,
        _wav: wavPath,
      };
      item.audio_file = `/api/audio/${item.id}`;
      store.add(item);
      return sendJson(res, 200, { success: true, text, duration: item.duration, transcription_time: item.transcription_time, id: item.id });
    }

    return sendJson(res, 404, { error: 'unknown api route' });
  } catch (e) {
    return sendJson(res, 500, { success: false, error: e.message });
  }
}

// ---------------------------------------------------------------------------
// Static serving + shim injection
// ---------------------------------------------------------------------------

let SHIM_SRC = '';
function loadShim() { try { SHIM_SRC = fs.readFileSync(path.join(__dirname, 'web-shim.js'), 'utf8'); } catch { SHIM_SRC = ''; } }
loadShim();

function serveFrontend(res) {
  let html;
  try { html = fs.readFileSync(FRONTEND, 'utf8'); } catch { res.writeHead(500); return res.end('frontend missing'); }
  loadShim(); // hot-reload the shim on each load during dev
  // Web-only injection: the bridge shim + PWA (installable / Add to Home Screen).
  // Electron never hits this path, so these stay out of the desktop build.
  const pwa = [
    '<link rel="manifest" href="/manifest.webmanifest">',
    '<meta name="theme-color" content="#1c1917">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    '<meta name="apple-mobile-web-app-title" content="WhisperClick">',
    '<link rel="apple-touch-icon" href="/docs/assets/favicon-192.png">',
    "<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}</script>",
  ].join('\n');
  // <base> lets us serve this HTML at the raw root (/) while its relative asset
  // paths (premium/…, css/…) still resolve to /shared/frontend/… — no redirect, no deep path.
  const inject = `<base href="/shared/frontend/">\n<script>\n${SHIM_SRC}\n</script>\n${pwa}`;
  // Inject at top of <head> so window.pywebview exists before the app's inline script runs.
  if (html.includes('<head>')) html = html.replace('<head>', '<head>\n' + inject);
  else html = inject + html;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
  res.end(html);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);

  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }

  if (p.startsWith('/api/')) return handleApi(req, res, url);

  // Redirect root to the real app path so the browser's base URL is
  // /shared/frontend/ and index.html's relative asset paths (css/, js/) resolve.
  // Serve the app DIRECTLY at the raw root — no redirect, no deep path in the address bar.
  // The injected <base href="/shared/frontend/"> makes the relative asset paths resolve.
  if (p === '/' || p === '') return serveFrontend(res);
  // Keep the deep path working too (back-compat / bookmarks).
  if (p === '/shared/frontend/index.html') return serveFrontend(res);

  // PWA: manifest + service worker, served from platforms/web/ at root scope.
  if (p === '/manifest.webmanifest') {
    return fs.readFile(path.join(__dirname, 'manifest.webmanifest'), (e, buf) => {
      if (e) { res.writeHead(404); return res.end('no manifest'); }
      res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Access-Control-Allow-Origin': '*' });
      res.end(buf);
    });
  }
  if (p === '/sw.js') {
    return fs.readFile(path.join(__dirname, 'sw.js'), (e, buf) => {
      if (e) { res.writeHead(404); return res.end('no sw'); }
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
      res.end(buf);
    });
  }

  // Everything else: static from the repo root.
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(path.join(ROOT))) { res.writeHead(403); return res.end('403'); }
  fs.stat(fp, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404); return res.end('Not found: ' + p); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(fp).pipe(res);
  });
});

engine.start();
setTimeout(() => engine.configure(), 500);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`WhisperClick WEB (functional) on http://0.0.0.0:${PORT}`);
  console.log(`  phone: http://100.120.237.49:${PORT}/`);
  console.log(`  engine: ${fs.existsSync(VENV_PY) ? VENV_PY : 'python (PATH)'}`);
  console.log(`  ffmpeg: ${FFMPEG}`);
});
