# AIMKU — Valorant-style Aim Trainer

A 3D aim trainer inspired by Valorant, built with **React + Three.js + Tailwind**.
Live at **[aimku.xyz](https://aimku.xyz)**. Fan project — not affiliated with Riot Games.

## Features

- **True 3D FPS camera** via the Pointer Lock API.
- **Valorant sensitivity matcher** (in-game `0.07°/count` yaw constant) — flicks feel 1:1.
- **5 training modes:** Micro Flicks, Wide Flicks, Reflex Pop, Target Switch (gridshot), Headshot Precision.
- **GLB weapon viewmodel** (Colt Navy revolver) with recoil & muzzle flash, plus a procedural fallback.
- **Procedural audio** (Web Audio API) for hit/miss feedback.
- HUD: live score, accuracy, avg split time, hits/misses, 60s timer, FPS meter.
- Hitmarkers, floating score popups, dynamic scoring (faster splits = more points).
- Customizable crosshair (color & size) and target size.
- **Valorant-style landing page** with PLAY / Profile / Credits and a wind effect.
- **Bilingual UI** (English / Indonesian).
- Fullscreen mode with a minimal HUD; desktop-only (blocks touch devices).

## Architecture

```
React (Vite) frontend  ──HTTPS──>  Cloudflare Worker  ──>  Cloudflare D1 (SQLite)
   localStorage (settings)            (worker.js)            profiles table
```

- **Frontend** is deployed on Vercel.
- **Profile + best scores** sync to a Cloudflare **D1** database via a Worker, keyed by a
  per-browser `deviceId` (no login). See `src/api.js` and `worker.js`.
- **Settings** (sensitivity, crosshair, target size, language, mode) persist in `localStorage`.

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173
```

Create `.env.local` to point the frontend at your Worker (optional in dev):

```
VITE_API_URL=https://<your-worker>.workers.dev
```

## Build

```bash
npm run build
npm run preview
```

## Backend (Cloudflare Worker + D1)

```bash
# create the D1 database (id goes into wrangler.toml)
npx wrangler d1 create valorant-aim-trainer-db

# apply the schema
npx wrangler d1 execute valorant-aim-trainer-db --file=./schema.sql

# deploy the worker
npx wrangler deploy
```

API endpoints (`worker.js`):

- `GET  /api/profile?deviceId=…` — fetch profile + best scores
- `POST /api/profile` — upsert `{ deviceId, name, best:{ score, accuracy, split } }`

CORS is restricted to `aimku.xyz`, `localhost`, and `*.vercel.app` previews.

## Tech stack

React 18 · Three.js · Tailwind CSS · Vite · Cloudflare Workers + D1

## Credits

- 3D model: *“1851 Colt Navy Revolver”* by **Steven Jurriaans** (CC BY).
- Inspired by Valorant (Riot Games). This is a non-commercial fan project.

## Notes

For aim that matches Valorant 1:1, disable OS mouse acceleration
("Enhance pointer precision" on Windows).
