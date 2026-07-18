// riot.js — Unofficial Riot / VALORANT auth + storefront client for the Worker.
//
// This talks to Riot's *internal* game API (the same endpoints the VALORANT
// client uses). There is no official public store API, so everything here is
// reverse-engineered and can break whenever Riot changes their auth flow.
//
// Flow implemented:
//   1. authRequestCookies()  -> hit the auth endpoint to get session cookies
//   2. submitCredentials()   -> POST username/password
//        - "response"    => logged in, tokens are in the redirect URI fragment
//        - "multifactor" => a 2FA email code is required (submitMfaCode next)
//        - "auth"+error  => wrong credentials / rate limited
//   3. buildShop(tokens)     -> entitlement + region + storefront + wallet
//
// IMPORTANT: this module never stores or logs the password. It is used once to
// obtain a short-lived access token and then discarded.

const AUTH_URL = 'https://auth.riotgames.com/api/v1/authorization';
const ENTITLEMENT_URL = 'https://entitlements.auth.riotgames.com/api/token/v1';
const GEO_URL = 'https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant';
const VAPI = 'https://valorant-api.com/v1';

// Currency UUIDs used in wallet balances / store offer costs.
const VP_CURRENCY = '85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741';   // Valorant Points
const RAD_CURRENCY = 'e59aa87c-4cbf-517a-5983-6e81511be9b7';  // Radianite
const KC_CURRENCY = '85ca954a-41f2-ce94-9b45-8ca3dd39a00d';   // Kingdom Credits

// Static client descriptor Riot expects in X-Riot-ClientPlatform (base64 JSON).
const CLIENT_PLATFORM = btoa(JSON.stringify({
  platformType: 'PC',
  platformOS: 'Windows',
  platformOSVersion: '10.0.19042.1.256.64bit',
  platformChipset: 'Unknown',
}));

// A Riot-client-looking UA. The auth endpoint is picky about non-browser callers.
const USER_AGENT =
  'RiotClient/63.0.9.4909983.4789131 rso-auth (Windows;10;;Professional, x64)';

// Fallback build string if valorant-api.com is unreachable. The store endpoint
// tolerates a slightly stale X-Riot-ClientVersion, so this keeps things working.
const FALLBACK_VERSION = 'release-09.00-shipping-9-2444158';

// --- cookie jar helpers ----------------------------------------------------
// Cloudflare Workers' fetch has no cookie jar, so we carry cookies by hand:
// read Set-Cookie off each response and replay them on the next request.
function mergeSetCookies(res, jar = {}) {
  const list =
    typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const pair = c.split(';', 1)[0];
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return jar;
}
function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// Decode a JWT payload segment (base64url, no signature check — we only read it).
function jwtPayload(token) {
  const seg = token.split('.')[1] || '';
  const pad = seg.length % 4 ? '='.repeat(4 - (seg.length % 4)) : '';
  return JSON.parse(atob(seg.replace(/-/g, '+').replace(/_/g, '/') + pad));
}

// Riot returns tokens in the fragment of a redirect URI:
//   https://playvalorant.com/opt_in#access_token=...&id_token=...&...
function tokensFromUri(uri) {
  const frag = (uri || '').split('#')[1] || '';
  const p = new URLSearchParams(frag);
  return { accessToken: p.get('access_token'), idToken: p.get('id_token') };
}

// region -> shard mapping for the pd.<shard>.a.pvp.net data endpoints.
function shardFor(region) {
  if (region === 'latam' || region === 'br') return 'na';
  return region; // na, eu, ap, kr
}

async function clientVersion() {
  try {
    const res = await fetch(`${VAPI}/version`);
    const j = await res.json();
    return j.data?.riotClientVersion || FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

// Resolve a store offer's skin-level UUID to a display name + icon via the
// community valorant-api.com (this part is a legal, stable metadata source).
async function resolveSkin(levelId) {
  try {
    const res = await fetch(`${VAPI}/weapons/skinlevels/${levelId}`);
    const j = await res.json();
    return { name: j.data?.displayName || 'Unknown skin', image: j.data?.displayIcon || null };
  } catch {
    return { name: 'Unknown skin', image: null };
  }
}

// --- auth steps ------------------------------------------------------------
export async function authRequestCookies() {
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      client_id: 'play-valorant-web-prod',
      nonce: '1',
      redirect_uri: 'https://playvalorant.com/opt_in',
      response_type: 'token id_token',
      scope: 'account openid',
    }),
  });
  return mergeSetCookies(res);
}

async function submitCredentials(jar, username, password) {
  const res = await fetch(AUTH_URL, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      Cookie: cookieHeader(jar),
    },
    body: JSON.stringify({
      type: 'auth',
      username,
      password,
      remember: false,
      language: 'en_US',
    }),
  });
  mergeSetCookies(res, jar);
  const data = await res.json().catch(() => ({}));
  return data;
}

