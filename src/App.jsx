import React, { useState, useEffect } from 'react';
import Landing from './Landing.jsx';
import AimTrainer from './AimTrainer.jsx';
import { getDeviceId, fetchProfile, saveProfile, submitScore } from './api.js';

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

  // Profile and High Scores State
  const [name, setName] = useState('Agent');
  const [best, setBest] = useState({ score: 0, accuracy: 0, split: 0 });

  // Load Profile on Mount from Cloudflare D1
  useEffect(() => {
    async function loadProfile() {
      const dbData = await fetchProfile(deviceId);
      if (dbData) {
        if (dbData.name) {
          setName(dbData.name);
        }
        if (dbData.best) {
          setBest(dbData.best);
        }
      }
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
    setName((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveProfile(deviceId, next, best);
      return next;
    });
  };

  const handleSetBest = (updater) => {
    setBest((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveProfile(deviceId, name, next);
      return next;
    });
  };

  // Log a finished session to the weekly leaderboard (best score also synced
  // separately via handleSetBest).
  const handleSession = (session) => {
    submitScore(deviceId, name, session);
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

  if (view === 'landing') {
    return (
      <Landing
        onPlay={() => setView('play')}
        lang={lang}
        setLang={handleSetLang}
        isMobile={isMobile}
        name={name}
        setName={handleSetName}
        best={best}
      />
    );
  }
  return (
    <AimTrainer
      onExit={() => setView('landing')}
      lang={lang}
      setLang={handleSetLang}
      isMobile={isMobile}
      best={best}
      setBest={handleSetBest}
      onSession={handleSession}
    />
  );
}
