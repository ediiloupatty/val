import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TEXT, MODE_TEXT } from './translations.js';

/* ------------------------------------------------------------------ *
 * Valorant Aim Trainer — "Micro Flicks"
 * Pure client-side. State/stats/settings live entirely in React hooks.
 * Three.js renders a minimal scene for maximum FPS / minimal input lag.
 * ------------------------------------------------------------------ */

// Distance of the target plane in front of the camera (world units).
const TARGET_DISTANCE = -8;
// Floor height — targets must never clip through or touch it.
const FLOOR_Y = -1.6;
const SESSION_SECONDS = 40;

/*
 * Training modes. Each one reshapes how & where targets spawn:
 *  count   – simultaneous targets   spreadX/Y – cluster size (world units)
 *  centerY – vertical centre        sizeScale – multiplies the Target Size slider
 *  reflex  – spawn one at a time after a short random delay (reaction training)
 */
const MODES = {
  micro: {
    name: 'Micro Flicks',
    desc: 'Tight cluster at head height. Train tiny, precise corrections.',
    count: 3, spreadX: 1.35, spreadY: 0.6, centerY: 0.1, sizeScale: 1, reflex: false,
  },
  wide: {
    name: 'Wide Flicks',
    desc: 'One far-flung target at a time - big, fast angle snaps.',
    count: 1, spreadX: 5.5, spreadY: 0.8, centerY: 0.2, sizeScale: 1.15, reflex: false,
  },
  reflex: {
    name: 'Reflex Pop',
    desc: 'A single target pops at a random moment - destroy it ASAP.',
    count: 1, spreadX: 4, spreadY: 0.7, centerY: 0.1, sizeScale: 1.2, reflex: true,
  },
  grid: {
    name: 'Target Switch',
    desc: 'Many targets spread wide. Clear fast, switch smoothly (gridshot).',
    count: 6, spreadX: 4.8, spreadY: 1.0, centerY: 0.2, sizeScale: 0.9, reflex: false,
  },
  head: {
    name: 'Headshot Precision',
    desc: 'Small targets on the head line. Pure accuracy & placement.',
    count: 3, spreadX: 2.4, spreadY: 0.2, centerY: 0.1, sizeScale: 0.55, reflex: false,
  },
  strafe: {
    name: 'Counter-Strafe',
    desc: 'Strafe with A / D. Your shots scatter while moving - stop (counter-strafe) before you fire.',
    // spreadY 0 → all targets sit on one flat head-height line (no high/low).
    count: 3, spreadX: 2.6, spreadY: 0, centerY: 0.1, sizeScale: 1, reflex: false, counterStrafe: true,
  },
};
const MODE_ORDER = ['micro', 'wide', 'reflex', 'grid', 'head', 'strafe'];

// Standard target-size band for the per-mode leaderboard (must match worker.js
// RANKED_SIZE_MIN/MAX). Outside this, scores still count on the "All" board but
// not on the fair per-mode boards — the UI warns the player.
const RANKED_SIZE_MIN = 0.12;
const RANKED_SIZE_MAX = 0.35;

/* ---- Settings defaults & loader (module scope — computed once, not per render) ----
 * Keeping these outside the component avoids recreating the object literal and
 * running the localStorage parse on every single re-render.
 * ------------------------------------------------------------------------------------- */
const SETTINGS_DEFAULTS = {
  sensitivity: 0.35,
  crosshairColor: '#00e5c0',
  crosshairSize: 10,
  targetSize: 0.28,
  modeKey: 'micro',
  lang: 'en',
};

function loadSettings() {
  try {
    return { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem('vat_settings')) };
  } catch {
    return SETTINGS_DEFAULTS;
  }
}

/*
 * Valorant sensitivity matcher.
 * Valorant's yaw is a fixed 0.07° of rotation per mouse count, per 1.0 sens.
 * A raw mouse "count" maps 1:1 to pointer-lock `movementX/Y` (pixels) when the
 * OS has no acceleration, so:  degreesRotated = movement * sensitivity * 0.07
 * This makes flicks feel identical to the in-game experience.
 */
const VALORANT_YAW_CONSTANT = 0.07;

// Valorant uses a fixed ~103° horizontal FOV. Three.js cameras take a *vertical*
// FOV, so we derive it from the screen aspect to avoid the over-wide, distorted
// look (which makes panning sideways feel swimmy/heavy).
const VALORANT_HFOV = 103;

