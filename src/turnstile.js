// Cloudflare Turnstile helper. Inert unless VITE_TURNSTILE_SITEKEY is set, so
// the app runs fine without Turnstile configured. When a site key is present it
// lazy-loads the Turnstile script, renders one invisible widget, and returns a
// fresh single-use token on demand (used by startSession). Fails open — any
// error or timeout resolves to null so gameplay is never blocked by a captcha.

const SITEKEY = import.meta.env.VITE_TURNSTILE_SITEKEY || '';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const TOKEN_TIMEOUT_MS = 8000;

let scriptPromise = null;
let widgetId = null;
let pending = null; // { resolve } for the in-flight execute()

function settle(token) {
  if (pending) {
    pending.resolve(token);
    pending = null;
  }
}

function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Turnstile script failed to load'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

function ensureWidget() {
  if (widgetId !== null) return;
  // Off-screen container for the invisible widget. The token arrives via the
  // callbacks below (Turnstile's API is callback-based, not promise-based).
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-9999px;bottom:0;width:0;height:0;';
  document.body.appendChild(holder);
  widgetId = window.turnstile.render(holder, {
    sitekey: SITEKEY,
    size: 'invisible',
    callback: (token) => settle(token),
    'error-callback': () => settle(null),
    'timeout-callback': () => settle(null),
  });
}

/**
 * Resolves to a fresh Turnstile token, or null when Turnstile isn't configured
 * or anything goes wrong (so the caller proceeds without it).
 */
export async function getTurnstileToken() {
  if (!SITEKEY) return null;
  try {
    await loadScript();
    if (!window.turnstile) return null;
    ensureWidget();
    return await new Promise((resolve) => {
      pending = { resolve };
      try { window.turnstile.reset(widgetId); } catch { /* fresh widget */ }
      window.turnstile.execute(widgetId, { action: 'session' });
      // Safety net: never let a stuck challenge block starting a round.
      setTimeout(() => settle(null), TOKEN_TIMEOUT_MS);
    });
  } catch (err) {
    console.warn('[Turnstile] token error:', err.message);
    return null;
  }
}
