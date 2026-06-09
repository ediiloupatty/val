import React, { useEffect, useMemo, useState } from 'react';
import { TEXT } from './translations.js';
import { fetchLeaderboard } from './api.js';

// Landing background (converted from PNG → WebP for a much smaller file).
const BG_URL = '/img/jett-background.webp';

// Contact / support destinations — edit to your own links.
const CONTACT = {
  email: 'muhammadlikmansyah143@gmail.com',
  donate: 'https://saweria.co/', // ← replace with your Saweria/Trakteer/Ko-fi
  github: 'https://github.com/ediiloupatty', // ← your profile
};

export default function Landing({ onPlay, lang, setLang, isMobile, name, setName, best, deviceId }) {
  const [panel, setPanel] = useState(null); // 'profile' | 'credits' | 'support' | 'leaderboard' | null
  const [showMobileModal, setShowMobileModal] = useState(false);
  const [tempName, setTempName] = useState(name);
  const [board, setBoard] = useState(null); // null = loading, [] = empty, [...] = rows
  const t = TEXT[lang] || TEXT.en;

  useEffect(() => {
    setTempName(name);
  }, [name]);

  // Load the weekly leaderboard each time its panel opens (always fresh).
  useEffect(() => {
    if (panel !== 'leaderboard') return;
    let alive = true;
    setBoard(null);
    fetchLeaderboard().then((rows) => {
      if (alive) setBoard(rows || []);
    });
    return () => {
      alive = false;
    };
  }, [panel]);

  const handleSave = () => {
    const trimmed = tempName.trim();
    if (trimmed && trimmed !== name) {
      setName(trimmed);
    }
  };

  return (
    <div
      className="relative h-[100dvh] w-screen overflow-hidden bg-val-dark font-sans text-white select-none"
      style={{
        backgroundImage: `linear-gradient(90deg, rgba(15,20,25,0.96) 0%, rgba(15,20,25,0.72) 26%, rgba(15,20,25,0.22) 58%, rgba(15,20,25,0.55) 100%), radial-gradient(70% 90% at 50% 100%, rgba(15,20,25,0.6), transparent 60%), url('${BG_URL}')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center right',
      }}
    >
      {/* Wind effect — flows right→left & slightly up, matching Jett's motion */}
      <WindFX />
      {/* ---------- Top bar ---------- */}
      <header className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-6 py-4 md:px-8 md:py-5">
        <div className="flex items-center gap-3">
          <img
            src="/img/app-icon.png"
            alt="AIMKU"
            className="h-9 w-9 md:h-11 md:w-11 rounded-2xl shadow-[0_0_18px_rgba(0,229,192,0.35)]"
          />
          <div className="leading-tight">
            <p className="text-base md:text-lg font-black tracking-[0.3em] text-white">AIMKU</p>
            <p className="text-[9px] md:text-[10px] tracking-[0.35em] text-slate-400">
              {t.subtitle.toUpperCase()} · MICRO FLICKS
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[9px] md:text-[10px] uppercase tracking-[0.3em] text-slate-400">{t.bestScoreLabel}</p>
          <p className="text-lg md:text-xl font-black tabular-nums text-val-accent">{best.score}</p>
        </div>
      </header>

      {/* ---------- Left menu ---------- */}
      <nav className="absolute left-6 md:left-12 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-3">
        <button
          onClick={isMobile ? () => setShowMobileModal(true) : onPlay}
          className="group flex items-center gap-3 text-left"
        >
          <span className="h-8 md:h-10 w-1 bg-val-red transition-all group-hover:h-10 md:group-hover:h-12" />
          <span className="text-5xl md:text-6xl font-black uppercase tracking-wider text-val-red drop-shadow-[0_2px_10px_rgba(255,70,85,0.5)] transition-transform group-hover:translate-x-1">
            {t.play}
          </span>
        </button>

        <MenuItem label={t.leaderboard} onClick={() => setPanel('leaderboard')} />
        <MenuItem label={t.profile} onClick={() => setPanel('profile')} />
        <MenuItem label={t.credits} onClick={() => setPanel('credits')} />
        <MenuItem label={`👋 ${t.support}`} onClick={() => setPanel('support')} />
        <MenuItem
          label={lang === 'en' ? '🌐 Language: EN' : '🌐 Bahasa: ID'}
          onClick={() => setLang(lang === 'en' ? 'id' : 'en')}
        />
      </nav>

      {/* ---------- Footer ---------- */}
      <footer className="absolute bottom-4 left-6 right-6 md:left-8 md:right-auto z-10 text-[9px] md:text-[10px] tracking-widest text-slate-500 leading-normal">
        {t.footerText}
      </footer>

      {/* ---------- Panels ---------- */}
      {panel === 'profile' && (
        <Modal title={t.profile} onClose={() => setPanel(null)}>
          <label className="mb-4 block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">
              {t.displayName}
            </span>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSave();
                  }
                }}
                maxLength={20}
                className="w-full sm:flex-1 rounded-2xl bg-black/20 px-4 py-2.5 text-sm text-white outline-none border border-white/10 focus:border-val-accent focus:bg-white/10 transition-all shadow-inner"
              />
              <button
                onClick={handleSave}
                disabled={tempName.trim() === name || !tempName.trim()}
                className={`w-full sm:w-auto rounded-2xl px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-white shadow-[0_8px_16px_rgba(0,0,0,0.2)] transition-all ${
                  tempName.trim() === name || !tempName.trim()
                    ? 'bg-white/5 border border-white/10 text-slate-400 cursor-not-allowed'
                    : 'bg-gradient-to-br from-white/20 to-white/10 border border-white/30 backdrop-blur-lg shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)] hover:from-white/30 hover:to-white/20 hover:scale-105 active:scale-95'
                }`}
              >
                {t.save}
              </button>
            </div>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <Stat label={t.bestScore} value={best.score} accent />
            <Stat label={t.bestAcc} value={`${best.accuracy ? best.accuracy.toFixed(0) : 0}%`} />
            <Stat label={t.bestSplit} value={`${best.split ? Math.round(best.split) : 0}ms`} />
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
            {t.profileTip}
          </p>
        </Modal>
      )}

      {panel === 'credits' && (
        <Modal title={t.credits} onClose={() => setPanel(null)}>
          <div className="space-y-3 text-sm">
            <CreditRow label={t.madeBy} value="ediiloupatty" />
            <CreditRow
              label={t.model3d}
              value="“1851 Colt Navy Revolver” — Steven Jurriaans (CC BY)"
            />
            <CreditRow label={t.builtWith} value="React · Three.js · Tailwind CSS" />
            <CreditRow label={t.inspiredBy} value="Valorant (Riot Games) — fan project" />
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
            {t.creditsTip}
          </p>
        </Modal>
      )}

      {panel === 'leaderboard' && (
        <Modal title={t.leaderboard} onClose={() => setPanel(null)}>
          <p className="-mt-2 mb-4 text-[11px] uppercase tracking-widest text-slate-400">
            {t.leaderboardSub}
          </p>
          {board === null ? (
            <p className="py-8 text-center text-sm text-slate-400">{t.leaderboardLoading}</p>
          ) : board.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">{t.leaderboardEmpty}</p>
          ) : (
            <ol className="space-y-1.5">
              {board.map((row, i) => {
                const isYou = row.deviceId === deviceId;
                const medal = ['🥇', '🥈', '🥉'][i];
                return (
                  <li
                    key={i}
                    className={`flex items-center gap-3 rounded-2xl px-4 py-3 border transition-all ${
                      isYou ? 'bg-gradient-to-r from-white/20 to-white/10 border-white/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_4px_12px_rgba(0,0,0,0.2)]' : 'bg-black/20 border-white/5'
                    }`}
                  >
                    <span className="w-7 shrink-0 text-center text-sm font-black tabular-nums text-slate-400">
                      {medal || i + 1}
                    </span>
                    <span className="flex-1 truncate text-sm font-bold text-white">
                      {row.name}
                      {isYou && (
                        <span className="ml-1.5 text-[10px] font-bold uppercase tracking-widest text-val-red">
                          {t.you}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-sm font-black tabular-nums text-val-accent">
                      {row.score.toLocaleString()}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Modal>
      )}

      {panel === 'support' && (
        <Modal title={t.sayHello} onClose={() => setPanel(null)}>
          <p className="mb-5 text-sm leading-relaxed text-slate-300">{t.supportMsg}</p>
          <div className="space-y-2.5">
            <a
              href={CONTACT.donate}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-white/20 to-white/10 border border-white/30 backdrop-blur-lg px-4 py-3 text-sm font-bold text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.3),0_8px_16px_rgba(0,0,0,0.2)] transition-all hover:from-white/30 hover:to-white/20 hover:scale-105 active:scale-95"
            >
              {t.donate}
            </a>
            <a
              href={`mailto:${CONTACT.email}`}
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-md px-4 py-3 text-sm font-bold text-slate-200 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] transition-all hover:from-white/15 hover:to-white/5 hover:scale-105 active:scale-95"
            >
              {t.helloBtn}
            </a>
            <a
              href={CONTACT.github}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-md px-4 py-3 text-sm font-bold text-slate-200 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] transition-all hover:from-white/15 hover:to-white/5 hover:scale-105 active:scale-95"
            >
              {t.github}
            </a>
          </div>
        </Modal>
      )}

      {showMobileModal && (
        <Modal title={t.mobileTitle} onClose={() => setShowMobileModal(false)}>
          <p className="mb-6 text-xs md:text-sm leading-relaxed text-slate-300">
            {t.mobileText}
          </p>
          <button
            onClick={() => setShowMobileModal(false)}
            className="w-full rounded-2xl bg-gradient-to-br from-white/20 to-white/10 border border-white/30 backdrop-blur-lg py-3 text-xs md:text-sm font-bold uppercase tracking-wider text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.3),0_8px_16px_rgba(0,0,0,0.2)] transition-all hover:from-white/30 hover:to-white/20 hover:scale-105 active:scale-95"
          >
            {t.gotIt}
          </button>
        </Modal>
      )}
    </div>
  );
}

function WindFX() {
  // Pre-compute a set of streaks with varied position / length / speed so the
  // gusts feel layered rather than uniform.
  const streaks = useMemo(
    () =>
      Array.from({ length: 22 }, () => ({
        top: Math.random() * 100, // vertical position (%)
        width: 120 + Math.random() * 280, // streak length (px)
        height: Math.random() < 0.25 ? 3 : Math.random() < 0.6 ? 2 : 1, // thickness
        duration: 3 + Math.random() * 4.5, // seconds to cross
        delay: -Math.random() * 8, // negative → already mid-flight on load
        opacity: 0.25 + Math.random() * 0.55,
      })),
    []
  );
  return (
    <div
      className="pointer-events-none absolute -inset-[20%] z-[1] overflow-hidden"
      style={{ transform: 'rotate(-12deg)' }} // wind direction (up-left)
      aria-hidden="true"
    >
      {streaks.map((s, i) => (
        <span
          key={i}
          className="wind-streak"
          style={{
            top: `${s.top}%`,
            width: `${s.width}px`,
            height: `${s.height}px`,
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
            '--o': s.opacity,
          }}
        />
      ))}
    </div>
  );
}

function MenuItem({ label, onClick }) {
  return (
    <button onClick={onClick} className="group flex items-center gap-3 text-left">
      <span className="h-4 md:h-5 w-1 bg-transparent transition-all group-hover:bg-white" />
      <span className="text-xl md:text-2xl font-black uppercase tracking-wider text-slate-300 transition-all group-hover:translate-x-1 group-hover:text-white">
        {label}
      </span>
    </button>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4 transition-all"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[80dvh] overflow-y-auto no-scrollbar rounded-[1.5rem] md:rounded-[2rem] border border-white/20 bg-gradient-to-br from-white/10 to-white/5 p-5 md:p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_8px_32px_0_rgba(0,0,0,0.4)] backdrop-blur-2xl backdrop-saturate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-black uppercase tracking-widest text-val-red">{title}</h2>
          <button
            onClick={onClose}
            className="rounded px-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 backdrop-blur-lg p-3 text-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]">
      <p className="text-[9px] uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`text-lg font-black tabular-nums ${accent ? 'text-val-accent' : 'text-white'}`}>
        {value}
      </p>
    </div>
  );
}

function CreditRow({ label, value }) {
  return (
    <div className="flex flex-col border-b border-white/5 pb-2">
      <span className="text-[10px] uppercase tracking-widest text-slate-400">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}
