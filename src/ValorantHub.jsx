import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchShop, fetchValorantOverview, fetchValorantInventory } from './api.js';
import { RIOT_LOGIN_URL, cleanSsid, saveSsid, loadSsid, clearSsid } from './riotSession.js';

// VALORANT account hub. The user grabs their long-lived `ssid` cookie once; the
// Worker reauths it into a fresh access token on every request, so they stay
// logged in for weeks (until they change their password) with no re-paste.
// Password never touches our server.

const LOGIN_TUTORIAL_URL = 'https://youtu.be/a2qu0XThnJo';

const VP_ICON =
  'https://media.valorant-api.com/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png';
const RAD_ICON =
  'https://media.valorant-api.com/currencies/e59aa87c-4cbf-517a-5983-6e81511be9b7/displayicon.png';

const vp = (n) => (n != null ? Number(n).toLocaleString('id-ID') : '-');
const rp = (n) => (n != null ? `Rp${Math.round(Number(n)).toLocaleString('id-ID')}` : '-');

// Official Codashop/Riot ID pricing: 475 VP = Rp56.000 … 11.000 VP = Rp1.099.000
// (≈ Rp100–118 per VP). We convert with the 1000-VP pack rate since that's the
// most common denomination — and exactly one battlepass.
const IDR_PER_VP = 112;
const BATTLEPASS_COST_VP = 1000;

// Account resale estimate, calibrated against real itemku listings (Jul 2026):
// 170 skins ≈ Rp4,3jt · 82 skins ≈ Rp2,75jt · 30 skins ≈ Rp800rb — consistently
// ~10–20% of the estimated money spent. High ranks fetch a premium (market
// calculators put Radiant at 2–5× an unranked account with the same skins).
const RESALE_RATE_LOW = 0.10;
const RESALE_RATE_HIGH = 0.20;
const RANK_MULTIPLIERS = [
  ['radiant', 2.0],
  ['immortal', 1.5],
  ['ascendant', 1.25],
  ['diamond', 1.15],
  ['platinum', 1.05],
  ['gold', 1.0],
  ['silver', 1.0],
  ['bronze', 0.95],
  ['iron', 0.9],
];
function rankMultiplier(rankName) {
  const n = (rankName || '').toLowerCase();
  for (const [key, mult] of RANK_MULTIPLIERS) if (n.includes(key)) return mult;
  return 1.0;
}

// Market premium for limited (discontinued) skins on top of the base resale
// range, per skin. Calibrated from account-market listings (PlayerAuctions,
// zeusX, EpicNPC — Jul 2026): Champions 2021 bundle accounts trade at $76–192
// (≈ Rp1,2–3,1jt for the Vandal+Karambit pair); later Champions years and the
// Arcane Sheriff carry smaller premiums. First matching pattern wins.
const LIMITED_PREMIUMS = [
  [/champions\s*2021/i, 600_000, 1_500_000],
  [/champions\s*2022/i, 300_000, 800_000],
  [/champions\s*2023/i, 200_000, 500_000],
  [/champions/i, 150_000, 400_000],
  [/arcane\s*sheriff/i, 100_000, 300_000],
];
function limitedPremium(names) {
  let low = 0;
  let high = 0;
  for (const name of names || []) {
    const hit = LIMITED_PREMIUMS.find(([re]) => re.test(name));
    if (hit) {
      low += hit[1];
      high += hit[2];
    }
  }
  return { low, high };
}

// Inline styling helpers for the localized strings below.
const C = ({ children }) => (
  <code className="break-all rounded bg-white/10 px-1 py-0.5 text-xs">{children}</code>
);
const B = ({ children }) => <b className="text-white">{children}</b>;
const Hi = ({ children }) => <b className="text-slate-300">{children}</b>;

