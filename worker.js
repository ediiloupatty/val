import { login as riotLogin, submitMfaCode as riotSubmitMfa } from './riot.js';

// Origins allowed to call this API.
const ALLOWED_ORIGINS = [
  "https://aimku.xyz",
  "https://www.aimku.xyz",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    // Allow only THIS project's Vercel deploys (e.g. https://val-xxxx.vercel.app),
    // not any *.vercel.app site — so an arbitrary attacker page can't request tokens.
    return /^val[a-z0-9-]*\.vercel\.app$/.test(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * Validates that a deviceId matches the expected client-generated format.
 * Although all queries use prepared statements (preventing SQL injection),
 * this adds a data-integrity layer and rejects obviously invalid inputs early.
 * Format: "dev-" followed by 10–60 alphanumeric/hyphen characters.
 */
function isValidDeviceId(id) {
  return typeof id === 'string' && /^dev-[a-zA-Z0-9\-]{10,60}$/.test(id);
}

// --- Server-side validation bounds -----------------------------------------
// A session is a fixed 40 s round (see SESSION_SECONDS in the client). Each hit
// awards at most ~300 points, so even a flawless run lands far below MAX_SCORE.
// These ceilings reject obviously forged payloads (e.g. score: 999999999) while
// staying generous enough never to reject a legitimate elite run.
const MAX_NAME_LEN = 20;
const MAX_SCORE = 100000;   // generous ceiling; a real 40 s session caps well below this
// Scores are cumulative over the round, so a 40 s round totals less than the
// legacy 60 s round. Normalise every stored score to a 60 s equivalent (×1.5)
// so the leaderboard stays fair across both eras. Mirrors SCORE_NORMALIZER on
// the client, which scales the live score and synced best the same way.
const SCORE_NORMALIZER = 60 / 40; // 1.5
const MAX_ACCURACY = 100;   // accuracy is a percentage
const MAX_SPLIT_MS = 60000; // generous ceiling; a split can't exceed the session length

/**
 * Cleans a user-supplied display name before it is stored and later rendered on
 * the leaderboard. Strips control characters and angle brackets (defence in depth
 * against HTML/script injection), trims, and caps the length. Falls back to a
 * default so a blank/whitespace name never reaches the database.
 */
function sanitizeName(name) {
  const cleaned = String(name ?? '')
    .replace(/[\u0000-\u001F\u007F<>]/g, '') // strip control chars + angle brackets
    .trim()
    .slice(0, MAX_NAME_LEN);
  return cleaned || 'Agent';
}

/**
 * Validates the numeric gameplay stats against plausible bounds. Unlike the old
 * `Number(x) || 0` coercion (which silently accepted absurd values), this rejects
 * non-finite numbers and anything outside the achievable range.
 * @returns {{ ok: true, values: {score:number, accuracy:number, split:number} }
 *          | { ok: false, error: string }}
 */
function validateGameStats({ score, accuracy, split }) {
  const s = Number(score);
  const a = Number(accuracy);
  const sp = Number(split);

  if (!Number.isFinite(s) || s < 0 || s > MAX_SCORE) {
    return { ok: false, error: `Invalid score: must be a number between 0 and ${MAX_SCORE}` };
  }
  if (!Number.isFinite(a) || a < 0 || a > MAX_ACCURACY) {
    return { ok: false, error: `Invalid accuracy: must be a number between 0 and ${MAX_ACCURACY}` };
  }
  if (!Number.isFinite(sp) || sp < 0 || sp > MAX_SPLIT_MS) {
    return { ok: false, error: `Invalid split: must be a number between 0 and ${MAX_SPLIT_MS}` };
  }

  return { ok: true, values: { score: Math.round(s), accuracy: a, split: sp } };
}

// --- Server-authoritative score verification -------------------------------
// The client sends a per-hit gameplay log; the server re-derives the score from
// it and rejects logs whose timing is physically impossible for a human. This
// closes the "POST any score up to the ceiling" hole: a forged score now has to
// come with a forged log that still obeys human limits, which bounds how high a
// cheater can plausibly go. (It does NOT prove a human actually played — that is
// impossible for client-rendered games — but it removes trivial value-forgery.)
//
// Scoring formula MUST mirror the client (AimTrainer.jsx onHit):
//   pts = 100 + round(max(0, 600 - bonusInterval) / 3)   // bonusInterval null => +100 only
// Training modes eligible for the per-mode leaderboard (must match the client's
// MODES keys). Anything else is stored as NULL and only shows on the "All" board.
const RANKED_MODES = new Set(["micro", "wide", "reflex", "grid", "head", "strafe"]);
// Standard target-size band for the per-mode leaderboard. Bigger targets are
// easier and inflate scores, so scores above the cap are kept out of the fair
// per-mode boards (they still count on "All"). Mirrors the client slider's min.
const RANKED_SIZE_MIN = 0.12;
const RANKED_SIZE_MAX = 0.35;

const HIT_BASE_POINTS = 100;
const HIT_BONUS_REF_MS = 600;     // intervals at/above this earn no bonus
const HIT_BONUS_DIVISOR = 3;      // => max bonus 200, max 300 pts/hit
const MAX_SHOTS = 3000;           // generous payload ceiling (hits + misses)
const HARD_FLOOR_MS = 20;         // a single sub-20ms interval is a double-register/bot
const MAX_SUBFLOOR_HITS = 2;      // tolerate a couple of engine double-registers
const SUSTAINED_FLOOR_MS = 70;    // median interval below this = superhuman cadence
                                  // (real human medians are ~150ms+; tune up to
                                  // tighten the cheat ceiling, down to loosen)
const SUSTAINED_MIN_HITS = 10;    // only apply the median gate once there's enough data
// Ceiling on log.durationMs. The real session is 40 s; 65 s gives generous
// headroom for Turnstile startup delay without allowing time-padding attacks.
const SESSION_MAX_MS = 65000;

function ptsForInterval(b) {
  // b is the bonus interval in ms, or null for the first hit (no prior split).
  if (b == null) return HIT_BASE_POINTS;
  return HIT_BASE_POINTS + Math.round(Math.max(0, HIT_BONUS_REF_MS - b) / HIT_BONUS_DIVISOR);
}

/**
 * Re-derives the score from a gameplay log and validates its plausibility.
 * @param {*} log   { mode, durationMs, hits: [{t, b}], misses }
 * @param {number} claimedScore  the score the client reported (cross-checked)
 * @returns {{ok:true, score:number, accuracy:number, split:number}
 *          | {ok:false, error:string}}
 */
function verifyGameLog(log, claimedScore) {
  if (!log || typeof log !== 'object') return { ok: false, error: 'Missing gameplay log' };
  const hits = log.hits;
  const misses = Number(log.misses);
  if (!Array.isArray(hits)) return { ok: false, error: 'Malformed gameplay log: hits' };
  if (!Number.isInteger(misses) || misses < 0) return { ok: false, error: 'Malformed gameplay log: misses' };
  if (hits.length + misses > MAX_SHOTS) return { ok: false, error: 'Gameplay log too large' };

  // Validate session duration so an attacker can't pad a log with hits spread
  // over e.g. 120 s, accumulating 3× the hits of a real 40 s session while each
  // individual interval still passes the plausibility gates.
  const durationMs = Number(log.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > SESSION_MAX_MS) {
    return { ok: false, error: 'Invalid session duration' };
  }

  let score = 0;
  let lastT = -1;
  let subFloor = 0;
  let bonusSum = 0;
  let bonusCount = 0;
  const intervals = [];

  for (const h of hits) {
    if (!h || typeof h !== 'object') return { ok: false, error: 'Malformed hit entry' };
    const t = Number(h.t);
    if (!Number.isFinite(t) || t < 0) return { ok: false, error: 'Invalid hit timestamp' };
    if (t > durationMs) return { ok: false, error: 'Hit timestamp exceeds session duration' };
    if (t < lastT) return { ok: false, error: 'Hit timestamps not in order' };
    lastT = t;

    const b = h.b == null ? null : Number(h.b);
    if (b != null) {
      if (!Number.isFinite(b) || b < 0) return { ok: false, error: 'Invalid hit interval' };
      if (b < HARD_FLOOR_MS) subFloor += 1;
      intervals.push(b);
      bonusSum += b;
      bonusCount += 1;
    }
    score += ptsForInterval(b);
  }

  // Plausibility gates — reject only the physically impossible.
  if (subFloor > MAX_SUBFLOOR_HITS) {
    return { ok: false, error: 'Implausible hit timing' };
  }
  if (intervals.length >= SUSTAINED_MIN_HITS) {
    const sorted = intervals.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median < SUSTAINED_FLOOR_MS) return { ok: false, error: 'Implausible hit cadence' };
  }

  // The re-derived score is authoritative — we STORE this, not the client's
  // claimed value — so we deliberately don't reject on client/server rounding
  // differences (the client scores from raw intervals, the log rounds them).
  // The plausibility gates above are what guard against forged logs.
  void claimedScore;

  const shots = hits.length + misses;
  const accuracy = shots > 0 ? (hits.length / shots) * 100 : 0;
  const split = bonusCount > 0 ? bonusSum / bonusCount : 0;
  // Normalise to the 60 s equivalent (matches the client), then hard-cap so even
  // a plausible-looking log can never store above MAX_SCORE.
  const normalized = Math.round(score * SCORE_NORMALIZER);
  return { ok: true, score: Math.min(normalized, MAX_SCORE), accuracy, split };
}

/**
 * Per-request rate limiting for write endpoints, keyed by both client IP and
 * deviceId so neither a single device nor a single IP can flood the scores table.
 * Uses Cloudflare's native rate-limiting binding (configured in wrangler.toml).
 * Degrades gracefully — if the binding isn't present (e.g. local `wrangler dev`
 * without it), requests are allowed through rather than failing closed.
 * @returns {Promise<boolean>} true if the request is within limits.
 */
async function withinRateLimit(env, request, deviceId) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const checks = [];
  if (env.RATE_LIMITER) checks.push(env.RATE_LIMITER.limit({ key: `dev:${deviceId}` }));
  if (env.RATE_LIMITER_IP) checks.push(env.RATE_LIMITER_IP.limit({ key: `ip:${ip}` }));
  if (checks.length === 0) return true; // bindings not configured (e.g. local dev)
  const results = await Promise.all(checks);
  return results.every((r) => r.success);
}

