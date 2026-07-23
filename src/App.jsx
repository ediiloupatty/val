import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Landing from './Landing.jsx';
import { getDeviceId, fetchProfile, saveProfile, submitScore, startSession, linkValorantProfile } from './api.js';
import { getTurnstileToken } from './turnstile.js';
import { TEXT } from './translations.js';

// Code-split the trainer: Three.js (~500KB) only loads when entering the arena,
// keeping the landing page fast to open.
const AimTrainer = lazy(() => import('./AimTrainer.jsx'));
// The Valorant account hub is a separate, optional feature — load it on demand.
const ValorantHub = lazy(() => import('./ValorantHub.jsx'));

let toastSeq = 0;

function checkIsMobile() {
  if (typeof window === 'undefined') return false;
  const ua = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile|BlackBerry/i.test(
    navigator.userAgent || ''
  );
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  const noLock = !document.documentElement.requestPointerLock;
  return ua || coarse || noLock || window.innerWidth < 1024;
}

// Cache the profile (name + best) in localStorage so every tab in the same
// browser shows the same identity instantly — before the async server fetch
// resolves — instead of flashing the default "Agent" / 0, which looked like a
// brand-new user. The persistent deviceId stays the source of truth; this is
// just a local mirror for an instant, flicker-free first paint.
const PROFILE_CACHE_KEY = 'vat_profile';
// Valorant identity (name#tag, avatar, level, rank) pulled from a store login.
const VALORANT_KEY = 'vat_valorant';
const DEFAULT_BEST = { score: 0, accuracy: 0, split: 0 };

function readValorantProfile() {
  try {
    const v = JSON.parse(localStorage.getItem(VALORANT_KEY));
    if (v && typeof v === 'object') return v;
  } catch {
    /* ignore */
  }
  return null;
}

function readProfileCache() {
  try {
    const c = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY));
    if (c && typeof c.name === 'string' && c.best) return c;
  } catch {
    /* ignore */
  }
  return null;
}

function writeProfileCache(name, best) {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ name, best }));
  } catch {
    /* ignore */
  }
}

