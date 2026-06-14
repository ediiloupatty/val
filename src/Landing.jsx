import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TEXT } from './translations.js';
import { fetchLeaderboard, fetchRank, fetchDonations, fetchBackgrounds } from './api.js';
import { generateShareCard, CARD_TEMPLATES } from './shareCard.js';

// Landing background (converted from PNG → WebP for a much smaller file).
const BG_URL = '/img/jett-background.webp';

// Rotating landing background ("wallpaper of the day"). When on, one wallpaper
// is chosen deterministically per ROTATE_WINDOW_DAYS window, so it's identical
// on every reload within that window (no random flicker) and changes on its own
// when the window rolls over. The choice is cached in localStorage + preloaded,
// so reloads paint the right image immediately with no Jett-then-swap flash.
const ROTATE_BG = true;
const ROTATE_WINDOW_DAYS = 14; // length of each wallpaper window (14 = fortnightly)
// Rotation is anchored: window 0 begins at ROTATE_ANCHOR and shows
// ROTATE_START_KEY; each window after advances one wallpaper through the sorted
// R2 pool, wrapping around. This lets us pin which wallpaper shows "now".
const ROTATE_ANCHOR = Date.UTC(2026, 5, 14); // 2026-06-14
const ROTATE_START_KEY = 'zhranx15-05'; // wallpaper for the current window, then rotate
const BG_CACHE_KEY = 'vat_bg_cache'; // localStorage: last shown wallpaper URL

// Apology banner auto-expires one month after the cleanup (2026-06-14). It shows
// on every visit until this moment, then never appears again. Bump this date to
// run a future announcement.
const NOTICE_EXPIRY = new Date('2026-07-14T23:59:59+07:00').getTime();
// localStorage key remembering that the user closed the current banner (✕),
// keyed by NOTICE_EXPIRY so a new announcement re-shows automatically.
const NOTICE_DISMISS_KEY = 'vat_notice_dismissed';

