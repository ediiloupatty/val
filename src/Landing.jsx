import React, { useEffect, useMemo, useState } from 'react';
import { TEXT } from './translations.js';

// Landing background (converted from PNG → WebP for a much smaller file).
const BG_URL = '/img/jett-background.webp';

export default function Landing({ onPlay, lang, setLang, isMobile, name, setName, best }) {
  const [panel, setPanel] = useState(null); // 'profile' | 'credits' | null
  const [showMobileModal, setShowMobileModal] = useState(false);
  const [tempName, setTempName] = useState(name);
  const t = TEXT[lang] || TEXT.en;

  useEffect(() => {
    setTempName(name);
  }, [name]);

  const handleSave = () => {
    const trimmed = tempName.trim();
    if (trimmed && trimmed !== name) {
      setName(trimmed);
    }
  };

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-val-dark font-mono text-white select-none"
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

        <MenuItem label={t.profile} onClick={() => setPanel('profile')} />
        <MenuItem label={t.credits} onClick={() => setPanel('credits')} />
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
            <div className="flex gap-2">
              <input
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSave();
                  }
                }}
                maxLength={20}
                className="flex-1 rounded bg-black/40 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-val-red"
              />
              <button
                onClick={handleSave}
                disabled={tempName.trim() === name || !tempName.trim()}
                className={`rounded px-4 py-2 text-sm font-bold uppercase tracking-wider text-white transition ${
                  tempName.trim() === name || !tempName.trim()
                    ? 'bg-slate-700/50 text-slate-400 cursor-not-allowed'
                    : 'bg-val-red hover:brightness-110'
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

      {showMobileModal && (
        <Modal title={t.mobileTitle} onClose={() => setShowMobileModal(false)}>
          <p className="mb-6 text-xs md:text-sm leading-relaxed text-slate-300">
            {t.mobileText}
          </p>
          <button
            onClick={() => setShowMobileModal(false)}
            className="w-full rounded bg-val-red py-2.5 text-xs md:text-sm font-bold uppercase tracking-wider text-white transition hover:brightness-110"
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
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-white/10 bg-val-panel/95 p-6 shadow-2xl"
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
    <div className="rounded-md bg-black/30 p-2.5 text-center">
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
