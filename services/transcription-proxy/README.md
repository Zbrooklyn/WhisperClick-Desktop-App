# WhisperClick — Transcription Proxy (Complete tier)

The managed backend for WhisperClick's paid **Complete** tier. Subscribers
transcribe with **no API key of their own**: the desktop app sends audio plus a
signed **license token**, this Cloudflare Worker verifies the license, forwards
the audio to our provider account (OpenAI or Gemini) using a key held
server-side, meters usage per license, rate-limits, and returns the transcript.

This is the only backend WhisperClick runs. Everything else is client-side.

---

## Client-facing request/response contract

The desktop app calls one endpoint.

**Endpoint**

```
POST https://<your-worker-domain>/v1/transcribe
```

**Headers**

| Header          | Value                                   | Required |
| --------------- | --------------------------------------- | -------- |
| `Authorization` | `Bearer <license-token>`                | yes      |
| `Content-Type`  | `multipart/form-data` **or** `audio/*`  | yes      |

**Body — option A (recommended): multipart/form-data**

| Field      | Type   | Notes                                            |
| ---------- | ------ | ------------------------------------------------ |
| `file`     | file   | the audio (webm/wav/mp3/m4a/ogg)                 |
| `provider` | string | optional — `openai` (default) or `gemini`        |
| `model`    | string | optional — e.g. `whisper-1`                      |
| `language` | string | optional — ISO code hint, e.g. `en`              |

**Body — option B: raw audio bytes** with an `audio/*` `Content-Type`.
Provider/model/language may then be passed as query params, e.g.
`/v1/transcribe?provider=openai&language=en`.

**Success — 200**

```json
{
  "text": "the transcribed text",
  "duration": 12.4,
  "provider": "openai",
  "usage": {
    "used_minutes": 43.2,
    "allowance_minutes": 900,
    "remaining_minutes": 856.8
  }
}
```

**Errors** — JSON body `{ "error": { "code": "...", "message": "..." } }`

| Status | code                  | Meaning                                             |
| ------ | --------------------- | --------------------------------------------------- |
| 400    | `bad_request` / `no_file` / `empty_body` / `bad_provider` | malformed request |
| 401    | `missing_token` / `invalid_license` | token missing, malformed, unsigned, or expired |
| 402    | `quota_exceeded`      | monthly allowance used up (resets next month); includes `usage` |
| 405    | `method_not_allowed`  | use POST                                            |
| 413    | `too_large`           | audio over 25 MB                                    |
| 429    | `rate_limited`        | per-license request cap tripped; sends `Retry-After` |
| 502    | `provider_error` / `provider_auth` | upstream provider failed / rejected our key |
| 500    | `provider_unconfigured` / `kv_unconfigured` | server not fully configured |

**Health check:** `GET /health` → `{ "ok": true }` (no auth).

### License token format

Compact, JWT-like, dot-separated base64url: `<payload>.<signature>`

- `payload` is base64url JSON: `{ "sub": "<licenseId>", "exp": <unixSeconds> }`
  (add whatever else you need; `sub` and `exp` are the ones this Worker reads).
- `signature` is an **Ed25519** signature over the ASCII bytes of the `payload`
  base64url string, signed with your license **private** key. This Worker
  verifies it with the matching public key (`LICENSE_PUBLIC_KEY`).

Your license issuer (wherever you mint tokens after a Lemon Squeezy purchase)
holds the private key; the Worker only ever sees the public key.

---

## Deploy steps

1. Install Wrangler and log in to **Edward's Cloudflare account**:
   ```bash
   npm install -g wrangler
   wrangler login
   ```
2. From this directory (`services/transcription-proxy/`), create the KV namespace:
   ```bash
   wrangler kv namespace create USAGE_KV
   ```
   Copy the printed `id` into `wrangler.toml` (replace `TODO_EDWARD_KV_NAMESPACE_ID`).
3. Set the secrets (see checklist below) — one prompt each:
   ```bash
   wrangler secret put OPENAI_API_KEY
   wrangler secret put GEMINI_API_KEY                # optional
   wrangler secret put LICENSE_PUBLIC_KEY
   wrangler secret put LEMON_SQUEEZY_WEBHOOK_SECRET  # for the active-sub check
   ```
4. (Optional) adjust `MONTHLY_MINUTES` / `RATE_LIMIT` in `wrangler.toml [vars]`.
5. Deploy:
   ```bash
   wrangler deploy
   ```
6. Point the desktop app's Complete-tier endpoint at the deployed Worker URL.

---

## Secrets & bindings Edward must set

- [ ] **Cloudflare account** — `wrangler login` to Edward's account (deploy target).
- [ ] **`USAGE_KV` namespace id** — created in step 2, pasted into `wrangler.toml`.
- [ ] **`OPENAI_API_KEY`** — OUR OpenAI account key (the managed provider key).
- [ ] **`GEMINI_API_KEY`** — OUR Google Gemini key. Optional; only needed if you
      offer Gemini as a provider.
- [ ] **`LICENSE_PUBLIC_KEY`** — base64 Ed25519 **public** key that verifies
      license tokens. Until this is set the Worker does **not** verify signatures
      — do not run production without it.
- [ ] **`LEMON_SQUEEZY_WEBHOOK_SECRET`** — Lemon Squeezy webhook signing secret,
      used to verify subscription-status webhooks for the active-subscription
      check (see the `TODO(edward)` in `verifyLicense`).
- [ ] **`MONTHLY_MINUTES`** *(var, optional)* — monthly allowance per license
      (default 900).
- [ ] **`RATE_LIMIT`** *(var, optional)* — requests per license per 60s (default 30).

---

## What is left to wire (marked `// TODO(edward)` in `worker.js`)

- **Lemon Squeezy active-subscription check** — the Ed25519 signature proves we
  issued the token, but not that the subscription is still active. Wire a
  Lemon Squeezy webhook (verified with `LEMON_SQUEEZY_WEBHOOK_SECRET`) that
  writes `status:<licenseId>` into KV, then reject non-active licenses. Details
  in the `verifyLicense` TODO.
- **Gemini model id** — confirm the exact Gemini model to standardize on.
- **Public key format** — the code imports a **raw** 32-byte Ed25519 key. If
  yours is SPKI/PEM, adjust the `importKey` call noted in `verifyEd25519`.
