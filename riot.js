// riot.js — VALORANT account client for the Worker (OAuth implicit flow).
//
// We do NOT take the user's password. The user logs in on Riot's own page via
// the official `riot-client` OAuth client (which permits a localhost redirect),
// then pastes the redirect URL. We extract the tokens and use them to read the
// store, inventory, battlepass, and account data. This sidesteps Riot's hCaptcha
// wall entirely and the password never touches our server.
//
// The access token is short-lived (~1h). We never persist it server-side; the
// browser holds it and sends it on each request until it expires or logout.

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

// Currency UUIDs.
const VP_CURRENCY = '85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741';   // Valorant Points
const RAD_CURRENCY = 'e59aa87c-4cbf-517a-5983-6e81511be9b7';  // Radianite
const KC_CURRENCY = '85ca954a-41f2-ce94-9b45-8ca3dd39a00d';   // Kingdom Credits

// Entitlement item-type UUIDs (what "count owned" queries against).
const ITEM_TYPES = {
  agents: '01bb38e1-da47-4e6a-9b3d-945fe4655707',
  skins: 'e7c63390-eda7-46e0-bb7a-a6abdacd2433', // skin *levels*
  sprays: 'd5f120f8-ff8c-4aac-92ea-f2b5acbe9475',
  buddies: 'dd3bf334-87f3-40bd-b043-682a57a8dc3a',
  cards: '3f296c07-64c3-494c-923b-fe692a4fa1bd',
  titles: 'de7caa6b-adf7-4588-bbd1-143831e786c6',
};

// Static client descriptor Riot expects in X-Riot-ClientPlatform (base64 JSON).
const CLIENT_PLATFORM = btoa(JSON.stringify({
  platformType: 'PC',
  platformOS: 'Windows',
  platformOSVersion: '10.0.19042.1.256.64bit',
  platformChipset: 'Unknown',
}));

const FALLBACK_VERSION = 'release-09.00-shipping-9-2444158';

function shardFor(region) {
  if (region === 'latam' || region === 'br') return 'na';
  return region; // na, eu, ap, kr
}

function jwtPayload(token) {
  const seg = (token || '').split('.')[1] || '';
  const pad = seg.length % 4 ? '='.repeat(4 - (seg.length % 4)) : '';
  return JSON.parse(atob(seg.replace(/-/g, '+').replace(/_/g, '/') + pad));
}

// Pull access_token + id_token out of a pasted redirect URL (or bare fragment).
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

async function resolveSkin(levelId) {
  try {
    const res = await fetch(`${VAPI}/weapons/skinlevels/${levelId}`);
    const j = await res.json();
    return { name: j.data?.displayName || 'Unknown skin', image: j.data?.displayIcon || null };
  } catch {
    return { name: 'Unknown skin', image: null };
  }
}

async function resolveRank(tier) {
  if (!tier || tier <= 0) return { tier: 0, name: 'Unranked', icon: null, color: null };
  try {
    const res = await fetch(`${VAPI}/competitivetiers`);
    const j = await res.json();
    const episodes = j.data || [];
    const current = episodes[episodes.length - 1];
    const t = (current?.tiers || []).find((x) => x.tier === tier);
    if (!t) return { tier, name: 'Unranked', icon: null, color: null };
    return {
      tier,
      name: t.tierName || 'Unranked',
      icon: t.largeIcon || null,
      color: t.color ? `#${t.color.slice(0, 6)}` : null,
    };
  } catch {
    return { tier, name: 'Unranked', icon: null, color: null };
  }
}

// --- shared setup ----------------------------------------------------------
// Given the redirect tokens, obtain entitlement + region + a ready header set.
// Returns { ok: true, headers, shard, puuid } | { ok: false, error }.
async function prepare({ accessToken, idToken }) {
  if (!accessToken) return { ok: false, error: 'Token tidak ditemukan di URL' };

  const entRes = await fetch(ENTITLEMENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({}),
  });
  if (!entRes.ok) {
    return {
      ok: false,
      error:
        entRes.status === 401 || entRes.status === 400
          ? 'expired'
          : `Gagal ambil entitlement (HTTP ${entRes.status})`,
    };
  }
  const entData = await entRes.json().catch(() => ({}));
  const entitlement = entData.entitlements_token;
  if (!entitlement) return { ok: false, error: 'Gagal mengambil entitlement token' };

  let puuid;
  try {
    puuid = jwtPayload(accessToken).sub;
  } catch {
    return { ok: false, error: 'Token login tidak valid' };
  }
  if (!puuid) return { ok: false, error: 'Gagal membaca PUUID akun' };

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
  const version = await clientVersion();

  return {
    ok: true,
    shard: shardFor(region),
    region,
    puuid,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Riot-Entitlements-JWT': entitlement,
      'X-Riot-ClientPlatform': CLIENT_PLATFORM,
      'X-Riot-ClientVersion': version,
    },
  };
}