// All hub UI strings, both languages. Kept here rather than translations.js so
// the text stays code-split with this lazy-loaded page. Values may be strings,
// JSX, or functions of the values they interpolate.
const HUB_TEXT = {
  id: {
    back: 'Kembali',
    hourSuffix: 'j',
    sessionExpired: 'Sesi Riot berakhir (mungkin kamu ganti password atau logout everywhere). Tambahkan ssid lagi.',
    ssidTooShort: 'Nilai ssid terlihat terlalu pendek. Pastikan menyalin value cookie "ssid" yang benar.',
    loginTitle: '🔒 Login sekali, tahan berminggu-minggu',
    loginBody: (
      <>
        Ambil cookie <C>ssid</C> dari browser sekali. Setelah itu kamu tetap login otomatis sampai
        ganti password. <b>Password tidak pernah masuk ke web ini.</b>
      </>
    ),
    watchTutorial: '▶ Tonton Cara Login (Video) ↗',
    step1: 'Buka & login di halaman Riot (kalau sudah login, tinggal muncul halaman blank, itu normal).',
    openRiot: 'Buka Login Riot ↗',
    step2: (
      <>
        Di tab yang sama, buka alamat <C>auth.riotgames.com</C>, lalu tekan <B>F12</B> → tab{' '}
        <B>Application</B> (Chrome) / <B>Storage</B> (Firefox) → <B>Cookies</B> →{' '}
        <C>https://auth.riotgames.com</C>.
      </>
    ),
    step3: (
      <>
        Cari baris bernama <C>ssid</C>, salin isi kolom <B>Value</B>-nya, lalu tempel di sini:
      </>
    ),
    ssidPlaceholder: 'Tempel value ssid di sini…',
    signIn: 'Masuk',
    ssidNote: (
      <>
        Cookie <C>ssid</C> = kunci sesi akunmu. Jangan bagikan ke siapa pun. Disimpan hanya di
        browser ini untuk auto-login; hapus dengan tombol Logout.
      </>
    ),
    tabs: { dashboard: 'Dashboard', inventory: 'Inventory', store: 'Toko', night: 'Night Market' },
    playerFallback: 'Pemain',
    welcomeBack: 'SELAMAT DATANG,',
    tagline: 'Main terus, kumpulkan gayamu.',
    statSkins: 'Total Skin',
    statValue: 'Nilai Koleksi',
    statAgents: 'Agent Terbuka',
    statLevel: 'Level Akun',
    online: 'Online',
    searchPlaceholder: 'Cari skin…',
    catAll: 'Semua',
    dailyOffers: 'Penawaran Harian',
    offersRefreshIn: 'Offer refresh dalam',
    nightEndsIn: 'Berakhir dalam',
    heroTitle: 'Estimasi Total VP Skin',
    heroNote: (priced, owned) => (
      <>
        Estimasi dari <Hi>{priced} skin berharga</Hi> yang kamu miliki (total {owned} skin unik).
        Dihitung dari harga standar per content tier (Select/Deluxe/Premium/Exclusive/Ultra),{' '}
        <Hi>bukan</Hi> uang asli yang dikeluarkan. Skin gratis/battlepass/default tidak dihitung.
      </>
    ),
    invUnavailable: 'Data inventory tidak tersedia (mungkin timeout dari Riot). Coba buka lagi menu ini.',
    spendTitle: 'Estimasi Total Pengeluaran',
    spendSkins: (vpStr) => `Skin premium (${vpStr} VP)`,
    spendBp: (n, cost) => `Battlepass (${n} × ${cost} VP)`,
    spendNote: `Konversi memakai harga resmi paket 1000 VP (sekitar Rp${IDR_PER_VP.toLocaleString('id-ID')} per VP; paket besar bisa lebih murah, kisaran Rp100 sampai Rp118 per VP). Battlepass dihitung dari act yang skin jalur berbayarnya kamu miliki. Skin hadiah/diskon Night Market membuat pengeluaran asli bisa lebih rendah. Ini estimasi, bukan tagihan. 😄`,
    resaleTitle: 'Estimasi Harga Jual Akun',
    resaleRankLine: (rank, mult) => `Rank ${rank} · multiplier ${mult}×`,
    resaleNote: 'Kalibrasi dari listing nyata pasar akun Indonesia (itemku): akun 170-an skin laku sekitar Rp4,3jt, 82 skin sekitar Rp2,75jt, kira-kira 10 sampai 20% dari estimasi pengeluaran. Rank tinggi menaikkan harga (Immortal sekitar 1,5x, Radiant 2x). Skin langka (Champions, bundle lawas) bisa di atas rentang ini.',
    resaleWarning: '⚠️ Sekadar info pasar: jual-beli akun melanggar Terms of Service Riot dan berisiko banned permanen.',
    resaleLimitedLine: (names, lo, hi) => `✨ Skin limited terdeteksi: ${names}. Premium pasar +${lo} sampai ${hi} sudah ditambahkan ke rentang (kalibrasi listing PlayerAuctions/zeusX).`,
    badgeLimited: 'Limited',
    bpMissing: 'Tidak terdeteksi (mungkin belum punya battlepass aktif).',
    collectionTitle: 'Koleksi Akun',
    invStatPremium: 'Skin Premium',
    invStatPremiumSub: 'Punya content tier',
    invStatFree: 'Skin Gratis',
    invStatFreeSub: 'Default / battlepass',
    invStatValue: 'Nilai (est.)',
    invStatValueSub: 'VP, dari content tier',
    invSectionPremium: 'Skin Premium',
    invSectionFree: 'Skin Gratis / Battlepass',
    invFreeNote: 'Skin yang kamu dapat sebagai hadiah battlepass / event pass (dicocokkan dengan daftar reward kontrak Riot), bukan dibeli dengan VP. Tidak dihitung dalam estimasi nilai.',
    badgeFree: 'Gratis',
    badgeBp: 'Battlepass',
    storeRefresh: (time) => (
      <>
        Refresh dalam <B>{time}</B>
      </>
    ),
    nightEnds: (time) => (
      <>
        Berakhir dalam <B>{time}</B>
      </>
    ),
    nightInactive: 'Night Market sedang tidak aktif.',
  },
  en: {
    back: 'Back',
    hourSuffix: 'h',
    sessionExpired: 'Your Riot session has ended (you may have changed your password or logged out everywhere). Add your ssid again.',
    ssidTooShort: 'That ssid value looks too short. Make sure you copied the value of the "ssid" cookie.',
    loginTitle: '🔒 Log in once, stays for weeks',
    loginBody: (
      <>
        Grab the <C>ssid</C> cookie from your browser once. After that you stay logged in until you
        change your password. <b>Your password never touches this site.</b>
      </>
    ),
    watchTutorial: '▶ Watch How to Log In (Video) ↗',
    step1: "Open & log in on Riot's page (if you're already logged in you'll just see a blank page, that's normal).",
    openRiot: 'Open Riot Login ↗',
    step2: (
      <>
        In the same tab, go to <C>auth.riotgames.com</C>, then press <B>F12</B> → the{' '}
        <B>Application</B> tab (Chrome) / <B>Storage</B> (Firefox) → <B>Cookies</B> →{' '}
        <C>https://auth.riotgames.com</C>.
      </>
    ),
    step3: (
      <>
        Find the row named <C>ssid</C>, copy its <B>Value</B> column, and paste it here:
      </>
    ),
    ssidPlaceholder: 'Paste the ssid value here…',
    signIn: 'Sign In',
    ssidNote: (
      <>
        The <C>ssid</C> cookie is the key to your account session. Never share it with anyone. It's
        stored only in this browser for auto-login; remove it with the Logout button.
      </>
    ),
    tabs: { dashboard: 'Dashboard', inventory: 'Inventory', store: 'Store', night: 'Night Market' },
    playerFallback: 'Player',
    welcomeBack: 'WELCOME BACK,',
    tagline: 'Play more, earn more, collect your style.',
    statSkins: 'Total Skins',
    statValue: 'Collection Value',
    statAgents: 'Agents Unlocked',
    statLevel: 'Account Level',
    online: 'Online',
    searchPlaceholder: 'Search inventory…',
    catAll: 'All',
    dailyOffers: 'Daily Offers',
    offersRefreshIn: 'Offers refresh in',
    nightEndsIn: 'Ends in',
    heroTitle: 'Estimated Total Skin VP',
    heroNote: (priced, owned) => (
      <>
        Estimated from <Hi>{priced} priced skins</Hi> you own ({owned} unique skins total). Based on
        standard prices per content tier (Select/Deluxe/Premium/Exclusive/Ultra), <Hi>not</Hi> real
        money spent. Free/battlepass/default skins aren't counted.
      </>
    ),
    invUnavailable: 'Inventory data unavailable (possibly a Riot timeout). Try opening this menu again.',
    spendTitle: 'Estimated Total Spend',
    spendSkins: (vpStr) => `Premium skins (${vpStr} VP)`,
    spendBp: (n, cost) => `Battlepass (${n} × ${cost} VP)`,
    spendNote: `Converted using the official 1000-VP pack price (about Rp${IDR_PER_VP.toLocaleString('id-ID')} per VP; bigger packs are cheaper, around Rp100 to Rp118 per VP). Battlepasses are counted from acts whose paid-track skins you own. Gifted skins and Night Market discounts can make real spend lower. This is an estimate, not a bill. 😄`,
    resaleTitle: 'Estimated Account Resale Value',
    resaleRankLine: (rank, mult) => `Rank ${rank} · multiplier ${mult}×`,
    resaleNote: "Calibrated against real listings on Indonesia's account marketplace (itemku): around 170 skins sells for about Rp4.3M, 82 skins about Rp2.75M, roughly 10 to 20% of estimated spend. High ranks raise the price (Immortal about 1.5x, Radiant 2x). Rare skins (Champions, old bundles) can go above this range.",
    resaleWarning: "⚠️ Market info only: buying or selling accounts violates Riot's Terms of Service and risks a permanent ban.",
    resaleLimitedLine: (names, lo, hi) => `✨ Limited skins detected: ${names}. A market premium of +${lo} to ${hi} is already added to the range (calibrated from PlayerAuctions/zeusX listings).`,
    badgeLimited: 'Limited',
    bpMissing: "Not detected (you may not have an active battlepass).",
    collectionTitle: 'Account Collection',
    invStatPremium: 'Premium Skins',
    invStatPremiumSub: 'Has a content tier',
    invStatFree: 'Free Skins',
    invStatFreeSub: 'Default / battlepass',
    invStatValue: 'Value (est.)',
    invStatValueSub: 'VP, from content tier',
    invSectionPremium: 'Premium Skins',
    invSectionFree: 'Free / Battlepass Skins',
    invFreeNote: "Skins you received as battlepass / event pass rewards (matched against Riot's contract reward list), not bought with VP. Not counted in the value estimate.",
    badgeFree: 'Free',
    badgeBp: 'Battlepass',
    storeRefresh: (time) => (
      <>
        Refreshes in <B>{time}</B>
      </>
    ),
    nightEnds: (time) => (
      <>
        Ends in <B>{time}</B>
      </>
    ),
    nightInactive: 'Night Market is currently inactive.',
  },
};

