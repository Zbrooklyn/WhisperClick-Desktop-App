/**
 * WhisperClick — Transcription Proxy (Complete tier)
 * ---------------------------------------------------
 * Cloudflare Worker (ES module). This is the ONLY backend WhisperClick runs.
 *
 * Purpose: subscribers on the paid "Complete" tier transcribe with NO API key of
 * their own. The desktop app POSTs audio + a signed license token here; this
 * Worker verifies the license, forwards the audio to OUR provider account using a
 * key held server-side (env binding only, never in code), meters usage per
 * license, rate-limits, and returns the transcript.
 *
 * Request contract (see README.md for the full spec):
 *   POST /v1/transcribe
 *     Authorization: Bearer <license-token>
 *     Body: application/json { audio: <base64>, mime_type, word_timestamps?,
 *           language?, prompt?, provider?, model? }   ← desktop app (Complete tier)
 *           OR multipart/form-data (field "file") OR raw audio bytes
 *   -> 200 { text, duration, language, segments, words, provider, usage: {…} }
 *
 *   POST /v1/chat   (meeting summaries / managed post-processing / translation)
 *     Authorization: Bearer <license-token>
 *     Body: application/json { messages: [{role,content}…], temperature?, provider? }
 *   -> 200 { text }
 *
 * Error codes: 400 bad request · 401 auth · 402 quota exceeded · 405 method ·
 *              413 too large · 429 rate limited · 502 provider error · 500 internal.
 */

// ---------------------------------------------------------------------------
// Config defaults (overridable via env vars — see wrangler.toml)
// ---------------------------------------------------------------------------
const DEFAULT_MONTHLY_MINUTES = 900; // monthly allowance per license
const DEFAULT_RATE_LIMIT = 30; // max requests per license per RATE_WINDOW_SECONDS
const RATE_WINDOW_SECONDS = 60; // sliding-ish fixed window for the request cap
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB — matches OpenAI's per-request cap
const TRANSCRIBE_PATH = "/v1/transcribe";
const CHAT_PATH = "/v1/chat";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check — no auth, handy for uptime monitors.
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "whisperclick-transcription-proxy" });
    }

    if (url.pathname !== TRANSCRIBE_PATH && url.pathname !== CHAT_PATH) {
      return errorResponse(404, "not_found", "Unknown route.");
    }
    if (request.method !== "POST") {
      return errorResponse(405, "method_not_allowed", "Use POST.", {
        Allow: "POST",
      });
    }

    // 1) AUTH -----------------------------------------------------------------
    const token = readBearer(request);
    if (!token) {
      return errorResponse(401, "missing_token", "Authorization: Bearer <license-token> required.");
    }
    let license;
    try {
      license = await verifyLicense(token, env);
    } catch (err) {
      return errorResponse(401, "invalid_license", err.message || "License verification failed.");
    }
    const licenseId = license.sub;

    // 4) RATE LIMIT (cheap check first, before touching provider) --------------
    const rateLimit = Number(env.RATE_LIMIT) || DEFAULT_RATE_LIMIT;
    const rate = await bumpRateLimit(env, licenseId, rateLimit);
    if (!rate.ok) {
      return errorResponse(429, "rate_limited", "Too many requests. Slow down.", {
        "Retry-After": String(rate.retryAfter),
      });
    }

    // CHAT — meeting summaries / managed post-processing / translation. Shares
    // the same auth + rate limit; a chat call is cheap so it isn't minute-metered.
    if (url.pathname === CHAT_PATH) {
      try {
        return await handleChat(request, env);
      } catch (err) {
        if (err.status === 401 || err.status === 403) {
          return errorResponse(502, "provider_auth", "Chat provider rejected our credentials.");
        }
        return errorResponse(err.status || 502, err.code || "chat_error", err.message || "Chat request failed.");
      }
    }

    // 3a) QUOTA pre-check — reject early if already over allowance -------------
    const allowanceMinutes = Number(env.MONTHLY_MINUTES) || DEFAULT_MONTHLY_MINUTES;
    const usageBefore = await getUsageSeconds(env, licenseId);
    if (usageBefore / 60 >= allowanceMinutes) {
      return quotaResponse(usageBefore, allowanceMinutes);
    }

    // 2) READ AUDIO -----------------------------------------------------------
    let audio;
    try {
      audio = await readAudio(request);
    } catch (err) {
      return errorResponse(err.status || 400, err.code || "bad_request", err.message);
    }

    // 2) PROXY TRANSCRIPTION --------------------------------------------------
    const provider = (audio.fields.provider || url.searchParams.get("provider") || "openai").toLowerCase();
    let result;
    try {
      if (provider === "openai") {
        result = await transcribeOpenAI(env, audio);
      } else if (provider === "gemini") {
        result = await transcribeGemini(env, audio);
      } else {
        return errorResponse(400, "bad_provider", `Unsupported provider "${provider}".`);
      }
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        // A provider-auth failure is OUR misconfiguration, not the client's.
        return errorResponse(502, "provider_auth", "Transcription provider rejected our credentials.");
      }
      return errorResponse(err.status || 502, "provider_error", err.message || "Provider request failed.");
    }

    // 3b) METER USAGE — count the seconds we actually transcribed -------------
    // Prefer the provider-reported duration; fall back to a byte-based estimate.
    const seconds = result.duration != null ? result.duration : estimateSeconds(audio.bytes.byteLength);
    const usageAfter = await addUsageSeconds(env, licenseId, seconds);

    return json({
      text: result.text,
      duration: result.duration,
      language: result.language ?? null,
      segments: result.segments ?? null,
      words: result.words ?? null,
      provider,
      usage: usagePayload(usageAfter, allowanceMinutes),
    });
  },
};

