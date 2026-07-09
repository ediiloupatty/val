# AIMKU

A browser-based 3D aim trainer modeled after Valorant's aiming feel. It runs entirely in the browser, matches Valorant's sensitivity 1:1, and syncs profiles and weekly leaderboards through a Cloudflare Worker.

Live: [aimku.xyz](https://aimku.xyz)

> Fan project for training purposes. Not affiliated with or endorsed by Riot Games.

## Demo

[![AIMKU demo](https://img.youtube.com/vi/5Nd4XRpEkvw/maxresdefault.jpg)](https://youtu.be/Cje_noEfuv8?si=oiVQK8aX5fvydJQb)

A short walkthrough: start a session, choose a mode, play a round, and exit. ([watch on YouTube](https://youtu.be/5Nd4XRpEkvw))

## Features

- True 3D FPS camera using the Pointer Lock API.
- Sensitivity matched to Valorant via its `0.07°/count` yaw constant, so flicks transfer 1:1.
- Five training modes: Micro Flicks, Wide Flicks, Reflex Pop, Target Switch (gridshot), and Headshot Precision.
- GLB weapon viewmodel (Colt Navy revolver) with recoil and muzzle flash, plus a procedural fallback.
- Procedural hit/miss audio through the Web Audio API.
- Live HUD: score, accuracy, average split time, hit/miss counts, round timer, and FPS.
- Hitmarkers, floating score popups, and split-based dynamic scoring.
- Adjustable crosshair (color, size) and target size.
- Per-browser profiles and a weekly leaderboard, with no account required.
- Server-side score verification to guard against tampering.
- English and Indonesian UI.
- Fullscreen play with a minimal HUD. Desktop only; touch devices are blocked.

## Tech stack

- **Frontend:** React 18, Three.js, Tailwind CSS, Vite
- **Backend:** Cloudflare Workers, D1 (SQLite), R2
- **Hosting:** Vercel (frontend), Cloudflare (Worker and storage)

## Architecture

```
React (Vite)  ──HTTPS──>  Cloudflare Worker  ──>  D1 (SQLite)   profiles, scores, donations
localStorage              (worker.js)           └─>  R2          landing background images
```

- The frontend is deployed on Vercel and talks to the Worker over HTTPS.
- Profiles, scores, and donations are stored in D1. Players are identified by a per-browser `deviceId`; there is no login.
- Local settings (sensitivity, crosshair, target size, language, selected mode) persist in `localStorage`.
- Score submission is protected by a short-lived, HMAC-signed session token that can be redeemed once, plus per-device and per-IP rate limiting.

## Getting started

Prerequisites: Node.js 18+ and npm.

```bash
npm install
npm run dev          # http://localhost:5173
```

To point the frontend at a deployed Worker during development, create `.env.local`:

```
VITE_API_URL=https://<your-worker>.workers.dev
```

Production build:

```bash
npm run build
npm run preview
```

## Backend setup

The Worker and database live in `worker.js`, `schema.sql`, and `wrangler.toml`.

```bash
# Create the D1 database, then copy the returned id into wrangler.toml
npx wrangler d1 create valorant-aim-trainer-db

# Apply the schema
npx wrangler d1 execute valorant-aim-trainer-db --file=./schema.sql

# Deploy
npx wrangler deploy
```

CORS is restricted to `aimku.xyz`, `localhost`, and `*.vercel.app` preview deployments.

## API reference

| Method | Endpoint                | Description                                          |
| ------ | ----------------------- | ---------------------------------------------------- |
| GET    | `/api/profile`          | Fetch a profile and best scores by `deviceId`        |
| POST   | `/api/profile`          | Create or update a profile                           |
| POST   | `/api/session/start`    | Issue a signed, single-use session token            |
| POST   | `/api/score`            | Submit a round score; verified server-side           |
| GET    | `/api/rank`             | Get a player's current leaderboard rank              |
| GET    | `/api/leaderboard`      | Weekly top scores, filterable by mode                |
| GET    | `/api/donations`        | Recent supporters shown on the landing page          |
| POST   | `/api/saweria-webhook`  | Donation webhook (Saweria)                           |
| GET    | `/api/backgrounds`      | List landing-page background images                  |
| GET    | `/api/bg/:name`         | Serve a background image from R2                      |

## Acknowledgements

- 3D model: *"1851 Colt Navy Revolver"* by Steven Jurriaans (CC BY).
- Inspired by Valorant (Riot Games). Non-commercial fan project.
- Built with the help of Claude (Opus 4.8) by Anthropic.

## Notes

For aim that matches Valorant 1:1, disable OS mouse acceleration ("Enhance pointer precision" on Windows).