// --- Signed session tokens -------------------------------------------------
// A token is issued at game start (/api/session/start) and required to submit a
// score. This means a score can only come from a session this backend authorized,
// blocking blind POSTs straight to /api/score. Combined with single-use nonces
// and a minimum-elapsed check it also stops automated score farming.
// NOTE: it does NOT make the score value itself trustworthy — the client still
// computes it. True anti-cheat needs server-authoritative scoring (out of scope).
const TOKEN_MIN_ELAPSED_MS = 30 * 1000;   // a real round is 40 s; reject suspiciously fast submits
const TOKEN_MAX_AGE_MS = 30 * 60 * 1000;  // tokens expire after 30 min

const _enc = new TextEncoder();

function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecodeToString(s) {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}
function importHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', _enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
}
// Constant-time string comparison (avoids leaking signature bytes via timing).
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signSession(secret, deviceId) {
  const payload = `${deviceId}|${Date.now()}|${crypto.randomUUID()}`;
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, _enc.encode(payload));
  return `${b64urlEncode(_enc.encode(payload))}.${b64urlEncode(new Uint8Array(sig))}`;
}

/**
 * Verifies a session token's signature, age, and minimum elapsed time.
 * @returns {Promise<{ok:true, deviceId:string, nonce:string} | {ok:false, error:string}>}
 */