function pdUrl(shard, path) {
  return `https://pd.${shard}.a.pvp.net${path}`;
}

// Resolve to `fallback` if `promise` doesn't settle within `ms`, so one slow
// Riot endpoint can't stall the whole dashboard — it just yields partial data.
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// --- data fetchers (each takes a prepared context) -------------------------
async function getWallet(headers, shard, puuid) {
  try {
    const res = await fetch(pdUrl(shard, `/store/v1/wallet/${puuid}`), { headers });
    if (!res.ok) return { vp: null, radianite: null, kingdom: null };
    const b = (await res.json()).Balances || {};
    return { vp: b[VP_CURRENCY] ?? null, radianite: b[RAD_CURRENCY] ?? null, kingdom: b[KC_CURRENCY] ?? null };
  } catch {
    return { vp: null, radianite: null, kingdom: null };
  }
}

async function getIdentity(headers, shard, puuid) {
  const [nameData, loadout, mmr] = await Promise.all([
    fetch(pdUrl(shard, '/name-service/v2/players'), { method: 'PUT', headers, body: JSON.stringify([puuid]) })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(pdUrl(shard, `/personalization/v2/players/${puuid}/playerloadout`), { headers })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(pdUrl(shard, `/mmr/v1/players/${puuid}`), { headers })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  const nm = Array.isArray(nameData) ? nameData[0] : null;
  const gameName = nm?.GameName || null;
  const tagLine = nm?.TagLine || null;
  const cardId = loadout?.Identity?.PlayerCardID || null;
  const card = cardId ? `https://media.valorant-api.com/playercards/${cardId}/smallart.png` : null;
  const level = loadout?.Identity?.AccountLevel || null;

  let tier = mmr?.LatestCompetitiveUpdate?.TierAfterUpdate || 0;
  const seasons = mmr?.QueueSkills?.competitive?.SeasonalInfoBySeasonID;
  if (!tier && seasons) {
    tier = Object.values(seasons).reduce((mx, s) => Math.max(mx, s?.CompetitiveTier || 0), 0);
  }
  const rank = await resolveRank(tier);

  return {
    gameName,
    tagLine,
    displayName: gameName ? (tagLine ? `${gameName}#${tagLine}` : gameName) : null,
    card,
    level,
    rank,
  };
}

// Owned ItemIDs for one entitlement type.
async function getEntitlements(headers, shard, puuid, itemTypeId) {
  try {
    const res = await fetch(pdUrl(shard, `/store/v1/entitlements/${puuid}/${itemTypeId}`), { headers });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.Entitlements || []).map((e) => e.ItemID);
  } catch {
    return [];
  }
}

// Riot removed the live price catalog (/store/v1/offers/ now 404s), so we
// estimate a skin's price from its content tier. VALORANT prices are fixed per
// edition; melee skins cost more. This is an estimate, clearly labelled as such.
const MELEE_WEAPON_UUID = '2f59173c-4bed-b6c3-2191-dea9b58be9c7';
const TIER_PRICE = {
  '12683d76-48d7-84a3-4e09-6985794f0445': 875,  // Select
  '0cebb8be-46d7-c12a-d306-e9907bfc5a25': 1275, // Deluxe
  '60bca009-4182-7998-dee7-b8a2558dc369': 1775, // Premium
  'e046854e-406c-37f4-6607-19a9ba8426fc': 2175, // Exclusive
  '411e4a55-4e59-7757-41f0-86a53f101bb5': 2475, // Ultra
};
const TIER_PRICE_MELEE = {
  '12683d76-48d7-84a3-4e09-6985794f0445': 1750,
  '0cebb8be-46d7-c12a-d306-e9907bfc5a25': 2550,
  '60bca009-4182-7998-dee7-b8a2558dc369': 3550,
  'e046854e-406c-37f4-6607-19a9ba8426fc': 4350,
  '411e4a55-4e59-7757-41f0-86a53f101bb5': 4950,
};

function estimateSkinPrice(entry) {
  if (!entry?.tier) return null; // no content tier => default/free skin
  return (entry.isMelee ? TIER_PRICE_MELEE : TIER_PRICE)[entry.tier] ?? null;
}

// Build skin-level UUID -> { uuid, name, image, tier, isMelee } from the
// community weapons list (one call). Used to resolve owned entitlements and to
// estimate prices. Returns {} on failure.
async function getWeaponSkinIndex() {
  const index = {};
  try {
    const res = await fetch(`${VAPI}/weapons`);
    if (!res.ok) return index;
    const data = (await res.json()).data || [];
    for (const weapon of data) {
      const isMelee = weapon.uuid === MELEE_WEAPON_UUID;
      for (const skin of weapon.skins || []) {
        const entry = {
          uuid: skin.uuid,
          name: skin.displayName || 'Unknown skin',
          image: skin.displayIcon || skin.levels?.[0]?.displayIcon || null,
          tier: skin.contentTierUuid || null,
          isMelee,
        };
        for (const lvl of skin.levels || []) if (lvl.uuid) index[lvl.uuid] = entry;
        for (const ch of skin.chromas || []) if (ch.uuid) index[ch.uuid] = entry;
      }
    }
  } catch {
    /* ignore */
  }
  return index;
}

// Skin inventory summary: count of priced skins owned + total VP value.
async function getInventory(headers, shard, puuid) {
  const [owned, index] = await Promise.all([
    getEntitlements(headers, shard, puuid, ITEM_TYPES.skins),
    getWeaponSkinIndex(),
  ]);
  const seen = new Set();
  let collectionValueVp = 0;
  let pricedSkinCount = 0;
  for (const levelId of owned) {
    const entry = index[levelId];
    if (!entry || seen.has(entry.uuid)) continue;
    seen.add(entry.uuid);
    const price = estimateSkinPrice(entry);
    if (price != null) {
      collectionValueVp += price;
      pricedSkinCount += 1;
    }
  }
  return {
    totalSkinEntitlements: owned.length,
    ownedSkinCount: seen.size,
    pricedSkinCount,
    collectionValueVp,
  };
}

async function getAccount(headers, shard, puuid) {
  const [xp, agents, sprays, cards, buddies, titles] = await Promise.all([
    fetch(pdUrl(shard, `/account-xp/v1/players/${puuid}`), { headers })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null),
    getEntitlements(headers, shard, puuid, ITEM_TYPES.agents),
    getEntitlements(headers, shard, puuid, ITEM_TYPES.sprays),
    getEntitlements(headers, shard, puuid, ITEM_TYPES.cards),
    getEntitlements(headers, shard, puuid, ITEM_TYPES.buddies),
    getEntitlements(headers, shard, puuid, ITEM_TYPES.titles),
  ]);
  return {
    level: xp?.Progress?.Level ?? null,
    xp: xp?.Progress?.XP ?? null,
    agentCount: agents.length,
    sprayCount: sprays.length,
    cardCount: cards.length,
    buddyCount: buddies.length,
    titleCount: titles.length,
  };
}