// ===========================================================================
// 1) AUTH — license verification
// ===========================================================================

/**
 * Verify a WhisperClick license token.
 *
 * Token format (compact, JWT-like, dot-separated base64url):
 *   <payload-b64url>.<signature-b64url>
 * where <payload> is JSON: { sub: "<licenseId>", exp: <unixSeconds>, ... }
 * and <signature> is an Ed25519 signature over the ASCII bytes of the
 * <payload-b64url> string (i.e. everything before the final dot).
 *
 * Returns the decoded payload on success; throws on any failure.
 */
export async function verifyLicense(token, env) {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) throw new Error("Malformed token.");
  const signedPart = token.slice(0, dot); // the base64url payload string
  const sigPart = token.slice(dot + 1);

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(signedPart)));
  } catch {
    throw new Error("Unreadable token payload.");
  }
  if (!payload || typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Token missing license id (sub).");
  }

  // Ed25519 signature check against our public key.
  if (env.LICENSE_PUBLIC_KEY) {
    const ok = await verifyEd25519(env.LICENSE_PUBLIC_KEY, signedPart, sigPart);
    if (!ok) throw new Error("Bad signature.");
  } else {
    // TODO(edward): set the LICENSE_PUBLIC_KEY secret before going live. Until it
    // is set, signatures are NOT verified — do not deploy to production without it.
  }

  // Expiry (optional but recommended in the token).
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    throw new Error("License expired.");
  }

  // TODO(edward): confirm the subscription is still ACTIVE with Lemon Squeezy.
  //   The signature only proves we issued this token; it does not prove the
  //   subscriber has not since cancelled or been refunded. Wire one of:
  //     (a) A Lemon Squeezy webhook (subscription_updated / _cancelled /
  //         _expired / _payment_failed) that writes each license's status into
  //         USAGE_KV, e.g. key `status:<licenseId>` = "active" | "cancelled".
  //         Then here: read that key and reject if not "active".
  //     (b) Or an on-demand call to the Lemon Squeezy API to check the
  //         subscription tied to payload.sub, cached briefly in KV.
  //   Verify the webhook using env.LEMON_SQUEEZY_WEBHOOK_SECRET (HMAC-SHA256).

  return payload;
}

async function verifyEd25519(publicKeyB64, signedPart, sigB64url) {
  let keyBytes;
  try {
    keyBytes = b64ToBytes(publicKeyB64.trim());
  } catch {
    throw new Error("LICENSE_PUBLIC_KEY is not valid base64.");
  }
  // Accept a raw 32-byte Ed25519 public key (base64). If yours is SPKI/PEM,
  // strip the header/footer and change "raw" -> "spki" below.
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const sig = b64urlToBytes(sigB64url);
  const data = new TextEncoder().encode(signedPart);
  return crypto.subtle.verify({ name: "Ed25519" }, key, sig, data);
}

