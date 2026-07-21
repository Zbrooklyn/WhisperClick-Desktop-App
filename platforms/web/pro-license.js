// pro-license.js — offline-first license / tier client for the WEB build.
//
// This mirrors the desktop premium license (platforms/electron/premium/
// pro-license.js): a license is a compact, self-contained, Ed25519-signed token
// verified entirely offline, so a paid user is never locked out by a flaky
// connection. Same token format, same tiers, same fail-safe-to-free behaviour —
// one licensing scheme across desktop and web.
//
// SAFE TO OPEN-SOURCE: only the PUBLIC key lives here. The private signing key
// never ships — it stays in Edward's license-issuing backend. A public verifier
// gives away nothing; forging a license needs the private key.
//
// TOKEN FORMAT (what the license generator emits):
//   token = base64url(payloadJSON) + "." + base64url(ed25519Signature)
//   payloadJSON = JSON.stringify({ email, tier, expiresAt, machineLimit })
//     tier      'pro' | 'complete'   (anything else → treated as free)
//     expiresAt epoch ms, or null/absent for a perpetual license
//   signature = Ed25519 over the ASCII bytes of the base64url payload segment.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Public key ──────────────────────────────────────────────────────────────
// Ed25519 SPKI PEM. Pairs with the private key kept in .license-keys/ (gitignored)
// / Edward's issuing backend. While empty, every license verifies invalid → the
// app stays free (never a fake unlock).
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAwVa2C48ZlmcDyfoqbfVbQ/RpYCOhYcMSsYjL5ha1PQ4=
-----END PUBLIC KEY-----`;

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFLINE_GRACE_DAYS = 45;
const OFFLINE_GRACE_MS = OFFLINE_GRACE_DAYS * DAY_MS;

const VALID_TIERS = ['pro', 'complete'];
const TIER_RANK = Object.freeze({ free: 0, pro: 1, complete: 2 });

const FREE_STATUS = Object.freeze({
  tier: 'free', valid: false, expiresAt: null, offlineGrace: false, email: null, reason: 'no-license',
});
function freeStatus(reason) { return { ...FREE_STATUS, reason: reason || 'no-license' }; }

function b64urlDecode(str) { return Buffer.from(String(str), 'base64url'); }

let _publicKeyObj, _publicKeyResolved = false;
function getPublicKey() {
  if (_publicKeyResolved) return _publicKeyObj;
  _publicKeyResolved = true;
  _publicKeyObj = null;
  const raw = (LICENSE_PUBLIC_KEY || '').trim();
  if (!raw) return null;
  try {
    _publicKeyObj = raw.includes('BEGIN')
      ? crypto.createPublicKey({ key: raw, format: 'pem' })
      : crypto.createPublicKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'spki' });
  } catch (e) { _publicKeyObj = null; }
  return _publicKeyObj;
}

// Verify a signed license token entirely offline.
function verifyToken(token) {
  if (!token || typeof token !== 'string') return { valid: false, payload: null, reason: 'missing-token' };
  const key = getPublicKey();
  if (!key) return { valid: false, payload: null, reason: 'no-public-key' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false, payload: null, reason: 'malformed-token' };
  const [payloadSeg, sigSeg] = parts;
  let payload;
  try { payload = JSON.parse(b64urlDecode(payloadSeg).toString('utf8')); }
  catch (e) { return { valid: false, payload: null, reason: 'bad-payload' }; }
  let signature;
  try { signature = b64urlDecode(sigSeg); }
  catch (e) { return { valid: false, payload: null, reason: 'bad-signature-encoding' }; }
  let sigOk = false;
  try { sigOk = crypto.verify(null, Buffer.from(payloadSeg, 'utf8'), key, signature); }
  catch (e) { sigOk = false; }
  if (!sigOk) return { valid: false, payload: null, reason: 'bad-signature' };
  return { valid: true, payload, reason: 'ok' };
}

// ── Stub / allowlist keys ─────────────────────────────────────────────────
// A simple allowlist of plaintext keys → tier, for issuing access before the
// full signing backend exists ("poofed and ready" locally). Same JSON shape a
// GitHub-hosted allowlist would use, so the source can later swap to a URL fetch
// with no format change. Set WC_LICENSE_ALLOWLIST to point elsewhere. The file
// is gitignored — real keys never ship. Accepts either
//   { "keys": { "KEY": { "tier": "pro", "email": "x" } } }  or  { "KEY": "pro" }.
const STUB_KEYS_FILE = process.env.WC_LICENSE_ALLOWLIST
  || path.join(__dirname, '..', '..', '.license-keys', 'stub-keys.json');
let _stubCache = null, _stubMtime = -1;
function loadStubKeys() {
  try {
    const st = fs.statSync(STUB_KEYS_FILE);
    if (_stubCache && st.mtimeMs === _stubMtime) return _stubCache;
    const raw = JSON.parse(fs.readFileSync(STUB_KEYS_FILE, 'utf8'));
    const src = (raw && raw.keys) ? raw.keys : raw;
    const map = {};
    for (const k of Object.keys(src || {})) {
      const v = src[k];
      map[k.trim()] = (typeof v === 'string') ? { tier: v, email: null }
        : { tier: (v && v.tier) || 'free', email: (v && v.email) || null };
    }
    _stubCache = map; _stubMtime = st.mtimeMs;
    return map;
  } catch (e) { _stubCache = null; _stubMtime = -1; return {}; }
}
function stubLookup(key) {
  const k = (key || '').trim();
  if (!k) return null;
  const entry = loadStubKeys()[k];
  if (!entry) return null;
  const tier = VALID_TIERS.includes(entry.tier) ? entry.tier : 'free';
  if (tier === 'free') return null;
  return { tier, email: entry.email || null };
}

// Compute the current license status from a plain settings object. Pure, offline,
// never throws. License fields on settings (snake_case, matching the web store):
//   license_key, license_token, license_tier, license_last_validated
function getLicenseStatus(settings) {
  try {
    const s = settings || {};
    // 1. Signed token (offline-verified) — the real, unforgeable path.
    const token = s.license_token || '';
    if (token) {
      const v = verifyToken(token);
      if (v.valid) {
        const p = v.payload || {};
        const tier = VALID_TIERS.includes(p.tier) ? p.tier : 'free';
        if (tier !== 'free') {
          const expiresAt = (typeof p.expiresAt === 'number') ? p.expiresAt : null;
          const email = (typeof p.email === 'string') ? p.email : null;
          const now = Date.now();
          if (expiresAt === null || now <= expiresAt) return { tier, valid: true, expiresAt, offlineGrace: false, email, reason: 'ok' };
          if (now <= expiresAt + OFFLINE_GRACE_MS) return { tier, valid: true, expiresAt, offlineGrace: true, email, reason: 'grace' };
          return { tier: 'free', valid: false, expiresAt, offlineGrace: false, email, reason: 'expired' };
        }
      }
    }
    // 2. Stub / allowlist key (local now, GitHub-hosted later). Re-checked every
    //    call, so removing a key from the allowlist downgrades immediately.
    const stub = stubLookup(s.license_key);
    if (stub) return { tier: stub.tier, valid: true, expiresAt: null, offlineGrace: false, email: stub.email, reason: 'stub' };
    return freeStatus(token ? 'invalid-token' : 'no-license');
  } catch (e) { return freeStatus('error'); }
}

// Activate a license by pasting a signed token. Mutates `settings` in place and
// returns the resulting status; the caller persists settings. Never fakes an
// unlock — an unverifiable key leaves the tier free.
function activate(settings, key) {
  const s = settings || {};
  const trimmed = (key || '').trim();
  if (!trimmed) return { ...getLicenseStatus(s), reason: 'empty-key' };
  s.license_key = trimmed;
  // Signed token path (real, unforgeable).
  const asToken = verifyToken(trimmed);
  if (asToken.valid) {
    s.license_token = trimmed;
    s.license_tier = VALID_TIERS.includes(asToken.payload.tier) ? asToken.payload.tier : 'free';
    s.license_last_validated = Date.now();
    return getLicenseStatus(s);
  }
  // Stub / allowlist path (local or GitHub-hosted list).
  const stub = stubLookup(trimmed);
  if (stub) {
    s.license_token = '';   // not a signed token — validity re-checked from the allowlist
    s.license_tier = stub.tier;
    s.license_last_validated = Date.now();
    return getLicenseStatus(s);
  }
  // Online key→token exchange would go here (STUB until the issuing backend is wired).
  return { ...getLicenseStatus(s), reason: 'activation-unverified' };
}

// Clear all license state → back to free.
function deactivate(settings) {
  const s = settings || {};
  s.license_key = ''; s.license_token = ''; s.license_tier = 'free'; s.license_last_validated = 0;
  return freeStatus('deactivated');
}

// Does `status` meet the minimum tier a feature requires?
function meetsTier(status, minTier) {
  const have = TIER_RANK[(status && status.tier) || 'free'] || 0;
  const need = TIER_RANK[minTier] || 0;
  return have >= need;
}

module.exports = {
  getLicenseStatus, activate, deactivate, verifyToken, meetsTier,
  TIER_RANK, VALID_TIERS, OFFLINE_GRACE_DAYS, LICENSE_PUBLIC_KEY,
};
