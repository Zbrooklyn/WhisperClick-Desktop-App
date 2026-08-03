/* web-shim.js — browser bridge that makes the real WhisperClick frontend work
 * without Electron. Defines window.pywebview.api (the frontend calls it via
 * callNativeApi) and captures phone-mic audio, routing transcription to the
 * wc-api.js backend. Injected at the top of <head> so it exists before the
 * app's inline script runs.
 */
(function () {
  'use strict';

  var API = ''; // same-origin

  function jget(path) {
    return fetch(API + path).then(function (r) { return r.json(); });
  }
  function jpost(path, body) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); });
  }

  function fireState(state, message) {
    window.dispatchEvent(new CustomEvent('state-update', { detail: { state: state, message: message } }));
  }

  // ---- Mic capture -------------------------------------------------------
  var mediaStream = null;
  var recorder = null;
  var chunks = [];
  var recMime = '';
  var redoRecorder = null, redoChunks = [];

  // Device picker: real audioinput devices, exposed to the (Electron-shaped)
  // frontend as numeric indices so its Number()-coercing id handling works
  // unchanged. selectedDeviceId is the real MediaDeviceInfo.deviceId.
  var micDevices = [];
  var selectedDeviceId = null;
  var audioPrefs = { echoCancellation: true, noiseSuppression: true, autoGainControl: false };
  try {
    var _ap = JSON.parse(localStorage.getItem('wc_audio_prefs') || 'null');
    if (_ap && typeof _ap === 'object') audioPrefs = Object.assign(audioPrefs, _ap);
  } catch (e) {}
  function _audioConstraints() {
    var c = {
      echoCancellation: !!audioPrefs.echoCancellation,
      noiseSuppression: !!audioPrefs.noiseSuppression,
      autoGainControl: !!audioPrefs.autoGainControl,
    };
    if (selectedDeviceId) c.deviceId = { exact: selectedDeviceId };
    return c;
  }

  // ---- Live streaming (beta): re-transcribe the growing take for partials ---
  var liveStreaming = false;
  jget('/api/settings').then(function (s) { liveStreaming = !!(s && s.live_streaming); }).catch(function () {});
  var partialTimer = null, partialInFlight = false;
  function showPartial(text) {
    var el = document.getElementById('live-partial');
    if (el && text) { el.textContent = text; el.classList.remove('hidden'); }
  }
  function hidePartial() {
    var el = document.getElementById('live-partial');
    if (el) { el.classList.add('hidden'); el.textContent = ''; }
  }
  function startPartialLoop() {
    stopPartialLoop();
    partialTimer = setInterval(function () {
      if (partialInFlight || !chunks.length) return;
      partialInFlight = true;
      var blob = new Blob(chunks, { type: recMime || 'audio/webm' });
      fetch(API + '/api/transcribe-partial', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob })
        .then(function (r) { return r.json(); })
        .then(function (r) { if (r && r.text) showPartial(r.text); })
        .catch(function () {})
        .then(function () { partialInFlight = false; });
    }, 2200);
  }
  function stopPartialLoop() {
    if (partialTimer) { clearInterval(partialTimer); partialTimer = null; }
    partialInFlight = false;
  }

  function pickMime() {
    var opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mpeg'];
    for (var i = 0; i < opts.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(opts[i])) return opts[i];
    }
    return '';
  }

  function ensureStream() {
    if (mediaStream) return Promise.resolve(mediaStream);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('Microphone not available. Open this page over HTTPS.'));
    }
    return navigator.mediaDevices.getUserMedia({ audio: _audioConstraints() })
      .then(function (s) { mediaStream = s; return s; });
  }

  function startRec() {
    return ensureStream().then(function (stream) {
      chunks = [];
      recMime = pickMime();
      recorder = recMime ? new MediaRecorder(stream, { mimeType: recMime }) : new MediaRecorder(stream);
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      if (liveStreaming) { recorder.start(1000); startPartialLoop(); } // 1s timeslice feeds live chunks
      else { recorder.start(); }
      return true;
    });
  }

  function stopRec() {
    return new Promise(function (resolve, reject) {
      if (!recorder) return reject(new Error('not recording'));
      stopPartialLoop();
      recorder.onstop = function () {
        var blob = new Blob(chunks, { type: recMime || 'audio/webm' });
        recorder = null;
        resolve(blob);
      };
      try { recorder.stop(); } catch (e) { reject(e); }
    });
  }

  // ---- System / tab audio capture (getDisplayMedia) ----------------------
  // Record audio playing on the machine (a call, a video, a tab). The browser
  // requires a screen/tab pick with "share audio" enabled; we keep only the
  // audio track and transcribe it as one entry.
  var sysStream = null, sysRecorder = null, sysChunks = [];
  function startSystemCapture() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      return Promise.reject(new Error('System audio capture is not supported in this browser.'));
    }
    return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(function (stream) {
      var audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        throw new Error('No audio was shared. Re-try and tick “Share tab audio” (or “Share system audio”) in the picker.');
      }
      // We only need the audio; stop the video track to drop the screen preview.
      stream.getVideoTracks().forEach(function (t) { t.stop(); });
      sysStream = stream;
      sysChunks = [];
      recMime = pickMime();
      var audioOnly = new MediaStream(audioTracks);
      sysRecorder = recMime ? new MediaRecorder(audioOnly, { mimeType: recMime }) : new MediaRecorder(audioOnly);
      sysRecorder.ondataavailable = function (e) { if (e.data && e.data.size) sysChunks.push(e.data); };
      // If the user stops sharing from the browser chrome, end cleanly.
      audioTracks[0].addEventListener('ended', function () { try { window.dispatchEvent(new Event('wc-system-ended')); } catch (e) {} });
      sysRecorder.start();
      return true;
    });
  }
  function stopSystemCapture() {
    return new Promise(function (resolve, reject) {
      if (!sysRecorder) return reject(new Error('not capturing'));
      sysRecorder.onstop = function () {
        var blob = new Blob(sysChunks, { type: recMime || 'audio/webm' });
        if (sysStream) { try { sysStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} sysStream = null; }
        sysRecorder = null;
        resolve(blob);
      };
      try { sysRecorder.stop(); } catch (e) { reject(e); }
    });
  }

  function pauseRec() {
    if (recorder && recorder.state === 'recording') {
      try { recorder.pause(); if (liveStreaming) stopPartialLoop(); return true; } catch (e) {}
    }
    return false;
  }
  function resumeRec() {
    if (recorder && recorder.state === 'paused') {
      try { recorder.resume(); if (liveStreaming) startPartialLoop(); return true; } catch (e) {}
    }
    return false;
  }
  function recPaused() { return !!(recorder && recorder.state === 'paused'); }

  function uploadAudio(blob) {
    return fetch(API + '/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'audio/webm' },
      body: blob,
    }).then(function (r) { return r.json(); });
  }

  // ---- Continuous listening (VAD) ----------------------------------------
  // Hands-free: watch mic loudness; each speech burst followed by a silence
  // gap becomes its own segment, transcribed and appended to history, while
  // listening continues until the user stops.
  var continuousMode = false;
  var wakeWord = '';
  jget('/api/settings').then(function (s) { continuousMode = !!(s && s.continuous_listening); wakeWord = (s && s.wake_word || '').trim().toLowerCase(); }).catch(function () {});
  var vad = { ctx: null, analyser: null, raf: null, running: false, paused: false, speaking: false, silenceAt: 0, segStart: 0, seg: null, segChunks: [], stream: null };

  function _rms(buf) { var s = 0; for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; s += v * v; } return Math.sqrt(s / buf.length); }

  // Meeting mode reuses the same VAD engine but routes each finalized segment
  // to a live-transcript accumulator instead of creating a history entry.
  var meetingText = '';
  function _defaultSegment(blob) {
    uploadAudio(blob).then(function (r) {
      if (r && r.success) { try { window.dispatchEvent(new Event('wc-history-refresh')); } catch (e) {} }
    }).catch(function () {});
  }
  // Wake-word gate: in continuous mode, transcribe a quick preview first and
  // only keep the segment (with its audio) if it contains the wake phrase.
  function _wakeSegment(blob) {
    fetch(API + '/api/transcribe-partial', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        var t = (r && r.text || '').toLowerCase();
        if (!t || !wakeWord || t.indexOf(wakeWord) === -1) return; // no wake word → drop segment
        try { window.dispatchEvent(new CustomEvent('wc-wake-triggered', { detail: { text: (r.text || '') } })); } catch (e) {}
        _defaultSegment(blob); // matched → save the real segment (audio + words)
      }).catch(function () {});
  }
  function _meetingSegment(blob) {
    fetch(API + '/api/transcribe-partial', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        var t = (r && r.text || '').trim();
        if (!t) return;
        meetingText += (meetingText ? ' ' : '') + t;
        try { window.dispatchEvent(new CustomEvent('wc-meeting-segment', { detail: { text: t, full: meetingText } })); } catch (e) {}
      }).catch(function () {});
  }

  function startVad(onSegment) {
    return ensureStream().then(function (stream) {
      vad.stream = stream; vad.running = true; vad.onSegment = onSegment; recMime = pickMime();
      var AC = window.AudioContext || window.webkitAudioContext;
      vad.ctx = new AC();
      var src = vad.ctx.createMediaStreamSource(stream);
      vad.analyser = vad.ctx.createAnalyser();
      vad.analyser.fftSize = 512;
      src.connect(vad.analyser);
      var data = new Uint8Array(vad.analyser.fftSize);
      var THRESH = 0.018, SIL_MS = 1100, MIN_SEG_MS = 400;
      function loop() {
        if (!vad.running) return;
        if (vad.paused) { vad.raf = requestAnimationFrame(loop); return; }
        vad.analyser.getByteTimeDomainData(data);
        var rms = _rms(data), now = (window.performance ? performance.now() : Date.now());
        if (rms > THRESH) {
          if (!vad.speaking) { vad.speaking = true; vad.segStart = now; _segStart(stream); }
          vad.silenceAt = 0;
        } else if (vad.speaking) {
          if (!vad.silenceAt) vad.silenceAt = now;
          else if (now - vad.silenceAt > SIL_MS) {
            vad.speaking = false; vad.silenceAt = 0;
            if (now - vad.segStart > MIN_SEG_MS) _segFinalize(); else _segDiscard();
          }
        }
        vad.raf = requestAnimationFrame(loop);
      }
      loop();
      return true;
    });
  }
  function _segStart(stream) {
    vad.segChunks = [];
    try { vad.seg = recMime ? new MediaRecorder(stream, { mimeType: recMime }) : new MediaRecorder(stream); }
    catch (e) { vad.seg = new MediaRecorder(stream); }
    vad.seg.ondataavailable = function (e) { if (e.data && e.data.size) vad.segChunks.push(e.data); };
    vad.seg.start();
  }
  function _segFinalize() {
    if (!vad.seg) return;
    var seg = vad.seg; vad.seg = null;
    var handler = vad.onSegment || _defaultSegment;
    seg.onstop = function () {
      var blob = new Blob(vad.segChunks, { type: recMime || 'audio/webm' });
      handler(blob);
    };
    try { seg.stop(); } catch (e) {}
  }
  function _segDiscard() { if (vad.seg) { try { vad.seg.stop(); } catch (e) {} vad.seg = null; } }
  function _stopVad() {
    vad.running = false;
    if (vad.raf) cancelAnimationFrame(vad.raf);
    if (vad.seg) { try { vad.seg.stop(); } catch (e) {} vad.seg = null; }
    if (vad.ctx) { try { vad.ctx.close(); } catch (e) {} vad.ctx = null; }
    vad.speaking = false; vad.silenceAt = 0; vad.onSegment = null;
  }
  function startContinuous() { return startVad(wakeWord ? _wakeSegment : _defaultSegment); }
  function stopContinuous() { _stopVad(); }
  var meetingStartTs = 0;
  // Full-meeting recorder: runs alongside the VAD on the same stream so the whole
  // take is captured as one playable blob (the per-segment VAD recorders only feed
  // transcription and are discarded). Two MediaRecorders can share one stream.
  var meetingRec = null, meetingRecChunks = [];
  // Rolling speaker-diarization: a second, periodically-drained chunk buffer
  // fed by the same MediaRecorder. Every MEETING_DIARIZE_INTERVAL_MS we upload
  // just the chunks collected since the last flush (not the whole growing
  // recording) so diarization cost stays flat as the meeting gets longer.
  var meetingDiarizeChunks = [];
  var meetingDiarizeTimer = null;
  var MEETING_DIARIZE_INTERVAL_MS = 25000;
  function _flushMeetingDiarizeChunk() {
    if (vad.paused || !meetingDiarizeChunks.length) return;
    var chunks = meetingDiarizeChunks; meetingDiarizeChunks = [];
    var blob = new Blob(chunks, { type: recMime || 'audio/webm' });
    if (blob.size < 8000) return; // too little audio in this window to bother
    fetch(API + '/api/meeting-diarize-chunk', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.success && Array.isArray(j.segments) && j.segments.length) {
          try { window.dispatchEvent(new CustomEvent('wc-meeting-speakers', { detail: { segments: j.segments } })); } catch (e) {}
        }
      }).catch(function () {}); // best-effort — never interrupts the meeting
  }
  function startMeeting() {
    meetingText = '';
    meetingStartTs = (window.performance ? performance.now() : Date.now());
    return startVad(_meetingSegment).then(function (ok) {
      try {
        meetingRecChunks = []; meetingDiarizeChunks = [];
        meetingRec = recMime ? new MediaRecorder(vad.stream, { mimeType: recMime }) : new MediaRecorder(vad.stream);
        meetingRec.ondataavailable = function (e) {
          if (!e.data || !e.data.size) return;
          meetingRecChunks.push(e.data);
          meetingDiarizeChunks.push(e.data);
        };
        meetingRec.start(1000); // periodic chunks so a long meeting flushes as it goes
        if (meetingDiarizeTimer) clearInterval(meetingDiarizeTimer);
        meetingDiarizeTimer = setInterval(_flushMeetingDiarizeChunk, MEETING_DIARIZE_INTERVAL_MS);
      } catch (e) { meetingRec = null; } // audio is best-effort; never block the meeting
      return ok;
    });
  }
  function stopMeeting() {
    var now = (window.performance ? performance.now() : Date.now());
    var dur = meetingStartTs ? Math.round((now - meetingStartTs) / 1000) : 0;
    meetingStartTs = 0;
    var text = meetingText;
    if (meetingDiarizeTimer) { clearInterval(meetingDiarizeTimer); meetingDiarizeTimer = null; }
    meetingDiarizeChunks = [];
    return new Promise(function (resolve) {
      var rec = meetingRec; meetingRec = null;
      function done(blob) { meetingRecChunks = []; _stopVad(); resolve({ text: text, duration: dur, blob: blob || null }); }
      if (!rec || rec.state === 'inactive') return done(null);
      rec.onstop = function () { done(meetingRecChunks.length ? new Blob(meetingRecChunks, { type: recMime || 'audio/webm' }) : null); };
      try { rec.stop(); } catch (e) { done(null); }
    });
  }
  // Pause/resume a live meeting in place: the VAD stops turning speech into
  // segments and the diarize timer stops uploading, but nothing is discarded —
  // the MediaRecorder itself is paused too so no dead air gets captured.
  function pauseMeeting() {
    if (!vad.running || vad.paused) return { success: false, error: 'Not recording' };
    vad.paused = true;
    if (vad.seg) { try { vad.seg.stop(); } catch (e) {} vad.seg = null; } // drop any in-flight segment
    vad.speaking = false; vad.silenceAt = 0;
    try { if (meetingRec && meetingRec.state === 'recording') meetingRec.pause(); } catch (e) {}
    return { success: true };
  }
  function resumeMeeting() {
    if (!vad.running || !vad.paused) return { success: false, error: 'Not paused' };
    vad.paused = false;
    try { if (meetingRec && meetingRec.state === 'paused') meetingRec.resume(); } catch (e) {}
    return { success: true };
  }

  // ---- Settings mapping --------------------------------------------------
  // Backend keeps snake_case keys; the frontend also speaks snake_case via
  // callNativeApi, so we pass through, translating only where the frontend
  // uses a different key than the backend.
  function toFrontendSettings(s) {
    return s || {};
  }

  // ---- The API surface ---------------------------------------------------
  var api = {
    // Settings
    get_settings: function () { return jget('/api/settings').then(toFrontendSettings); },
    save_settings: function (patch) {
      // Some saves carry the recording mode/provider/model — push straight through.
      if (patch && typeof patch.live_streaming !== 'undefined') liveStreaming = !!patch.live_streaming;
      if (patch && typeof patch.continuous_listening !== 'undefined') continuousMode = !!patch.continuous_listening;
      if (patch && typeof patch.wake_word !== 'undefined') wakeWord = (patch.wake_word || '').trim().toLowerCase();
      return jpost('/api/settings', patch || {}).then(function () { return { success: true }; });
    },
    reset_settings: function () { return jpost('/api/settings', {}).then(function () { return { success: true }; }); },

    // API keys
    get_api_keys: function () {
      return jget('/api/api-keys').then(function (r) {
        return { success: true, openai: r.openai || '', gemini: r.gemini || '', openai_decrypt_failed: false, gemini_decrypt_failed: false };
      });
    },
    set_api_key: function (provider, key) { return jpost('/api/api-key', { provider: provider, key: key }).then(function () { return { success: true }; }); },
    verify_api_key: function (provider, key, baseUrl) {
      return jpost('/api/verify-key', { provider: provider, key: key, baseUrl: baseUrl }).then(function (r) {
        return { success: true, valid: !!r.valid, error: r.valid ? undefined : (r.error || 'Verification failed') };
      });
    },
    get_migration_notice: function () { return Promise.resolve(null); },

    // Models
    get_models: function () { return jget('/api/models').then(function (m) { return Array.isArray(m) ? m : []; }); },
    set_model: function (name) { return jpost('/api/settings', { model: name }).then(function () { return { success: true }; }); },
    download_model: function (name) { return jpost('/api/download-model', { model: name }).then(function () { return { success: true }; }); },
    delete_model: function (name) { return jpost('/api/delete-model', { model: name }).then(function (r) { return r || { success: false }; }); },
    get_download_progress: function () { return jget('/api/download-progress'); },

    // Microphones — the browser picks the mic; expose a single default entry.
    // Real device picker. Labels are only populated once mic permission has
    // been granted, so unlock them with a one-shot getUserMedia if needed.
    // Exposed as numeric indices (the frontend coerces ids to Number).
    get_microphones: function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return Promise.resolve([{ id: 0, name: 'Browser microphone', is_default: true }]);
      }
      function enumerate() {
        return navigator.mediaDevices.enumerateDevices().then(function (list) {
          micDevices = list.filter(function (d) { return d.kind === 'audioinput'; });
          // keep the selected device valid across re-enumeration
          if (selectedDeviceId && !micDevices.some(function (d) { return d.deviceId === selectedDeviceId; })) selectedDeviceId = null;
          return micDevices.map(function (d, i) {
            return { id: i, name: d.label || ('Microphone ' + (i + 1)), is_default: i === 0 };
          });
        });
      }
      return enumerate().then(function (mapped) {
        var unlabeled = micDevices.length && micDevices.every(function (d) { return !d.label; });
        if (!micDevices.length || unlabeled) {
          return navigator.mediaDevices.getUserMedia({ audio: _audioConstraints() })
            .then(function (s) { s.getTracks().forEach(function (t) { t.stop(); }); return enumerate(); })
            .catch(function () { return mapped; });
        }
        return mapped;
      }).catch(function () { return [{ id: 0, name: 'Browser microphone', is_default: true }]; });
    },
    set_microphone: function (index) {
      var i = Number(index);
      var dev = (Number.isFinite(i) && micDevices[i]) ? micDevices[i] : null;
      selectedDeviceId = dev ? dev.deviceId : null;
      // Drop the cached stream so the next capture re-opens on the new device.
      if (mediaStream) { try { mediaStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} mediaStream = null; }
      return Promise.resolve({ success: true });
    },
    // Noise-suppression / echo-cancel / AGC toggles (persisted).
    set_audio_prefs: function (prefs) {
      if (prefs && typeof prefs === 'object') audioPrefs = Object.assign(audioPrefs, prefs);
      try { localStorage.setItem('wc_audio_prefs', JSON.stringify(audioPrefs)); } catch (e) {}
      if (mediaStream) { try { mediaStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} mediaStream = null; }
      return Promise.resolve({ success: true, prefs: audioPrefs });
    },
    get_audio_prefs: function () { return Promise.resolve(audioPrefs); },

    // Recording
    start_recording: function () {
      if (continuousMode) {
        return startContinuous().then(function () {
          fireState('recording');
          return { success: true };
        }).catch(function (e) {
          return { success: false, error: e.message };
        });
      }
      return startRec().then(function () {
        fireState('recording');
        return { success: true };
      }).catch(function (e) {
        return { success: false, error: e.message };
      });
    },
    pause_recording: function () { return Promise.resolve({ success: pauseRec(), paused: recPaused() }); },
    resume_recording: function () { return Promise.resolve({ success: resumeRec(), paused: recPaused() }); },
    is_recording_paused: function () { return Promise.resolve({ paused: recPaused() }); },
    stop_recording: function () {
      if (continuousMode) {
        stopContinuous();
        fireState('dormant');
        try { window.dispatchEvent(new Event('wc-history-refresh')); } catch (e) {}
        return Promise.resolve({ success: true, text: '' });
      }
      fireState('processing');
      return stopRec()
        .then(uploadAudio)
        .then(function (r) {
          hidePartial();
          if (!r || !r.success) throw new Error((r && r.error) || 'Transcription failed');
          fireState('success');
          return { success: true, text: r.text };
        })
        .catch(function (e) {
          hidePartial();
          fireState('error', e.message);
          return { success: false, error: e.message };
        });
    },
    cancel_processing: function () { stopPartialLoop(); hidePartial(); try { if (recorder) recorder.stop(); } catch (e) {} recorder = null; fireState('dormant'); return Promise.resolve({ success: true }); },
    get_recording_state: function () {
      var rec = !!(recorder && recorder.state === 'recording');
      return Promise.resolve({ is_recording: rec, is_processing: false, cancel_requested: false });
    },
    ack_state: function () { fireState('dormant'); return Promise.resolve({ success: true }); },

    // File upload: transcribe an existing audio/video file (any format ffmpeg
    // can read). Same /api/transcribe path as a live take, so it lands in history.
    // opts?: { start, end } — seconds; transcribe only that window of the file.
    upload_file: function (file, opts) {
      if (!file) return Promise.resolve({ success: false, error: 'no file' });
      var o = opts || {}; var qs = '';
      var s = Number(o.start) || 0, e = Number(o.end) || 0;
      if (s > 0 || e > 0) qs = '?start=' + s + '&end=' + e;
      return fetch(API + '/api/transcribe' + qs, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      }).then(function (r) { return r.json(); });
    },


    // Persist an edited transcript (redo-this-bit / manual edits).
    // (id, text, extra?) — text optional; extra carries enrichment fields
    // (summary / action_items / speakers / title). The server whitelists them.
    update_history_text: function (id, text, extra) {
      var body = { id: id };
      if (text !== null && text !== undefined) body.text = text;
      if (extra && typeof extra === 'object') Object.assign(body, extra);
      return jpost('/api/history/update', body);
    },

    // "Redo this bit": record a short clip and return its text WITHOUT saving a
    // new history entry (the caller splices it into an existing transcript).
    redo_start: function () {
      return ensureStream().then(function (stream) {
        redoChunks = []; recMime = pickMime();
        redoRecorder = recMime ? new MediaRecorder(stream, { mimeType: recMime }) : new MediaRecorder(stream);
        redoRecorder.ondataavailable = function (e) { if (e.data && e.data.size) redoChunks.push(e.data); };
        redoRecorder.start();
        return { success: true };
      }).catch(function (e) { return { success: false, error: e.message }; });
    },
    redo_stop: function () {
      return new Promise(function (resolve) {
        if (!redoRecorder) return resolve({ success: false, error: 'not recording' });
        redoRecorder.onstop = function () {
          var blob = new Blob(redoChunks, { type: recMime || 'audio/webm' });
          redoRecorder = null;
          fetch(API + '/api/transcribe-partial', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob })
            .then(function (r) { return r.json(); })
            .then(function (r) { resolve({ success: true, text: (r && r.text || '').trim() }); })
            .catch(function (e) { resolve({ success: false, error: e.message }); });
        };
        try { redoRecorder.stop(); } catch (e) { resolve({ success: false, error: e.message }); }
      });
    },


    // History
    get_history: function () { return jget('/api/history'); },
    // Paginated, newest-first, optional text query. Returns {items,total,offset,limit}.
    get_history_page: function (limit, offset, q) {
      var qs = '?limit=' + (limit || 40) + '&offset=' + (offset || 0) + (q ? '&q=' + encodeURIComponent(q) : '');
      return jget('/api/history/page' + qs);
    },
    delete_history: function (id) { return jpost('/api/history/delete', { id: id }).then(function () { return { success: true }; }); },
    clear_history: function () { return jpost('/api/history/clear', {}).then(function () { return { success: true }; }); },

    // Audio playback — the frontend builds `data:${mime};base64,${data}`, so
    // fetch the stored wav and hand back base64, matching that exact contract.
    get_audio: function (historyId) {
      return fetch(API + '/api/audio/' + encodeURIComponent(historyId))
        .then(function (r) { if (!r.ok) throw new Error('No audio available'); return r.blob(); })
        .then(function (blob) {
          return new Promise(function (resolve) {
            var fr = new FileReader();
            fr.onload = function () {
              var base64 = String(fr.result).split(',')[1] || '';
              resolve({ success: true, mime: blob.type || 'audio/wav', data: base64 });
            };
            fr.onerror = function () { resolve({ success: false, error: 'Failed to read audio' }); };
            fr.readAsDataURL(blob);
          });
        })
        .catch(function (e) { return { success: false, error: e.message }; });
    },

    // Clipboard / paste / enter — browser clipboard where possible, else no-op.
    copy_to_clipboard: function (text) {
      try { if (navigator.clipboard) navigator.clipboard.writeText(text || ''); } catch (e) {}
      return Promise.resolve({ success: true });
    },
    paste_last_transcript: function () { return Promise.resolve({ success: true }); },
    simulate_enter: function () { return Promise.resolve({ success: true }); },

    // Window / monitors / pill — desktop-only no-ops for the web build.
    minimize: function () { return Promise.resolve(); },
    close: function () { return Promise.resolve(); },
    toggle_maximize: function () { return Promise.resolve(); },
    is_maximized: function () { return Promise.resolve(false); },
    drag_start: function () {}, nc_resize_start: function () {},
    get_monitors: function () { return Promise.resolve([]); },
    set_pill_display: function () { return Promise.resolve({ success: true }); },
    toggle_pill: function () { return Promise.resolve({ success: true }); },
    get_version: function () { return Promise.resolve({ version: 'web', dev: false }); },
    export_transcription: function () { return Promise.resolve({ success: false, error: 'not supported on web' }); },

    // License/tier — same method name as the Electron bridge so the frontend can
    // ask once (callNativeApi) and each platform routes it its own way.
    get_license: function () { return jget('/api/license'); },
    pro_activate: function () { return Promise.resolve({ success: false }); },
    pro_deactivate: function () { return Promise.resolve({ success: false }); },
    open_external: function (url) { try { window.open(url, '_blank'); } catch (e) {} return Promise.resolve({ success: true }); },

    // Updater — no-op on web.
    check_for_updates: function () { return Promise.resolve({ status: 'idle' }); },
    download_update: function () { return Promise.resolve({ status: 'idle' }); },
    install_update: function () { return Promise.resolve({ status: 'idle' }); },
    set_update_channel: function () { return Promise.resolve({ success: true }); },
    get_update_channel: function () { return Promise.resolve({ channel: 'stable' }); },
    get_update_status: function () { return Promise.resolve({ status: 'idle' }); },
  };

  window.pywebview = { api: api };
  // Signal readiness so the app's waitForNativeBridge() resolves immediately.
  try { window.dispatchEvent(new Event('pywebviewready')); } catch (e) {}
  document.addEventListener('DOMContentLoaded', function () {
    try { window.dispatchEvent(new Event('pywebviewready')); } catch (e) {}
  });
})();