async function verifySession(secret, token) {
  if (typeof token !== 'string' || token.indexOf('.') === -1) {
    return { ok: false, error: 'Missing or malformed session token' };
  }
  const [payloadB64, sig] = token.split('.');
  let payload;
  try { payload = b64urlDecodeToString(payloadB64); } catch { return { ok: false, error: 'Malformed session token' }; }

  const key = await importHmacKey(secret);
  const expected = b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, _enc.encode(payload))));
  if (!timingSafeEqual(sig, expected)) return { ok: false, error: 'Invalid session token' };

  const [deviceId, issuedAtStr, nonce] = payload.split('|');
  const issuedAt = Number(issuedAtStr);
  if (!deviceId || !nonce || !Number.isFinite(issuedAt)) return { ok: false, error: 'Invalid session token payload' };

  const age = Date.now() - issuedAt;
  if (age < 0 || age > TOKEN_MAX_AGE_MS) return { ok: false, error: 'Session token expired' };
  if (age < TOKEN_MIN_ELAPSED_MS) return { ok: false, error: 'Session too short to submit a score' };

  return { ok: true, deviceId, nonce };
}

// --- Shop checker: encrypted MFA hand-off ----------------------------------
// The Riot login is two steps when 2FA is on: submit password, then submit the
// emailed code. The cookies from step 1 must survive into step 2, but the Worker
// is stateless. Rather than store them server-side, we encrypt the cookie jar
// (AES-GCM, key derived from SHOP_SECRET) into an opaque token the client holds
// for a few minutes and sends back with the code. The client can't read it, and
// it can't be replayed after the short TTL check in the /api/shop/mfa handler.
async function shopAesKey(secret) {
  const hash = await crypto.subtle.digest('SHA-256', _enc.encode(secret));
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function shopEncrypt(secret, obj) {
  const key = await shopAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, _enc.encode(JSON.stringify(obj)))
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64urlEncode(out);
}
async function shopDecrypt(secret, token) {
  const key = await shopAesKey(secret);
  const raw = Uint8Array.from(b64urlDecodeToString(token), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

// Per-IP rate limit for the shop login/mfa endpoints (they have no deviceId).
// Reuses the IP rate-limit binding; degrades open if it isn't configured.
async function shopRateOk(env, request) {
  if (!env.RATE_LIMITER_IP) return true;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const r = await env.RATE_LIMITER_IP.limit({ key: `shop:${ip}` });
  return r.success;
}

// Verifies a Cloudflare Turnstile token with the siteverify API. Only enforced
// when TURNSTILE_SECRET is configured; otherwise the caller skips the check so
// the app keeps working without Turnstile set up (graceful degradation).
async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error('turnstile verify error:', err);
    return false;
  }
}

