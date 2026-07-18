// Cloudflare Worker API url
let API_URL = import.meta.env.VITE_API_URL || 'https://valorant-aim-trainer-backend.ediloupatty.workers.dev';
// Defensive guard: if the env var was accidentally saved without the leading 'h'
// (e.g. VITE_API_URL=ttps://...), restore the full URL.
if (API_URL && API_URL.startsWith('ttps://')) {
  API_URL = 'https://' + API_URL.slice(7);
}

/**
 * Fetch wrapper with an AbortController-based timeout.
 * Prevents API calls from hanging indefinitely when the backend is unresponsive.
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} timeoutMs — default 8 s
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Gets or generates a unique Device ID for the browser/session.
 * Persists it in localStorage so the user is consistently recognized on this device.
 */
export function getDeviceId() {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem('vat_device_id');
  if (!id) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      id = `dev-${crypto.randomUUID()}`;
    } else {
      // Robust fallback generator if crypto.randomUUID is not available (e.g. non-HTTPS local dev)
      const rand = Math.random().toString(36).substring(2, 11);
      const timestamp = Date.now().toString(36);
      id = `dev-${rand}-${timestamp}`;
    }
    try {
      localStorage.setItem('vat_device_id', id);
    } catch (err) {
      /* ignore storage block */
    }
  }
  return id;
}

/**
 * Fetches the user profile and best scores from the Cloudflare D1 database
 * via the Worker backend. Returns null if the fetch fails or times out.
 */
export async function fetchProfile(deviceId) {
  if (!deviceId) return null;
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/profile?deviceId=${deviceId}`);
    if (res.ok) {
      const json = await res.json();
      return json.success ? json.data : null;
    }
  } catch (err) {
    console.warn('[API] Could not fetch profile from Cloudflare D1:', err.message);
  }
  return null;
}

/**
 * Synchronizes the local profile details (name and high scores) to the
 * Cloudflare D1 database (upsert by deviceId).
 */
export async function saveProfile(deviceId, name, best) {
  if (!deviceId) return { ok: false };
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deviceId, name, best }),
    });
    if (!res.ok) {
      console.warn('[API] Worker responded with status:', res.status);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[API] Could not sync profile to Cloudflare D1:', err.message);
    return { ok: false };
  }
}

/**
 * Requests a signed session token from the backend at game start. The token is
 * later required by submitScore(), so the leaderboard only accepts scores from a
 * session this backend authorized. Returns the token string or null on failure.
 */
export async function startSession(deviceId, turnstileToken) {
  if (!deviceId) return null;
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, turnstileToken }),
    });
    if (res.ok) {
      const json = await res.json();
      return json.success ? json.token : null;
    }
  } catch (err) {
    console.warn('[API] Could not start session:', err.message);
  }
  return null;
}

/**
 * Logs one finished session to the scores table (feeds the weekly leaderboard).
 * Requires the signed token from startSession(). Fire-and-forget — failures are
 * non-fatal to gameplay.
 */
export async function submitScore(deviceId, name, session, token) {
  if (!deviceId || !session) return { ok: false };
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        name,
        score: session.score,
        accuracy: session.accuracy,
        split: session.split,
        targetSize: session.targetSize,
        log: session.log,
        token,
      }),
    });
    if (res.ok) {
      const json = await res.json();
      return { ok: json.success === true };
    }
    console.warn('[API] Score submit responded with status:', res.status);
    return { ok: false };
  } catch (err) {
    console.warn('[API] Could not submit score:', err.message);
    return { ok: false };
  }
}

/**
 * Fetches the player's weekly leaderboard standing for the share card and the
 * "your rank" row. Returns { rank, score } (rank is 1-based), or null if
 * unranked / on failure.
 */
export async function fetchRank(deviceId) {
  if (!deviceId) return null;
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/rank?deviceId=${deviceId}`);
    if (res.ok) {
      const json = await res.json();
      return json.success && json.rank ? { rank: json.rank, score: json.score } : null;
    }
  } catch (err) {
    console.warn('[API] Could not fetch rank:', err.message);
  }
  return null;
}

/**
 * Fetches the list of rotating landing background image URLs (from R2 via the
 * Worker). Returns absolute URLs (possibly empty); never throws.
 */
export async function fetchBackgrounds() {
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/backgrounds`);
    if (res.ok) {
      const json = await res.json();
      return (json.images || []).map((p) => `${API_URL}${p}`);
    }
  } catch (err) {
    console.warn('[API] Could not fetch backgrounds:', err.message);
  }
  return [];
}

/**
 * Fetches recent Saweria donations for the landing "supporters" card.
 * Returns an array (possibly empty); never throws.
 */
export async function fetchDonations() {
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/donations`);
    if (res.ok) {
      const json = await res.json();
      return json.success ? json.data : [];
    }
  } catch (err) {
    console.warn('[API] Could not fetch donations:', err.message);
  }
  return [];
}

/**
 * Fetches the daily store (+ night market when active) using stored session
 * tokens. Returns { ok, shop, nightMarket, profile } | { ok: false, error }.
 * Several upstream Riot calls run server-side, so this gets a longer timeout.
 */
export async function fetchShop(tokens, turnstileToken) {
  try {
    const res = await fetchWithTimeout(
      `${API_URL}/api/shop/store`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: tokens.accessToken,
          idToken: tokens.idToken,
          turnstileToken,
        }),
      },
      25000
    );
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.success) {
      return { ok: true, shop: json.shop, nightMarket: json.nightMarket, profile: json.profile };
    }
    return { ok: false, error: json.error || 'Gagal mengambil toko' };
  } catch (err) {
    return { ok: false, error: 'Tidak bisa terhubung ke server' };
  }
}

/**
 * Fetches the account hub dashboard (identity, wallet, inventory summary,
 * account stats, battlepass) using stored session tokens.
 * Returns { ok: true, overview } | { ok: false, error }.
 */
export async function fetchValorantOverview(tokens, turnstileToken) {
  try {
    const res = await fetchWithTimeout(
      `${API_URL}/api/valorant/overview`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: tokens.accessToken,
          idToken: tokens.idToken,
          turnstileToken,
        }),
      },
      30000
    );
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.success) return { ok: true, overview: json.overview };
    return { ok: false, error: json.error || 'Gagal mengambil data akun' };
  } catch (err) {
    return { ok: false, error: 'Tidak bisa terhubung ke server' };
  }
}

/**
 * Fetches the weekly top-10 leaderboard (scores achieved in the last 7 days).
 * Returns an array (possibly empty) or null on failure.
 */
export async function fetchLeaderboard(range = 'week', mode = 'all') {
  try {
    const params = new URLSearchParams();
    if (range === 'all') params.set('range', 'all');
    if (mode && mode !== 'all') params.set('mode', mode);
    const qs = params.toString() ? `?${params}` : '';
    const res = await fetchWithTimeout(`${API_URL}/api/leaderboard${qs}`);
    if (res.ok) {
      const json = await res.json();
      return { rows: json.success ? json.data : [], error: false };
    }
    return { rows: null, error: true };
  } catch (err) {
    console.warn('[API] Could not fetch leaderboard:', err.message);
    return { rows: null, error: true };
  }
}