function ToastContainer({ toasts }) {
  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col-reverse gap-2 pointer-events-none">
      {toasts.map(({ id, message, type }) => (
        <div
          key={id}
          className={`animate-toast pointer-events-auto rounded-2xl border px-4 py-3 text-sm font-bold shadow-xl ${
            type === 'success'
              ? 'border-[#00e5c0]/40 bg-[#00e5c0] text-[#0f1419]'
              : type === 'error'
              ? 'border-[#ff4655]/40 bg-[#ff4655] text-white'
              : 'border-white/20 bg-[#1a2530] text-white'
          }`}
        >
          {message}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState('landing'); // 'landing' | 'play' | 'shop'
  const [lang, setLang] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('vat_settings'));
      return saved && saved.lang ? saved.lang : 'en';
    } catch {
      return 'en';
    }
  });
  const t = TEXT[lang] || TEXT.en;

  const [isMobile, setIsMobile] = useState(checkIsMobile);

  // Unique Device ID for Cloudflare R2 Sync
  const [deviceId] = useState(() => getDeviceId());

  // Profile and High Scores State — hydrated synchronously from the local cache
  // so a freshly opened tab shows the existing user immediately, not "Agent".
  const [name, setName] = useState(() => readProfileCache()?.name || 'Agent');
  const [best, setBest] = useState(() => readProfileCache()?.best || { ...DEFAULT_BEST });
  // Only show the loading shimmer when there's nothing cached to display yet.
  const [profileLoading, setProfileLoading] = useState(() => !readProfileCache());

  // Valorant identity from a store login (avatar/level/rank shown on the profile).
  const [valorantProfile, setValorantProfile] = useState(() => readValorantProfile());

  // Toast notifications
  const [toasts, setToasts] = useState([]);
  const toastTimers = useRef([]);
  const showToast = useCallback((message, type = 'info') => {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, message, type }]);
    const tid = setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
      toastTimers.current = toastTimers.current.filter((x) => x !== tid);
    }, 3500);
    toastTimers.current.push(tid);
  }, []);
  useEffect(() => () => { toastTimers.current.forEach(clearTimeout); }, []);

  // Load Profile on Mount from Cloudflare D1, then refresh the local cache so the
  // next tab/visit paints the up-to-date identity instantly.
  useEffect(() => {
    async function loadProfile() {
      const dbData = await fetchProfile(deviceId);
      if (dbData) {
        const nextName = dbData.name || readProfileCache()?.name || 'Agent';
        const nextBest = dbData.best || readProfileCache()?.best || { ...DEFAULT_BEST };
        setName(nextName);
        setBest(nextBest);
        writeProfileCache(nextName, nextBest);
        // The DB is the source of truth for a linked Valorant identity too —
        // this is what makes the profile show it on any browser/device, not
        // just the one that logged into the Hub.
        if (dbData.valorant) {
          setValorantProfile(dbData.valorant);
          try {
            localStorage.setItem(VALORANT_KEY, JSON.stringify(dbData.valorant));
          } catch {
            /* ignore */
          }
        }
      }
      setProfileLoading(false);
    }
    loadProfile();
  }, [deviceId]);

  useEffect(() => {
    const check = () => setIsMobile(checkIsMobile());
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const handleSetName = (updater) => {
    let resolvedName;
    setName((prev) => {
      resolvedName = typeof updater === 'function' ? updater(prev) : updater;
      return resolvedName;
    });
    writeProfileCache(resolvedName, bestRef.current);
    saveProfile(deviceId, resolvedName, bestRef.current).then(({ ok }) => {
      if (ok) showToast(t.profileSaveOk, 'success');
      else showToast(t.profileSaveError, 'error');
    });
  };

  // Called after a successful store login: adopt the Valorant identity. The
  // name#tag becomes the app/leaderboard name; avatar/level/rank are persisted
  // for the profile display. The hub fires this on every mount, so only save
  // when the name actually changed — otherwise every shop visit re-saves the
  // same name and surfaces a pointless success/error toast.
  const handleValorantIdentity = (identity) => {
    if (!identity) return;
    setValorantProfile(identity);
    try {
      localStorage.setItem(VALORANT_KEY, JSON.stringify(identity));
    } catch {
      /* ignore */
    }
    const nextName = identity.displayName ? identity.displayName.slice(0, 20) : null;
    if (nextName && nextName !== nameRef.current) handleSetName(nextName);
    if (identity.puuid) linkValorantProfile(deviceId, identity);
  };

  // Logout from the Valorant hub: drop the cached identity display. (The token
  // session itself is cleared inside the hub.) The leaderboard name keeps its
  // last value — it's editable in the profile panel.
  const handleValorantLogout = () => {
    setValorantProfile(null);
    try {
      localStorage.removeItem(VALORANT_KEY);
    } catch {
      /* ignore */
    }
  };

  const handleSetBest = (updater) => {
    setBest((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveProfile(deviceId, nameRef.current, next);
      writeProfileCache(nameRef.current, next);
      return next;
    });
  };

  // Mirror best into a ref so handleSetName always writes the current value to
  // the profile cache, even if best updated since the last render.
  const bestRef = useRef(best);
  useEffect(() => { bestRef.current = best; }, [best]);

  // Mirror name into a ref so handleSetBest always writes the current name
  // to the profile, even if name changed since the last render.
  const nameRef = useRef(name);
  useEffect(() => { nameRef.current = name; }, [name]);

  // Signed session token, requested when a round starts and redeemed once when
  // the score is submitted. Kept in a ref so it survives re-renders mid-round.
  const sessionTokenRef = useRef(null);

  // Each round starts with a fresh token request (the 40s round gives ample
  // time to resolve before the score is submitted). Retries once on failure
  // and shows a warning toast if both attempts fail.
  const handleRoundStart = useCallback(() => {
    sessionTokenRef.current = null;
    const attempt = async (retriesLeft) => {
      const turnstileToken = await getTurnstileToken();
      const token = await startSession(deviceId, turnstileToken);
      if (token) {
        sessionTokenRef.current = token;
      } else if (retriesLeft > 0) {
        await new Promise((r) => setTimeout(r, 2000));
        return attempt(retriesLeft - 1);
      } else {
        showToast(t.sessionTokenWarning, 'error');
      }
    };
    attempt(1);
  }, [deviceId, showToast, t]);

  // Log a finished session to the weekly leaderboard (best score also synced
  // separately via handleSetBest).
  const handleSession = useCallback(async (session) => {
    const result = await submitScore(deviceId, name, session, sessionTokenRef.current);
    sessionTokenRef.current = null; // single use — force a new token next round
    if (!result?.ok) showToast(t.scoreSubmitError, 'error');
  }, [deviceId, name, showToast, t]);

  const handleSetLang = (newLang) => {
    setLang(newLang);
    try {
      const saved = JSON.parse(localStorage.getItem('vat_settings')) || {};
      saved.lang = newLang;
      localStorage.setItem('vat_settings', JSON.stringify(saved));
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <ToastContainer toasts={toasts} />
      {view === 'landing' ? (
        <Landing
          onPlay={() => setView('play')}
          onShop={() => setView('valorant')}
          lang={lang}
          setLang={handleSetLang}
          isMobile={isMobile}
          name={name}
          setName={handleSetName}
          best={best}
          deviceId={deviceId}
          profileLoading={profileLoading}
          showToast={showToast}
          valorantProfile={valorantProfile}
        />
      ) : view === 'valorant' ? (
        <Suspense
          fallback={
            <div className="flex h-[100dvh] w-screen items-center justify-center bg-val-dark">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[#00e5c0]" />
            </div>
          }
        >
          <ValorantHub
            onExit={() => setView('landing')}
            onIdentity={handleValorantIdentity}
            onLogout={handleValorantLogout}
            lang={lang}
          />
        </Suspense>
      ) : (
        <Suspense
          fallback={
            <div className="flex h-[100dvh] w-screen items-center justify-center bg-val-dark">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[#00e5c0]" />
            </div>
          }
        >
          <AimTrainer
            onExit={() => setView('landing')}
            lang={lang}
            setLang={handleSetLang}
            isMobile={isMobile}
            name={name}
            setName={handleSetName}
            best={best}
            setBest={handleSetBest}
            onSession={handleSession}
            onRoundStart={handleRoundStart}
            showToast={showToast}
          />
        </Suspense>
      )}
    </>
  );
}