function corsFor(request) {
  const origin = request.headers.get("Origin") || "";
  return {
    // Echo the origin when allowed; otherwise lock responses to the prod domain.
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "https://aimku.xyz",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = corsFor(request);

    // Handle CORS preflight request
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Check Cloudflare D1 Database binding
    if (!env.DB) {
      return new Response(
        JSON.stringify({ success: false, error: "Cloudflare D1 Database binding 'DB' not found" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // GET /api/profile?deviceId=...
    if (path === "/api/profile" && request.method === "GET") {
      const deviceId = url.searchParams.get("deviceId");
      if (!deviceId) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing required 'deviceId' parameter" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      if (!isValidDeviceId(deviceId)) {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid deviceId format" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      try {
        const { results } = await env.DB.prepare(
          "SELECT name, score, accuracy, split FROM profiles WHERE device_id = ?"
        ).bind(deviceId).all();

        if (!results || results.length === 0) {
          // fallback if profile not saved in SQLite yet
          return new Response(
            JSON.stringify({
              success: true,
              exists: false,
              data: { name: "Agent", best: { score: 0, accuracy: 0, split: 0 } }
            }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        const row = results[0];
        const profileData = {
          name: row.name,
          best: {
            score: Number(row.score) || 0,
            accuracy: Number(row.accuracy) || 0,
            split: Number(row.split) || 0
          }
        };

        return new Response(
          JSON.stringify({ success: true, exists: true, data: profileData }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch (err) {
        console.error("profile GET error:", err);
        return new Response(
          JSON.stringify({ success: false, error: "Could not fetch profile" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // POST /api/profile
    if (path === "/api/profile" && request.method === "POST") {
      try {
        const body = await request.json();
        const { deviceId, name, best } = body;

        if (!deviceId || !name || !best) {
          return new Response(
            JSON.stringify({ success: false, error: "Missing required fields: deviceId, name, best" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        if (!isValidDeviceId(deviceId)) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid deviceId format" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        const stats = validateGameStats(best);
        if (!stats.ok) {
          return new Response(
            JSON.stringify({ success: false, error: stats.error }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        if (!(await withinRateLimit(env, request, deviceId))) {
          return new Response(
            JSON.stringify({ success: false, error: "Too many requests. Please slow down." }),
            { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        const cleanName = sanitizeName(name);
        const { score, accuracy, split } = stats.values;
        const updatedAt = new Date().toISOString();

        // SQL Upsert statement
        await env.DB.prepare(`
          INSERT INTO profiles (device_id, name, score, accuracy, split, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(device_id) DO UPDATE SET
            name = excluded.name,
            score = MAX(profiles.score, excluded.score),
            accuracy = CASE WHEN excluded.score >= profiles.score THEN excluded.accuracy ELSE profiles.accuracy END,
            split = CASE WHEN excluded.score >= profiles.score THEN excluded.split ELSE profiles.split END,
            updated_at = excluded.updated_at
        `).bind(deviceId, cleanName, score, accuracy, split, updatedAt).run();

        const profileData = {
          name: cleanName,
          best: { score, accuracy, split },
          updatedAt
        };

        return new Response(
          JSON.stringify({ success: true, data: profileData }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch (err) {
        console.error("profile POST error:", err);
        return new Response(
          JSON.stringify({ success: false, error: "Could not save profile" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // POST /api/session/start — issue a signed token at game start. The token is
    // required to later submit a score, so scores can only come from a real session.
    if (path === "/api/session/start" && request.method === "POST") {
      if (!env.SESSION_SECRET) {
        return new Response(
          JSON.stringify({ success: false, error: "Score submission is not configured on the server" }),
          { status: 503, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      try {
        const { deviceId, turnstileToken } = await request.json();
        if (!isValidDeviceId(deviceId)) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid deviceId format" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        // Bot check (only enforced when Turnstile is configured). Makes farming
        // fresh device IDs in bulk much harder.
        if (env.TURNSTILE_SECRET) {
          const ip = request.headers.get('CF-Connecting-IP') || '';
          if (!(await verifyTurnstile(env.TURNSTILE_SECRET, turnstileToken, ip))) {
            return new Response(
              JSON.stringify({ success: false, error: "Bot verification failed" }),
              { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
          }
        }
        // Rate limit token issuance so an attacker can't farm tokens in bulk.
        if (!(await withinRateLimit(env, request, deviceId))) {
          return new Response(
            JSON.stringify({ success: false, error: "Too many requests. Please slow down." }),
            { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        const token = await signSession(env.SESSION_SECRET, deviceId);
        return new Response(
          JSON.stringify({ success: true, token }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch (err) {
        console.error("session start error:", err);
        return new Response(
          JSON.stringify({ success: false, error: "Could not start session" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // POST /api/score — log one finished session (feeds the weekly leaderboard)
    if (path === "/api/score" && request.method === "POST") {
      try {
        const body = await request.json();
        const { deviceId, name, score, accuracy, split, log, token, targetSize } = body;

        if (!deviceId || !name || score == null) {
          return new Response(
            JSON.stringify({ success: false, error: "Missing required fields: deviceId, name, score" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        if (!isValidDeviceId(deviceId)) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid deviceId format" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        const stats = validateGameStats({ score, accuracy, split });
        if (!stats.ok) {
          console.error("score reject (stats):", stats.error, { score, accuracy, split });
          return new Response(
            JSON.stringify({ success: false, error: stats.error }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        // Re-derive the score from the gameplay log (server-authoritative).
        // The recomputed values — not the client's claimed ones — are stored.
        const verified = verifyGameLog(log, score);
        if (!verified.ok) {
          console.error("score verify rejected:", verified.error, "hits:", log && Array.isArray(log.hits) ? log.hits.length : 'n/a');
          return new Response(
            JSON.stringify({ success: false, error: verified.error }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        if (!(await withinRateLimit(env, request, deviceId))) {
          console.error("score reject (rate limit)", deviceId);
          return new Response(
            JSON.stringify({ success: false, error: "Too many requests. Please slow down." }),
            { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        // Require a valid, single-use session token tied to this device.
        if (!env.SESSION_SECRET) {
          return new Response(
            JSON.stringify({ success: false, error: "Score submission is not configured on the server" }),
            { status: 503, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        const session = await verifySession(env.SESSION_SECRET, token);
        if (!session.ok || session.deviceId !== deviceId) {
          console.error("score reject (session):", session.ok ? "device mismatch" : session.error, "hasToken:", !!token);
          return new Response(
            JSON.stringify({ success: false, error: session.ok ? "Session token does not match device" : session.error }),
            { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        // Enforce single use: the nonce can only ever be redeemed once.
        try {
          await env.DB.prepare(
            "INSERT INTO used_sessions (nonce, used_at) VALUES (?, ?)"
          ).bind(session.nonce, new Date().toISOString()).run();
        } catch {
          console.error("score reject (nonce reused)");
          return new Response(
            JSON.stringify({ success: false, error: "Session token already used" }),
            { status: 409, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        // Opportunistically purge expired nonces so the table can't grow forever.
        if (Math.random() < 0.02) {
          const cutoff = new Date(Date.now() - TOKEN_MAX_AGE_MS).toISOString();
          ctx.waitUntil(
            env.DB.prepare("DELETE FROM used_sessions WHERE used_at < ?").bind(cutoff).run().catch(() => {})
          );
        }

        // Mode/size are display + filter metadata (not part of score derivation),
        // so they're trusted but bounded: unknown mode or implausible size → NULL.
        const mode = log && RANKED_MODES.has(log.mode) ? log.mode : null;
        const sizeNum = Number(targetSize);
        const safeSize = Number.isFinite(sizeNum) && sizeNum > 0 && sizeNum <= 2 ? sizeNum : null;

        await env.DB.prepare(
          "INSERT INTO scores (device_id, name, score, accuracy, split, mode, target_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          deviceId,
          sanitizeName(name),
          verified.score,
          verified.accuracy,
          verified.split,
          mode,
          safeSize,
          new Date().toISOString()
        ).run();

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch (err) {
        console.error("score POST error:", err);
        return new Response(
          JSON.stringify({ success: false, error: "Could not save score" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // GET /api/rank?deviceId=... — the device's 1-based rank on the weekly
    // leaderboard (by best score in the last 7 days). null if it has no scores
    // this week. Used by the shareable score card.
    if (path === "/api/rank" && request.method === "GET") {
      const deviceId = url.searchParams.get("deviceId");
      if (!isValidDeviceId(deviceId)) {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid deviceId format" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      try {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { results } = await env.DB.prepare(`
          WITH best AS (
            SELECT device_id, MAX(score) AS s
            FROM scores WHERE created_at >= ? GROUP BY device_id
          )
          SELECT (SELECT COUNT(*) FROM best b2 WHERE b2.s > b1.s) + 1 AS rank, b1.s AS score
          FROM best b1 WHERE b1.device_id = ?
        `).bind(weekAgo, deviceId).all();
        const row = results && results.length ? results[0] : null;
        const rank = row ? Number(row.rank) : null;
        const score = row ? Number(row.score) : null;
        return new Response(
          JSON.stringify({ success: true, rank, score }),
          { headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=30", ...corsHeaders } }
        );
      } catch (err) {
        console.error("rank error:", err);
        return new Response(
          JSON.stringify({ success: false, error: "Could not fetch rank" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // GET /api/leaderboard[?range=all] — top 10 scores. Defaults to the last 7
    // days; range=all returns the all-time top 10.
    // SQLite "bare column" rule: with a single MAX(), the name/accuracy/split
    // columns are taken from the same row as that max score (one per device).
    if (path === "/api/leaderboard" && request.method === "GET") {
      try {
        const allTime = url.searchParams.get("range") === "all";
        const since = allTime ? "1970-01-01T00:00:00.000Z"
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        // A specific, known mode → the fair per-mode board: filtered to that mode
        // and the standard target-size band. Otherwise → the overall "All" board.
        const modeParam = url.searchParams.get("mode");
        const perMode = modeParam && RANKED_MODES.has(modeParam);

        const where = perMode
          ? "s.created_at >= ? AND s.mode = ? AND s.target_size >= ? AND s.target_size <= ?"
          : "s.created_at >= ?";
        const binds = perMode
          ? [since, modeParam, RANKED_SIZE_MIN, RANKED_SIZE_MAX]
          : [since];

        const { results } = await env.DB.prepare(`
          SELECT s.device_id, COALESCE(p.name, s.name) AS name, MAX(s.score) AS score, s.accuracy, s.split, s.target_size
          FROM scores s
          LEFT JOIN profiles p ON s.device_id = p.device_id
          WHERE ${where}
          GROUP BY s.device_id
          ORDER BY score DESC
          LIMIT 10
        `).bind(...binds).all();

        const data = (results || []).map((row) => ({
          deviceId: row.device_id,
          name: row.name,
          score: Number(row.score) || 0,
          accuracy: Number(row.accuracy) || 0,
          split: Number(row.split) || 0,
          targetSize: row.target_size == null ? null : Number(row.target_size),
        }));

        return new Response(
          JSON.stringify({ success: true, data }),
          { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=30", ...corsHeaders } }
        );
      } catch (err) {
        console.error("leaderboard error:", err);
        return new Response(
          JSON.stringify({ success: false, error: "Could not fetch leaderboard" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // POST /api/saweria-webhook?token=... — receives a donation from Saweria's
    // webhook integration and stores it. Protected by a shared secret in the URL
    // (DONATION_WEBHOOK_SECRET) since the endpoint is public. Inert until the
    // secret is configured.
    if (path === "/api/saweria-webhook" && request.method === "POST") {
      if (!env.DONATION_WEBHOOK_SECRET) {
        return new Response(
          JSON.stringify({ success: false, error: "Donations webhook is not configured" }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }
      const token = url.searchParams.get("token") || "";
      if (!timingSafeEqual(token, env.DONATION_WEBHOOK_SECRET)) {
        return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
          status: 401, headers: { "Content-Type": "application/json" },
        });
      }
      try {
        const body = await request.json();
        const id = String(body.id || crypto.randomUUID()).slice(0, 80);
        const name = sanitizeName(body.donator_name || body.name || "Anonim");
        const amount = Math.max(0, Math.round(Number(body.amount_raw ?? body.amount ?? 0)) || 0);
        const message = String(body.message || "")
          .replace(/[\u0000-\u001F\u007F<>]/g, "").trim().slice(0, 140);
        // Email keys the aggregation: repeat donors from the same email get their
        // amounts summed and their displayed name updated to the latest one.
        const email = String(body.donator_email || body.email || "")
          .replace(/[\u0000-\u001F\u007F<>]/g, "").trim().slice(0, 120).toLowerCase();
        const createdAt = body.created_at ? String(body.created_at).slice(0, 40) : new Date().toISOString();

        // INSERT OR IGNORE dedupes if Saweria retries the same transaction id.
        await env.DB.prepare(
          "INSERT OR IGNORE INTO donations (id, name, amount, message, email, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(id, name, amount, message, email, createdAt).run();

        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error("saweria webhook error:", err);
        return new Response(JSON.stringify({ success: false, error: "Could not record donation" }), {
          status: 500, headers: { "Content-Type": "application/json" },
        });
      }
    }

    // GET /api/donations — top donations (largest first) for the supporters card.
    if (path === "/api/donations" && request.method === "GET") {
      try {
        // Aggregate by email: donors sharing an email have their amounts summed
        // and show their most recent name. Rows without an email stay separate
        // (grouped by their own id). Largest total first.
        const { results } = await env.DB.prepare(`
          SELECT name, total AS amount, last_at AS created_at FROM (
            SELECT
              name,
              SUM(amount) OVER (PARTITION BY grp) AS total,
              MAX(created_at) OVER (PARTITION BY grp) AS last_at,
              ROW_NUMBER() OVER (PARTITION BY grp ORDER BY created_at DESC, rowid DESC) AS rn
            FROM (
              SELECT name, amount, created_at, rowid,
                     COALESCE(NULLIF(email, ''), 'id:' || id) AS grp
              FROM donations
            )
          )
          WHERE rn = 1
          ORDER BY amount DESC, created_at DESC
          LIMIT 20
        `).all();
        const data = (results || []).map((r) => ({
          name: r.name,
          amount: Number(r.amount) || 0,
          createdAt: r.created_at,
        }));
        return new Response(
          JSON.stringify({ success: true, data }),
          { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", ...corsHeaders } }
        );
      } catch (err) {
        console.error("donations error:", err);
        return new Response(
          JSON.stringify({ success: false, error: "Could not fetch donations" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // GET /api/backgrounds — list landing-page background images stored in R2.
    // The client rotates through these by date. Returns relative paths the
    // client resolves against the API origin.
    if (path === "/api/backgrounds" && request.method === "GET") {
      try {
        if (!env.BG_BUCKET) {
          return new Response(JSON.stringify({ success: true, images: [] }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } });
        }
        const list = await env.BG_BUCKET.list({ limit: 100 });
        const images = (list.objects || [])
          .map((o) => o.key)
          .sort()
          .map((k) => `/api/bg/${encodeURIComponent(k)}`);
        return new Response(
          JSON.stringify({ success: true, images }),
          { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600", ...corsHeaders } }
        );
      } catch (err) {
        console.error("backgrounds list error:", err);
        return new Response(JSON.stringify({ success: false, images: [] }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
    }

    // GET /api/bg/<key> — stream one background image from R2 (cached at edge).
    if (path.startsWith("/api/bg/") && request.method === "GET") {
      if (!env.BG_BUCKET) return new Response("Not Found", { status: 404, headers: corsHeaders });
      const key = decodeURIComponent(path.slice("/api/bg/".length));
      try {
        const obj = await env.BG_BUCKET.get(key);
        if (!obj) return new Response("Not Found", { status: 404, headers: corsHeaders });
        return new Response(obj.body, {
          headers: {
            "Content-Type": obj.httpMetadata?.contentType || "image/webp",
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (err) {
        console.error("bg fetch error:", err);
        return new Response("Error", { status: 500, headers: corsHeaders });
      }
    }

    // POST /api/shop/login — check a user's VALORANT store. Body: { username,
    // password, turnstileToken? }. On success returns the daily shop; if the
    // account has 2FA it returns { mfaRequired: true, mfaSession } instead, and
    // the client must call /api/shop/mfa with the emailed code.
    //
    // NOTE: this uses Riot's unofficial/internal API and violates Riot's ToS.
    // It is a personal/learning feature. The password is used once to obtain a
    // token and is never stored or logged.
    if (path === "/api/shop/login" && request.method === "POST") {
      if (!env.SHOP_SECRET) {
        return new Response(
          JSON.stringify({ success: false, error: "Shop checker belum dikonfigurasi di server" }),
          { status: 503, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      try {
        const { username, password, turnstileToken } = await request.json();
        if (!username || !password) {
          return new Response(
            JSON.stringify({ success: false, error: "Username dan password wajib diisi" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        // Optional bot check (only when Turnstile is configured).
        if (env.TURNSTILE_SECRET) {
          const ip = request.headers.get('CF-Connecting-IP') || '';
          if (!(await verifyTurnstile(env.TURNSTILE_SECRET, turnstileToken, ip))) {
            return new Response(
              JSON.stringify({ success: false, error: "Verifikasi bot gagal" }),
              { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
          }
        }
        if (!(await shopRateOk(env, request))) {
          return new Response(
            JSON.stringify({ success: false, error: "Terlalu banyak percobaan. Pelan-pelan ya." }),
            { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        const result = await riotLogin(String(username), String(password));
        if (result.status === "ok") {
          return new Response(
            JSON.stringify({ success: true, shop: result.shop }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        if (result.status === "mfa") {
          const mfaSession = await shopEncrypt(env.SHOP_SECRET, { jar: result.jar, ts: Date.now() });
          return new Response(
            JSON.stringify({ success: true, mfaRequired: true, mfaSession, email: result.email }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        return new Response(
          JSON.stringify({ success: false, error: result.error }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch (err) {
        console.error("shop login error:", err);
        return new Response(
          JSON.stringify({ success: false, error: "Gagal login ke Riot" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // POST /api/shop/mfa — finish a 2FA login. Body: { mfaSession, code }.
    // mfaSession is the encrypted cookie jar issued by /api/shop/login.
    if (path === "/api/shop/mfa" && request.method === "POST") {
      if (!env.SHOP_SECRET) {
        return new Response(
          JSON.stringify({ success: false, error: "Shop checker belum dikonfigurasi di server" }),
          { status: 503, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      try {
        const { mfaSession, code } = await request.json();
        if (!mfaSession || !code) {
          return new Response(
            JSON.stringify({ success: false, error: "Sesi 2FA atau kode tidak ada" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        if (!(await shopRateOk(env, request))) {
          return new Response(
            JSON.stringify({ success: false, error: "Terlalu banyak percobaan. Pelan-pelan ya." }),
            { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        let payload;
        try {
          payload = await shopDecrypt(env.SHOP_SECRET, mfaSession);
        } catch {
          return new Response(
            JSON.stringify({ success: false, error: "Sesi 2FA tidak valid" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        // Short TTL: the emailed code and its session are only good briefly.
        if (!payload || !payload.jar || Date.now() - Number(payload.ts) > 5 * 60 * 1000) {
          return new Response(
            JSON.stringify({ success: false, error: "Sesi 2FA kadaluarsa. Login ulang." }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        const result = await riotSubmitMfa(payload.jar, String(code));
        if (result.status === "ok") {
          return new Response(
            JSON.stringify({ success: true, shop: result.shop }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        return new Response(
          JSON.stringify({ success: false, error: result.error }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch (err) {
        console.error("shop mfa error:", err);
        return new Response(
          JSON.stringify({ success: false, error: "Gagal verifikasi 2FA" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};
