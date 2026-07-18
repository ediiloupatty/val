import React, { useState } from 'react';
import { fetchShop } from './api.js';
import { getTurnstileToken } from './turnstile.js';

// VALORANT store checker using Riot's OAuth implicit flow. The user logs in on
// Riot's OWN page (Riot handles captcha + 2FA), gets redirected to a localhost
// URL carrying the tokens, and pastes that URL here. We never see their
// password. The Worker (/api/shop/store) extracts the tokens and reads the store.

// client_id=riot-client + the localhost redirect is what lets this work without
// being an approved Riot developer. (Mirrors AUTH_URL in riot.js.)
const AUTH_URL =
  'https://auth.riotgames.com/authorize' +
  '?redirect_uri=http%3A%2F%2Flocalhost%2Fredirect' +
  '&client_id=riot-client' +
  '&response_type=token%20id_token' +
  '&nonce=1' +
  '&scope=openid%20link%20ban%20lol_region%20account' +
  '&prompt=login';

const VP_ICON =
  'https://media.valorant-api.com/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png';

function formatCountdown(totalSeconds) {
  const s = Math.max(0, Number(totalSeconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}j ${m}m`;
}

function SkinCard({ skin }) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-val-panel p-5 transition-colors hover:border-val-accent/40">
      <div className="flex min-h-[7rem] items-center justify-center">
        {skin.image ? (
          <img
            src={skin.image}
            alt={skin.name}
            className="max-h-28 w-full object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)] transition-transform group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="h-24 w-full rounded-lg bg-white/5" />
        )}
      </div>
      <p className="mt-4 text-sm font-bold uppercase tracking-wide text-white">{skin.name}</p>
      <div className="mt-2 flex items-center gap-1.5 text-val-accent">
        <img src={VP_ICON} alt="VP" className="h-4 w-4" />
        <span className="font-bold tabular-nums">
          {skin.price != null ? skin.price.toLocaleString('id-ID') : '—'}
        </span>
      </div>
    </div>
  );
}

export default function ShopChecker({ onExit }) {
  const [step, setStep] = useState('login'); // 'login' | 'shop'
  const [redirectUrl, setRedirectUrl] = useState('');
  const [shop, setShop] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCheck = async (e) => {
    e.preventDefault();
    const url = redirectUrl.trim();
    if (!url || loading) return;
    if (!url.includes('access_token')) {
      setError('URL belum berisi token. Salin URL lengkap dari address bar setelah login (harus ada "access_token").');
      return;
    }
    setLoading(true);
    setError('');
    const turnstileToken = await getTurnstileToken();
    const res = await fetchShop(url, turnstileToken);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setShop(res.shop);
    setRedirectUrl(''); // drop the token-bearing URL from state once used
    setStep('shop');
  };

  const reset = () => {
    setStep('login');
    setRedirectUrl('');
    setShop(null);
    setError('');
  };

  return (
    <div className="min-h-[100dvh] w-screen bg-val-dark text-white">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-4xl flex-col px-5 py-6 sm:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={onExit}
            className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-400 transition-colors hover:text-white"
          >
            ← Kembali
          </button>
          <h1 className="text-lg font-black uppercase tracking-wider text-val-red">Cek Toko</h1>
        </div>

        {/* Step: login */}
        {step === 'login' && (
          <div className="flex flex-col gap-6">
            {/* Info banner */}
            <div className="rounded-2xl border border-val-accent/30 bg-val-accent/10 p-4 text-sm text-slate-200">
              <p className="font-bold text-val-accent">🔒 Login lewat halaman Riot asli</p>
              <p className="mt-1.5 leading-relaxed text-slate-300">
                Kamu login di halaman Riot sendiri — <b>password kamu tidak pernah masuk ke web ini</b>.
                Kami cuma membaca data toko. Tetap catatan: fitur ini pakai API internal Riot
                (melanggar ToS), pakai untuk akun sendiri.
              </p>
            </div>

            {/* Steps */}
            <ol className="flex flex-col gap-4">
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-val-red text-sm font-black">1</span>
                <div className="flex-1">
                  <p className="text-sm text-slate-300">Buka halaman login Riot, lalu login seperti biasa.</p>
                  <a
                    href={AUTH_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-2 rounded-xl bg-val-red px-5 py-2.5 text-sm font-black uppercase tracking-wider text-white transition-opacity hover:opacity-90"
                  >
                    Buka Login Riot ↗
                  </a>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-val-red text-sm font-black">2</span>
                <p className="flex-1 text-sm text-slate-300">
                  Setelah login, browser akan pindah ke halaman <b className="text-white">error/blank</b> di{' '}
                  <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">localhost</code> — itu normal.
                  <b className="text-white"> Salin seluruh URL</b> dari address bar.
                </p>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-val-red text-sm font-black">3</span>
                <p className="flex-1 text-sm text-slate-300">Tempel URL-nya di sini:</p>
              </li>
            </ol>

            <form onSubmit={handleCheck} className="flex flex-col gap-4">
              <input
                type="text"
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-val-panel px-4 py-3 text-sm text-white outline-none transition-colors focus:border-val-accent"
                placeholder="http://localhost/redirect#access_token=..."
              />
              {error && <p className="text-sm font-semibold text-val-red">{error}</p>}
              <button
                type="submit"
                disabled={loading || !redirectUrl}
                className="flex items-center justify-center gap-2 rounded-xl bg-val-accent px-6 py-3 font-black uppercase tracking-wider text-val-dark transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-val-dark/30 border-t-val-dark" />
                ) : (
                  'Cek Toko Saya'
                )}
              </button>
            </form>
          </div>
        )}

        {/* Step: shop */}
        {step === 'shop' && shop && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <span className="rounded-full bg-white/5 px-3 py-1 font-bold uppercase tracking-wider text-val-accent">
                  {shop.region?.toUpperCase() || '—'}
                </span>
                <span>Refresh dalam <b className="text-white">{formatCountdown(shop.remaining)}</b></span>
              </div>
              {shop.wallet?.vp != null && (
                <div className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-sm">
                  <img src={VP_ICON} alt="VP" className="h-4 w-4" />
                  <span className="font-bold tabular-nums text-val-accent">
                    {shop.wallet.vp.toLocaleString('id-ID')}
                  </span>
                </div>
              )}
            </div>

            {shop.skins?.length ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {shop.skins.map((s) => (
                  <SkinCard key={s.id} skin={s} />
                ))}
              </div>
            ) : (
              <p className="text-slate-400">Tidak ada data skin di toko.</p>
            )}

            <button
              onClick={reset}
              className="mx-auto mt-2 rounded-xl border border-white/10 px-6 py-2.5 text-sm font-bold uppercase tracking-wider text-slate-300 transition-colors hover:border-white/30 hover:text-white"
            >
              Cek akun lain
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
