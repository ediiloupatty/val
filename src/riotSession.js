// Riot store-login session, persisted in the browser so the user stays "logged
// in" across page loads until logout or the token expires (~1h — Riot's implicit
// access token is short-lived and there's no refresh, so this is a hard cap).
//
// The token is the user's own, on their own device. It's short-lived, which
// bounds the exposure. We never send it anywhere except our own Worker.

const SESSION_KEY = 'vat_riot_session';

// The URL the user opens to log in on Riot's own page.
export const AUTH_URL =
  'https://auth.riotgames.com/authorize' +
  '?redirect_uri=http%3A%2F%2Flocalhost%2Fredirect' +
  '&client_id=riot-client' +
  '&response_type=token%20id_token' +
  '&nonce=1' +
  '&scope=openid%20link%20ban%20lol_region%20account' +
  '&prompt=login';

// Parse access_token / id_token / expiry out of the pasted redirect URL.
export function extractTokens(url) {
  const raw = String(url || '');
  const frag = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : raw;
  const p = new URLSearchParams(frag);
  const accessToken = p.get('access_token');
  if (!accessToken) return null;
  const expiresIn = Number(p.get('expires_in')) || 3600;
  return {
    accessToken,
    idToken: p.get('id_token') || '',
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

// Returns the stored session only if it exists and hasn't expired.
export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (s && s.accessToken && Number(s.expiresAt) > Date.now()) return s;
  } catch {
    /* ignore */
  }
  return null;
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
