// Cloudflare Turnstile helper. Inert unless VITE_TURNSTILE_SITEKEY is set, so
// the app runs fine without Turnstile configured. When a site key is present it
// lazy-loads the Turnstile script, renders one invisible widget, and returns a
// fresh single-use token on demand (used by startSession). Fails open — any
// error resolves to null so gameplay is never blocked by a captcha hiccup.

const SITEKEY = import.meta.env.VITE_TURNSTILE_SITEKEY || '';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

let scriptPromise = null;
let widgetId = null;

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
  if (widgetId !== null) return widgetId;
  // Off-screen container for the invisible/managed widget.
  const holder = document.createElement('div');
  holder.style.position = 'fixed';
  holder.style.bottom = '0';
  holder.style.left = '-9999px';
  document.body.appendChild(holder);
  widgetId = window.turnstile.render(holder, { sitekey: SITEKEY, size: 'invisible' });
  return widgetId;
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
    const id = ensureWidget();
    window.turnstile.reset(id);
    return await window.turnstile.execute(id, { action: 'session' });
  } catch (err) {
    console.warn('[Turnstile] token error:', err.message);
    return null;
  }
}
