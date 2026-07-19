// Persistent Riot session via the long-lived `ssid` cookie. Unlike an access
// token (which dies in ~1h), the ssid lasts weeks — until the user changes
// their password or logs out everywhere. We store only the ssid; the Worker
// exchanges it for a fresh access token on each request (cookie reauth). So the
// user logs in once and stays logged in for a long time, like a Discord bot.

const SSID_KEY = 'vat_riot_ssid';

// Where the user logs into Riot before grabbing the ssid cookie.
export const RIOT_LOGIN_URL =
  'https://auth.riotgames.com/authorize' +
  '?redirect_uri=http%3A%2F%2Flocalhost%2Fredirect' +
  '&client_id=riot-client' +
  '&response_type=token%20id_token' +
  '&nonce=1' +
  '&scope=openid%20link%20ban%20lol_region%20account' +
  '&prompt=login';

// Users sometimes paste the whole `ssid=...` pair or a longer cookie string;
// pull just the ssid value out of whatever they paste.
export function cleanSsid(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const m = raw.match(/ssid=([^;\s]+)/i);
  return (m ? m[1] : raw).trim();
}

export function saveSsid(ssid) {
  try {
    localStorage.setItem(SSID_KEY, ssid);
  } catch {
    /* ignore */
  }
}

export function loadSsid() {
  try {
    return localStorage.getItem(SSID_KEY) || null;
  } catch {
    return null;
  }
}

export function clearSsid() {
  try {
    localStorage.removeItem(SSID_KEY);
  } catch {
    /* ignore */
  }
}