export default function AimTrainer({ onExit, lang, setLang, isMobile, name, setName, best, setBest, onSession, onRoundStart, showToast }) {
  const mountRef = useRef(null);
  const rootRef = useRef(null);
  // All mutable engine/game data — lives outside React's render cycle so the
  // 144Hz+ render loop and raw input handlers never deal with stale closures.
  const engine = useRef(null);
  const runningRef = useRef(false);

  // --- Live config (mirrored into a ref so the engine reads fresh values) ---
  // Settings persist across refreshes via localStorage.
  // SETTINGS_DEFAULTS and loadSettings() are defined at module scope so they
  // are never recreated on re-renders. Lazy useState initialisers ensure
  // localStorage is read only once per mount, not on every render.

  const [sensitivity, setSensitivity] = useState(() => loadSettings().sensitivity);
  const [crosshairColor, setCrosshairColor] = useState(() => loadSettings().crosshairColor);
  const [crosshairSize, setCrosshairSize] = useState(() => loadSettings().crosshairSize);
  const [targetSize, setTargetSize] = useState(() => loadSettings().targetSize);
  const [modeKey, setModeKey] = useState(() => {
    const key = loadSettings().modeKey;
    return MODES[key] ? key : 'micro';
  });
  const mode = MODES[modeKey] || MODES.micro;
  const [modeOpen, setModeOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState(null); // mode awaiting "restart timer" confirm
  const [dontWarnAgain, setDontWarnAgain] = useState(false); // the dialog's checkbox
  const [skipModeWarn, setSkipModeWarn] = useState(() => {
    try {
      return localStorage.getItem('vat_skipModeWarn') === '1';
    } catch {
      return false;
    }
  });
  const t = TEXT[lang] || TEXT.en;
  const modeText = (MODE_TEXT[lang] || MODE_TEXT.en)[modeKey] || MODE_TEXT.en.micro;

  const cfgRef = useRef({ sensitivity, targetSize, mode });
  useEffect(() => {
    cfgRef.current = { sensitivity, targetSize, mode };
  }, [sensitivity, targetSize, mode]);

  // Persist settings — debounced 400ms so rapid slider drags don't spam localStorage.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(
          'vat_settings',
          JSON.stringify({ sensitivity, crosshairColor, crosshairSize, targetSize, modeKey, lang })
        );
      } catch {
        /* private mode / quota — settings just won't persist */
      }
    }, 400);
    return () => clearTimeout(id);
  }, [sensitivity, crosshairColor, crosshairSize, targetSize, modeKey, lang]);

  // --- Session stats (UI state) ---
  const [isRunning, setIsRunning] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [isMoving, setIsMoving] = useState(false); // strafing in Counter-Strafe mode
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS);
  const [score, setScore] = useState(0);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [avgRt, setAvgRt] = useState(0); // avg split time between consecutive hits (ms)
  const [fps, setFps] = useState(0);
  const [popups, setPopups] = useState([]); // floating +score / MISS feedback
  const [hitKey, setHitKey] = useState(0); // bumped each hit to replay the hitmarker
  const [newHigh, setNewHigh] = useState(false);
  const splitRef = useRef({ sum: 0, count: 0, last: 0 });
  // Per-round gameplay log sent to the backend so the server can re-derive the
  // score from the actual hit timing (server-authoritative anti-cheat). Each hit
  // records { t: ms since round start, b: bonus interval ms used for scoring }.
  const eventLogRef = useRef({ hits: [], misses: 0, startedAt: 0 });
  const popupSeq = useRef(0);
  // Tracks pending popup timeouts so we can cancel them on unmount and avoid
  // "can't perform a React state update on an unmounted component" warnings.
  const popupTimeouts = useRef([]);
  // DOM refs for effects written directly from the rAF loop (zero re-render overhead)
  const vigRef   = useRef(null); // vignette overlay element
  const bloomRef = useRef(0);   // current bloom amount (passed to Crosshair via ref)

  const shots = hits + misses;
  const accuracy = shots > 0 ? (hits / shots) * 100 : 0;

  // (#3) Transient floating feedback near the crosshair.
  const addPopup = useCallback((text, color) => {
    const id = ++popupSeq.current;
    setPopups((p) => [...p, { id, text, color, dx: Math.random() * 70 - 35 }]);
    const tid = setTimeout(() => {
      setPopups((p) => p.filter((x) => x.id !== id));
      popupTimeouts.current = popupTimeouts.current.filter((t) => t !== tid);
    }, 650);
    popupTimeouts.current.push(tid);
  }, []);

  // Cancel all pending popup timers on unmount (prevents state updates after unmount).
  useEffect(() => () => { popupTimeouts.current.forEach(clearTimeout); }, []);

  // Session backup — written to localStorage while a session is running so a browser
  // crash or accidental close doesn't silently discard the user's score.
  // Debounced 1s to avoid writing on every single shot.
  useEffect(() => {
    if (!isRunning || score === 0) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem('vat_session_backup', JSON.stringify({ score, hits, misses, modeKey, ts: Date.now() }));
      } catch { /* ignore */ }
    }, 1000);
    return () => clearTimeout(id);
  }, [score, hits, misses, isRunning, modeKey]);

  /* --------------------------- Audio (procedural) --------------------------- */
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem('vat_muted') === '1'; } catch { return false; }
  });
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
    try { localStorage.setItem('vat_muted', muted ? '1' : '0'); } catch { /* ignore */ }
  }, [muted]);

  const audioRef = useRef(null);
  const beep = useCallback((freq, duration, type = 'sine', gain = 0.15) => {
    if (mutedRef.current) return;
    let ctx = audioRef.current;
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioRef.current = ctx;
      } catch { return; }
    }
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }, []);
  const hitSound = useCallback(() => beep(880, 0.08, 'square', 0.12), [beep]);
  const missSound = useCallback(() => beep(160, 0.1, 'sawtooth', 0.06), [beep]);

  /* ----------------------- Three.js scene (init once) ----------------------- */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    // Dark range palette — high contrast against glowing targets.
    scene.background = new THREE.Color(0x16212b);
    scene.fog = new THREE.FogExp2(0x16212b, 0.04);

    const camera = new THREE.PerspectiveCamera(
      71, // vertical FOV placeholder — recomputed by setFov() from VALORANT_HFOV
      mount.clientWidth / mount.clientHeight,
      0.1,
      200
    );
    camera.position.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    // The viewmodel is parented to the camera, so the camera must be part of
    // the scene graph for its children to render.
    scene.add(camera);

    // Keep a Valorant-like ~103° horizontal FOV on any aspect ratio.
    const setFov = () => {
      const aspect = mount.clientWidth / mount.clientHeight;
      const hfov = THREE.MathUtils.degToRad(VALORANT_HFOV);
      camera.aspect = aspect;
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / aspect));
      camera.updateProjectionMatrix();
    };
    setFov();

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      desynchronized: true, // Bypasses OS compositor for minimum latency
    });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.cursor = 'crosshair';

    // --- Minimal environment: dark floor + back/side walls --------------------
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1d2b36, roughness: 1 });
    const wallMat  = new THREE.MeshStandardMaterial({ color: 0x1a2630, roughness: 1 });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.6;
    scene.add(floor);

    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(60, 24), wallMat);
    backWall.position.set(0, 10, -20);
    scene.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(40, 24), wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-15, 10, 0);
    scene.add(leftWall);

    const rightWall = leftWall.clone();
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(15, 10, 0);
    scene.add(rightWall);

    // Sparse grid on floor — 20 divisions keeps spatial context without clutter.
    const grid = new THREE.GridHelper(60, 20, 0x253545, 0x1e2c3a);
    grid.position.y = -1.59;
    scene.add(grid);

    // --- Lighting — cooler and dimmer so emissive targets glow by contrast ----
    scene.add(new THREE.AmbientLight(0x8ab0cc, 0.6));
    scene.add(new THREE.HemisphereLight(0x6090b0, 0x1a2030, 0.5));
    const dir = new THREE.DirectionalLight(0xc0d8e8, 0.4);
    dir.position.set(5, 12, 8);
    scene.add(dir);

    /* ----------------- FPS viewmodel: GLB revolver only ----------------- */
    const weapon = new THREE.Group();

    // Muzzle flash (hidden until a shot fires).
    const muzzle = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.14, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 })
    );
    muzzle.rotation.x = -Math.PI / 2; // point down-range (-Z)
    muzzle.position.set(0, -0.02, -0.32);
    muzzle.visible = false;
    weapon.add(muzzle);
    const muzzleLight = new THREE.PointLight(0xffcaa0, 0, 4);
    muzzleLight.position.set(0, -0.02, -0.35);
    weapon.add(muzzleLight);

    // A soft fill light fixed to the camera so the viewmodel stays readable.
    const vmLight = new THREE.PointLight(0xffffff, 0.5, 6);
    vmLight.position.set(0.4, 0.1, 0.3);
    camera.add(vmLight);

    // Base pose — raised & canted so the gripping hand stays in frame, with the
    // barrel angled toward the centre like Valorant's Sheriff viewmodel.
    const VM_BASE = { x: 0.17, y: -0.13, z: -0.55, rx: 0.02, ry: 0.10, rz: 0.04 };
    weapon.position.set(VM_BASE.x, VM_BASE.y, VM_BASE.z);
    weapon.rotation.set(VM_BASE.rx, VM_BASE.ry, VM_BASE.rz);
    camera.add(weapon);

    /* ---------------- Revolver model (GLB) ----------------
     * Auto-centred & auto-scaled; tune fitLength / pos / rot to taste.
     * -------------------------------------------------------------- */
    const MODEL_URL = '/models/colt_navy_1851.glb';
    const MODEL_TF = {
      fitLength: 0.5, //  longest dimension, in viewmodel units
      pos: [0.0, -0.09, -0.07], //  bottom-right placement
      rot: [0, 0, 0], //  this model's muzzle already faces -Z
    };
    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        const model = gltf.scene;
        // Centre the raw mesh on its own origin (this model is far off-centre).
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        model.position.set(-center.x, -center.y, -center.z);
        // Wrap in a pivot we can freely scale / rotate / place.
        const pivot = new THREE.Group();
        pivot.add(model);
        pivot.scale.setScalar(MODEL_TF.fitLength / Math.max(size.x, size.y, size.z));
        pivot.rotation.set(...MODEL_TF.rot);
        pivot.position.set(...MODEL_TF.pos);
        weapon.add(pivot);
      },
      undefined,
      () => {
        console.info('[AimTrainer] Could not load %s — using fallback geometry', MODEL_URL);
        showToast?.(t.modelLoadError, 'info');
        // Minimal box-based viewmodel so something appears in-hand.
        const mat = new THREE.MeshStandardMaterial({ color: 0x2a3540, roughness: 0.85, metalness: 0.3 });
        const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.038, 0.36), mat);
        barrel.position.set(0, 0.01, -0.16);
        const slide = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.055, 0.28), mat);
        slide.position.set(0, 0.035, -0.14);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.13, 0.048), mat);
        grip.position.set(0, -0.06, 0.02);
        weapon.add(barrel, slide, grip);
      }
    );

    let vmRecoilZ = 0;
    let vmRecoilRotX = 0;
    let vmRecoilRotZ = 0;
    let camRecoilPitch = 0;
    let camRecoilYaw = 0;
    let muzzleTimer = 0;
    // Crosshair bloom — gap in px, applied on top of the base gap in the React layer
    let xhairBloom = 0;
    // Vignette flash state — driven by animloop, written to a DOM ref directly
    let vigTimer = 0; // seconds remaining for flash
    let vigType = 'fire'; // 'fire' | 'hit'
    const dyingTargets = [];

    // --- Hit flash point light (reused across hits) ---------------------------
    const hitLight = new THREE.PointLight(0xffffff, 0, 7);
    scene.add(hitLight);
    let hitLightTimer = 0;

    // --- Hit particle burst ---------------------------------------------------
    const particleGeo = new THREE.BoxGeometry(0.042, 0.042, 0.042);
    const hitParticles = []; // { mesh, vx, vy, vz, age, maxAge }

    function spawnHitParticles(pos, hexColor) {
      const count = 6;
      for (let i = 0; i < count; i++) {
        const mat = new THREE.MeshBasicMaterial({ color: hexColor, transparent: true, opacity: 1 });
        const mesh = new THREE.Mesh(particleGeo, mat);
        mesh.position.copy(pos);
        // Scatter radially in XY — bias slightly upward, minimal Z drift.
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.8;
        const speed = 3.5 + Math.random() * 4.5;
        hitParticles.push({
          mesh,
          vx: Math.cos(angle) * speed,
          vy: Math.abs(Math.sin(angle)) * speed * 0.6 + 1.5,
          vz: (Math.random() - 0.5) * 1.5,
          age: 0,
          maxAge: 0.18 + Math.random() * 0.08,
        });
        scene.add(mesh);
      }
    }

    function fireViewmodel() {
      // Viewmodel kick
      vmRecoilZ    = 0.14;
      vmRecoilRotX = 0.11;
      vmRecoilRotZ = (Math.random() - 0.5) * 0.14;

      // Camera snap — sharper pitch up, slight random yaw
      camRecoilPitch += 0.018; // ~1° screen kick up (Valorant-tuned)
      camRecoilYaw   += (Math.random() - 0.5) * 0.007;

      // Crosshair bloom — expands immediately, spring-recovers in animate()
      xhairBloom = 9;

      // Vignette flash — white rim pulse
      vigType  = 'fire';
      vigTimer = 0.08; // 80ms

      muzzleTimer = 0.05;
      muzzle.visible = true;
      muzzle.rotation.z = Math.random() * Math.PI;
      muzzleLight.intensity = 2.5;
    }

    const raycaster = new THREE.Raycaster();
    const CENTER = new THREE.Vector2(0, 0); // crosshair is always screen centre
    const targets = [];
    let reflexTimer = null; // pending delayed spawn for Reflex Pop mode

    // Authoritative hit radius per target, kept in a closure-scoped WeakMap so it
    // can't be reached or altered from the page (devtools, userscripts). Hit
    // detection uses THESE radii via a manual ray–sphere test — never the mesh
    // geometry or .scale — so visually inflating a target grants no larger
    // hittable area. Anti-cheat for the "enlarge the target" trick.
    const hitRadii = new WeakMap();
    const _hitSphere = new THREE.Sphere();
    const _hitPoint = new THREE.Vector3();

    // Geometry cache — reuse SphereGeometry instances by radius key instead of
    // allocating a new one per target. This eliminates repeated GC pressure on
    // every hit/spawn cycle (up to ~1200+ allocs per session in grid mode).
    // IMPORTANT: clearTargets() must NOT dispose cached geometries — only materials.
    //            Cached geometries are bulk-disposed during full engine teardown.
    const geoCache = new Map();
    function getCachedGeo(r) {
      const key = r.toFixed(3);
      if (!geoCache.has(key)) {
        // Fewer segments for small targets (visually indistinguishable at play distance).
        const segs = r < 0.2 ? 12 : 16;
        geoCache.set(key, new THREE.SphereGeometry(r, segs, segs));
      }
      return geoCache.get(key);
    }

    function spawnTarget() {
      const mode = cfgRef.current.mode;
      const r = cfgRef.current.targetSize * mode.sizeScale;
      const geo = getCachedGeo(r);
      const isRed = Math.random() < 0.5;
      const color = isRed ? 0xff4655 : 0x00e5c0;
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.7,
        roughness: 0.2,
        metalness: 0.05,
      });
      const m = new THREE.Mesh(geo, mat);
      m.userData.radius = r;       // used by spawn-overlap math below
      hitRadii.set(m, r);          // authoritative radius for hit detection (tamper-proof)

      // The spawn area scales with target size so bigger balls spread out in
      // proportion instead of bunching together — the relative gap between
      // targets (and thus the aiming difficulty) stays the same as at the
      // default 0.28 size, so enlarging targets is no longer an easy-mode
      // exploit. The cluster only stops growing when it would push a target off
      // screen, so the cap adapts to the ball radius (a bigger ball needs a
      // little more margin) rather than being a fixed value that breaks the
      // proportional scaling at large sizes.
      const VIS_HALF_X = 9.8; // ~half the visible width at the target plane (103° HFOV)
      const VIS_HALF_Y = 5.4; // ~half the visible height
      const sizeRatio = cfgRef.current.targetSize / 0.28;
      const spreadX = Math.min(mode.spreadX * sizeRatio, Math.max(mode.spreadX, VIS_HALF_X - r));
      const spreadY = Math.min(mode.spreadY * sizeRatio, Math.max(mode.spreadY, VIS_HALF_Y - r));

      // Disc distribution within the (size-scaled) spread. Reject positions that
      // overlap existing targets (2D check — all share the same Z plane).
      // Breathing room between balls also scales with their size (GAP_FACTOR of
      // the combined radii). 0.25 reproduces the original 0.14 gap at default size.
      const GAP_FACTOR = 0.25;
      let best = { x: 0, y: mode.centerY };
      let bestClearance = -Infinity;
      for (let attempt = 0; attempt < 30; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(Math.random()); // 0..1, even disc distribution
        const x = Math.cos(ang) * rad * spreadX;
        let y = mode.centerY + Math.sin(ang) * rad * spreadY;
        y = Math.max(y, FLOOR_Y + r + 0.15); // keep clear of the floor
        let clearance = Infinity;
        for (const o of targets) {
          const gap = (r + o.userData.radius) * GAP_FACTOR; // scales with ball size
          const d =
            Math.hypot(x - o.position.x, y - o.position.y) -
            (r + o.userData.radius + gap);
          if (d < clearance) clearance = d;
        }
        if (clearance >= 0) {
          best = { x, y }; // found a fully non-overlapping spot
          break;
        }
        if (clearance > bestClearance) {
          bestClearance = clearance; // keep the least-bad fallback
          best = { x, y };
        }
      }
      m.position.set(best.x, best.y, TARGET_DISTANCE);
      m.userData.spawnTime = performance.now();
      m.userData.spawnAge  = 0; // drives the pop-in animation in animate()
      m.scale.setScalar(0);    // start invisible — animate() scales to 1
      scene.add(m);
      targets.push(m);
    }

    function clearTargets() {
      if (reflexTimer) {
        clearTimeout(reflexTimer);
        reflexTimer = null;
      }
      for (const t of targets) {
        scene.remove(t);
        // Geometry is shared in geoCache — only dispose the per-instance material.
        t.material.dispose();
      }
      targets.length = 0;
      for (const dtg of dyingTargets) {
        scene.remove(dtg.mesh);
        // Geometry is shared in geoCache — only dispose the per-instance material.
        dtg.mesh.material.dispose();
      }
      dyingTargets.length = 0;
    }

    function fillTargets() {
      while (targets.length < cfgRef.current.mode.count) spawnTarget();
    }

    // Replenish after a hit — instant for most modes, delayed for Reflex Pop.
    function respawn() {
      if (cfgRef.current.mode.reflex) {
        reflexTimer = setTimeout(() => {
          reflexTimer = null;
          if (runningRef.current) fillTargets();
        }, 350 + Math.random() * 650);
      } else {
        fillTargets();
      }
    }

    // --- Pointer Lock controls ------------------------------------------------
    let yaw = 0;
    let pitch = 0;
    let isCanvasLocked = false; // true while the pointer is locked to the canvas
    let justLocked = false; // skip the first move after (re)locking — see below
    // Any single event larger than this (px) is a Pointer Lock glitch, not real
    // input, so we drop it. Normal aim is well under this even on fast flicks.
    const SPIKE = 400;

    // --- Counter-Strafe movement (A / D) — only the counterStrafe mode uses it ---
    let moveLeft = false;
    let moveRight = false;
    let strafeVel = 0; // horizontal velocity (world units / sec)
    let lastMoving = false; // edge-trigger for the dynamic crosshair
    const STRAFE_MAX = 7; // top strafe speed
    const STRAFE_ACCEL = 70; // ramp toward top speed
    const STRAFE_FRICTION = 45; // slide-out decel when no key is held
    const STRAFE_BRAKE = 140; // hard decel when pressing the opposite key (the counter-strafe)
    const STRAFE_RANGE = 5; // clamp so the player stays inside the room
    const STRAFE_ACC_THRESHOLD = 0.6; // at/below this speed, shots are accurate
    const STRAFE_SPREAD_K = 0.03; // NDC aim error per unit of speed over threshold

    function onPointerMove(e) {
      if (document.pointerLockElement !== canvas) return;

      // The browser often reports a huge bogus delta on the first event right
      // after lock is (re)acquired (cursor jumping from its old position) — skip.
      if (justLocked) {
        justLocked = false;
        return;
      }

      // Use the event's own delta (reliable). We render once per frame, so
      // summing getCoalescedEvents() added no visual benefit and could feed in
      // spurious spikes — that was the "sudden flick" bug.
      const rawDx = e.movementX || 0;
      const rawDy = e.movementY || 0;

      // Reject non-physical spikes in any direction (up/down/sideways).
      // Checked on the raw CSS-pixel delta, before the DPI correction below.
      if (Math.abs(rawDx) > SPIKE || Math.abs(rawDy) > SPIKE) return;

      // Pointer Lock reports deltas in *CSS pixels*. On HiDPI screens or with OS
      // display scaling / browser zoom (devicePixelRatio > 1), that's fewer units
      // than the mouse's raw counts — so aim feels slower than the same sens in
      // Valorant (which works in raw counts, independent of screen scaling).
      // Convert back to physical device pixels so 0.07°/count holds 1:1.
      const dpr = window.devicePixelRatio || 1;
      const dx = rawDx * dpr;
      const dy = rawDy * dpr;

      const rotPerCount = THREE.MathUtils.degToRad(
        cfgRef.current.sensitivity * VALORANT_YAW_CONSTANT
      );
      yaw -= dx * rotPerCount;
      pitch -= dy * rotPerCount;
      pitch = Math.max(-1.5, Math.min(1.5, pitch)); // clamp look up/down
      camera.rotation.set(pitch + camRecoilPitch, yaw + camRecoilYaw, 0);
    }

    function onMouseDown() {
      if (!runningRef.current) return;
      // Paused (e.g. after Esc): treat the press itself as a resume request so
      // re-locking happens on mousedown rather than waiting for the click event.
      // This press must NOT also fire a shot.
      if (document.pointerLockElement !== canvas) {
        requestLock();
        return;
      }
      fireViewmodel(); // recoil + muzzle flash on every shot
      // Counter-Strafe: firing while moving scatters the shot away from the
      // crosshair (accurate only once you've stopped).
      let aimPt = CENTER;
      if (cfgRef.current.mode.counterStrafe) {
        const over = Math.abs(strafeVel) - STRAFE_ACC_THRESHOLD;
        if (over > 0) {
          const s = Math.min(over * STRAFE_SPREAD_K, 0.18);
          aimPt = new THREE.Vector2((Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s);
        }
      }
      raycaster.setFromCamera(aimPt, camera);
      // Manual ray–sphere test against the authoritative (tamper-proof) radius
      // instead of raycaster.intersectObjects(), which would test the mesh
      // geometry/scale and therefore reward anyone who enlarges a target.
      // Pick the nearest target the ray passes through.
      let hitMesh = null;
      let hitDistSq = Infinity;
      for (const t of targets) {
        if (t.userData.dying) continue;
        _hitSphere.set(t.position, hitRadii.get(t) || t.userData.radius);
        if (raycaster.ray.intersectSphere(_hitSphere, _hitPoint)) {
          const d = raycaster.ray.origin.distanceToSquared(_hitPoint);
          if (d < hitDistSq) { hitDistSq = d; hitMesh = t; }
        }
      }
      if (hitMesh) {
        // True reaction = time from this target spawning to being hit.
        const reaction = performance.now() - (hitMesh.userData.spawnTime || performance.now());
        engine.current.onHit(reaction);
        // Destroy & respawn nearby.
        const idx = targets.indexOf(hitMesh);
        if (idx !== -1) targets.splice(idx, 1);

        // Hit particle burst — scatter from target center.
        const hitColor = hitMesh.material.color.getHex();
        spawnHitParticles(hitMesh.position, hitColor);

        // Hit flash — brief point light at impact position.
        hitLight.color.setHex(hitColor);
        hitLight.position.copy(hitMesh.position);
        hitLight.intensity = 4;
        hitLightTimer = 0.12;

        hitMesh.userData.dying = true;
        dyingTargets.push({ mesh: hitMesh, age: 0 });
        respawn();
      } else {
        engine.current.onMiss();
        // Miss: brief red vignette edge flash
        vigType  = 'miss';
        vigTimer = 0.12;
      }
    }

    function onPointerLockChange() {
      const locked = document.pointerLockElement === canvas;
      isCanvasLocked = locked;
      if (locked) {
        justLocked = true; // ignore the first (often bogus) delta
      } else {
        // Pausing kills any strafe momentum so you don't drift on resume.
        strafeVel = 0;
        moveLeft = false;
        moveRight = false;
        lastMoving = false;
      }
      engine.current.setLocked(locked);
    }

    // Counter-Strafe keys (A / D, arrows). Booleans are only read by the
    // counterStrafe mode's movement block, so other modes are unaffected.
    function onKeyDown(e) {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') moveLeft = true;
      else if (e.code === 'KeyD' || e.code === 'ArrowRight') moveRight = true;
    }
    function onKeyUp(e) {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') moveLeft = false;
      else if (e.code === 'KeyD' || e.code === 'ArrowRight') moveRight = false;
    }

    function requestLock() {
      // Re-lock when the user clicks the canvas mid-session (e.g. after Esc).
      // Browsers enforce a short (~1.3s) cooldown after Esc before re-locking is
      // allowed, so a click during that window is ignored — the next click then
      // succeeds. All failures are swallowed so they never surface as unhandled
      // promise rejections (which previously made resume feel stuck).
      if (!runningRef.current || document.pointerLockElement === canvas) return;
      const plainLock = () => {
        try {
          const p = canvas.requestPointerLock();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch { /* ignore — user can click again after the cooldown */ }
      };
      try {
        // Request raw mouse input (bypasses OS acceleration) for true 1:1 aim.
        const promise = canvas.requestPointerLock({ unadjustedMovement: true });
        if (promise && typeof promise.catch === 'function') promise.catch(plainLock);
      } catch {
        plainLock();
      }
    }

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('click', requestLock);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // --- Render loop (uncapped for 144Hz+ displays) ---------------------------
    let animId;
    // (B) FPS meter — averaged over a short window, reported ~4x/second so it
    // doesn't spam React state on every single frame.
    let lastFrame = performance.now();
    let fpsFrames = 0;
    let fpsAccum = 0;
    function animate() {
      animId = requestAnimationFrame(animate);
      // Guard: if cleanup already ran (engine.current = null), bail immediately.
      // Without this, a stale rAF frame can fire after unmount and crash on
      // engine.current.onBloom / onFps / onVig — all of which are null-accessed.
      if (!engine.current) {
        cancelAnimationFrame(animId);
        return;
      }
      const now = performance.now();
      const dt = Math.min((now - lastFrame) / 1000, 0.05); // clamp huge tab-switch gaps
      lastFrame = now;

      // --- Counter-Strafe: the player slides with A / D. Pressing the opposite
      // key brakes hard (the counter-strafe); accuracy is handled in onMouseDown
      // via a speed-based aim spread. ---
      const curMode = cfgRef.current.mode;
      if (curMode.counterStrafe && runningRef.current && isCanvasLocked) {
        const input = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);
        if (input !== 0) {
          const braking = strafeVel !== 0 && Math.sign(input) !== Math.sign(strafeVel);
          strafeVel += input * (braking ? STRAFE_BRAKE : STRAFE_ACCEL) * dt;
          strafeVel = Math.max(-STRAFE_MAX, Math.min(STRAFE_MAX, strafeVel));
        } else {
          const dec = STRAFE_FRICTION * dt;
          strafeVel = Math.abs(strafeVel) <= dec ? 0 : strafeVel - Math.sign(strafeVel) * dec;
        }
        camera.position.x += strafeVel * dt;
        if (camera.position.x > STRAFE_RANGE) {
          camera.position.x = STRAFE_RANGE;
          strafeVel = 0;
        } else if (camera.position.x < -STRAFE_RANGE) {
          camera.position.x = -STRAFE_RANGE;
          strafeVel = 0;
        }
        const moving = Math.abs(strafeVel) > STRAFE_ACC_THRESHOLD;
        if (moving !== lastMoving) {
          lastMoving = moving;
          engine.current.onMoveState(moving);
        }
      }

      fpsAccum += dt;
      fpsFrames += 1;
      if (fpsAccum >= 0.25) {
        engine.current.onFps(Math.round(fpsFrames / fpsAccum));
        fpsFrames = 0;
        fpsAccum = 0;
      }

      // --- Spawn pop animation (scale 0→1 ease-out cubic, 70ms) ---
      for (const tgt of targets) {
        if (tgt.userData.spawnAge === undefined) continue;
        tgt.userData.spawnAge += dt;
        const p = Math.min(tgt.userData.spawnAge / 0.07, 1);
        const s = 1 - Math.pow(1 - p, 3); // ease-out cubic
        tgt.scale.setScalar(s);
        if (p >= 1) delete tgt.userData.spawnAge;
      }

      // --- Dying target pop animation ---
      for (let i = dyingTargets.length - 1; i >= 0; i--) {
        const dtg = dyingTargets[i];
        dtg.age += dt;
        if (dtg.age > 0.15) {
          scene.remove(dtg.mesh);
          // Geometry is shared in geoCache — only dispose the per-instance material.
          dtg.mesh.material.dispose();
          dyingTargets.splice(i, 1);
        } else {
          const s = Math.max(0, 1 - Math.pow(dtg.age / 0.15, 3));
          dtg.mesh.scale.set(s, s, s);
        }
      }

      // --- Hit particle burst update ---
      for (let i = hitParticles.length - 1; i >= 0; i--) {
        const p = hitParticles[i];
        p.age += dt;
        if (p.age >= p.maxAge) {
          scene.remove(p.mesh);
          p.mesh.material.dispose();
          hitParticles.splice(i, 1);
        } else {
          const frac = p.age / p.maxAge;
          p.mesh.position.x += p.vx * dt;
          p.mesh.position.y += p.vy * dt - 12 * p.age * dt; // gravity pull
          p.mesh.position.z += p.vz * dt;
          p.mesh.material.opacity = 1 - frac * frac;
          const s = 1 - frac * 0.6;
          p.mesh.scale.setScalar(s);
        }
      }

      // --- Hit flash light fade ---
      if (hitLightTimer > 0) {
        hitLightTimer -= dt;
        hitLight.intensity = Math.max(0, (hitLightTimer / 0.12) * 4);
        if (hitLightTimer <= 0) hitLight.intensity = 0;
      }

      // --- Camera recoil recovery (slower spring = weightier feel) ---
      camRecoilPitch += (0 - camRecoilPitch) * Math.min(1, dt * 11);
      camRecoilYaw   += (0 - camRecoilYaw)   * Math.min(1, dt * 11);
      camera.rotation.set(pitch + camRecoilPitch, yaw + camRecoilYaw, 0);

      // --- Viewmodel recoil & muzzle flash ---
      vmRecoilZ    += (0 - vmRecoilZ)    * Math.min(1, dt * 12);
      vmRecoilRotX += (0 - vmRecoilRotX) * Math.min(1, dt * 12);
      vmRecoilRotZ += (0 - vmRecoilRotZ) * Math.min(1, dt * 12);

      weapon.position.z = VM_BASE.z + vmRecoilZ;
      weapon.rotation.x = VM_BASE.rx - vmRecoilRotX;
      weapon.rotation.z = VM_BASE.rz + vmRecoilRotZ;
      if (muzzleTimer > 0) {
        muzzleTimer -= dt;
        muzzleLight.intensity = Math.max(0, (muzzleTimer / 0.05) * 2.5);
        if (muzzleTimer <= 0) {
          muzzle.visible = false;
          muzzleLight.intensity = 0;
        }
      }

      // --- Crosshair bloom recovery ---
      xhairBloom += (0 - xhairBloom) * Math.min(1, dt * 16); // snappy spring
      if (Math.abs(xhairBloom) < 0.05) xhairBloom = 0;
      engine.current.onBloom(xhairBloom);

      // --- Vignette flash (white on fire, red on miss, green on hit) ---
      if (vigTimer > 0) {
        vigTimer -= dt;
        const t = Math.max(0, vigTimer / 0.08);
        const opacity = t * (vigType === 'fire' ? 0.22 : vigType === 'hit' ? 0.28 : 0.20);
        const color   = vigType === 'fire' ? '255,255,255'
                      : vigType === 'hit'  ? '0,229,192'
                      :                      '255,70,85';
        engine.current.onVig(opacity, color);
      } else {
        engine.current.onVig(0, '0,0,0');
      }

      renderer.render(scene, camera);
    }

    // --- Resize ---------------------------------------------------------------
    function onResize() {
      setFov(); // recomputes aspect + vertical FOV from VALORANT_HFOV
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    }
    window.addEventListener('resize', onResize);

    // Expose an imperative API the React layer drives.
    engine.current = {
      canvas,
      spawnTarget,
      clearTargets,
      fillTargets,
      requestLock: () => {
        try {
          const promise = canvas.requestPointerLock({ unadjustedMovement: true });
          if (promise) promise.catch(() => canvas.requestPointerLock());
        } catch (e) {
          canvas.requestPointerLock();
        }
      },
      resize: onResize,
      resetView: () => {
        yaw = 0; pitch = 0;
        camera.rotation.set(0, 0, 0);
        camera.position.set(0, 0, 0);
        strafeVel = 0; moveLeft = false; moveRight = false; lastMoving = false;
      },
      onHit:      () => {},
      onMiss:     () => {},
      setLocked:  () => {},
      onFps:      () => {},
      onMoveState:() => {},
      // New: bloom & vignette driven by the rAF loop, NOT React state
      onBloom:    () => {},
      onVig:      () => {},
    };

    // Start render loop AFTER engine.current is fully initialized
    // so the null-guard in animate() doesn't falsely trigger on the first frame.
    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('click', requestLock);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      clearTargets();
      // Bulk-dispose all cached geometries now that the engine is fully torn down.
      geoCache.forEach((geo) => geo.dispose());
      geoCache.clear();
      // Dispose any in-flight hit particles.
      for (const p of hitParticles) { scene.remove(p.mesh); p.mesh.material.dispose(); }
      hitParticles.length = 0;
      particleGeo.dispose();
      renderer.dispose();
      if (canvas.parentNode === mount) mount.removeChild(canvas);
      engine.current = null;
    };
  }, []);

  /* ------------- Bind engine callbacks to current React setters ------------- */
  useEffect(() => {
    if (!engine.current) return;
    engine.current.onHit = (reactionMs) => {
      hitSound();
      // Hit: green vignette reward flash — trigger directly via vigRef bypass
      if (vigRef.current) {
        vigRef.current.style.opacity = 0.28;
        vigRef.current.style.boxShadow = 'inset 0 0 120px 40px rgba(0,229,192,0.28)';
      }
      const now = performance.now();
      const s = splitRef.current;
      let pts = 100; // base reward
      // `bonusInterval` is the timing value that drives the bonus (reaction for
      // Reflex Pop, split between hits otherwise). It's logged so the server can
      // recompute pts itself and reject timing that's physically impossible.
      let bonusInterval = null;
      if (cfgRef.current.mode.reflex) {
        // (#2) Reflex Pop: the meaningful metric is pure reaction (spawn→hit),
        // NOT the gap between hits (which would include the random spawn delay).
        if (reactionMs != null) {
          s.sum += reactionMs;
          s.count += 1;
          setAvgRt(s.sum / s.count);
          bonusInterval = reactionMs;
          pts += Math.round(Math.max(0, 600 - reactionMs) / 3);
        }
      } else if (s.last) {
        // Other modes: time between consecutive hits ("split").
        const split = now - s.last;
        s.sum += split;
        s.count += 1;
        setAvgRt(s.sum / s.count);
        bonusInterval = split;
        // Bonus scales with how fast the split was (faster = more points).
        pts += Math.round(Math.max(0, 600 - split) / 3);
      }
      s.last = now;
      eventLogRef.current.hits.push({
        t: Math.round(now - eventLogRef.current.startedAt),
        b: bonusInterval == null ? null : Math.round(bonusInterval),
      });
      setHits((h) => h + 1);
      setScore((v) => v + pts);
      addPopup(`+${pts}`, '#00e5c0'); // (#3) feedback
      setHitKey((k) => k + 1);
    };
    engine.current.onMiss = () => {
      missSound();
      eventLogRef.current.misses += 1;
      setMisses((m) => m + 1);
      addPopup('MISS', '#ff4655');
    };
    engine.current.setLocked  = (locked) => {
      setIsLocked(locked);
      if (!locked) setIsMoving(false);
    };
    engine.current.onFps      = (v) => setFps(v);
    engine.current.onMoveState= (m) => setIsMoving(m);
    // Bloom: write directly to a ref — Crosshair reads it on each render cycle
    engine.current.onBloom    = (px) => { bloomRef.current = px; };
    // Vignette: write directly to DOM style, zero React state
    engine.current.onVig      = (opacity, color) => {
      if (vigRef.current) {
        vigRef.current.style.opacity = opacity;
        vigRef.current.style.boxShadow =
          `inset 0 0 120px 40px rgba(${color},${opacity})`;
      }
    };
  }, [hitSound, missSound, addPopup]);

  /* ------------------------------ Game control ------------------------------ */
  const endGame = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setIsMoving(false);
    if (document.pointerLockElement) document.exitPointerLock();
    engine.current?.clearTargets();
    try { localStorage.removeItem('vat_session_backup'); } catch { /* ignore */ }
  }, []);

  const startPractice = useCallback(() => {
    if (!engine.current) return;
    // Reset stats.
    splitRef.current = { sum: 0, count: 0, last: 0 };
    eventLogRef.current = { hits: [], misses: 0, startedAt: performance.now() };
    setScore(0);
    setHits(0);
    setMisses(0);
    setAvgRt(0);
    setPopups([]);
    setNewHigh(false);
    setTimeLeft(SESSION_SECONDS);
    setHasPlayed(true);

    engine.current.resetView();
    engine.current.clearTargets();
    engine.current.fillTargets();

    runningRef.current = true;
    setIsRunning(true);
    engine.current.requestLock(); // button click is a valid user gesture

    // Ask the backend for a fresh signed token for this round (used to authorize
    // the score submission when the round ends).
    onRoundStart?.();

    // Warm up audio context on the gesture.
    beep(0.0001, 0.01);
  }, [beep, onRoundStart]);

  const reset = useCallback(() => {
    endGame();
    splitRef.current = { sum: 0, count: 0, last: 0 };
    setScore(0);
    setHits(0);
    setMisses(0);
    setAvgRt(0);
    setPopups([]);
    setNewHigh(false);
    setTimeLeft(SESSION_SECONDS);
    setHasPlayed(false);
    engine.current?.resetView();
    try { localStorage.removeItem('vat_session_backup'); } catch { /* ignore */ }
  }, [endGame]);

  // Apply a mode and restart the round fresh. Pushes the new mode into the
  // engine ref this same tick so fillTargets() uses it, and keeps
  // requestPointerLock() inside the originating click gesture.
  const applyModeChange = (key) => {
    setModeKey(key);
    cfgRef.current = { ...cfgRef.current, mode: MODES[key] };
    startPractice();
  };

  // Picking a mode: switch freely when idle. Mid-round it restarts the timer &
  // score, so warn first — unless the user opted out of the warning.
  const handleModeSelect = (key) => {
    setModeOpen(false);
    if (key === modeKey) return;
    if (!isRunning) {
      setModeKey(key);
    } else if (skipModeWarn) {
      applyModeChange(key);
    } else {
      setDontWarnAgain(false);
      setPendingMode(key);
    }
  };

  const confirmModeChange = () => {
    if (dontWarnAgain) {
      setSkipModeWarn(true);
      try {
        localStorage.setItem('vat_skipModeWarn', '1');
      } catch {
        /* ignore storage block */
      }
    }
    const key = pendingMode;
    setPendingMode(null);
    applyModeChange(key);
  };

  /* -------------------------- 40s countdown timer --------------------------- */
  // (#1) Only counts down while the pointer is actually locked — pressing Esc
  // pauses the clock instead of bleeding time you can't play.
  useEffect(() => {
    if (!isRunning || !isLocked) return;
    const id = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          // Keep the state-updater function pure (no side effects inside setState).
          // queueMicrotask runs endGame() right after this setState batch commits.
          queueMicrotask(() => endGame());
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isRunning, isLocked, endGame]);

  /* ----------- (#5) Persist personal bests when a session finishes ---------- */
  useEffect(() => {
    if (!hasPlayed || timeLeft !== 0) return;
    setNewHigh(score > best.score);
    setBest((prev) => ({
      score: Math.max(prev.score, score),
      accuracy: Math.max(prev.accuracy, accuracy),
      // Best split = fastest (lowest) average; ignore sessions with <2 hits.
      split: avgRt > 0 ? (prev.split ? Math.min(prev.split, avgRt) : avgRt) : prev.split,
    }));
    // Log this session to the weekly leaderboard (skip empty/idle sessions).
    // Include the gameplay log so the backend can re-derive and verify the score.
    if (score > 0) {
      const ev = eventLogRef.current;
      onSession?.({
        score,
        accuracy,
        split: avgRt,
        targetSize,
        log: {
          mode: modeKey,
          durationMs: Math.round(performance.now() - ev.startedAt),
          hits: ev.hits,
          misses: ev.misses,
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, hasPlayed]);

  // --- Fullscreen: hides the sidebar, leaving a minimal HUD over the arena ---
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      rootRef.current?.requestFullscreen?.()?.catch(() => {
        showToast?.(t.fullscreenError, 'error');
      });
    } else {
      document.exitFullscreen?.()?.catch(() => {});
    }
  }, [showToast, t.fullscreenError]);
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);
  // The arena canvas is full-screen at all times (the sidebar slides over it),
  // so entering/leaving play no longer resizes it. Only entering/exiting
  // fullscreen changes the viewport — nudge the renderer to re-fit then.
  useEffect(() => {
    const id = setTimeout(() => engine.current?.resize(), 60);
    return () => clearTimeout(id);
  }, [isFullscreen]);

  /* -------------------------------- Render ---------------------------------- */
  // Mobile / touch devices can't aim — show a "use a desktop" screen instead.
  if (isMobile) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-val-dark px-8 text-center font-mono text-slate-200">
        <div className="text-6xl">🖱️</div>
        <h1 className="text-2xl font-black tracking-widest text-val-red">
          VALORANT AIM TRAINER
        </h1>
        <p className="max-w-sm text-sm leading-relaxed text-slate-300">{t.mobileMsg1}</p>
        <p className="max-w-sm text-sm font-bold text-val-accent">{t.mobileMsg2}</p>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="relative h-screen w-screen overflow-hidden bg-val-dark font-sans text-slate-200 select-none"
    >
      {/* ============================ SIDEBAR ============================ */}
      {/* Always mounted so it can slide in/out; translated off-screen during
          locked play or fullscreen. The arena canvas stays full-screen
          underneath at all times, so toggling play never resizes the WebGL
          canvas — the result is a smooth slide with no map glitch. */}
      <aside
        className={`no-scrollbar absolute left-0 top-0 z-20 flex h-full w-80 flex-col gap-4 overflow-y-auto border-r border-white/10 bg-[#141d24] p-6 transition-transform duration-300 ease-out ${
          isFullscreen || (isRunning && isLocked) ? '-translate-x-full' : 'translate-x-0'
        }`}
      >
        <header className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/img/app-icon.png"
              alt="AIMKU"
              className="h-9 w-9 rounded-xl shadow-[0_0_12px_rgba(0,229,192,0.3)]"
            />
            <div>
              <h1 className="text-lg font-black tracking-widest text-val-red">AIMKU</h1>
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                {t.subtitle}
              </p>
            </div>
          </div>
          {onExit && (
            <button
              onClick={() => {
                try { localStorage.removeItem('vat_session_backup'); } catch { /* ignore */ }
                onExit();
              }}
              title="Menu"
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold text-slate-200 shadow-sm transition-all hover:bg-white/20"
            >
              ← Menu
            </button>
          )}
        </header>

        {/* Mode selector — click to reveal the full list of modes */}
        <div className="relative">
          <button
            onClick={() => setModeOpen((o) => !o)}
            disabled={isLocked}
            className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>
              <span className="block text-[10px] uppercase tracking-widest text-slate-400">
                {t.mode}
              </span>
              <span className="text-sm font-bold text-val-red">⌖ {modeText.name}</span>
            </span>
            <span className="text-xs text-slate-400">{modeOpen ? '▲' : '▼'}</span>
          </button>
          {modeOpen && !isLocked && (
            <div className="absolute z-40 mt-2 w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0f1922] shadow-xl">
              {MODE_ORDER.map((key) => (
                <button
                  key={key}
                  onClick={() => handleModeSelect(key)}
                  className={`block w-full border-l-2 px-3 py-2 text-left transition hover:bg-white/10 ${
                    key === modeKey
                      ? 'border-val-red bg-white/5'
                      : 'border-transparent'
                  }`}
                >
                  <span className="text-sm font-bold text-white">
                    {(MODE_TEXT[lang] || MODE_TEXT.en)[key].name}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-slate-400">
                    {(MODE_TEXT[lang] || MODE_TEXT.en)[key].desc}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Counter-Strafe mechanic tip — only shown in strafe mode */}
        {modeKey === 'strafe' && (
          <div className="rounded-2xl border border-[#ff4655]/20 bg-[#ff4655]/5 px-4 py-3">
            <p className="text-[11px] leading-relaxed text-slate-400">
              <span className="font-bold text-[#ff4655]">Counter-Strafe · </span>
              {t.strafeTip}
            </p>
          </div>
        )}

        {/* Timer */}
        <div className="rounded-2xl bg-white/5 p-4 text-center">
          <p className="text-[10px] uppercase tracking-widest text-slate-400">
            {t.timeRemaining}
          </p>
          <p
            className={`text-4xl font-black tabular-nums ${
              timeLeft <= 10 && isRunning ? 'text-val-red' : 'text-white'
            }`}
          >
            {String(timeLeft).padStart(2, '0')}s
          </p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          <Stat label={t.score} value={score} accent />
          <Stat label={t.accuracy} value={`${accuracy.toFixed(1)}%`} />
          <Stat label={t.hits} value={hits} good />
          <Stat label={t.misses} value={misses} bad />
          <Stat
            label={mode.reflex ? t.avgReaction : t.avgSplit}
            value={`${avgRt ? Math.round(avgRt) : 0} ms`}
            wide
          />
          <Stat label={t.bestScore} value={best.score} accent wide />
        </div>

        {/* Controls */}
        <div className="flex gap-2">
          <button
            onClick={startPractice}
            disabled={isRunning}
            className="flex-1 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-bold uppercase tracking-wider text-white transition-all hover:bg-white/15 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          >
            {isRunning ? t.running : t.startBtn.replace('▶ ', '')}
          </button>
          <button
            onClick={reset}
            className="rounded-2xl border border-white/10 bg-transparent px-4 py-3 text-sm font-bold uppercase tracking-wider text-slate-300 transition-colors hover:bg-white/5"
          >
            {t.reset}
          </button>
        </div>

        {/* Settings panel */}
        <div className="mt-2 space-y-5 rounded-3xl bg-white/[0.03] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-slate-400">
            {t.settings}
          </p>

          <Slider
            label={t.sensitivity}
            value={sensitivity}
            min={0.05}
            max={2}
            step={0.01}
            onChange={setSensitivity}
            display={sensitivity.toFixed(2)}
          />

          <Slider
            label={t.targetSize}
            value={targetSize}
            min={0.12}
            max={0.6}
            step={0.01}
            onChange={setTargetSize}
            display={targetSize.toFixed(2)}
          />
          {targetSize > RANKED_SIZE_MAX && (
            <p className="-mt-3 text-[11px] leading-snug text-val-red/90">
              {t.sizeOutOfBand}
            </p>
          )}

          {/* Crosshair customizer */}
          <div className="space-y-2 border-t border-white/5 pt-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
              {t.crosshair}
            </p>
            <div className="flex items-center justify-between text-xs">
              <label className="text-slate-300">{t.color}</label>
              <input
                type="color"
                value={crosshairColor}
                onChange={(e) => setCrosshairColor(e.target.value)}
                className="h-7 w-12 cursor-pointer rounded bg-transparent"
              />
            </div>
            <Slider
              label={t.size}
              value={crosshairSize}
              min={4}
              max={28}
              step={1}
              onChange={(v) => setCrosshairSize(Math.round(v))}
              display={`${crosshairSize}px`}
            />
          </div>
        </div>

        <p className="mt-auto text-center text-[10px] leading-relaxed text-slate-500">
          {t.tip}
        </p>
      </aside>

      {/* ============================ ARENA ============================ */}
      <main className="absolute inset-0">
        <div ref={mountRef} className="absolute inset-0" />

        {/* Vignette overlay — written to directly by the rAF loop, no React state */}
        <div
          ref={vigRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10"
          style={{ opacity: 0, transition: 'opacity 0.04s linear, box-shadow 0.04s linear' }}
        />

        {/* Crosshair overlay — only while actively playing */}
        {isRunning && isLocked && (
          <Crosshair
            color={crosshairColor}
            size={crosshairSize}
            moving={isMoving}
            bloomRef={bloomRef}
          />
        )}

        {/* Top-right controls: FPS meter + mute + fullscreen toggle */}
        <div className="absolute right-4 top-4 z-30 flex items-center gap-2">
          <div
            className={`rounded-full bg-black/40 border border-white/10 px-3 py-1.5 text-xs font-bold tabular-nums shadow-sm ${
              fps >= 120
                ? 'text-emerald-400'
                : fps >= 60
                ? 'text-yellow-400'
                : 'text-val-red'
            }`}
          >
            {fps} FPS
          </div>
          <button
            onClick={() => setMuted((m) => !m)}
            title={muted ? t.unmute : t.mute}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/40 text-sm leading-none shadow-sm transition-all hover:scale-105 hover:bg-black/60 active:scale-95"
            style={{ color: muted ? '#ff4655' : '#94a3b8' }}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? t.fsExit : t.fsEnter}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/40 text-sm leading-none text-slate-200 shadow-sm transition-all hover:scale-105 hover:bg-black/60 active:scale-95"
          >
            {isFullscreen ? '🗗' : '⛶'}
          </button>
        </div>

        {/* (#3) Hitmarker — remounts on every hit to replay the burst anim */}
        {hitKey > 0 && (
          <div
            key={hitKey}
            className="animate-hitmarker pointer-events-none absolute left-1/2 top-1/2 z-20"
          >
            <HitMarker color={crosshairColor} />
          </div>
        )}

        {/* (#3) Floating +score / MISS popups near the crosshair */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          {popups.map((p) => (
            <span
              key={p.id}
              className="animate-floatup absolute whitespace-nowrap text-lg font-black tabular-nums"
              style={{ color: p.color, left: p.dx, top: -36 }}
            >
              {p.text}
            </span>
          ))}
        </div>

        {/* Idle / paused overlays */}
        {!isRunning && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 transition-all">
            <div className="pointer-events-auto text-center">
              {hasPlayed && timeLeft === 0 ? (
                <SessionSummary
                  score={score}
                  accuracy={accuracy}
                  hits={hits}
                  misses={misses}
                  avgRt={avgRt}
                  best={best}
                  newHigh={newHigh}
                  t={t}
                  splitLabel={mode.reflex ? t.avgReaction : t.avgSplit}
                  onAgain={startPractice}
                  name={name}
                  setName={setName}
                />
              ) : (
                <>
                  <h2 className="text-3xl font-black uppercase tracking-widest text-white">
                    {modeText.name}
                  </h2>
                  <p className="mt-2 max-w-sm text-sm text-slate-300">
                    {modeText.desc} {t.secondsOnClock}
                  </p>
                  <button
                    onClick={startPractice}
                    className="mt-6 rounded-3xl border border-white/20 bg-white/10 px-8 py-3.5 text-sm font-bold uppercase tracking-wider text-white transition-all hover:bg-white/15 hover:scale-105 active:scale-95"
                  >
                    {t.startBtn}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Click-to-resume hint when running but pointer not locked (e.g. after Esc) */}
        {isRunning && !isLocked && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="animate-pulse rounded-full border border-white/20 bg-black/60 px-5 py-2.5 text-sm font-bold uppercase tracking-widest text-white shadow-lg">
              {t.resume}
            </p>
          </div>
        )}

        {/* Live mini HUD top-center */}
        {isRunning && (
          <div className="pointer-events-none absolute left-1/2 top-5 flex -translate-x-1/2 gap-8 rounded-full border border-white/10 bg-black/40 px-6 py-2.5 text-sm font-bold tabular-nums shadow-md">
            <span className="text-val-accent">{score}</span>
            <span className="text-slate-300">{accuracy.toFixed(0)}%</span>
            <span className={timeLeft <= 10 ? 'text-val-red' : 'text-white'}>
              {timeLeft}s
            </span>
          </div>
        )}
      </main>

      {/* Confirm switching mode mid-round — it restarts the timer & score */}
      {pendingMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-80 rounded-[2rem] border border-white/10 bg-[#141d24] p-7 text-center shadow-2xl">
            <p className="text-lg font-black uppercase tracking-widest text-val-red">
              {t.changeModeTitle}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">{t.changeModeMsg}</p>
            <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 text-xs text-slate-400 hover:text-slate-200">
              <input
                type="checkbox"
                checked={dontWarnAgain}
                onChange={(e) => setDontWarnAgain(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer accent-val-red"
              />
              {t.dontShowAgain}
            </label>
            <div className="mt-5 flex gap-2">
              <button
                onClick={confirmModeChange}
                className="flex-1 rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-white transition-all hover:bg-white/15 hover:scale-105 active:scale-95"
              >
                {t.changeModeConfirm}
              </button>
              <button
                onClick={() => setPendingMode(null)}
                className="flex-1 rounded-2xl border border-white/10 bg-transparent px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-slate-300 transition-colors hover:bg-white/5"
              >
                {t.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Subcomponents ------------------------------ */

function Stat({ label, value, accent, good, bad, wide }) {
  const color = accent
    ? 'text-val-accent'
    : good
    ? 'text-emerald-400'
    : bad
    ? 'text-val-red'
    : 'text-white';
  return (
    <div className={`rounded-2xl bg-white/5 p-3 ${wide ? 'col-span-2' : ''}`}>
      <p className="text-[10px] uppercase tracking-widest text-slate-400">
        {label}
      </p>
      <p className={`text-lg font-black tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, display }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <label className="text-slate-300">{label}</label>
        <span className="font-bold text-val-accent">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

function Crosshair({ color, size, moving, bloomRef }) {
  const thickness = 2;
  // Bloom from shots (read from ref — no re-render needed, value set each rAF frame).
  // Add on top of the movement gap so both effects compose correctly.
  const bloom = bloomRef?.current ?? 0;
  // While strafing crosshair blooms open & turns red (Valorant-style spread feedback).
  const gap = (moving ? 11 : 3) + bloom;
  const c = moving ? '#ff4655' : color;
  const arm = {
    position: 'absolute',
    background: c,
    boxShadow: `0 0 2px ${c}`,
    transition: moving ? 'all 0.06s linear' : 'all 0.04s ease-out',
  };
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
      {/* left */}
      <div style={{ ...arm, width: size, height: thickness, right: gap, top: -thickness / 2 }} />
      {/* right */}
      <div style={{ ...arm, width: size, height: thickness, left: gap, top: -thickness / 2 }} />
      {/* top */}
      <div style={{ ...arm, height: size, width: thickness, bottom: gap, left: -thickness / 2 }} />
      {/* bottom */}
      <div style={{ ...arm, height: size, width: thickness, top: gap, left: -thickness / 2 }} />
      {/* center dot */}
      <div
        style={{
          position: 'absolute',
          width: thickness,
          height: thickness,
          background: c,
          left: -thickness / 2,
          top: -thickness / 2,
        }}
      />
    </div>
  );
}

function SessionSummary({ score, accuracy, hits, misses, avgRt, best, newHigh, t, splitLabel, onAgain, name, setName }) {
  const [tempName, setTempName] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const showPrompt = name === 'Agent' && !saved;

  // Brief grace period so a click left over from the final shots of the round
  // can't immediately trigger "Play Again" and skip straight into a new match.
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const id = setTimeout(() => setReady(true), 700);
    return () => clearTimeout(id);
  }, []);

  const handleSave = () => {
    const trimmed = tempName.trim();
    if (!trimmed || trimmed === 'Agent') return;
    setName(trimmed);
    setSaved(true);
  };

  return (
    <div className="w-[22rem] rounded-[2rem] border border-white/10 bg-[#141d24] p-7 shadow-2xl">
      <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
        {t.sessionComplete}
      </p>
      {newHigh && (
        <p className="mt-1 animate-pulse text-xs font-black uppercase tracking-[0.3em] text-val-accent">
          {t.newRecord}
        </p>
      )}
      <p className="mt-1 text-5xl font-black text-val-accent tabular-nums">
        {score}
      </p>
      <p className="text-[11px] uppercase tracking-widest text-slate-400">
        {t.best} {best.score}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-left text-sm">
        <SummaryRow label={t.accuracy} value={`${accuracy.toFixed(1)}%`} />
        <SummaryRow label={splitLabel || t.avgSplit} value={`${avgRt ? Math.round(avgRt) : 0} ms`} />
        <SummaryRow label={t.hits} value={hits} />
        <SummaryRow label={t.misses} value={misses} />
      </div>

      {/* Name prompt — shown only when name is still the default "Agent" */}
      {showPrompt && (
        <div className="mt-4 rounded-2xl bg-[#ff4655]/10 px-4 py-3">
          <p className="mb-0.5 text-[11px] font-black uppercase tracking-widest text-[#ff4655]">
            {t.namePromptTitle}
          </p>
          <p className="mb-2.5 text-[11px] leading-snug text-slate-400">
            {t.namePromptSub}
          </p>
          <div className="flex gap-2">
            <input
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              maxLength={20}
              placeholder={t.namePromptPlaceholder}
              className="min-w-0 flex-1 rounded-xl bg-black/30 px-3 py-2 text-sm text-white outline-none border border-white/10 focus:border-[#00e5c0] transition-colors"
            />
            <button
              onClick={handleSave}
              disabled={!tempName.trim() || tempName.trim() === 'Agent'}
              className="rounded-xl bg-[#00e5c0] px-3 py-2 text-xs font-black text-[#0f1419] transition-all hover:scale-105 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {t.namePromptSave}
            </button>
          </div>
        </div>
      )}
      {saved && (
        <p className="mt-3 text-center text-xs font-bold text-[#00e5c0]">
          ✓ {t.namePromptSaved}
        </p>
      )}

      <button
        onClick={onAgain}
        disabled={!ready}
        className="mt-4 w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-bold uppercase tracking-wider text-white transition-all hover:bg-white/15 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 disabled:hover:bg-white/10"
      >
        {t.playAgain}
      </button>
    </div>
  );
}

function HitMarker({ color }) {
  // Two crossed bars forming a classic FPS hitmarker; the wrapper's
  // animate-hitmarker class scales & fades it out.
  const bar = {
    position: 'absolute',
    width: 20,
    height: 3,
    background: color,
    borderRadius: 2,
    boxShadow: `0 0 5px ${color}`,
  };
  return (
    <div className="relative">
      <div style={{ ...bar, transform: 'translate(-50%,-50%) rotate(45deg)' }} />
      <div style={{ ...bar, transform: 'translate(-50%,-50%) rotate(-45deg)' }} />
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="rounded-2xl bg-white/5 px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-slate-400">
        {label}
      </p>
      <p className="font-black tabular-nums text-white">{value}</p>
    </div>
  );
}