function readBearer(request) {
  const h = request.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// ===========================================================================
// 2) AUDIO INTAKE
// ===========================================================================

/**
 * Read the audio from either multipart/form-data (field "file") or a raw body.
 * Returns { bytes, filename, contentType, fields } where fields carries any
 * extra multipart form fields (provider, model, language).
 */
async function readAudio(request) {
  const contentType = request.headers.get("Content-Type") || "";
  const fields = {};
  let bytes;
  let filename = "audio.webm";
  let mediaType = "application/octet-stream";

  if (contentType.includes("application/json")) {
    // The desktop app (Complete tier) posts JSON: base64 audio + metadata.
    let payload;
    try { payload = await request.json(); }
    catch { throw withStatus(400, "bad_json", "Invalid JSON body."); }
    if (!payload || typeof payload.audio !== "string" || !payload.audio) {
      throw withStatus(400, "no_audio", 'JSON body must include base64 "audio".');
    }
    bytes = b64ToBytes(payload.audio);
    mediaType = payload.mime_type || payload.contentType || mediaType;
    filename = "audio." + extFromMime(mediaType);
    for (const k of ["provider", "model", "language", "prompt"]) {
      if (payload[k] != null) fields[k] = String(payload[k]);
    }
    if (payload.word_timestamps) fields.word_timestamps = "1";
  } else if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      throw withStatus(400, "no_file", 'multipart body must include a "file" field.');
    }
    bytes = new Uint8Array(await file.arrayBuffer());
    filename = file.name || filename;
    mediaType = file.type || mediaType;
    for (const [k, v] of form.entries()) {
      if (k !== "file" && typeof v === "string") fields[k] = v;
    }
  } else {
    // Raw audio body. Client should send an audio/* Content-Type.
    bytes = new Uint8Array(await request.arrayBuffer());
    mediaType = contentType || mediaType;
    filename = "audio." + extFromMime(mediaType);
  }

  if (!bytes || bytes.byteLength === 0) {
    throw withStatus(400, "empty_body", "No audio received.");
  }
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    throw withStatus(413, "too_large", `Audio exceeds ${Math.floor(MAX_AUDIO_BYTES / 1024 / 1024)} MB limit.`);
  }
  return { bytes, filename, contentType: mediaType, fields };
}

// ===========================================================================
// 2) PROVIDER CALLS  (keys come ONLY from env bindings)
// ===========================================================================

async function transcribeOpenAI(env, audio) {
  if (!env.OPENAI_API_KEY) {
    // TODO(edward): set the OPENAI_API_KEY secret (our account's key).
    throw withStatus(500, "provider_unconfigured", "OPENAI_API_KEY is not set.");
  }
  const model = audio.fields.model || "whisper-1";
  const form = new FormData();
  form.append("file", new Blob([audio.bytes], { type: audio.contentType }), audio.filename);
  form.append("model", model);
  // verbose_json gives us the audio duration, which we use for accurate metering,
  // plus speaker segments the client surfaces as diarization/karaoke.
  form.append("response_format", "verbose_json");
  if (audio.fields.prompt) form.append("prompt", audio.fields.prompt);
  // Per-word timestamps power confidence highlighting + click-to-play. Only
  // whisper-1 supports word granularity with verbose_json.
  if (audio.fields.word_timestamps) form.append("timestamp_granularities[]", "word");
  if (audio.fields.language) form.append("language", audio.fields.language);

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!resp.ok) {
    throw withStatus(resp.status, "openai_error", await safeErr(resp));
  }
  const data = await resp.json();
  return {
    text: data.text ?? "",
    duration: data.duration ?? null,
    language: data.language ?? null,
    segments: data.segments ?? null,
    words: data.words ?? null,
  };
}

async function transcribeGemini(env, audio) {
  if (!env.GEMINI_API_KEY) {
    // TODO(edward): set the GEMINI_API_KEY secret if you want Gemini as a provider.
    throw withStatus(500, "provider_unconfigured", "GEMINI_API_KEY is not set.");
  }
  // TODO(edward): confirm the Gemini model id you want to standardize on.
  const model = audio.fields.model || "gemini-1.5-flash";
  const audioB64 = bytesToB64(audio.bytes);
  const body = {
    contents: [
      {
        parts: [
          { text: "Transcribe this audio verbatim. Return only the transcript text." },
          { inline_data: { mime_type: audio.contentType, data: audioB64 } },
        ],
      },
    ],
  };
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!resp.ok) {
    throw withStatus(resp.status, "gemini_error", await safeErr(resp));
  }
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";
  // Gemini does not report audio duration, so metering falls back to the
  // byte-based estimate in the caller.
  return { text, duration: null };
}

// ===========================================================================
// 2c) CHAT PROXY  (meeting summaries / managed post-processing / translation)
// ===========================================================================

async function handleChat(request, env) {
  let body;
  try { body = await request.json(); }
  catch { throw withStatus(400, "bad_json", "Invalid JSON body."); }
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    throw withStatus(400, "no_messages", 'JSON body must include a non-empty "messages" array.');
  }
  const temperature = typeof body.temperature === "number" ? body.temperature : 0;
  const provider = (body.provider || "openai").toLowerCase();
  const text = provider === "gemini"
    ? await chatGemini(env, messages, temperature)
    : await chatOpenAI(env, messages, temperature);
  return json({ text });
}

