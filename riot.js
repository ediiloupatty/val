// riot.js — VALORANT storefront client for the Worker (OAuth implicit flow).
//
// We do NOT take the user's password. Instead the user logs in on Riot's own
// page via the official `riot-client` OAuth client, which permits a localhost
// redirect. Riot then redirects to http://localhost/redirect#access_token=...
// The user copies that URL; we extract the tokens and use them to read the
// store. This sidesteps Riot's hCaptcha wall entirely (Riot's page handles the
// captcha + 2FA) and the password never touches our server.
//
// The access token is short-lived (~1h) and only used to read the store, so we
// don't persist anything.

const ENTITLEMENT_URL = 'https://entitlements.auth.riotgames.com/api/token/v1';
const GEO_URL = 'https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant';
const VAPI = 'https://valorant-api.com/v1';

// The URL the user opens to log in. client_id=riot-client + the localhost
// redirect is what makes this work without being an approved Riot developer.
export const AUTH_URL =
  'https://auth.riotgames.com/authorize' +
  '?redirect_uri=http%3A%2F%2Flocalhost%2Fredirect' +
  '&client_id=riot-client' +
  '&response_type=token%20id_token' +
  '&nonce=1' +
  '&scope=openid%20link%20ban%20lol_region%20account' +
  '&prompt=login';

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

// Fallback build string if valorant-api.com is unreachable. The store endpoint
// tolerates a slightly stale X-Riot-ClientVersion, so this keeps things working.
const FALLBACK_VERSION = 'release-09.00-shipping-9-2444158';

// region -> shard mapping for the pd.<shard>.a.pvp.net data endpoints.
function shardFor(region) {
  if (region === 'latam' || region === 'br') return 'na';
  return region; // na, eu, ap, kr
}

// Decode a JWT payload segment (base64url, no signature check — we only read it).
function jwtPayload(token) {
  const seg = (token || '').split('.')[1] || '';
  const pad = seg.length % 4 ? '='.repeat(4 - (seg.length % 4)) : '';
  return JSON.parse(atob(seg.replace(/-/g, '+').replace(/_/g, '/') + pad));
}

// Pull access_token + id_token out of a pasted redirect URL (or bare fragment).
// The redirect looks like: http://localhost/redirect#access_token=...&id_token=...
export function extractTokens(url) {
  const raw = String(url || '');
  const frag = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : raw;
  const p = new URLSearchParams(frag);
  return { accessToken: p.get('access_token'), idToken: p.get('id_token') || '' };
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

// Resolve a skin-level UUID to a display name + icon via the community
// valorant-api.com (a legal, stable metadata source).
async function resolveSkin(levelId) {
  try {
    const res = await fetch(`${VAPI}/weapons/skinlevels/${levelId}`);
    const j = await res.json();
    return { name: j.data?.displayName || 'Unknown skin', image: j.data?.displayIcon || null };
  } catch {
    return { name: 'Unknown skin', image: null };
  }
}

// Given the tokens from the redirect, fetch entitlement/region/store/wallet.
// Returns { status: 'ok', shop } | { status: 'error', error }.
export async function fetchShop({ accessToken, idToken }) {
  if (!accessToken) return { status: 'error', error: 'Token tidak ditemukan di URL' };

  // Entitlement token — required alongside the access token for game endpoints.
  const entRes = await fetch(ENTITLEMENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({}),
  });
  if (!entRes.ok) {
    return {
      status: 'error',
      error:
        entRes.status === 401 || entRes.status === 400
          ? 'Token sudah kadaluarsa. Login ulang lewat Riot.'
          : `Gagal ambil entitlement (HTTP ${entRes.status})`,
    };
  }
  const entData = await entRes.json().catch(() => ({}));
  const entitlement = entData.entitlements_token;
  if (!entitlement) return { status: 'error', error: 'Gagal mengambil entitlement token' };

  let puuid;
  try {
    puuid = jwtPayload(accessToken).sub;
  } catch {
    return { status: 'error', error: 'Token login tidak valid' };
  }
  if (!puuid) return { status: 'error', error: 'Gagal membaca PUUID akun' };

  // Region/shard via the PAS (geo affinity) token.
  let region = 'na';
  try {
    const geoRes = await fetch(GEO_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ id_token: idToken }),
    });
    const geo = await geoRes.json().catch(() => ({}));
    region = geo.affinities?.live || 'na';
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
  const offers = panel.SingleItemStoreOffers || [];
  const remaining = panel.SingleItemOffersRemainingDurationInSeconds || 0;

  const skins = await Promise.all(
    offers.map(async (offer) => {
      // The real skin UUID is usually in Rewards[0].ItemID; fall back to OfferID.
      const itemId = offer.Rewards?.[0]?.ItemID || offer.OfferID;
      const meta = await resolveSkin(itemId);
      return {
        id: offer.OfferID || itemId,
        name: meta.name,
        image: meta.image,
        price: offer.Cost?.[VP_CURRENCY] ?? null,
      };
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