// People credited in the Credits modal's "Special Thanks" section. Add an entry
// per contributor; `url` and `note` are optional.
const CONTRIBUTORS = [
  { name: 'Conradium', url: 'https://github.com/Conradium', note: 'Security report' },
  { name: 'Stephen', note: 'Gameplay exploit report' },
];

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
  const [lbRange, setLbRange] = useState('week'); // 'week' | 'all'
  const [myRankInfo, setMyRankInfo] = useState(null); // { rank, score } when outside top 10
  const [donations, setDonations] = useState([]); // recent Saweria supporters
  // Start from the last wallpaper we showed (cached) so reloads paint it
  // instantly — no flash of the bundled Jett image before the swap.
  const [bgUrl, setBgUrl] = useState(() => {
    if (typeof window === 'undefined') return BG_URL;
    try { return localStorage.getItem(BG_CACHE_KEY) || BG_URL; } catch { return BG_URL; }
  });
  // Landing announcement banner: shows until NOTICE_EXPIRY, then auto-hides for
  // everyone. Clicking ✕ dismisses it for good on this device — we remember the
  // dismissed banner by its expiry, so a future announcement (new NOTICE_EXPIRY)
  // shows again automatically.
  const [showNotice, setShowNotice] = useState(() => {
    if (Date.now() >= NOTICE_EXPIRY) return false;
    try { return localStorage.getItem(NOTICE_DISMISS_KEY) !== String(NOTICE_EXPIRY); } catch { return true; }
  });
  const dismissNotice = () => {
    setShowNotice(false);
    try { localStorage.setItem(NOTICE_DISMISS_KEY, String(NOTICE_EXPIRY)); } catch { /* ignore */ }
  };
  // Share-card state: the generated PNG (as an object URL for preview) + its Blob
  // (for the Web Share API), and a flag while the canvas is rendering.
  const [shareUrl, setShareUrl] = useState(null);
  const [shareBlob, setShareBlob] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [template, setTemplate] = useState('neon');
  const [showRank, setShowRank] = useState(true);
  const [rank, setRank] = useState(null);
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
    fetchLeaderboard(lbRange).then(({ rows, error }) => {
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
    const cleanup = loadLeaderboard();
    // Weekly rank is fetched separately so we can show a "you" row when the
    // player sits outside the visible top 10.
    if (deviceId) fetchRank(deviceId).then(setMyRankInfo);
    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, lbRange]);

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

  // Render the score card for a given template + rank into the preview state.
  const renderCard = async (tpl, rankVal) => {
    const blob = await generateShareCard({
      name,
      score: best.score,
      accuracy: best.accuracy,
      split: best.split,
      text: t,
      template: tpl,
      rank: rankVal,
    });
    const url = URL.createObjectURL(blob);
    setShareBlob(blob);
    setShareUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  };

  // Open the share panel: fetch the weekly rank, then preview the current template.
  const handleOpenShare = async () => {
    try {
      setSharing(true);
      const info = deviceId ? await fetchRank(deviceId) : null;
      const r = info?.rank ?? null;
      setRank(r);
      await renderCard(template, showRank ? r : null);
      setPanel('share');
    } catch {
      showToast?.(t.shareError, 'error');
    } finally {
      setSharing(false);
    }
  };

  // Switch template and re-render the preview.
  const handleSelectTemplate = async (tpl) => {
    if (tpl === template) return;
    setTemplate(tpl);
    try {
      setSharing(true);
      await renderCard(tpl, showRank ? rank : null);
    } catch {
      showToast?.(t.shareError, 'error');
    } finally {
      setSharing(false);
    }
  };

  // Toggle the rank badge on the card and re-render.
  const handleToggleRank = async () => {
    const next = !showRank;
    setShowRank(next);
    try {
      setSharing(true);
      await renderCard(template, next ? rank : null);
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
          url: 'https://aimku.xyz',
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

  // Recent supporters for the right-side card (empty array hides the card).
  useEffect(() => { fetchDonations().then(setDonations); }, []);

  // "Wallpaper of the day": pick one R2 wallpaper deterministically per
  // ROTATE_WINDOW_DAYS window, so every reload within the window shows the same
  // image (stable, no flicker) and it rotates on its own when the window rolls
  // over. The choice is preloaded before swapping (no half-loaded flash) and
  // cached so the next reload paints it immediately. Falls back to the bundled
  // Jett image if R2 is empty/unreachable.
  useEffect(() => {
    if (!ROTATE_BG) return;
    let alive = true;
    fetchBackgrounds().then((imgs) => {
      if (!alive || !imgs.length) return;
      // imgs come back sorted by the worker. Anchor on ROTATE_START_KEY so the
      // current window shows that wallpaper, then step forward one per window.
      const startIdx = Math.max(0, imgs.findIndex((u) => u.includes(ROTATE_START_KEY)));
      const windowsElapsed = Math.floor((Date.now() - ROTATE_ANCHOR) / (ROTATE_WINDOW_DAYS * 86400000));
      const idx = (((startIdx + windowsElapsed) % imgs.length) + imgs.length) % imgs.length;
      const chosen = imgs[idx];
      if (chosen === bgUrl) return; // already showing this window's pick — no swap needed
      // Preload before swapping so there's no flash of a half-loaded image.
      const pre = new Image();
      pre.onload = () => {
        if (!alive) return;
        setBgUrl(chosen);
        try { localStorage.setItem(BG_CACHE_KEY, chosen); } catch { /* ignore */ }
      };
      pre.src = chosen;
    });
    return () => { alive = false; };
  }, []);
  const formatRp = (n) => `Rp${Number(n || 0).toLocaleString('id-ID')}`;

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
          backgroundImage: `url('${bgUrl}')`,
          backgroundSize: 'cover',
          transition: 'background-image 0.4s ease',
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

      {/* ---------- Announcement banner ---------- */}
      {showNotice && (
        <div className="absolute left-1/2 top-16 z-30 w-[92%] max-w-md -translate-x-1/2 md:top-20">
          <div className="flex items-start gap-3 rounded-2xl border border-white/15 bg-black/50 px-4 py-3 shadow-lg backdrop-blur-sm">
            <span className="text-base leading-none">🙏</span>
            <p className="flex-1 text-[11px] leading-relaxed text-slate-100 md:text-xs">{t.noticeText}</p>
            <button
              onClick={dismissNotice}
              aria-label="Close"
              className="-mt-0.5 shrink-0 text-slate-300 transition-colors hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
      )}

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

      {/* ---------- Supporters (right side, minimal) ---------- */}
      {donations.length > 0 && (
        <aside className="absolute right-6 md:right-12 top-1/2 z-10 hidden w-52 -translate-y-1/2 flex-col gap-2.5 border-l border-white/10 pl-4 md:flex">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">
            ❤ {t.supporters}
          </p>
          <ul className="no-scrollbar flex max-h-[11rem] flex-col gap-2 overflow-y-auto pr-1">
            {donations.map((d, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-slate-200">{d.name}</span>
                <span className="shrink-0 font-bold tabular-nums text-val-accent">{formatRp(d.amount)}</span>
              </li>
            ))}
          </ul>
        </aside>
      )}

      {/* ---------- Footer ---------- */}
      <footer className="absolute bottom-4 left-6 right-6 md:left-8 md:right-auto z-10 text-[9px] md:text-[10px] tracking-widest text-slate-500 leading-normal">
        {t.footerText}
      </footer>

      {/* ---------- Background credit (every wallpaper, incl. the Jett one, is Zhranx15's work) ---------- */}
      <a
        href="https://alphacoders.com/users/profile/235636/Zhranx15"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-4 right-4 z-10 text-[8px] md:text-[9px] tracking-widest text-slate-500/70 transition-colors hover:text-slate-300"
      >
        Background by Zhranx15
      </a>

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
              className={`mx-auto max-h-[52vh] w-auto rounded-2xl border border-white/5 shadow-lg transition-opacity ${sharing ? 'opacity-50' : 'opacity-100'}`}
            />
          )}

          {/* Template picker — minimal underline tabs */}
          <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2.5">
            {CARD_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => handleSelectTemplate(tpl.id)}
                disabled={sharing}
                className={`border-b-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wider transition-colors disabled:opacity-50 ${
                  template === tpl.id
                    ? 'border-val-accent text-white'
                    : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                {tpl.name}
              </button>
            ))}
          </div>

          {/* Show-rank toggle — minimal switch */}
          <button
            onClick={handleToggleRank}
            disabled={sharing || !rank}
            className="mt-5 flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400 transition-opacity disabled:opacity-40"
          >
            <span>{t.showRankToggle}{rank ? ` (#${rank})` : ''}</span>
            <span className={`relative h-5 w-9 rounded-full transition-colors ${showRank && rank ? 'bg-val-accent/80' : 'bg-white/15'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${showRank && rank ? 'left-[1.125rem]' : 'left-0.5'}`} />
            </span>
          </button>

          {/* Actions — flat, borderless */}
          <div className="mt-5 flex gap-2">
            <button
              onClick={handleNativeShare}
              className="flex-1 rounded-xl bg-val-accent/15 px-5 py-3 text-sm font-semibold uppercase tracking-wider text-val-accent transition-colors hover:bg-val-accent/25 active:scale-95"
            >
              {t.shareBtn}
            </button>
            <button
              onClick={handleDownload}
              className="flex-1 rounded-xl bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-wider text-slate-300 transition-colors hover:bg-white/10 hover:text-white active:scale-95"
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
              value="“1851 Colt Navy Revolver” - Steven Jurriaans (CC BY)"
            />
            <CreditRow label={t.builtWith} value="React · Three.js · Tailwind CSS" />
            <CreditRow label={t.inspiredBy} value="Valorant (Riot Games) - fan project" />
          </div>
          {CONTRIBUTORS.length > 0 && (
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="mb-2 text-[10px] uppercase tracking-widest text-slate-400">
                {t.specialThanks}
              </p>
              <ul className="space-y-1.5">
                {CONTRIBUTORS.map((c) => (
                  <li key={c.name} className="flex items-center justify-between gap-2 text-sm">
                    {c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-val-accent hover:underline"
                      >
                        {c.name}
                      </a>
                    ) : (
                      <span className="font-bold text-white">{c.name}</span>
                    )}
                    {c.note && <span className="text-[11px] text-slate-400">{c.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
            {t.creditsTip}
          </p>
        </Modal>
      )}

      {panel === 'leaderboard' && (
        <Modal title={t.leaderboard} onClose={() => setPanel(null)}>
          <div className="-mt-2 mb-4 flex items-center justify-between gap-2">
            <div className="flex rounded-full bg-white/5 p-0.5">
              {[['week', t.lbWeekly], ['all', t.lbAllTime]].map(([r, label]) => (
                <button
                  key={r}
                  onClick={() => setLbRange(r)}
                  className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                    lbRange === r ? 'bg-val-accent/20 text-val-accent' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={loadLeaderboard}
              disabled={board === null}
              className="text-[10px] uppercase tracking-widest text-val-accent hover:opacity-80 disabled:opacity-30 transition-opacity"
            >
              ↻ {t.leaderboardRetry}
            </button>
          </div>
          <div className="h-[50vh] overflow-y-auto overscroll-contain no-scrollbar md:h-[55vh]">
          {board === null ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-[#00e5c0]" />
            </div>
          ) : boardError ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="mb-3 text-sm text-slate-400">{t.leaderboardError}</p>
              <button
                onClick={loadLeaderboard}
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-all hover:bg-white/15"
              >
                {t.leaderboardRetry}
              </button>
            </div>
          ) : board.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-center text-sm text-slate-400">{t.leaderboardEmpty}</p>
            </div>
          ) : (
            <>
            <ol key={lbRange} className="animate-lb space-y-1.5">
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
            {lbRange === 'week' && myRankInfo && !board.some((r) => r.deviceId === deviceId) && (
              <div className="mt-3 border-t border-white/10 pt-3">
                <div className="flex items-center gap-3 rounded-2xl border border-val-accent/30 bg-val-accent/10 px-4 py-3">
                  <span className="w-7 shrink-0 text-center text-sm font-black tabular-nums text-slate-400">
                    {myRankInfo.rank}
                  </span>
                  <span className="flex-1 truncate text-sm font-bold text-white">
                    {name}
                    <span className="ml-1.5 text-[10px] font-bold uppercase tracking-widest text-val-red">
                      {t.you}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-black tabular-nums text-val-accent">
                    {(myRankInfo.score || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            )}
            </>
          )}
          </div>
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
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className="no-scrollbar w-full max-w-md max-h-[80dvh] overflow-y-auto overscroll-contain rounded-[2rem] border border-white/10 bg-[#141d24]/80 p-7 shadow-2xl backdrop-blur-xl focus:outline-none"
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
