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
  if (!deviceId) return;
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
    }
  } catch (err) {
    console.warn('[API] Could not sync profile to Cloudflare D1:', err.message);
  }
}

/**
 * Logs one finished session to the scores table (feeds the weekly leaderboard).
 * Fire-and-forget — failures are non-fatal to gameplay.
 */
export async function submitScore(deviceId, name, session) {
  if (!deviceId || !session) return;
  try {
    await fetchWithTimeout(`${API_URL}/api/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        name,
        score: session.score,
        accuracy: session.accuracy,
        split: session.split,
      }),
    });
  } catch (err) {
    console.warn('[API] Could not submit score:', err.message);
  }
}

/**
 * Fetches the weekly top-10 leaderboard (scores achieved in the last 7 days).
 * Returns an array (possibly empty) or null on failure.
 */
export async function fetchLeaderboard() {
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/leaderboard`);
    if (res.ok) {
      const json = await res.json();
      return json.success ? json.data : null;
    }
  } catch (err) {
    console.warn('[API] Could not fetch leaderboard:', err.message);
  }
  return null;
}