function formatCountdown(totalSeconds, hourSuffix = 'j') {
  const s = Math.max(0, Number(totalSeconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}${hourSuffix} ${m}m`;
}

function isExpiredError(msg) {
  return /kadaluarsa|expired|tidak valid/i.test(msg || '');
}

// Weapon category buckets for the Inventory sidebar/filter, derived from the
// skin name (Riot skin names end with the weapon: "Prime Vandal").
const WEAPON_CATS = [
  ['Rifles', ['vandal', 'phantom', 'bulldog', 'guardian']],
  ['SMG', ['spectre', 'stinger']],
  ['Shotgun', ['judge', 'bucky']],
  ['Sniper', ['operator', 'marshal', 'outlaw']],
  ['Pistol', ['classic', 'ghost', 'sheriff', 'frenzy', 'shorty']],
  ['Heavy', ['odin', 'ares']],
];
function weaponCategory(name) {
  const n = (name || '').toLowerCase();
  for (const [cat, weapons] of WEAPON_CATS) {
    for (const w of weapons) if (n.endsWith(` ${w}`) || n === w) return cat;
  }
  return 'Melee';
}

// Live-ticking countdown: anchors the remaining seconds to a wall-clock target
// once, then ticks every second.
function useCountdown(remaining) {
  const [left, setLeft] = useState(() => Math.max(0, Number(remaining) || 0));
  useEffect(() => {
    const target = Date.now() + Math.max(0, Number(remaining) || 0) * 1000;
    setLeft(Math.max(0, Number(remaining) || 0));
    const id = setInterval(
      () => setLeft(Math.max(0, Math.round((target - Date.now()) / 1000))),
      1000
    );
    return () => clearInterval(id);
  }, [remaining]);
  return left;
}

const pad2 = (n) => String(n).padStart(2, '0');
function fmtHMS(s) {
  const v = Math.max(0, Number(s) || 0);
  return `${pad2(Math.floor(v / 3600))}:${pad2(Math.floor((v % 3600) / 60))}:${pad2(v % 60)}`;
}
function fmtDH(s, hourSuffix = 'h') {
  const v = Math.max(0, Number(s) || 0);
  const d = Math.floor(v / 86400);
  if (d > 0) return `${d}d ${Math.floor((v % 86400) / 3600)}${hourSuffix}`;
  return formatCountdown(v, hourSuffix);
}

// Dashboard stat card (mockup style): icon box + label + value.
function DashStat({ icon, label, value, accent }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-val-panel p-3.5 sm:p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-lg">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500">{label}</p>
        <p className={`truncate text-lg font-black tabular-nums ${accent ? 'text-val-accent' : 'text-white'}`}>{value}</p>
      </div>
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

// Offer card (Store daily offers + Night Market): tier-tinted border, discount
// badge top-left, price row with VP icon; struck base price when discounted.
function OfferCard({ skin }) {
  const discounted = skin.discountPrice != null;
  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-val-panel p-4 transition-all hover:-translate-y-0.5 hover:border-val-red/40"
      style={skin.tierColor ? { borderColor: `${skin.tierColor}66` } : undefined}
    >
      {discounted && skin.discountPercent != null && (
        <span className="absolute left-3 top-3 z-10 rounded bg-val-red/20 px-1.5 py-0.5 text-xs font-black tabular-nums text-val-red">
          -{skin.discountPercent}%
        </span>
      )}
      <div className="flex min-h-[6.5rem] items-center justify-center py-2 sm:min-h-[7rem]">
        {skin.image ? (
          <img
            src={skin.image}
            alt={skin.name}
            className="max-h-24 w-full object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)] transition-transform group-hover:scale-105 sm:max-h-28"
            loading="lazy"
          />
        ) : (
          <div className="h-24 w-full rounded-lg bg-white/5" />
        )}
      </div>
      <div className="mt-2 flex items-start justify-between gap-2">
        <p className="text-sm font-black uppercase leading-tight tracking-wide text-white">{skin.name}</p>
        {skin.tierIcon && <img src={skin.tierIcon} alt="" className="mt-0.5 h-4 w-4 shrink-0" />}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <img src={VP_ICON} alt="VP" className="h-4 w-4" />
        <span className="font-black tabular-nums text-white">
          {vp(discounted ? skin.discountPrice : skin.price)}
        </span>
        {discounted && skin.basePrice != null && (
          <span className="text-xs tabular-nums text-slate-500 line-through">{vp(skin.basePrice)}</span>
        )}
      </div>
    </div>
  );
}

// Sticky top navbar (mockup style): back + logo left, centered tabs with a red
// underline, VP pill + profile chip (dropdown with rank info & logout) right.
function HubNav({ t, identity, walletVp, tab, goTab, onExit, onLogout }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return;
    const h = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const tabs = [
    ['dashboard', t.tabs.dashboard],
    ['inventory', t.tabs.inventory],
    ['store', t.tabs.store],
    ['night', t.tabs.night],
  ];
  const tabBtn = (key, label, extra = '') => (
    <button
      key={key}
      onClick={() => goTab(key)}
      className={`relative shrink-0 whitespace-nowrap px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors sm:px-4 ${
        tab === key ? 'text-white' : 'text-slate-400 hover:text-white'
      } ${extra}`}
    >
      {label}
      {tab === key && (
        <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-val-red" />
      )}
    </button>
  );

  return (
    <div className="sticky top-0 z-30 border-b border-white/10 bg-val-dark/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:h-16 sm:gap-3 sm:px-8">
        <button
          onClick={onExit}
          aria-label={t.back}
          className="shrink-0 rounded-lg px-1.5 py-1 text-lg leading-none text-slate-400 transition-colors hover:text-white"
        >
          ←
        </button>
        <p className="shrink-0 text-sm font-black uppercase tracking-widest">
          <span className="text-val-red">Valo</span> Shop
        </p>

        {/* Centered tabs (desktop) */}
        <nav className="hidden flex-1 items-center justify-center md:flex">
          {tabs.map(([key, label]) => tabBtn(key, label, 'h-14 sm:h-16'))}
        </nav>
        <div className="flex-1 md:hidden" />

        {/* VP balance */}
        {walletVp != null && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
            <img src={VP_ICON} alt="VP" className="h-4 w-4" />
            <span className="text-xs font-black tabular-nums text-white">{vp(walletVp)}</span>
          </span>
        )}

        {/* Profile chip + dropdown */}
        <div ref={menuRef} className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 p-1 pr-2 transition-colors hover:bg-white/10 sm:pr-3"
          >
            {identity?.card ? (
              <img src={identity.card} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black text-slate-300">
                {(identity?.displayName || t.playerFallback).charAt(0).toUpperCase()}
              </span>
            )}
            <span className="hidden min-w-0 text-left leading-tight sm:block">
              <span className="block max-w-[110px] truncate text-xs font-black text-white">
                {identity?.displayName?.split('#')[0] || t.playerFallback}
              </span>
              <span className="block text-[9px] font-bold uppercase tracking-wider text-val-accent">{t.online}</span>
            </span>
            <span className="text-[9px] text-slate-500">▼</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-40 mt-2 w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#141d24] shadow-2xl">
              <div className="border-b border-white/10 p-3">
                <p className="truncate text-sm font-black text-white">{identity?.displayName || t.playerFallback}</p>
                <div className="mt-1 flex items-center gap-2">
                  {identity?.level != null && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Lv {identity.level}</span>
                  )}
                  {identity?.rank?.name && identity.rank.name !== 'Unranked' ? (
                    <span className="flex items-center gap-1">
                      {identity.rank.icon && <img src={identity.rank.icon} alt="" className="h-4 w-4" />}
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider"
                        style={identity.rank.color ? { color: identity.rank.color } : undefined}
                      >
                        {identity.rank.name}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Unranked</span>
                  )}
                </div>
              </div>
              <button
                onClick={onLogout}
                className="block w-full px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-slate-300 transition-colors hover:bg-val-red/10 hover:text-val-red"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile tabs row */}
      <div className="no-scrollbar flex overflow-x-auto border-t border-white/5 px-2 md:hidden">
        {tabs.map(([key, label]) => tabBtn(key, label))}
      </div>
    </div>
  );
}

// One skin tile in the Inventory grid (mockup style): image, name, weapon
// category subtitle, tier icon top-right, price / Free badge.
function SkinTile({ skin, t }) {
  return (
    <div
      className="group relative flex flex-col rounded-2xl border border-white/10 bg-val-panel p-3 transition-colors hover:border-val-red/40"
      style={skin.tierColor ? { borderColor: `${skin.tierColor}55` } : undefined}
    >
      {skin.tierIcon && <img src={skin.tierIcon} alt="" className="absolute right-2.5 top-2.5 h-4 w-4" />}
      {skin.limited && (
        <span className="absolute left-2.5 top-2.5 rounded bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
          {t.badgeLimited}
        </span>
      )}
      <div className="flex h-20 items-center justify-center py-1 sm:h-24">
        {skin.image ? (
          <img
            src={skin.image}
            alt=""
            className="max-h-16 w-full object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)] transition-transform group-hover:scale-105 sm:max-h-20"
            loading="lazy"
          />
        ) : (
          <div className="h-16 w-full rounded bg-white/5" />
        )}
      </div>
      <p className="mt-1.5 truncate text-xs font-black uppercase tracking-wide text-white sm:text-sm">{skin.name}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-500">{skin.cat}</span>
        {skin.price != null ? (
          <span className="flex shrink-0 items-center gap-1">
            <img src={VP_ICON} alt="VP" className="h-3.5 w-3.5" />
            <span className="text-xs font-black tabular-nums text-white">{vp(skin.price)}</span>
          </span>
        ) : (
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-val-accent">
            {skin.source === 'battlepass' ? t.badgeBp : t.badgeFree}
          </span>
        )}
      </div>
    </div>
  );
}

// Inventory view: search + category tabs, sidebar with per-category counts,
// and the skin tile grid.
function InventoryView({ inventory, t }) {
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const skins = useMemo(
    () => inventory.skins.map((s) => ({ ...s, cat: weaponCategory(s.name) })),
    [inventory.skins]
  );
  const counts = useMemo(() => {
    const c = {};
    for (const s of skins) c[s.cat] = (c[s.cat] || 0) + 1;
    return c;
  }, [skins]);
  const cats = [...WEAPON_CATS.map(([c]) => c), 'Melee'].filter((c) => counts[c]);
  const filtered = skins.filter(
    (s) =>
      (cat === 'all' || s.cat === cat) &&
      (!q || s.name.toLowerCase().includes(q.toLowerCase()))
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-black uppercase tracking-wide sm:text-2xl">{t.tabs.inventory}</h2>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.searchPlaceholder}
          className="w-full max-w-[240px] rounded-xl border border-white/10 bg-val-panel px-3.5 py-2 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-val-red/50"
        />
      </div>

      {/* Category tabs */}
      <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-white/10 px-1">
        {[['all', t.catAll], ...cats.map((c) => [c, c])].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setCat(key)}
            className={`relative shrink-0 whitespace-nowrap px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
              cat === key ? 'text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {label}
            {cat === key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-val-red" />}
          </button>
        ))}
      </div>

      <div className="flex items-start gap-4">
        {/* Sidebar: totals per category */}
        <aside className="hidden w-44 shrink-0 flex-col gap-3 rounded-2xl border border-white/10 bg-val-panel p-4 lg:flex">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500">{t.statSkins}</p>
            <p className="mt-1 border-l-2 border-val-red pl-2 text-2xl font-black tabular-nums text-white">
              {vp(skins.length)}
            </p>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-white/10 pt-3">
            {cats.map((c) => (
              <button
                key={c}
                onClick={() => setCat(cat === c ? 'all' : c)}
                className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-[11px] font-bold uppercase tracking-wider transition-colors ${
                  cat === c ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>{c}</span>
                <span className="tabular-nums text-slate-500">{counts[c]}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-white/10 pt-3">
            <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500">{t.invStatValue}</p>
            <p className="mt-1 flex items-center gap-1.5">
              <img src={VP_ICON} alt="VP" className="h-4 w-4" />
              <span className="text-base font-black tabular-nums text-white">{vp(inventory.totalValueVp)}</span>
            </p>
          </div>
        </aside>

        {/* Grid */}
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map((s) => (
            <SkinTile key={s.id} skin={s} t={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Store view: heading + live refresh countdown, then the daily-offer grid.
function StoreView({ shop, t }) {
  const left = useCountdown(shop.remaining);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-black uppercase tracking-wide sm:text-2xl">{t.tabs.store}</h2>
        <div className="text-right">
          <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500">{t.offersRefreshIn}</p>
          <p className="text-lg font-black tabular-nums text-val-red">{fmtHMS(left)}</p>
        </div>
      </div>
      <p className="-mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
        {t.dailyOffers} <span className="ml-1 tabular-nums text-val-red">{fmtHMS(left)}</span>
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {shop.skins.map((s) => (
          <OfferCard key={s.id} skin={s} />
        ))}
      </div>
    </div>
  );
}

// Night Market view: centered header + discount card grid.
function NightView({ nightMarket, t }) {
  const left = useCountdown(nightMarket.remaining);
  return (
    <div className="flex flex-col gap-5">
      <div className="text-center">
        <h2 className="text-2xl font-black uppercase tracking-[0.15em] text-white sm:text-3xl">
          {t.tabs.night}
        </h2>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.25em] text-val-red">
          {t.nightEndsIn} {fmtDH(left, t.hourSuffix)}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {nightMarket.items.map((s) => (
          <OfferCard key={s.id} skin={s} />
        ))}
      </div>
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

export default function ValorantHub({ onExit, onIdentity, onLogout, lang = 'id' }) {
  const t = HUB_TEXT[lang] || HUB_TEXT.id;
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
    setLoginError(t.sessionExpired);
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
      if (res.overview?.identity?.displayName) {
        onIdentity?.({ ...res.overview.identity, puuid: res.overview.puuid });
      }
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
      setLoginError(t.ssidTooShort);
      return;
    }
    setLoginError('');
    setSsidInput('');
    setSession(ssid); // triggers the overview effect, which validates + persists
  };

  return (
    <div className="h-[100dvh] w-full overflow-y-auto overflow-x-hidden bg-val-dark text-white">
      {/* Sticky navbar (logged in only) — full width, above the content column */}
      {session && (
        <HubNav
          t={t}
          identity={overview?.identity}
          walletVp={overview?.wallet?.vp}
          tab={tab}
          goTab={goTab}
          onExit={onExit}
          onLogout={doLogout}
        />
      )}
      <div className={`mx-auto flex min-h-full w-full flex-col px-4 py-5 sm:px-8 sm:py-6 ${session ? 'max-w-6xl' : 'max-w-4xl'}`}>
        {/* Header (login screen only — the hub has its own navbar) */}
        {!session && (
          <div className="mb-6 flex items-center justify-between">
            <button onClick={onExit} className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-400 transition-colors hover:text-white">
              ← {t.back}
            </button>
            <h1 className="text-lg font-black uppercase tracking-wider text-val-red">Valorant</h1>
          </div>
        )}

        {/* ---------- Not logged in: ssid setup ---------- */}
        {!session && (
          <div className="flex flex-col gap-5 sm:gap-6">
            <div className="rounded-2xl border border-val-accent/30 bg-val-accent/10 p-4 text-sm text-slate-200">
              <p className="font-bold text-val-accent">{t.loginTitle}</p>
              <p className="mt-1.5 leading-relaxed text-slate-300">{t.loginBody}</p>
            </div>

            <a
              href={LOGIN_TUTORIAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl border border-val-accent/40 bg-val-accent/10 px-5 py-3 text-sm font-black uppercase tracking-wider text-val-accent transition-colors hover:bg-val-accent/20"
            >
              {t.watchTutorial}
            </a>

            <ol className="flex flex-col gap-4">
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-val-red text-sm font-black">1</span>
                <div className="flex-1">
                  <p className="text-sm text-slate-300">{t.step1}</p>
                  <a href={RIOT_LOGIN_URL} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-2 rounded-xl bg-val-red px-5 py-2.5 text-sm font-black uppercase tracking-wider text-white transition-opacity hover:opacity-90">
                    {t.openRiot}
                  </a>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-val-red text-sm font-black">2</span>
                <p className="flex-1 text-sm leading-relaxed text-slate-300">{t.step2}</p>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-val-red text-sm font-black">3</span>
                <p className="flex-1 text-sm leading-relaxed text-slate-300">{t.step3}</p>
              </li>
            </ol>

            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <input
                type="password"
                value={ssidInput}
                onChange={(e) => setSsidInput(e.target.value)}
                autoComplete="off"
                className="w-full rounded-xl border border-white/10 bg-val-panel px-4 py-3 text-sm text-white outline-none transition-colors focus:border-val-accent"
                placeholder={t.ssidPlaceholder}
              />
              {loginError && <p className="text-sm font-semibold text-val-red">{loginError}</p>}
              <button type="submit" disabled={!ssidInput} className="flex items-center justify-center gap-2 rounded-xl bg-val-accent px-6 py-3 font-black uppercase tracking-wider text-val-dark transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                {t.signIn}
              </button>
              <p className="text-[11px] leading-relaxed text-slate-500">{t.ssidNote}</p>
            </form>
          </div>
        )}

        {/* ---------- Logged in: hub ---------- */}
        {session && (
          <div className="flex flex-col gap-5">
            {/* Dashboard */}
            {tab === 'dashboard' && (
              <>
                {overviewLoading && <Spinner />}
                {overviewError && <p className="text-sm font-semibold text-val-red">{overviewError}</p>}
                {overview && (
                  <div className="flex flex-col gap-5">
                    {/* Welcome hero (mockup style) */}
                    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-val-red/15 via-val-panel to-val-panel p-6 sm:p-8">
                      {overview.identity?.card && (
                        <img
                          src={overview.identity.card}
                          alt=""
                          className="pointer-events-none absolute -right-4 top-1/2 h-36 w-36 -translate-y-1/2 rotate-6 rounded-2xl object-cover opacity-25 sm:h-44 sm:w-44"
                        />
                      )}
                      <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400">{t.welcomeBack}</p>
                      <h2 className="mt-1 text-3xl font-black uppercase leading-none tracking-wide text-white sm:text-5xl">
                        {overview.identity?.displayName?.split('#')[0] || t.playerFallback}
                      </h2>
                      <p className="mt-2 text-xs text-slate-400 sm:text-sm">{t.tagline}</p>
                    </div>

                    {/* Quick stats row */}
                    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
                      <DashStat icon="🔫" label={t.statSkins} value={vp(overview.inventory?.ownedSkinCount)} />
                      <DashStat icon="💎" label={t.statValue} value={`${vp(overview.inventory?.collectionValueVp)} VP`} accent />
                      <DashStat icon="👥" label={t.statAgents} value={vp(overview.account?.agentCount)} />
                      <DashStat icon="⭐" label={t.statLevel} value={vp(overview.account?.level)} />
                    </div>

                    {/* Estimated total VP value of the skin collection (hero — the headline number) */}
                    {overview.inventory ? (
                      <div className="relative overflow-hidden rounded-3xl border border-val-accent/30 bg-gradient-to-br from-val-accent/20 via-val-panel to-val-panel p-5 sm:p-6">
                        <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-val-accent/10 blur-3xl" />
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-val-accent">{t.heroTitle}</p>
                        <div className="mt-2 flex items-end gap-2.5">
                          <img src={VP_ICON} alt="VP" className="mb-1.5 h-7 w-7 shrink-0 sm:h-8 sm:w-8" />
                          <span className="text-4xl font-black leading-none tabular-nums text-white sm:text-5xl">
                            {vp(overview.inventory.collectionValueVp)}
                          </span>
                          <span className="mb-1 text-sm font-bold text-slate-400">VP</span>
                        </div>
                        <p className="mt-3 max-w-prose text-xs leading-relaxed text-slate-400">
                          {t.heroNote(vp(overview.inventory.pricedSkinCount), vp(overview.inventory.ownedSkinCount))}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-val-panel p-4 text-sm text-slate-400">
                        {t.invUnavailable}
                      </div>
                    )}

                    {/* Estimated real-money spend: bought skins + battlepasses, converted to IDR */}
                    {overview.inventory && (() => {
                      const skinVp = overview.inventory.collectionValueVp || 0;
                      const bpCount = overview.inventory.battlepassBoughtCount || 0;
                      const bpVp = bpCount * BATTLEPASS_COST_VP;
                      const totalIdr = (skinVp + bpVp) * IDR_PER_VP;
                      return (
                        <div className="relative overflow-hidden rounded-3xl border border-val-red/30 bg-gradient-to-br from-val-red/15 via-val-panel to-val-panel p-5 sm:p-6">
                          <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-val-red/10 blur-3xl" />
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-val-red">{t.spendTitle}</p>
                          <p className="mt-2 text-4xl font-black leading-none tabular-nums text-white sm:text-5xl">
                            {rp(totalIdr)}
                          </p>
                          <div className="mt-4 flex flex-col gap-1.5 text-xs text-slate-300 sm:text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">{t.spendSkins(vp(skinVp))}</span>
                              <span className="font-bold tabular-nums">{rp(skinVp * IDR_PER_VP)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">{t.spendBp(vp(bpCount), vp(BATTLEPASS_COST_VP))}</span>
                              <span className="font-bold tabular-nums">{rp(bpVp * IDR_PER_VP)}</span>
                            </div>
                          </div>
                          <p className="mt-3 max-w-prose text-xs leading-relaxed text-slate-400">{t.spendNote}</p>
                        </div>
                      );
                    })()}

                    {/* Estimated account resale value: 10–20% of spend × rank multiplier */}
                    {overview.inventory && (() => {
                      const skinVp = overview.inventory.collectionValueVp || 0;
                      const bpVp = (overview.inventory.battlepassBoughtCount || 0) * BATTLEPASS_COST_VP;
                      const spendIdr = (skinVp + bpVp) * IDR_PER_VP;
                      const mult = rankMultiplier(overview.identity?.rank?.name);
                      const limited = overview.inventory.limitedSkins || [];
                      const prem = limitedPremium(limited);
                      const low = spendIdr * RESALE_RATE_LOW * mult + prem.low;
                      const high = spendIdr * RESALE_RATE_HIGH * mult + prem.high;
                      if (spendIdr <= 0 && prem.high <= 0) return null;
                      return (
                        <div className="rounded-2xl border border-white/10 bg-val-panel p-4 sm:p-5">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t.resaleTitle}</p>
                          <p className="mt-2 text-2xl font-black leading-none tabular-nums text-white sm:text-3xl">
                            {rp(low)} <span className="text-base font-bold text-slate-500">-</span> {rp(high)}
                          </p>
                          <p className="mt-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            {t.resaleRankLine(overview.identity?.rank?.name || '-', mult)}
                          </p>
                          {limited.length > 0 && (
                            <p className="mt-2 max-w-prose text-xs leading-relaxed text-amber-300">
                              {t.resaleLimitedLine(limited.join(', '), rp(prem.low), rp(prem.high))}
                            </p>
                          )}
                          <p className="mt-3 max-w-prose text-xs leading-relaxed text-slate-400">{t.resaleNote}</p>
                          <p className="mt-2 max-w-prose text-[11px] leading-relaxed text-slate-500">{t.resaleWarning}</p>
                        </div>
                      );
                    })()}

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
                        <p className="mt-1 text-sm text-slate-400">{t.bpMissing}</p>
                      </div>
                    )}

                    {/* Account counts — one tidy panel instead of six loose boxes */}
                    {overview.account && (
                      <div className="rounded-2xl border border-white/10 bg-val-panel p-4 sm:p-5">
                        <p className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">{t.collectionTitle}</p>
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
                {inventory && <InventoryView inventory={inventory} t={t} />}
              </>
            )}

            {/* Store */}
            {tab === 'store' && (
              <>
                {storeLoading && <Spinner />}
                {storeError && <p className="text-sm font-semibold text-val-red">{storeError}</p>}
                {store?.shop && <StoreView shop={store.shop} t={t} />}
              </>
            )}

            {/* Night Market */}
            {tab === 'night' && (
              <>
                {storeLoading && <Spinner />}
                {storeError && <p className="text-sm font-semibold text-val-red">{storeError}</p>}
                {store && !storeLoading && (
                  store.nightMarket?.items?.length ? (
                    <NightView nightMarket={store.nightMarket} t={t} />
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-val-panel p-6 text-center text-slate-400">
                      {t.nightInactive}
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
