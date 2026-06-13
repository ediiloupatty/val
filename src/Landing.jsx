import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TEXT } from './translations.js';
import { fetchLeaderboard } from './api.js';
import { generateShareCard } from './shareCard.js';

// Landing background (converted from PNG → WebP for a much smaller file).
const BG_URL = '/img/jett-background.webp';

// Contact / support destinations — edit to your own links.
const CONTACT = {
  email: 'muhammadlikmansyah143@gmail.com',
  donate: 'https://saweria.co/ediloupatty',
  github: 'https://github.com/ediiloupatty', // ← your profile
};

export default function Landing({ onPlay, lang, setLang, isMobile, name, setName, best, deviceId, profileLoading, showToast }) {
  const [panel, setPanel] = useState(null);
  const [showMobileModal, setShowMobileModal] = useState(false);
  const [tempName, setTempName] = useState(name);
  const [board, setBoard] = useState(null);
  const [boardError, setBoardError] = useState(false);
  // Share-card state: the generated PNG (as an object URL for preview) + its Blob
  // (for the Web Share API), and a flag while the canvas is rendering.
  const [shareUrl, setShareUrl] = useState(null);
  const [shareBlob, setShareBlob] = useState(null);
  const [sharing, setSharing] = useState(false);
  const t = TEXT[lang] || TEXT.en;

  // ---------- 3D parallax refs (no React state — driven by rAF) ----------
  const bgRef     = useRef(null); // background image layer
  const rafRef    = useRef(null);
  const targetRef = useRef({ x: 0.5, y: 0.5 }); // raw mouse (0-1)
  const curRef    = useRef({ x: 0.5, y: 0.5 }); // lerped position

  useEffect(() => {
    const onMouseMove = (e) => {
      targetRef.current = {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      };
    };

    // Lerp factor — lower = smoother / more lag (feels "heavy" and cinematic).
    const LERP = 0.055;
    // Max parallax shift in px. The bg layer is oversized (-8% inset) to avoid clipping.
    const MAX_X = 38;
    const MAX_Y = 24;

    const tick = () => {
      const c = curRef.current;
      const t = targetRef.current;
      // Exponential lerp toward target
      c.x += (t.x - c.x) * LERP;
      c.y += (t.y - c.y) * LERP;

      if (bgRef.current) {
        const tx = (c.x - 0.5) * -MAX_X * 2;
        const ty = (c.y - 0.5) * -MAX_Y * 2;
        bgRef.current.style.transform = `scale(1.12) translate(${tx}px, ${ty}px)`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    window.addEventListener('mousemove', onMouseMove);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);
  // -----------------------------------------------------------------------

  useEffect(() => { setTempName(name); }, [name]);

  const loadLeaderboard = () => {
    let alive = true;
    setBoard(null);
    setBoardError(false);
    fetchLeaderboard().then(({ rows, error }) => {
      if (!alive) return;
      if (error) {
        setBoardError(true);
        setBoard([]);
      } else {
        setBoard(rows || []);
      }
    });
    return () => { alive = false; };
  };

  useEffect(() => {
    if (panel !== 'leaderboard') return;
    return loadLeaderboard();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  // Check for a session backup left by a browser crash / unexpected close.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('vat_session_backup');
      if (!raw) return;
      const backup = JSON.parse(raw);
      const age = Date.now() - backup.ts;
      if (backup.score > 0 && age < 30 * 60 * 1000) {
        showToast?.(t.sessionBackupMsg.replace('{score}', backup.score.toLocaleString()), 'info');
      }
      localStorage.removeItem('vat_session_backup');
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = () => {
    const trimmed = tempName.trim();
    if (trimmed && trimmed !== name) setName(trimmed);
  };

  // Render the score card and open the share panel with a live preview.
  const handleOpenShare = async () => {
    try {
      setSharing(true);
      const blob = await generateShareCard({
        name,
        score: best.score,
        accuracy: best.accuracy,
        split: best.split,
        text: t,
      });
      const url = URL.createObjectURL(blob);
      setShareBlob(blob);
      setShareUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setPanel('share');
    } catch {
      showToast?.(t.shareError, 'error');
    } finally {
      setSharing(false);
    }
  };

  // Native share sheet (mobile / supported browsers); falls back to download.
  const handleNativeShare = async () => {
    if (!shareBlob) return;
    const file = new File([shareBlob], 'aimku-score.png', { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: t.shareCardTitle,
          text: t.shareText.replace('{score}', best.score),
          files: [file],
        });
      } else {
        handleDownload();
      }
    } catch (err) {
      // User cancelling the share sheet throws AbortError — not an error to surface.
      if (err?.name !== 'AbortError') showToast?.(t.shareError, 'error');
    }
  };

  const handleDownload = () => {
    if (!shareUrl) return;
    const a = document.createElement('a');
    a.href = shareUrl;
    a.download = 'aimku-score.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast?.(t.shareDownloaded, 'success');
  };

  // Release the preview object URL when the component unmounts.
  useEffect(() => () => { if (shareUrl) URL.revokeObjectURL(shareUrl); }, [shareUrl]);

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-val-dark font-sans text-white select-none">

      {/* ---- Parallax background image — shifts with mouse (3D depth illusion) ---- */}
      <div
        ref={bgRef}
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          // Oversized by 12% on each side so the translate never reveals a gap.
          inset: '-8%',
          backgroundImage: `url('${BG_URL}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center right',
          willChange: 'transform',
        }}
      />

      {/* ---- Fixed gradient overlay — stays perfectly still ---- */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: [
            'linear-gradient(90deg, rgba(15,20,25,0.96) 0%, rgba(15,20,25,0.72) 26%, rgba(15,20,25,0.22) 58%, rgba(15,20,25,0.55) 100%)',
            'radial-gradient(70% 90% at 50% 100%, rgba(15,20,25,0.6), transparent 60%)',
          ].join(', '),
        }}
      />

      {/* Wind effect */}
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
          {profileLoading ? (
            <div className="mb-1 ml-auto h-3 w-20 animate-pulse rounded bg-white/10" />
          ) : (
            <p
              className={`text-sm md:text-base font-black tracking-wide truncate max-w-[140px] ${
                name === 'Agent' ? 'text-slate-500' : 'text-white'
              }`}
            >
              {name}
            </p>
          )}
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
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-slate-400">
                {t.displayName}
              </span>
              <span className={`text-[10px] tabular-nums ${tempName.length >= 18 ? 'text-val-red' : 'text-slate-500'}`}>
                {tempName.length}/20
              </span>
            </div>
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
                className={`w-full sm:w-auto rounded-2xl px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-white transition-all ${
                  tempName.trim() === name || !tempName.trim()
                    ? 'opacity-40 cursor-not-allowed bg-white/5 border border-white/10 text-slate-400'
                    : 'border border-white/20 bg-white/10 hover:bg-white/15 hover:scale-105 active:scale-95'
                }`}
              >
                {t.save}
              </button>
            </div>
          </label>
          {profileLoading ? (
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-center">
                  <p className="text-[9px] uppercase tracking-widest text-slate-600">&nbsp;</p>
                  <div className="mx-auto mt-1 h-5 w-10 animate-pulse rounded bg-white/10" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <Stat label={t.bestScore} value={best.score} accent />
              <Stat label={t.bestAcc} value={`${best.accuracy ? best.accuracy.toFixed(0) : 0}%`} />
              <Stat label={t.bestSplit} value={`${best.split ? Math.round(best.split) : 0}ms`} />
            </div>
          )}
          {!profileLoading && best.score > 0 && (
            <button
              onClick={handleOpenShare}
              disabled={sharing}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-val-accent/40 bg-val-accent/10 px-5 py-3 text-sm font-bold uppercase tracking-wider text-val-accent transition-all hover:scale-[1.02] hover:bg-val-accent/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              {sharing ? t.shareGenerating : `📤 ${t.share}`}
            </button>
          )}
          <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
            {t.profileTip}
          </p>
        </Modal>
      )}

      {panel === 'share' && (
        <Modal title={t.shareCardTitle} onClose={() => setPanel('profile')}>
          {shareUrl && (
            <img
              src={shareUrl}
              alt={t.shareCardTitle}
              className="mx-auto max-h-[58vh] w-auto rounded-2xl border border-white/10 shadow-lg"
            />
          )}
          <div className="mt-4 flex gap-2">
            <button
              onClick={handleNativeShare}
              className="flex-1 rounded-2xl border border-val-accent/40 bg-val-accent/10 px-5 py-3 text-sm font-bold uppercase tracking-wider text-val-accent transition-all hover:bg-val-accent/20 active:scale-95"
            >
              {t.shareBtn}
            </button>
            <button
              onClick={handleDownload}
              className="flex-1 rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-sm font-bold uppercase tracking-wider text-white transition-all hover:bg-white/15 active:scale-95"
            >
              {t.downloadBtn}
            </button>
          </div>
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
          <div className="-mt-2 mb-4 flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-widest text-slate-400">
              {t.leaderboardSub}
            </p>
            <button
              onClick={loadLeaderboard}
              disabled={board === null}
              className="text-[10px] uppercase tracking-widest text-val-accent hover:opacity-80 disabled:opacity-30 transition-opacity"
            >
              ↻ {t.leaderboardRetry}
            </button>
          </div>
          {board === null ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-[#00e5c0]" />
            </div>
          ) : boardError ? (
            <div className="py-6 text-center">
              <p className="mb-3 text-sm text-slate-400">{t.leaderboardError}</p>
              <button
                onClick={loadLeaderboard}
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-all hover:bg-white/15"
              >
                {t.leaderboardRetry}
              </button>
            </div>
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
                    className={`flex items-center gap-3 rounded-2xl px-4 py-3 transition-all ${
                      isYou
                        ? 'border border-val-accent/30 bg-val-accent/10'
                        : 'bg-white/5'
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
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-bold text-white transition-all hover:bg-white/15 hover:scale-105 active:scale-95"
            >
              {t.donate}
            </a>
            <a
              href={`mailto:${CONTACT.email}`}
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-transparent px-4 py-3 text-sm font-bold text-slate-300 transition-colors hover:bg-white/5"
            >
              {t.helloBtn}
            </a>
            <a
              href={CONTACT.github}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-transparent px-4 py-3 text-sm font-bold text-slate-300 transition-colors hover:bg-white/5"
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
            className="w-full rounded-2xl border border-white/20 bg-white/10 py-3 text-xs md:text-sm font-bold uppercase tracking-wider text-white transition-all hover:bg-white/15 hover:scale-105 active:scale-95"
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
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className="no-scrollbar w-full max-w-md max-h-[80dvh] overflow-y-auto rounded-[2rem] border border-white/10 bg-[#141d24] p-7 shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="modal-title" className="text-xl font-black uppercase tracking-widest text-val-red">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white text-sm"
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
    <div className="rounded-2xl bg-white/5 p-3 text-center">
      <p className="text-[9px] uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`text-lg font-black tabular-nums ${accent ? 'text-val-accent' : 'text-white'}`}>
        {value}
      </p>
    </div>
  );
}

function CreditRow({ label, value }) {
  return (
    <div className="flex flex-col pb-2">
      <span className="text-[10px] uppercase tracking-widest text-slate-400">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}
