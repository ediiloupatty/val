import React, { useEffect, useState } from 'react';
import { fetchShop, fetchValorantOverview, fetchValorantInventory } from './api.js';
import { getTurnstileToken } from './turnstile.js';
import { AUTH_URL, extractTokens, saveSession, loadSession, clearSession } from './riotSession.js';

// VALORANT account hub. The user logs in once on Riot's own page (Riot handles
// captcha + 2FA), pastes the redirect URL, and we keep them logged in — via a
// browser-stored session — until they log out or the token expires (~1h).
// Password never touches our server.

const VP_ICON =
  'https://media.valorant-api.com/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png';
const RAD_ICON =
  'https://media.valorant-api.com/currencies/e59aa87c-4cbf-517a-5983-6e81511be9b7/displayicon.png';

const vp = (n) => (n != null ? Number(n).toLocaleString('id-ID') : '—');

function formatCountdown(totalSeconds) {
  const s = Math.max(0, Number(totalSeconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}j ${m}m`;
}

function isExpiredError(msg) {
  return /kadaluarsa|expired|tidak valid/i.test(msg || '');
}

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-val-panel p-3 sm:p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-white sm:text-2xl">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400 sm:text-xs">{sub}</p>}
    </div>
  );
}

function SkinCard({ skin }) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-val-panel p-4 transition-colors hover:border-val-accent/40 sm:p-5">
      <div className="flex min-h-[6rem] items-center justify-center sm:min-h-[7rem]">
        {skin.image ? (
          <img src={skin.image} alt={skin.name} className="max-h-24 w-full object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)] transition-transform group-hover:scale-105 sm:max-h-28" loading="lazy" />
        ) : (
          <div className="h-24 w-full rounded-lg bg-white/5" />
        )}
      </div>
      <p className="mt-3 text-sm font-bold uppercase tracking-wide text-white sm:mt-4">{skin.name}</p>
      <div className="mt-2 flex items-center gap-3">
        {skin.discountPrice != null ? (
          <>
            <span className="flex items-center gap-1.5 text-val-accent">
              <img src={VP_ICON} alt="VP" className="h-4 w-4" />
              <span className="font-bold tabular-nums">{vp(skin.discountPrice)}</span>
            </span>
            {skin.basePrice != null && (
              <span className="text-xs text-slate-500 line-through tabular-nums">{vp(skin.basePrice)}</span>
            )}
            {skin.discountPercent != null && (
              <span className="rounded bg-val-red/20 px-1.5 py-0.5 text-xs font-bold text-val-red">-{skin.discountPercent}%</span>
            )}
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-val-accent">
            <img src={VP_ICON} alt="VP" className="h-4 w-4" />
            <span className="font-bold tabular-nums">{vp(skin.price)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function IdentityHeader({ identity, onLogout }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-val-panel p-3 sm:gap-3 sm:p-4">
      {identity?.card && <img src={identity.card} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover sm:h-12 sm:w-12" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black text-white sm:text-base">{identity?.displayName || 'Pemain'}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {identity?.level != null && (
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 sm:text-xs">Lv {identity.level}</span>
          )}
          {identity?.rank?.name && identity.rank.name !== 'Unranked' ? (
            <span className="flex items-center gap-1.5">
              {identity.rank.icon && <img src={identity.rank.icon} alt="" className="h-4 w-4 sm:h-5 sm:w-5" />}
              <span className="text-[11px] font-bold uppercase tracking-wider sm:text-xs" style={identity.rank.color ? { color: identity.rank.color } : undefined}>
                {identity.rank.name}
              </span>
            </span>
          ) : (
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 sm:text-xs">Unranked</span>
          )}
        </div>
      </div>
      <button
        onClick={onLogout}
        className="shrink-0 rounded-xl border border-white/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300 transition-colors hover:border-val-red/50 hover:text-val-red sm:px-4 sm:py-2 sm:text-xs"
      >
        Logout
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-val-accent" />
    </div>
  );
}

export default function ValorantHub({ onExit, onIdentity, onLogout }) {
  const [session, setSession] = useState(() => loadSession());
  const [redirectUrl, setRedirectUrl] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [tab, setTab] = useState('dashboard'); // 'dashboard' | 'store' | 'night'

  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');

  const [store, setStore] = useState(null);      // { shop, nightMarket }
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState('');

  const [inventory, setInventory] = useState(null); // { count, totalValueVp, skins }
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState('');

  const doLogout = () => {
    clearSession();
    setSession(null);
    setOverview(null);
    setStore(null);
    setInventory(null);
    setTab('dashboard');
    setRedirectUrl('');
    onLogout?.();
  };

  const handleExpired = () => {
    clearSession();
    setSession(null);
    setOverview(null);
    setStore(null);
    setInventory(null);
    setLoginError('Sesi berakhir (token kadaluarsa ~1 jam). Silakan login lagi.');
  };

  // Load the dashboard when we get a session (login or a persisted one on mount).
  // Depend on `session` ONLY — including the loading/overview state here would let
  // this effect's cleanup cancel its own in-flight request the moment it flips
  // `overviewLoading`, leaving the spinner stuck forever.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      setOverviewLoading(true);
      setOverviewError('');
      const turnstileToken = await getTurnstileToken();
      const res = await fetchValorantOverview(session, turnstileToken);
      if (cancelled) return;
      setOverviewLoading(false);
      if (!res.ok) {
        if (isExpiredError(res.error)) return handleExpired();
        setOverviewError(res.error);
        return;
      }
      setOverview(res.overview);
      if (res.overview?.identity?.displayName) onIdentity?.(res.overview.identity);
    })();
    return () => {
      cancelled = true;
    };
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadStore = async () => {
    if (store || storeLoading || !session) return;
    setStoreLoading(true);
    setStoreError('');
    const turnstileToken = await getTurnstileToken();
    const res = await fetchShop(session, turnstileToken);
    setStoreLoading(false);
    if (!res.ok) {
      if (isExpiredError(res.error)) return handleExpired();
      setStoreError(res.error);
      return;
    }
    setStore({ shop: res.shop, nightMarket: res.nightMarket });
  };

  const loadInventory = async () => {
    if (inventory || inventoryLoading || !session) return;
    setInventoryLoading(true);
    setInventoryError('');
    const turnstileToken = await getTurnstileToken();
    const res = await fetchValorantInventory(session, turnstileToken);
    setInventoryLoading(false);
    if (!res.ok) {
      if (isExpiredError(res.error)) return handleExpired();
      setInventoryError(res.error);
      return;
    }
    setInventory(res.inventory);
  };

  const goTab = (next) => {
    setTab(next);
    if (next === 'store' || next === 'night') loadStore();
    if (next === 'inventory') loadInventory();
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    const url = redirectUrl.trim();
    if (!url || loggingIn) return;
    const tokens = extractTokens(url);
    if (!tokens) {
      setLoginError('URL belum berisi token. Salin URL lengkap dari address bar (harus ada "access_token").');
      return;
    }
    setLoggingIn(true);
    setLoginError('');
    saveSession(tokens);
    setRedirectUrl('');
    setSession(tokens); // triggers the overview load effect
    setLoggingIn(false);
  };

  return (
    <div className="h-[100dvh] w-full overflow-y-auto overflow-x-hidden bg-val-dark text-white">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-5 sm:px-8 sm:py-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <button onClick={onExit} className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-400 transition-colors hover:text-white">
            ← Kembali
          </button>
          <h1 className="text-lg font-black uppercase tracking-wider text-val-red">Valorant</h1>
        </div>

        {/* ---------- Not logged in: login flow ---------- */}
        {!session && (
          <div className="flex flex-col gap-6">
            <div className="rounded-2xl border border-val-accent/30 bg-val-accent/10 p-4 text-sm text-slate-200">
              <p className="font-bold text-val-accent">🔒 Login lewat halaman Riot asli</p>
              <p className="mt-1.5 leading-relaxed text-slate-300">
                Kamu login di halaman Riot sendiri — <b>password kamu tidak pernah masuk ke web ini</b>.
                Setelah login, kamu tetap masuk sampai klik Logout (atau ~1 jam saat token Riot kadaluarsa).
              </p>
            </div>

            <ol className="flex flex-col gap-4">
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-val-red text-sm font-black">1</span>
                <div className="flex-1">
                  <p className="text-sm text-slate-300">Buka halaman login Riot, lalu login seperti biasa.</p>
                  <a href={AUTH_URL} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-2 rounded-xl bg-val-red px-5 py-2.5 text-sm font-black uppercase tracking-wider text-white transition-opacity hover:opacity-90">
                    Buka Login Riot ↗
                  </a>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-val-red text-sm font-black">2</span>
                <p className="flex-1 text-sm text-slate-300">
                  Setelah login, browser pindah ke halaman <b className="text-white">error/blank</b> di{' '}
                  <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">localhost</code> — itu normal.
                  <b className="text-white"> Salin seluruh URL</b> dari address bar.
                </p>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-val-red text-sm font-black">3</span>
                <p className="flex-1 text-sm text-slate-300">Tempel URL-nya di sini:</p>
              </li>
            </ol>

            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <input
                type="text"
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-val-panel px-4 py-3 text-sm text-white outline-none transition-colors focus:border-val-accent"
                placeholder="http://localhost/redirect#access_token=..."
              />
              {loginError && <p className="text-sm font-semibold text-val-red">{loginError}</p>}
              <button type="submit" disabled={loggingIn || !redirectUrl} className="flex items-center justify-center gap-2 rounded-xl bg-val-accent px-6 py-3 font-black uppercase tracking-wider text-val-dark transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                Masuk
              </button>
            </form>
          </div>
        )}

        {/* ---------- Logged in: hub ---------- */}
        {session && (
          <div className="flex flex-col gap-5">
            <IdentityHeader identity={overview?.identity} onLogout={doLogout} />

            {/* Tabs — horizontally scrollable on narrow screens */}
            <div className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto border-b border-white/10 px-4 sm:mx-0 sm:gap-2 sm:px-0">
              {[
                ['dashboard', 'Dashboard'],
                ['inventory', 'Inventory'],
                ['store', 'Toko'],
                ['night', 'Night Market'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => goTab(key)}
                  className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors sm:px-4 sm:text-sm ${
                    tab === key ? 'border-val-accent text-white' : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Dashboard */}
            {tab === 'dashboard' && (
              <>
                {overviewLoading && <Spinner />}
                {overviewError && <p className="text-sm font-semibold text-val-red">{overviewError}</p>}
                {overview && (
                  <div className="flex flex-col gap-5">
                    {/* Wallet */}
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
                      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-val-panel p-3 sm:p-4">
                        <img src={VP_ICON} alt="VP" className="h-6 w-6 shrink-0" />
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">Valorant Points</p>
                          <p className="truncate text-base font-black tabular-nums text-val-accent sm:text-lg">{vp(overview.wallet?.vp)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-val-panel p-3 sm:p-4">
                        <img src={RAD_ICON} alt="RP" className="h-6 w-6 shrink-0" />
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">Radianite</p>
                          <p className="truncate text-base font-black tabular-nums text-white sm:text-lg">{vp(overview.wallet?.radianite)}</p>
                        </div>
                      </div>
                      {overview.wallet?.kingdom != null && (
                        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-val-panel p-3 sm:p-4">
                          <div className="min-w-0">
                            <p className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">Kingdom Credits</p>
                            <p className="truncate text-base font-black tabular-nums text-white sm:text-lg">{vp(overview.wallet.kingdom)}</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Estimated total VP value of the skin collection (hero card) */}
                    {overview.inventory ? (
                      <div className="rounded-2xl border border-val-accent/40 bg-gradient-to-br from-val-accent/15 to-transparent p-4 sm:p-5">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-val-accent">Estimasi Total VP Skin</p>
                        <div className="mt-1 flex items-end gap-2">
                          <img src={VP_ICON} alt="VP" className="mb-1 h-6 w-6 shrink-0 sm:mb-1.5 sm:h-7 sm:w-7" />
                          <span className="text-3xl font-black leading-none tabular-nums text-white sm:text-4xl">
                            {vp(overview.inventory.collectionValueVp)}
                          </span>
                          <span className="mb-0.5 text-sm font-bold text-slate-400 sm:mb-1">VP</span>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-slate-400">
                          Estimasi dari <b className="text-slate-300">{vp(overview.inventory.pricedSkinCount)} skin berharga</b> yang kamu miliki
                          (total {vp(overview.inventory.ownedSkinCount)} skin unik). Dihitung dari harga standar per content tier
                          (Select/Deluxe/Premium/Exclusive/Ultra) — <b className="text-slate-300">bukan</b> uang asli yang dikeluarkan.
                          Skin gratis/battlepass/default tidak dihitung.
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-val-panel p-4 text-sm text-slate-400">
                        Data inventory tidak tersedia (mungkin timeout dari Riot). Coba buka lagi menu ini.
                      </div>
                    )}

                    {/* Battlepass */}
                    {overview.battlepass ? (
                      <div className="rounded-2xl border border-white/10 bg-val-panel p-4">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{overview.battlepass.name || 'Battlepass'}</p>
                          <p className="text-sm font-black text-white">
                            Tier {overview.battlepass.tier}<span className="text-slate-500"> / {overview.battlepass.totalLevels}</span>
                          </p>
                        </div>
                        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-val-accent"
                            style={{ width: `${Math.min(100, (overview.battlepass.tier / (overview.battlepass.totalLevels || 50)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-val-panel p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Battlepass</p>
                        <p className="mt-1 text-sm text-slate-400">Tidak terdeteksi (mungkin belum punya battlepass aktif).</p>
                      </div>
                    )}

                    {/* Account counts */}
                    {overview.account && (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <StatCard label="Level Akun" value={vp(overview.account.level)} />
                        <StatCard label="Agent" value={vp(overview.account.agentCount)} />
                        <StatCard label="Player Card" value={vp(overview.account.cardCount)} />
                        <StatCard label="Spray" value={vp(overview.account.sprayCount)} />
                        <StatCard label="Buddy" value={vp(overview.account.buddyCount)} />
                        <StatCard label="Title" value={vp(overview.account.titleCount)} />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Inventory — owned skins */}
            {tab === 'inventory' && (
              <>
                {inventoryLoading && <Spinner />}
                {inventoryError && <p className="text-sm font-semibold text-val-red">{inventoryError}</p>}
                {inventory && (
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-3">
                      <StatCard label="Total skin dimiliki" value={vp(inventory.count)} />
                      <StatCard label="Nilai (est.)" value={`${vp(inventory.totalValueVp)} VP`} sub="Estimasi dari content tier" />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {inventory.skins.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-val-panel p-3"
                          style={s.tierColor ? { borderColor: `${s.tierColor}55` } : undefined}
                        >
                          {s.image ? (
                            <img src={s.image} alt="" className="h-9 w-20 shrink-0 object-contain sm:h-10 sm:w-24" loading="lazy" />
                          ) : (
                            <div className="h-9 w-20 shrink-0 rounded bg-white/5 sm:h-10 sm:w-24" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-white">{s.name}</p>
                            {s.price != null && (
                              <span className="flex items-center gap-1 text-xs text-val-accent">
                                <img src={VP_ICON} alt="VP" className="h-3.5 w-3.5" />
                                <span className="font-bold tabular-nums">{vp(s.price)}</span>
                              </span>
                            )}
                          </div>
                          {s.tierIcon && <img src={s.tierIcon} alt="" className="h-5 w-5 shrink-0" />}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Store */}
            {tab === 'store' && (
              <>
                {storeLoading && <Spinner />}
                {storeError && <p className="text-sm font-semibold text-val-red">{storeError}</p>}
                {store?.shop && (
                  <div className="flex flex-col gap-4">
                    <p className="text-sm text-slate-300">Refresh dalam <b className="text-white">{formatCountdown(store.shop.remaining)}</b></p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {store.shop.skins.map((s) => (
                        <SkinCard key={s.id} skin={s} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Night Market */}
            {tab === 'night' && (
              <>
                {storeLoading && <Spinner />}
                {storeError && <p className="text-sm font-semibold text-val-red">{storeError}</p>}
                {store && !storeLoading && (
                  store.nightMarket?.items?.length ? (
                    <div className="flex flex-col gap-4">
                      <p className="text-sm text-slate-300">Berakhir dalam <b className="text-white">{formatCountdown(store.nightMarket.remaining)}</b></p>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {store.nightMarket.items.map((s) => (
                          <SkinCard key={s.id} skin={s} />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-val-panel p-6 text-center text-slate-400">
                      Night Market sedang tidak aktif.
                    </div>
                  )
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
