# Valorant Aim Trainer

A pure client-side Valorant-style aim trainer built with **React**, **Tailwind CSS**, and **Three.js**. No backend — all session state, stats, and settings are managed with React hooks and persisted via `localStorage`.

## Features

- **True 3D FPS camera** with the Pointer Lock API.
- **Valorant sensitivity matcher** (uses the in-game `0.07°/count` yaw constant) — flicks feel 1:1 with the game.
- **5 training modes:** Micro Flicks, Wide Flicks, Reflex Pop, Target Switch (gridshot), Headshot Precision.
- **Procedural FPS viewmodel** (Sheriff-style revolver + hand) with recoil & muzzle flash — no external assets.
- **Procedural audio** (Web Audio API) for hit/miss feedback.
- HUD with live score, accuracy, avg split time, hits/misses, 60s timer, and an FPS meter.
- Hitmarkers, floating score popups, dynamic scoring (faster splits = more points).
- Customizable crosshair (color & size) and target size.
- Personal bests + settings saved across refreshes (`localStorage`).
- Fullscreen mode with a minimal HUD.

## Getting started

```bash
npm install
npm run dev
```

Then open the local URL Vite prints (usually `http://localhost:5173`).

## Build

```bash
npm run build
npm run preview
```

## Tech stack

- React 18 (functional components + hooks)
- Three.js (raw, in a `useRef` canvas)
- Tailwind CSS
- Vite

## Notes

For aim that matches Valorant 1:1, disable OS mouse acceleration ("Enhance pointer precision" on Windows).