// Current battlepass tier + total tiers. Best-effort: identifies the active
// battlepass contract by matching the current act via the community API.
async function getBattlepass(headers, shard, puuid) {
  try {
    const [contractsRes, seasons, defs] = await Promise.all([
      fetch(pdUrl(shard, `/contracts/v1/contracts/${puuid}`), { headers })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${VAPI}/seasons`).then((r) => r.json()).catch(() => null),
      fetch(`${VAPI}/contracts`).then((r) => r.json()).catch(() => null),
    ]);
    if (!contractsRes?.Contracts || !seasons?.data || !defs?.data) return null;

    const now = Date.now();
    // Current act = a season with a parent (acts nest under episodes) that's live now.
    const act = seasons.data.find(
      (s) => s.parentUuid && Date.parse(s.startTime) <= now && now <= Date.parse(s.endTime)
    );
    if (!act) return null;

    const def = defs.data.find(
      (c) => c.content?.relationType === 'Season' && c.content?.relationUuid === act.uuid
    );
    if (!def) return null;

    const owned = contractsRes.Contracts.find((c) => c.ContractDefinitionID === def.uuid);
    if (!owned) return { tier: 0, totalLevels: 50, name: def.displayName || 'Battlepass' };

    const totalLevels = (def.content?.chapters || []).reduce(
      (sum, ch) => sum + (ch.levels?.length || 0),
      0
    );
    return {
      tier: owned.ProgressionLevelReached || 0,
      totalLevels: totalLevels || 50,
      name: def.displayName || 'Battlepass',
    };
  } catch {
    return null;
  }
}

// --- public entry points ---------------------------------------------------
// The daily store (+ night market when active) + wallet + identity.
// Returns { status: 'ok', shop, nightMarket, wallet, profile } | { status: 'error', error }.
export async function fetchShop(tokens) {
  const ctx = await prepare(tokens);
  if (!ctx.ok) {
    return { status: 'error', error: ctx.error === 'expired' ? 'Token sudah kadaluarsa. Login ulang lewat Riot.' : ctx.error };
  }
  const { headers, shard, puuid, region } = ctx;

  const storeRes = await fetch(pdUrl(shard, `/store/v3/storefront/${puuid}`), {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  if (!storeRes.ok) {
    return { status: 'error', error: `Gagal mengambil toko (HTTP ${storeRes.status})` };
  }
  const store = await storeRes.json();

  // Daily featured skins.
  const panel = store.SkinsPanelLayout || {};
  const dailyOffers = panel.SingleItemStoreOffers || [];
  const skins = await Promise.all(
    dailyOffers.map(async (offer) => {
      const itemId = offer.Rewards?.[0]?.ItemID || offer.OfferID;
      const meta = await resolveSkin(itemId);
      return { id: offer.OfferID || itemId, name: meta.name, image: meta.image, price: offer.Cost?.[VP_CURRENCY] ?? null };
    })
  );

  // Night market (BonusStore) — only present when the event is active.
  let nightMarket = null;
  const bonus = store.BonusStore;
  if (bonus?.BonusStoreOffers?.length) {
    nightMarket = {
      remaining: bonus.BonusStoreRemainingDurationInSeconds || 0,
      items: await Promise.all(
        bonus.BonusStoreOffers.map(async (b) => {
          const off = b.Offer || {};
          const itemId = off.Rewards?.[0]?.ItemID || off.OfferID;
          const meta = await resolveSkin(itemId);
          return {
            id: off.OfferID || itemId,
            name: meta.name,
            image: meta.image,
            basePrice: off.Cost?.[VP_CURRENCY] ?? null,
            discountPrice: b.DiscountCosts?.[VP_CURRENCY] ?? null,
            discountPercent: b.DiscountPercent ?? null,
          };
        })
      ),
    };
  }

  const [wallet, profile] = await Promise.all([
    getWallet(headers, shard, puuid),
    getIdentity(headers, shard, puuid).catch(() => null),
  ]);

  return {
    status: 'ok',
    shop: { region, remaining: panel.SingleItemOffersRemainingDurationInSeconds || 0, skins, wallet },
    nightMarket,
    wallet,
    profile,
  };
}

// The hub dashboard: identity, wallet, inventory summary, account, battlepass.
// Returns { status: 'ok', overview } | { status: 'error', error }.
export async function fetchOverview(tokens) {
  const ctx = await prepare(tokens);
  if (!ctx.ok) {
    return { status: 'error', error: ctx.error === 'expired' ? 'Token sudah kadaluarsa. Login ulang lewat Riot.' : ctx.error };
  }
  const { headers, shard, puuid } = ctx;

  const [identity, wallet, inventory, account, battlepass] = await Promise.all([
    withTimeout(getIdentity(headers, shard, puuid).catch(() => null), 12000, null),
    withTimeout(getWallet(headers, shard, puuid), 8000, { vp: null, radianite: null, kingdom: null }),
    withTimeout(getInventory(headers, shard, puuid).catch(() => null), 12000, null),
    withTimeout(getAccount(headers, shard, puuid).catch(() => null), 12000, null),
    withTimeout(getBattlepass(headers, shard, puuid).catch(() => null), 12000, null),
  ]);

  return { status: 'ok', overview: { identity, wallet, inventory, account, battlepass } };
}

// The detailed owned-skins list. Resolves owned skin-level UUIDs to distinct
// skins via the community weapons list (one call, then local mapping) and
// estimates each price from its content tier.
// Returns { status: 'ok', inventory } | { status: 'error', error }.
export async function fetchInventoryDetail(tokens) {
  const ctx = await prepare(tokens);
  if (!ctx.ok) {
    return { status: 'error', error: ctx.error === 'expired' ? 'Token sudah kadaluarsa. Login ulang lewat Riot.' : ctx.error };
  }
  const { headers, shard, puuid } = ctx;

  const [owned, index, tiersJson] = await Promise.all([
    getEntitlements(headers, shard, puuid, ITEM_TYPES.skins),
    getWeaponSkinIndex(),
    fetch(`${VAPI}/contenttiers`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  // content tier UUID -> { color, icon }
  const tierMap = {};
  for (const t of tiersJson?.data || []) {
    tierMap[t.uuid] = {
      color: t.highlightColor ? `#${t.highlightColor.slice(0, 6)}` : null,
      icon: t.displayIcon || null,
    };
  }

  // Resolve owned entitlements to distinct skins (dedupe by skin uuid).
  const seen = new Set();
  const skins = [];
  let totalValueVp = 0;
  for (const levelId of owned) {
    const entry = index[levelId];
    if (!entry || seen.has(entry.uuid)) continue;
    seen.add(entry.uuid);
    const price = estimateSkinPrice(entry);
    if (price != null) totalValueVp += price;
    const tier = entry.tier ? tierMap[entry.tier] : null;
    skins.push({
      id: entry.uuid,
      name: entry.name,
      image: entry.image,
      price,
      tierColor: tier?.color || null,
      tierIcon: tier?.icon || null,
    });
  }

  // Priciest first; unpriced (default) skins sink to the bottom.
  skins.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));

  return {
    status: 'ok',
    inventory: {
      count: skins.length,
      totalSkinEntitlements: owned.length,
      totalValueVp,
      skins,
    },
  };
}
