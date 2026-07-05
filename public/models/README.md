# Weapon model

Put a revolver / cowboy-style 3D model here named **`revolver.glb`**:

```
public/models/revolver.glb
```

## Currently used model

**“Colt Navy 1851”** by **iedalton** — licensed **CC Attribution (CC BY)**.
- Stored here as `colt_navy_1851.glb` (~4.2 MB, 1k texture).
- The app loads it via `MODEL_URL` in `src/AimTrainer.jsx` and auto-centres /
  auto-scales it, so only `MODEL_TF.rot` / `pos` / `fitLength` need tuning.
- **Attribution is required** and is shown in-app via `MODEL_CREDIT` in
  `src/AimTrainer.jsx` — paste the exact Sketchfab model URL into `MODEL_CREDIT.url`.

The app loads `/models/revolver.glb` automatically. If the file is missing, it
falls back to the built-in procedural placeholder gun (no error).

## Where to get a free, legal model

- **Sketchfab** (https://sketchfab.com) — search "revolver" or "cowboy gun",
  filter **Downloadable** + a permissive licence (CC / CC0). Download the
  **glTF (.glb)** format.
- Or model your own in **Blender** and export as `.glb`.

> ⚠️ Don't use a model ripped from Valorant — the Sheriff is Riot Games' IP.
> Use a generic revolver with a free licence, especially since the site is public.

## Fitting it in the hand

Every model has a different scale / orientation, so open
`src/AimTrainer.jsx`, find `MODEL_TF`, and tweak:

```js
const MODEL_TF = {
  scale: 1.0,            // shrink/grow (try 0.1 if the model is life-size)
  pos: [0.0, -0.05, -0.2], // x = right, y = up, z = forward (negative)
  rot: [0, 0, 0],        // radians; many models need ry = Math.PI/2 or Math.PI
};
```

Also adjust `MUZZLE` position / `buildHand(...)` placement if needed so the
muzzle flash and hand line up with the new model.