async function submitMfa(jar, code) {
  const res = await fetch(AUTH_URL, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      Cookie: cookieHeader(jar),
    },
    body: JSON.stringify({ type: 'multifactor', code: String(code), rememberDevice: false }),
  });
  mergeSetCookies(res, jar);
  const data = await res.json().catch(() => ({}));
  return data;
}

// --- storefront ------------------------------------------------------------
async function buildShop({ accessToken, idToken }) {
  // Entitlement token — required alongside the access token for game endpoints.
  const entRes = await fetch(ENTITLEMENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({}),
  });
  const entData = await entRes.json().catch(() => ({}));
  const entitlement = entData.entitlements_token;
  if (!entitlement) return { status: 'error', error: 'Gagal mengambil entitlement token' };

  const puuid = jwtPayload(accessToken).sub;
  if (!puuid) return { status: 'error', error: 'Gagal membaca PUUID akun' };

  // Region/shard via the PAS (geo affinity) token.
  let region = 'na';
  try {
    const geoRes = await fetch(GEO_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ id_token: idToken }),
    });
    const geoJwt = await geoRes.text();
    region = jwtPayload(geoJwt).affinities?.live || 'na';
  } catch {
    /* fall back to na */
  }
  const shard = shardFor(region);
  const version = await clientVersion();

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'X-Riot-Entitlements-JWT': entitlement,
    'X-Riot-ClientPlatform': CLIENT_PLATFORM,
    'X-Riot-ClientVersion': version,
  };

  // Daily storefront (v3 requires a POST with a body).
  const storeRes = await fetch(`https://pd.${shard}.a.pvp.net/store/v3/storefront/${puuid}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  if (!storeRes.ok) {
    return { status: 'error', error: `Gagal mengambil toko (HTTP ${storeRes.status})` };
  }
  const store = await storeRes.json();

  const panel = store.SkinsPanelLayout || {};
  const offerIds = panel.SingleItemOffers || [];
  const offers = panel.SingleItemStoreOffers || [];
  const remaining = panel.SingleItemOffersRemainingDurationInSeconds || 0;

  const costById = {};
  for (const o of offers) costById[o.OfferID] = o.Cost?.[VP_CURRENCY] ?? null;

  const skins = await Promise.all(
    offerIds.map(async (id) => {
      const meta = await resolveSkin(id);
      return { id, name: meta.name, image: meta.image, price: costById[id] ?? null };
    })
  );

  // Wallet (best-effort — a failure here shouldn't sink the whole response).
  let wallet = { vp: null, radianite: null, kingdom: null };
  try {
    const wRes = await fetch(`https://pd.${shard}.a.pvp.net/store/v1/wallet/${puuid}`, { headers });
    if (wRes.ok) {
      const b = (await wRes.json()).Balances || {};
      wallet = {
        vp: b[VP_CURRENCY] ?? null,
        radianite: b[RAD_CURRENCY] ?? null,
        kingdom: b[KC_CURRENCY] ?? null,
      };
    }
  } catch {
    /* ignore wallet errors */
  }

  return { status: 'ok', shop: { region, remaining, skins, wallet } };
}

// --- interpret an auth response into a normalized result -------------------
async function interpret(data, jar) {
  if (data.type === 'response') {
    const tokens = tokensFromUri(data.response?.parameters?.uri);
    if (!tokens.accessToken) return { status: 'error', error: 'Gagal membaca token login' };
    return buildShop(tokens);
  }
  if (data.type === 'multifactor') {
    return { status: 'mfa', jar, email: data.multifactor?.email || null };
  }
  if (data.error === 'auth_failure') {
    return { status: 'error', error: 'Username atau password salah' };
  }
  if (data.error === 'rate_limited') {
    return { status: 'error', error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' };
  }
  if (data.error) {
    return { status: 'error', error: `Login gagal: ${data.error}` };
  }
  return {
    status: 'error',
    error: 'Login gagal (respons tak dikenali). Riot mungkin memblokir permintaan dari server.',
  };
}

// --- public entry points ---------------------------------------------------
// Returns one of:
//   { status: 'ok',   shop }
//   { status: 'mfa',  jar, email }   -> caller must follow up with submitMfaCode
//   { status: 'error', error }
export async function login(username, password) {
  const jar = await authRequestCookies();
  const data = await submitCredentials(jar, username, password);
  return interpret(data, jar);
}

// Returns { status: 'ok', shop } | { status: 'error', error }.
export async function submitMfaCode(jar, code) {
  const data = await submitMfa(jar, code);
  if (data.type === 'response') {
    const tokens = tokensFromUri(data.response?.parameters?.uri);
    if (!tokens.accessToken) return { status: 'error', error: 'Gagal membaca token login' };
    return buildShop(tokens);
  }
  if (data.type === 'multifactor') return { status: 'error', error: 'Kode 2FA salah' };
  return { status: 'error', error: 'Verifikasi 2FA gagal' };
}
