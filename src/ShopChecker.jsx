import React, { useState } from 'react';
import { shopLogin, shopMfa } from './api.js';
import { getTurnstileToken } from './turnstile.js';

// VALORANT store checker. Talks to the Worker's unofficial-Riot proxy
// (/api/shop/*). This is a personal/learning feature: it uses Riot's internal
// API, which is against Riot's ToS and can break at any time. The password is
// sent once over HTTPS to our own Worker, used to obtain a token, and never
// stored — but we still warn the user clearly before they type it.

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
  const [step, setStep] = useState('login'); // 'login' | 'mfa' | 'shop'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaSession, setMfaSession] = useState(null);
  const [mfaEmail, setMfaEmail] = useState(null);
  const [shop, setShop] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username || !password || loading) return;
    setLoading(true);
    setError('');
    const turnstileToken = await getTurnstileToken();
    const res = await shopLogin(username.trim(), password, turnstileToken);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (res.mfaRequired) {
      setMfaSession(res.mfaSession);
      setMfaEmail(res.email);
      setStep('mfa');
      return;
    }
    setShop(res.shop);
    setPassword(''); // drop the password from memory once we're past login
    setStep('shop');
  };

  const handleMfa = async (e) => {
    e.preventDefault();
    if (!code || loading) return;
    setLoading(true);
    setError('');
    const res = await shopMfa(mfaSession, code.trim());
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setShop(res.shop);
    setPassword('');
    setStep('shop');
  };

  const reset = () => {
    setStep('login');
    setPassword('');
    setCode('');
    setMfaSession(null);
    setMfaEmail(null);
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
          <h1 className="text-lg font-black uppercase tracking-wider text-val-red">
            Cek Toko
          </h1>
        </div>

        {/* Warning banner */}
        <div className="mb-6 rounded-2xl border border-val-red/30 bg-val-red/10 p-4 text-sm text-slate-200">
          <p className="font-bold text-val-red">⚠ Baca dulu sebelum login</p>
          <p className="mt-1.5 leading-relaxed text-slate-300">
            Fitur ini pakai API tidak resmi Riot dan <b>melanggar ToS Riot</b>. Password kamu
            dikirim sekali ke server untuk ambil data toko, <b>tidak disimpan</b>. Pakai dengan
            risiko sendiri — sebaiknya hanya untuk akun sendiri.
          </p>
        </div>

        {/* Step: login */}
        {step === 'login' && (
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">
                Username Riot
              </label>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-val-panel px-4 py-3 text-white outline-none transition-colors focus:border-val-accent"
                placeholder="username"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-val-panel px-4 py-3 text-white outline-none transition-colors focus:border-val-accent"
                placeholder="••••••••"
              />
            </div>
            {error && <p className="text-sm font-semibold text-val-red">{error}</p>}
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-val-red px-6 py-3 font-black uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                'Cek Toko Saya'
              )}
            </button>
          </form>
        )}

        {/* Step: 2FA */}
        {step === 'mfa' && (
          <form onSubmit={handleMfa} className="flex flex-col gap-4">
            <p className="text-sm text-slate-300">
              Masukkan kode 2FA yang dikirim ke email
              {mfaEmail ? <b className="text-white"> {mfaEmail}</b> : ' kamu'}.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              className="w-full rounded-xl border border-white/10 bg-val-panel px-4 py-3 text-center text-2xl font-black tracking-[0.5em] text-white outline-none transition-colors focus:border-val-accent"
              placeholder="000000"
            />
            {error && <p className="text-sm font-semibold text-val-red">{error}</p>}
            <button
              type="submit"
              disabled={loading || !code}
              className="flex items-center justify-center gap-2 rounded-xl bg-val-red px-6 py-3 font-black uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                'Verifikasi'
              )}
            </button>
            <button
              type="button"
              onClick={reset}
              className="text-sm font-semibold text-slate-400 transition-colors hover:text-white"
            >
              ← Login ulang
            </button>
          </form>
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
