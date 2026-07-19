import React, { useEffect, useState } from 'react';
import { fetchShop, fetchValorantOverview, fetchValorantInventory } from './api.js';
import { RIOT_LOGIN_URL, cleanSsid, saveSsid, loadSsid, clearSsid } from './riotSession.js';

// VALORANT account hub. The user grabs their long-lived `ssid` cookie once; the
// Worker reauths it into a fresh access token on every request, so they stay
// logged in for weeks (until they change their password) with no re-paste.
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

// One cell inside the "Koleksi Akun" panel: big number, quiet label beneath.
function AccountStat({ label, value }) {
  return (
    <div className="text-center">
      <p className="text-xl font-black tabular-nums text-white sm:text-2xl">{value}</p>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
    </div>
  );
}

// One wallet balance: icon, label, amount — laid out cleanly.
function WalletCard({ icon, label, value, accent }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-val-panel p-3 sm:p-4">
      {icon ? (
        <img src={icon} alt="" className="h-7 w-7 shrink-0" />
      ) : (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-black text-slate-300">KC</div>
      )}
      <div className="min-w-0">
        <p className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
        <p className={`truncate text-base font-black tabular-nums sm:text-lg ${accent ? 'text-val-accent' : 'text-white'}`}>{value}</p>
      </div>
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

// One skin row in the Inventory tab. Free skins (no price) show a quiet
// "Gratis" badge instead of a VP price.
function InventorySkinRow({ skin }) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-val-panel p-3"
      style={skin.tierColor ? { borderColor: `${skin.tierColor}55` } : undefined}
    >
      {skin.image ? (
        <img src={skin.image} alt="" className="h-9 w-20 shrink-0 object-contain sm:h-10 sm:w-24" loading="lazy" />
      ) : (
        <div className="h-9 w-20 shrink-0 rounded bg-white/5 sm:h-10 sm:w-24" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-white">{skin.name}</p>
        {skin.price != null ? (
          <span className="flex items-center gap-1 text-xs text-val-accent">
            <img src={VP_ICON} alt="VP" className="h-3.5 w-3.5" />
            <span className="font-bold tabular-nums">{vp(skin.price)}</span>
          </span>
        ) : (
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Gratis</span>
        )}
      </div>
      {skin.tierIcon && <img src={skin.tierIcon} alt="" className="h-5 w-5 shrink-0" />}
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
  const [session, setSession] = useState(() => loadSsid()); // ssid string or null
  const [ssidInput, setSsidInput] = useState('');
  const [loginError, setLoginError] = useState('');

  const [tab, setTab] = useState('dashboard'); // 'dashboard' | 'inventory' | 'store' | 'night'

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
    clearSsid();
    setSession(null);
    setOverview(null);
    setStore(null);
    setInventory(null);
    setTab('dashboard');
    setSsidInput('');
    onLogout?.();
  };

  const handleExpired = () => {
    clearSsid();
    setSession(null);
    setOverview(null);
    setStore(null);
    setInventory(null);
    setLoginError('Sesi Riot berakhir (mungkin kamu ganti password atau logout everywhere). Tambahkan ssid lagi.');
  };

  // Load the dashboard when we get an ssid (login or a persisted one on mount).
  // Depend on `session` ONLY — including the loading/overview state here would let
  // this effect's cleanup cancel its own in-flight request the moment it flips
  // `overviewLoading`, leaving the spinner stuck forever.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      setOverviewLoading(true);
      setOverviewError('');
      const res = await fetchValorantOverview(session);
      if (cancelled) return;
      setOverviewLoading(false);
      if (!res.ok) {
        if (isExpiredError(res.error)) return handleExpired();
        setOverviewError(res.error);
        return;
      }
      saveSsid(session); // persist only once we know the ssid actually works
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
    const res = await fetchShop(session);
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
    const res = await fetchValorantInventory(session);
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

  const handleLogin = (e) => {
    e.preventDefault();
    const ssid = cleanSsid(ssidInput);
    if (!ssid) return;
    if (ssid.length < 20) {
      setLoginError('Nilai ssid terlihat terlalu pendek. Pastikan menyalin value cookie "ssid" yang benar.');
      return;
    }
    setLoginError('');
    setSsidInput('');
    setSession(ssid); // triggers the overview effect, which validates + persists
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

        {/* ---------- Not logged in: ssid setup ---------- */}
        {!session && (
          <div className="flex flex-col gap-5 sm:gap-6">
            <div className="rounded-2xl border border-val-accent/30 bg-val-accent/10 p-4 text-sm text-slate-200">
              <p className="font-bold text-val-accent">🔒 Login sekali, tahan berminggu-minggu</p>
              <p className="mt-1.5 leading-relaxed text-slate-300">
                Ambil cookie <code className="rounded bg-white/10 px-1 py-0.5 text-xs">ssid</code> dari browser sekali.
                Setelah itu kamu tetap login otomatis sampai ganti password — <b>password tidak pernah masuk ke web ini</b>.
              </p>
            </div>

            <ol className="flex flex-col gap-4">
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-val-red text-sm font-black">1</span>
                <div className="flex-1">
                  <p className="text-sm text-slate-300">Buka & login di halaman Riot (kalau sudah login, tinggal muncul halaman blank — itu normal).</p>
                  <a href={RIOT_LOGIN_URL} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-2 rounded-xl bg-val-red px-5 py-2.5 text-sm font-black uppercase tracking-wider text-white transition-opacity hover:opacity-90">
                    Buka Login Riot ↗
                  </a>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-val-red text-sm font-black">2</span>
                <p className="flex-1 text-sm leading-relaxed text-slate-300">
                  Di tab yang sama, buka alamat <code className="break-all rounded bg-white/10 px-1 py-0.5 text-xs">auth.riotgames.com</code>,
                  lalu tekan <b className="text-white">F12</b> → tab <b className="text-white">Application</b> (Chrome) / <b className="text-white">Storage</b> (Firefox)
                  → <b className="text-white">Cookies</b> → <code className="break-all rounded bg-white/10 px-1 py-0.5 text-xs">https://auth.riotgames.com</code>.
                </p>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-val-red text-sm font-black">3</span>
                <p className="flex-1 text-sm leading-relaxed text-slate-300">
                  Cari baris bernama <code className="rounded bg-white/10 px-1 py-0.5 text-xs">ssid</code>, salin isi kolom <b className="text-white">Value</b>-nya, lalu tempel di sini:
                </p>
              </li>
            </ol>

            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <input
                type="password"
                value={ssidInput}
                onChange={(e) => setSsidInput(e.target.value)}
                autoComplete="off"
                className="w-full rounded-xl border border-white/10 bg-val-panel px-4 py-3 text-sm text-white outline-none transition-colors focus:border-val-accent"
                placeholder="Tempel value ssid di sini…"
              />
              {loginError && <p className="text-sm font-semibold text-val-red">{loginError}</p>}
              <button type="submit" disabled={!ssidInput} className="flex items-center justify-center gap-2 rounded-xl bg-val-accent px-6 py-3 font-black uppercase tracking-wider text-val-dark transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                Masuk
              </button>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Cookie <code className="rounded bg-white/10 px-1 py-0.5">ssid</code> = kunci sesi akunmu. Jangan bagikan ke siapa pun.
                Disimpan hanya di browser ini untuk auto-login; hapus dengan tombol Logout.
              </p>
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
                    {/* Estimated total VP value of the skin collection (hero — the headline number) */}
                    {overview.inventory ? (
                      <div className="relative overflow-hidden rounded-3xl border border-val-accent/30 bg-gradient-to-br from-val-accent/20 via-val-panel to-val-panel p-5 sm:p-6">
                        <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-val-accent/10 blur-3xl" />
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-val-accent">Estimasi Total VP Skin</p>
                        <div className="mt-2 flex items-end gap-2.5">
                          <img src={VP_ICON} alt="VP" className="mb-1.5 h-7 w-7 shrink-0 sm:h-8 sm:w-8" />
                          <span className="text-4xl font-black leading-none tabular-nums text-white sm:text-5xl">
                            {vp(overview.inventory.collectionValueVp)}
                          </span>
                          <span className="mb-1 text-sm font-bold text-slate-400">VP</span>
                        </div>
                        <p className="mt-3 max-w-prose text-xs leading-relaxed text-slate-400">
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

                    {/* Wallet */}
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
                      <WalletCard icon={VP_ICON} label="Valorant Points" value={vp(overview.wallet?.vp)} accent />
                      <WalletCard icon={RAD_ICON} label="Radianite" value={vp(overview.wallet?.radianite)} />
                      {overview.wallet?.kingdom != null && (
                        <WalletCard label="Kingdom Credits" value={vp(overview.wallet.kingdom)} />
                      )}
                    </div>

                    {/* Battlepass */}
                    {overview.battlepass ? (
                      <div className="rounded-2xl border border-white/10 bg-val-panel p-4 sm:p-5">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{overview.battlepass.name || 'Battlepass'}</p>
                          <p className="text-sm font-black text-white">
                            Tier {overview.battlepass.tier}<span className="text-slate-500"> / {overview.battlepass.totalLevels}</span>
                          </p>
                        </div>
                        <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-val-accent/70 to-val-accent"
                            style={{ width: `${Math.min(100, (overview.battlepass.tier / (overview.battlepass.totalLevels || 50)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-val-panel p-4 sm:p-5">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Battlepass</p>
                        <p className="mt-1 text-sm text-slate-400">Tidak terdeteksi (mungkin belum punya battlepass aktif).</p>
                      </div>
                    )}

                    {/* Account counts — one tidy panel instead of six loose boxes */}
                    {overview.account && (
                      <div className="rounded-2xl border border-white/10 bg-val-panel p-4 sm:p-5">
                        <p className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Koleksi Akun</p>
                        <div className="grid grid-cols-3 gap-y-5 sm:grid-cols-6">
                          <AccountStat label="Level" value={vp(overview.account.level)} />
                          <AccountStat label="Agent" value={vp(overview.account.agentCount)} />
                          <AccountStat label="Card" value={vp(overview.account.cardCount)} />
                          <AccountStat label="Spray" value={vp(overview.account.sprayCount)} />
                          <AccountStat label="Buddy" value={vp(overview.account.buddyCount)} />
                          <AccountStat label="Title" value={vp(overview.account.titleCount)} />
                        </div>
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
                {inventory && (() => {
                  // Paid skins have a content tier (and thus a price estimate);
                  // free ones (default/battlepass/event) don't.
                  const paidSkins = inventory.skins.filter((s) => s.price != null);
                  const freeSkins = inventory.skins.filter((s) => s.price == null);
                  return (
                    <div className="flex flex-col gap-5">
                      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                        <StatCard label="Skin Premium" value={vp(paidSkins.length)} sub="Punya content tier" />
                        <StatCard label="Skin Gratis" value={vp(freeSkins.length)} sub="Default / battlepass" />
                        <StatCard label="Nilai (est.)" value={`${vp(inventory.totalValueVp)}`} sub="VP, dari content tier" />
                      </div>

                      {paidSkins.length > 0 && (
                        <div className="flex flex-col gap-3">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-val-accent">
                            Skin Premium · {vp(paidSkins.length)}
                          </p>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {paidSkins.map((s) => (
                              <InventorySkinRow key={s.id} skin={s} />
                            ))}
                          </div>
                        </div>
                      )}

                      {freeSkins.length > 0 && (
                        <div className="flex flex-col gap-3">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            Skin Gratis / Battlepass · {vp(freeSkins.length)}
                          </p>
                          <p className="-mt-1.5 text-[11px] leading-relaxed text-slate-500">
                            Skin tanpa content tier: bawaan default, hadiah battlepass, atau event. Riot tidak membedakan
                            cara mendapatkannya, jadi pembagian ini berdasarkan ada/tidaknya tier harga.
                          </p>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {freeSkins.map((s) => (
                              <InventorySkinRow key={s.id} skin={s} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
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