async function chatOpenAI(env, messages, temperature) {
  if (!env.OPENAI_API_KEY) {
    throw withStatus(500, "provider_unconfigured", "OPENAI_API_KEY is not set.");
  }
  const model = env.CHAT_MODEL || "gpt-4o-mini";
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature }),
  });
  if (!resp.ok) {
    throw withStatus(resp.status, "openai_error", await safeErr(resp));
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

async function chatGemini(env, messages, temperature) {
  if (!env.GEMINI_API_KEY) {
    throw withStatus(500, "provider_unconfigured", "GEMINI_API_KEY is not set.");
  }
  const model = env.GEMINI_CHAT_MODEL || "gemini-1.5-flash";
  // Gemini's generateContent has no system role, so fold system turns into the
  // prompt preamble and concatenate the rest in order.
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const rest = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n");
  const prompt = sys ? `${sys}\n\n${rest}` : rest;
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature } }),
    },
  );
  if (!resp.ok) {
    throw withStatus(resp.status, "gemini_error", await safeErr(resp));
  }
  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";
}

// ===========================================================================
// 3) USAGE METERING (KV) — resets automatically each calendar month
// ===========================================================================

function usageKey(licenseId) {
  return `usage:${licenseId}:${currentMonth()}`; // e.g. usage:LIC123:2026-07
}

async function getUsageSeconds(env, licenseId) {
  requireUsageKV(env);
  const v = await env.USAGE_KV.get(usageKey(licenseId));
  return v ? Number(v) || 0 : 0;
}

async function addUsageSeconds(env, licenseId, seconds) {
  requireUsageKV(env);
  const key = usageKey(licenseId);
  const current = Number(await env.USAGE_KV.get(key)) || 0;
  const next = current + Math.max(0, Math.round(seconds));
  // NOTE: KV is eventually consistent, so two truly-concurrent requests for the
  // same license could under-count. For a per-user monthly meter that is an
  // acceptable trade-off. Set a TTL so stale months self-clean (~40 days).
  // TODO(edward): if you ever need exact concurrent counting, move the meter to
  //   a Durable Object; KV is fine for the Complete tier's per-user allowance.
  await env.USAGE_KV.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 40 });
  return next;
}

// ===========================================================================
// 4) RATE LIMITING (KV) — fixed window per license
// ===========================================================================

async function bumpRateLimit(env, licenseId, limit) {
  requireUsageKV(env);
  const window = Math.floor(Date.now() / 1000 / RATE_WINDOW_SECONDS);
  const key = `rate:${licenseId}:${window}`;
  const count = (Number(await env.USAGE_KV.get(key)) || 0) + 1;
  await env.USAGE_KV.put(key, String(count), { expirationTtl: RATE_WINDOW_SECONDS * 2 });
  if (count > limit) {
    const retryAfter = RATE_WINDOW_SECONDS - (Math.floor(Date.now() / 1000) % RATE_WINDOW_SECONDS);
    return { ok: false, retryAfter };
  }
  return { ok: true };
}

// ===========================================================================
// Helpers
// ===========================================================================

function requireUsageKV(env) {
  if (!env.USAGE_KV) {
    // TODO(edward): create the KV namespace and bind it as USAGE_KV (wrangler.toml).
    throw withStatus(500, "kv_unconfigured", "USAGE_KV binding is missing.");
  }
}

function usagePayload(usedSeconds, allowanceMinutes) {
  const usedMinutes = round1(usedSeconds / 60);
  return {
    used_minutes: usedMinutes,
    allowance_minutes: allowanceMinutes,
    remaining_minutes: round1(Math.max(0, allowanceMinutes - usedMinutes)),
  };
}

function quotaResponse(usedSeconds, allowanceMinutes) {
  return errorResponse(
    402,
    "quota_exceeded",
    "Monthly transcription allowance reached. Resets at the start of next month.",
    {},
    { usage: usagePayload(usedSeconds, allowanceMinutes) },
  );
}

// Rough fallback when the provider does not report duration. Assumes ~16 kB/s
// (typical compressed speech, e.g. Opus/AAC ~128 kbps). Only used for metering
// when the exact duration is unknown; deliberately conservative.
function estimateSeconds(byteLength) {
  const BYTES_PER_SECOND = 16000;
  return byteLength / BYTES_PER_SECOND;
}

function currentMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function extFromMime(mime) {
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp3") || mime.includes("mpeg")) return "mp3";
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  if (mime.includes("m4a") || mime.includes("mp4") || mime.includes("aac")) return "m4a";
  return "webm";
}

async function safeErr(resp) {
  try {
    const t = await resp.text();
    return t.slice(0, 500);
  } catch {
    return `HTTP ${resp.status}`;
  }
}

function withStatus(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

// --- JSON / error responses ---

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function errorResponse(status, code, message, headers = {}, extra = {}) {
  return json({ error: { code, message }, ...extra }, status, headers);
}

// --- base64 / base64url ---

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToBytes(b64url) {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return b64ToBytes(b64);
}

function bytesToB64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
