// Shared media/URL logic used by BOTH the web server (platforms/web/server.js)
// and the Electron main process (platforms/electron/main.js). Parameterized by
// the ffmpeg + python paths each platform resolves, so there is ONE copy of the
// URL-preview / yt-dlp / WAV-conversion behavior. Ported verbatim from server.js.
'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

const MEDIA_EXT_RE = /\.(mp3|wav|m4a|aac|flac|ogg|opus|weba|webm|mp4|mov|mkv|avi|wma|aiff?)$/i;

function ytVideoId(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const h = u.hostname.replace(/^www\./, '');
    if (h === 'youtu.be') return (u.pathname.slice(1).split('/')[0] || '').split('?')[0] || null;
    if (/(^|\.)youtube\.com$/.test(h)) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:shorts|embed|v|live)\/([^/?#]+)/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

function decodeHtml(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'").replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(+d); } catch { return ''; } })
    .replace(/&nbsp;/g, ' ');
}

function ogTag(html, key) {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + k + '["\'][^>]*content=["\']([^"\']*)', 'i'));
  if (!m) m = html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + k + '["\']', 'i'));
  return m ? decodeHtml(m[1]).trim() : null;
}

// Factory: bind the platform's ffmpeg + python commands once.
function createUrlImport({ ffmpeg, pyCmd }) {
  const FFMPEG = ffmpeg || 'ffmpeg';
  const PY_CMD = pyCmd || 'python';

  // Convert to 16k mono WAV. `range` optionally trims to a window:
  //   { start: seconds, end: seconds } — either may be omitted.
  // Seeking goes BEFORE -i for a fast keyframe seek; -to is relative to -ss.
  function toWav(inputPath, outputPath, range) {
    const pre = [];
    if (range && Number.isFinite(range.start) && range.start > 0) pre.push('-ss', String(range.start));
    const post = [];
    if (range && Number.isFinite(range.end) && range.end > 0) {
      const dur = (range && Number.isFinite(range.start) && range.start > 0) ? (range.end - range.start) : range.end;
      if (dur > 0) post.push('-t', String(dur));
    }
    const r = spawnSync(FFMPEG, ['-y', ...pre, '-i', inputPath, ...post, '-ar', '16000', '-ac', '1', '-f', 'wav', outputPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.status !== 0) throw new Error('ffmpeg failed: ' + (r.stderr ? r.stderr.toString().slice(-400) : 'unknown'));
    return outputPath;
  }

  let _ytdlpOk = null;
  function ytdlpAvailable() {
    if (_ytdlpOk !== null) return _ytdlpOk;
    try {
      const r = spawnSync(PY_CMD, ['-m', 'yt_dlp', '--version'], { timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] });
      _ytdlpOk = r.status === 0;
    } catch { _ytdlpOk = false; }
    return _ytdlpOk;
  }

  function ytdlpExtractAudio(url, outNoExt) {
    const args = ['-m', 'yt_dlp', '-x', '--audio-format', 'mp3', '--no-playlist', '--no-warnings',
      '--ffmpeg-location', FFMPEG, '-o', outNoExt + '.%(ext)s', url];
    const r = spawnSync(PY_CMD, args, { timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = outNoExt + '.mp3';
    if (r.status !== 0 || !fs.existsSync(out)) {
      let err = (r.stderr ? r.stderr.toString() : '').trim();
      err = err.split('\n').filter(l => /error/i.test(l)).pop() || err.slice(-240) || 'Could not fetch audio from that link.';
      throw new Error(err.replace(/^ERROR:\s*/i, '').slice(0, 240));
    }
    return out;
  }

  async function urlPreview(rawUrl) {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, '');

    // YouTube (video / short / live / youtu.be) → oEmbed, no API key needed.
    const ytId = ytVideoId(rawUrl);
    if (ytId) {
      const oe = await fetch('https://www.youtube.com/oembed?url=' +
        encodeURIComponent('https://www.youtube.com/watch?v=' + ytId) + '&format=json').catch(() => null);
      if (oe && oe.ok) {
        const o = await oe.json();
        return {
          kind: 'youtube', canTranscribe: ytdlpAvailable(),
          title: o.title || 'YouTube video', author: o.author_name || null,
          thumbnail: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
          source: 'YouTube', url: rawUrl,
        };
      }
      return { kind: 'youtube', canTranscribe: ytdlpAvailable(), title: 'YouTube video', thumbnail: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`, source: 'YouTube', url: rawUrl };
    }

    const extM = u.pathname.match(MEDIA_EXT_RE);

    // Cheap header probe (many hosts support HEAD; failures fall through).
    let ct = '', len = 0;
    try {
      const h = await fetch(rawUrl, { method: 'HEAD', redirect: 'follow' });
      if (h && h.ok) { ct = (h.headers.get('content-type') || '').toLowerCase(); len = Number(h.headers.get('content-length') || 0); }
    } catch {}

    if (extM || /audio\/|video\//.test(ct)) {
      const name = decodeURIComponent((u.pathname.split('/').filter(Boolean).pop() || 'media file'));
      return { kind: 'media', canTranscribe: true, title: name, source: host, mediaType: ct || ('audio/' + (extM ? extM[1].toLowerCase() : '')), bytes: len, url: rawUrl };
    }

    // Generic page → parse OpenGraph/title from the HTML.
    let html = '';
    try {
      const r = await fetch(rawUrl, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhisperClick/1.0)' } });
      const c = (r.headers.get('content-type') || '').toLowerCase();
      if (/text\/html|application\/xhtml/.test(c)) html = (await r.text()).slice(0, 250000);
    } catch {}
    const rawTitle = ogTag(html, 'og:title') || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || host;
    // yt-dlp supports 1000+ sites (SoundCloud, Vimeo, X/Twitter, TikTok, Facebook,
    // Twitch, podcast hosts…), so when it's available we let ANY page be attempted
    // — it pulls the audio if there's a supported media stream, and falls back to a
    // friendly error if not. Only hard-block when there's no extractor and no direct
    // media file. `viaExtractor` tells the UI to set the "we'll try to pull audio"
    // expectation instead of promising a known file.
    const viaExtractor = !extM && ytdlpAvailable();
    return {
      kind: 'page', canTranscribe: !!extM || ytdlpAvailable(), viaExtractor: viaExtractor,
      title: decodeHtml((rawTitle || host)).trim().slice(0, 200) || host,
      description: ogTag(html, 'og:description'),
      thumbnail: ogTag(html, 'og:image') || ogTag(html, 'twitter:image'),
      source: ogTag(html, 'og:site_name') || host, url: rawUrl,
    };
  }

  return { toWav, urlPreview, ytdlpAvailable, ytdlpExtractAudio, MEDIA_EXT_RE };
}

module.exports = { createUrlImport, MEDIA_EXT_RE, ytVideoId };
