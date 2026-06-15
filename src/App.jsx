import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Landing from './Landing.jsx';
import { getDeviceId, fetchProfile, saveProfile, submitScore, startSession } from './api.js';
import { getTurnstileToken } from './turnstile.js';
import { TEXT } from './translations.js';

// Code-split the trainer: Three.js (~500KB) only loads when entering the arena,
// keeping the landing page fast to open.
const AimTrainer = lazy(() => import('./AimTrainer.jsx'));

let toastSeq = 0;

// Cache the profile (name + best) in localStorage so every tab in the same
// browser shows the same identity instantly — before the async server fetch
// resolves — instead of flashing the default "Agent" / 0, which looked like a
// brand-new user. The persistent deviceId stays the source of truth; this is
// just a local mirror for an instant, flicker-free first paint.
const PROFILE_CACHE_KEY = 'vat_profile';
const DEFAULT_BEST = { score: 0, accuracy: 0, split: 0 };

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
  const [view, setView] = useState('landing'); // 'landing' | 'play'
  const [lang, setLang] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('vat_settings'));
      return saved && saved.lang ? saved.lang : 'en';
    } catch {
      return 'en';
    }
  });
  const t = TEXT[lang] || TEXT.en;

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    const ua = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile|BlackBerry/i.test(
      navigator.userAgent || ''
    );
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
    const noLock = !document.documentElement.requestPointerLock;
    return ua || coarse || noLock || window.innerWidth < 1024;
  });

  // Unique Device ID for Cloudflare R2 Sync
  const [deviceId] = useState(() => getDeviceId());

  // Profile and High Scores State — hydrated synchronously from the local cache
  // so a freshly opened tab shows the existing user immediately, not "Agent".
  const [name, setName] = useState(() => readProfileCache()?.name || 'Agent');
  const [best, setBest] = useState(() => readProfileCache()?.best || { ...DEFAULT_BEST });
  // Only show the loading shimmer when there's nothing cached to display yet.
  const [profileLoading, setProfileLoading] = useState(() => !readProfileCache());

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
      }
      setProfileLoading(false);
    }
    loadProfile();
  }, [deviceId]);

  useEffect(() => {
    const check = () => {
      const ua = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile|BlackBerry/i.test(
        navigator.userAgent || ''
      );
      const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
      const noLock = !document.documentElement.requestPointerLock;
      setIsMobile(ua || coarse || noLock || window.innerWidth < 1024);
    };
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const handleSetName = (updater) => {
    let resolvedName;
    setName((prev) => {
      resolvedName = typeof updater === 'function' ? updater(prev) : updater;
      return resolvedName;
    });
    writeProfileCache(resolvedName, best);
    saveProfile(deviceId, resolvedName, best).then(({ ok }) => {
      if (ok) showToast(t.profileSaveOk, 'success');
      else showToast(t.profileSaveError, 'error');
    });
  };

  const handleSetBest = (updater) => {
    setBest((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveProfile(deviceId, name, next);
      writeProfileCache(name, next);
      return next;
    });
  };

  // Signed session token, requested when a round starts and redeemed once when
  // the score is submitted. Kept in a ref so it survives re-renders mid-round.
  const sessionTokenRef = useRef(null);

  // Each round starts with a fresh token request (the 40s round gives it ample
  // time to resolve before the score is submitted).
  const handleRoundStart = useCallback(() => {
    sessionTokenRef.current = null;
    getTurnstileToken()
      .then((turnstileToken) => startSession(deviceId, turnstileToken))
      .then((token) => { sessionTokenRef.current = token; });
  }, [deviceId]);

  // Log a finished session to the weekly leaderboard (best score also synced
  // separately via handleSetBest).
  const handleSession = (session) => {
    submitScore(deviceId, name, session, sessionTokenRef.current);
    sessionTokenRef.current = null; // single use — force a new token next round
  };

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
          lang={lang}
          setLang={handleSetLang}
          isMobile={isMobile}
          name={name}
          setName={handleSetName}
          best={best}
          deviceId={deviceId}
          profileLoading={profileLoading}
          showToast={showToast}
        />
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
