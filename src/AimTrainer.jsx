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
const SESSION_SECONDS = 60;

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
    count: 3, spreadX: 1.35, spreadY: 0.85, centerY: 0, sizeScale: 1, reflex: false,
  },
  wide: {
    name: 'Wide Flicks',
    desc: 'One far-flung target at a time — big, fast angle snaps.',
    count: 1, spreadX: 5.5, spreadY: 2.2, centerY: 0.1, sizeScale: 1.15, reflex: false,
  },
  reflex: {
    name: 'Reflex Pop',
    desc: 'A single target pops at a random moment — destroy it ASAP.',
    count: 1, spreadX: 4, spreadY: 2, centerY: 0.1, sizeScale: 1.2, reflex: true,
  },
  grid: {
    name: 'Target Switch',
    desc: 'Many targets spread wide. Clear fast, switch smoothly (gridshot).',
    count: 6, spreadX: 4.8, spreadY: 2.2, centerY: 0.1, sizeScale: 0.9, reflex: false,
  },
  head: {
    name: 'Headshot Precision',
    desc: 'Small targets on the head line. Pure accuracy & placement.',
    count: 3, spreadX: 2.4, spreadY: 0.45, centerY: 0.2, sizeScale: 0.55, reflex: false,
  },
};
const MODE_ORDER = ['micro', 'wide', 'reflex', 'grid', 'head'];

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

export default function AimTrainer({ onExit, lang, setLang, isMobile, best, setBest, onSession }) {
  const mountRef = useRef(null);
  const rootRef = useRef(null);
  // All mutable engine/game data — lives outside React's render cycle so the
  // 144Hz+ render loop and raw input handlers never deal with stale closures.
  const engine = useRef(null);
  const runningRef = useRef(false);

  // --- Live config (mirrored into a ref so the engine reads fresh values) ---
  // Settings persist across refreshes via localStorage.
  const SETTINGS_DEFAULTS = {
    sensitivity: 0.35,
    crosshairColor: '#00e5c0',
    crosshairSize: 10,
    targetSize: 0.28,
    modeKey: 'micro',
    lang: 'en',
  };
  const savedSettings = (() => {
    try {
      return { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem('vat_settings')) };
    } catch {
      return SETTINGS_DEFAULTS;
    }
  })();

  const [sensitivity, setSensitivity] = useState(savedSettings.sensitivity);
  const [crosshairColor, setCrosshairColor] = useState(savedSettings.crosshairColor);
  const [crosshairSize, setCrosshairSize] = useState(savedSettings.crosshairSize);
  const [targetSize, setTargetSize] = useState(savedSettings.targetSize);
  const [modeKey, setModeKey] = useState(
    MODES[savedSettings.modeKey] ? savedSettings.modeKey : 'micro'
  );
  const mode = MODES[modeKey] || MODES.micro;
  const [modeOpen, setModeOpen] = useState(false);
  const t = TEXT[lang] || TEXT.en;
  const modeText = (MODE_TEXT[lang] || MODE_TEXT.en)[modeKey] || MODE_TEXT.en.micro;

  const cfgRef = useRef({ sensitivity, targetSize, mode });
  useEffect(() => {
    cfgRef.current = { sensitivity, targetSize, mode };
  }, [sensitivity, targetSize, mode]);

  // Persist settings whenever any of them change.
  useEffect(() => {
    try {
      localStorage.setItem(
        'vat_settings',
        JSON.stringify({ sensitivity, crosshairColor, crosshairSize, targetSize, modeKey, lang })
      );
    } catch {
      /* private mode / quota — settings just won't persist */
    }
  }, [sensitivity, crosshairColor, crosshairSize, targetSize, modeKey, lang]);

  // --- Session stats (UI state) ---
  const [isRunning, setIsRunning] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
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
  const popupSeq = useRef(0);

  const shots = hits + misses;
  const accuracy = shots > 0 ? (hits / shots) * 100 : 0;

  // (#3) Transient floating feedback near the crosshair.
  const addPopup = useCallback((text, color) => {
    const id = ++popupSeq.current;
    setPopups((p) => [...p, { id, text, color, dx: Math.random() * 70 - 35 }]);
    setTimeout(() => setPopups((p) => p.filter((x) => x.id !== id)), 650);
  }, []);

  /* --------------------------- Audio (procedural) --------------------------- */
  const audioRef = useRef(null);
  const beep = useCallback((freq, duration, type = 'sine', gain = 0.15) => {
    let ctx = audioRef.current;
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioRef.current = ctx;
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
    // Calm, soft studio palette — airy and low-contrast so it feels relaxed.
    scene.background = new THREE.Color(0x3e4d57);
    scene.fog = new THREE.Fog(0x3e4d57, 16, 46);

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
    });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.cursor = 'crosshair';

    // --- Minimal environment: soft floor + back/side walls --------------------
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x5a6670, roughness: 1 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a565f, roughness: 1 });

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

    // Grid on floor for spatial reference (subtle, low-contrast lines).
    const grid = new THREE.GridHelper(60, 60, 0x6b7782, 0x6b7782);
    grid.position.y = -1.59;
    scene.add(grid);

    // --- Lighting (cheap) — soft, warm and even for a relaxed mood ------------
    scene.add(new THREE.AmbientLight(0xfff4e6, 0.9));
    // Natural sky/ground fill keeps shadows gentle instead of harsh.
    scene.add(new THREE.HemisphereLight(0xa9c6da, 0x6a5d4f, 0.6));
    const dir = new THREE.DirectionalLight(0xffe9d0, 0.5);
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
    const VM_BASE = { x: 0.16, y: -0.22, z: -0.55, rx: 0, ry: 0.08, rz: 0.04 };
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
        console.info('[AimTrainer] Could not load %s', MODEL_URL);
      }
    );

    let recoil = 0; // eased back to 0 each frame
    let muzzleTimer = 0;
    function fireViewmodel() {
      recoil = Math.min(recoil + 0.05, 0.1);
      muzzleTimer = 0.05;
      muzzle.visible = true;
      muzzle.rotation.z = Math.random() * Math.PI; // vary the flash shape
      muzzleLight.intensity = 2.5;
    }

    const raycaster = new THREE.Raycaster();
    const CENTER = new THREE.Vector2(0, 0); // crosshair is always screen centre
    const targets = [];
    let reflexTimer = null; // pending delayed spawn for Reflex Pop mode

    function spawnTarget() {
      const mode = cfgRef.current.mode;
      const r = cfgRef.current.targetSize * mode.sizeScale;
      const geo = new THREE.SphereGeometry(r, 20, 20);
      const isRed = Math.random() < 0.5;
      const color = isRed ? 0xff4655 : 0x00e5c0;
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.5,
        roughness: 0.25,
        metalness: 0.1,
      });
      const m = new THREE.Mesh(geo, mat);
      m.userData.radius = r;

      // Disc distribution within the mode's spread. Reject positions that
      // overlap existing targets (2D check — all share the same Z plane).
      const gap = 0.14; // breathing room between balls (world units)
      let best = { x: 0, y: mode.centerY };
      let bestClearance = -Infinity;
      for (let attempt = 0; attempt < 30; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(Math.random()); // 0..1, even disc distribution
        const x = Math.cos(ang) * rad * mode.spreadX;
        let y = mode.centerY + Math.sin(ang) * rad * mode.spreadY;
        y = Math.max(y, FLOOR_Y + r + 0.15); // keep clear of the floor
        let clearance = Infinity;
        for (const o of targets) {
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
        t.geometry.dispose();
        t.material.dispose();
      }
      targets.length = 0;
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
    let justLocked = false; // skip the first move after (re)locking — see below
    // Any single event larger than this (px) is a Pointer Lock glitch, not real
    // input, so we drop it. Normal aim is well under this even on fast flicks.
    const SPIKE = 400;

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
      camera.rotation.set(pitch, yaw, 0);
    }

    function onMouseDown() {
      if (!runningRef.current || document.pointerLockElement !== canvas) return;
      fireViewmodel(); // recoil + muzzle flash on every shot
      raycaster.setFromCamera(CENTER, camera);
      const hits = raycaster.intersectObjects(targets, false);
      if (hits.length > 0) {
        const hitMesh = hits[0].object;
        engine.current.onHit();
        // Destroy & respawn nearby.
        const idx = targets.indexOf(hitMesh);
        if (idx !== -1) targets.splice(idx, 1);
        scene.remove(hitMesh);
        hitMesh.geometry.dispose();
        hitMesh.material.dispose();
        respawn();
      } else {
        engine.current.onMiss();
      }
    }

    function onPointerLockChange() {
      const locked = document.pointerLockElement === canvas;
      if (locked) justLocked = true; // ignore the first (often bogus) delta
      engine.current.setLocked(locked);
    }

    function requestLock() {
      // Re-lock when the user clicks the canvas mid-session (e.g. after Esc).
      if (runningRef.current && document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
      }
    }

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('click', requestLock);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    // --- Render loop (uncapped for 144Hz+ displays) ---------------------------
    let animId;
    // (B) FPS meter — averaged over a short window, reported ~4x/second so it
    // doesn't spam React state on every single frame.
    let lastFrame = performance.now();
    let fpsFrames = 0;
    let fpsAccum = 0;
    function animate() {
      animId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastFrame) / 1000, 0.05); // clamp huge tab-switch gaps
      lastFrame = now;

      fpsAccum += dt;
      fpsFrames += 1;
      if (fpsAccum >= 0.25) {
        engine.current.onFps(Math.round(fpsFrames / fpsAccum));
        fpsFrames = 0;
        fpsAccum = 0;
      }

      // --- Viewmodel recoil & muzzle flash (frame-rate independent) ---
      recoil += (0 - recoil) * Math.min(1, dt * 16); // ease back to rest
      weapon.position.z = VM_BASE.z + recoil;
      weapon.rotation.x = VM_BASE.rx - recoil * 2.2;
      if (muzzleTimer > 0) {
        muzzleTimer -= dt;
        muzzleLight.intensity = Math.max(0, (muzzleTimer / 0.05) * 2.5);
        if (muzzleTimer <= 0) {
          muzzle.visible = false;
          muzzleLight.intensity = 0;
        }
      }

      renderer.render(scene, camera);
    }
    animate();

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
      requestLock: () => canvas.requestPointerLock(),
      resize: onResize,
      resetView: () => {
        yaw = 0;
        pitch = 0;
        camera.rotation.set(0, 0, 0);
      },
      // Filled in below via the binding effect so they always hit fresh setState.
      onHit: () => {},
      onMiss: () => {},
      setLocked: () => {},
      onFps: () => {},
    };

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('click', requestLock);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      clearTargets();
      renderer.dispose();
      if (canvas.parentNode === mount) mount.removeChild(canvas);
      engine.current = null;
    };
  }, []);

  /* ------------- Bind engine callbacks to current React setters ------------- */
  useEffect(() => {
    if (!engine.current) return;
    engine.current.onHit = () => {
      hitSound();
      const now = performance.now();
      const s = splitRef.current;
      let pts = 100; // base reward
      if (s.last) {
        // (#2) Accurate speed metric: time between consecutive hits ("split").
        const split = now - s.last;
        s.sum += split;
        s.count += 1;
        setAvgRt(s.sum / s.count);
        // (#6) Bonus scales with how fast the split was (faster = more points).
        pts += Math.round(Math.max(0, 600 - split) / 3);
      }
      s.last = now;
      setHits((h) => h + 1);
      setScore((v) => v + pts);
      addPopup(`+${pts}`, '#00e5c0'); // (#3) feedback
      setHitKey((k) => k + 1);
    };
    engine.current.onMiss = () => {
      missSound();
      setMisses((m) => m + 1);
      addPopup('MISS', '#ff4655');
    };
    engine.current.setLocked = (locked) => setIsLocked(locked);
    engine.current.onFps = (v) => setFps(v);
  }, [hitSound, missSound, addPopup]);

  /* ------------------------------ Game control ------------------------------ */
  const endGame = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    if (document.pointerLockElement) document.exitPointerLock();
    engine.current?.clearTargets();
  }, []);

  const startPractice = useCallback(() => {
    if (!engine.current) return;
    // Reset stats.
    splitRef.current = { sum: 0, count: 0, last: 0 };
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
    // Warm up audio context on the gesture.
    beep(0.0001, 0.01);
  }, [beep]);

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
  }, [endGame]);

  /* -------------------------- 60s countdown timer --------------------------- */
  // (#1) Only counts down while the pointer is actually locked — pressing Esc
  // pauses the clock instead of bleeding time you can't play.
  useEffect(() => {
    if (!isRunning || !isLocked) return;
    const id = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          endGame();
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
    if (score > 0) onSession?.({ score, accuracy, split: avgRt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, hasPlayed]);

  // --- Fullscreen: hides the sidebar, leaving a minimal HUD over the arena ---
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      rootRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);
  // Sidebar show/hide changes the canvas size with no window resize event —
  // nudge the renderer to re-fit after the layout settles.
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
      className="flex h-screen w-screen bg-val-dark font-mono text-slate-200 select-none"
    >
      {/* ============================ SIDEBAR ============================ */}
      {!isFullscreen && (
      <aside className="flex h-full w-80 shrink-0 flex-col gap-4 overflow-y-auto border-r border-white/5 bg-val-panel p-5">
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
              onClick={onExit}
              disabled={isRunning}
              title="Menu"
              className="rounded-md border border-white/15 px-2.5 py-1 text-xs font-bold text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
            >
              ← Menu
            </button>
          )}
        </header>

        {/* Mode selector — click to reveal the full list of modes */}
        <div className="relative">
          <button
            onClick={() => setModeOpen((o) => !o)}
            disabled={isRunning}
            className="flex w-full items-center justify-between rounded-md border border-val-red/40 bg-val-red/10 px-3 py-2 text-left transition hover:bg-val-red/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>
              <span className="block text-[10px] uppercase tracking-widest text-slate-400">
                {t.mode}
              </span>
              <span className="text-sm font-bold text-val-red">⌖ {modeText.name}</span>
            </span>
            <span className="text-xs text-slate-400">{modeOpen ? '▲' : '▼'}</span>
          </button>
          {modeOpen && !isRunning && (
            <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-md border border-white/10 bg-val-panel shadow-2xl">
              {MODE_ORDER.map((key) => (
                <button
                  key={key}
                  onClick={() => {
                    setModeKey(key);
                    setModeOpen(false);
                  }}
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

        {/* Timer */}
        <div className="rounded-md bg-black/30 p-3 text-center">
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
            label={t.avgSplit}
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
            className="flex-1 rounded-md bg-val-red px-3 py-2.5 text-sm font-bold uppercase tracking-wider text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isRunning ? t.running : t.startBtn.replace('▶ ', '')}
          </button>
          <button
            onClick={reset}
            className="rounded-md border border-white/15 px-3 py-2.5 text-sm font-bold uppercase tracking-wider text-slate-300 transition hover:bg-white/10"
          >
            {t.reset}
          </button>
        </div>

        {/* Settings panel */}
        <div className="mt-1 space-y-4 rounded-md bg-black/20 p-4">
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
      )}

      {/* ============================ ARENA ============================ */}
      <main className="relative flex-1">
        <div ref={mountRef} className="absolute inset-0" />

        {/* Crosshair overlay — only while actively playing (not when paused) */}
        {isRunning && isLocked && (
          <Crosshair color={crosshairColor} size={crosshairSize} />
        )}

        {/* Top-right controls: FPS meter + fullscreen toggle */}
        <div className="absolute right-4 top-4 z-30 flex items-center gap-2">
          <div
            className={`rounded bg-black/50 px-2.5 py-1 text-xs font-bold tabular-nums backdrop-blur ${
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
            onClick={toggleFullscreen}
            title={isFullscreen ? t.fsExit : t.fsEnter}
            className="rounded bg-black/50 px-2.5 py-1 text-sm leading-none text-slate-200 backdrop-blur transition hover:bg-black/70"
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
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
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
                  onAgain={startPractice}
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
                    className="mt-5 rounded-md bg-val-red px-6 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-lg transition hover:brightness-110"
                  >
                    {t.startBtn}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Click-to-resume hint when running but pointer not locked */}
        {isRunning && !isLocked && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded bg-black/70 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white">
              {t.resume}
            </p>
          </div>
        )}

        {/* Live mini HUD top-center */}
        {isRunning && (
          <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 gap-6 rounded-md bg-black/40 px-5 py-2 text-sm font-bold tabular-nums backdrop-blur">
            <span className="text-val-accent">{score}</span>
            <span className="text-slate-300">{accuracy.toFixed(0)}%</span>
            <span className={timeLeft <= 10 ? 'text-val-red' : 'text-white'}>
              {timeLeft}s
            </span>
          </div>
        )}
      </main>
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
    <div
      className={`rounded-md bg-black/25 p-2.5 ${wide ? 'col-span-2' : ''}`}
    >
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

function Crosshair({ color, size }) {
  const thickness = 2;
  const gap = 3;
  const arm = {
    position: 'absolute',
    background: color,
    boxShadow: `0 0 2px ${color}`,
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
          background: color,
          left: -thickness / 2,
          top: -thickness / 2,
        }}
      />
    </div>
  );
}

function SessionSummary({ score, accuracy, hits, misses, avgRt, best, newHigh, t, onAgain }) {
  return (
    <div className="w-80 rounded-lg border border-white/10 bg-val-panel/95 p-6 shadow-2xl">
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
        <SummaryRow label={t.avgSplit} value={`${avgRt ? Math.round(avgRt) : 0} ms`} />
        <SummaryRow label={t.hits} value={hits} />
        <SummaryRow label={t.misses} value={misses} />
      </div>
      <button
        onClick={onAgain}
        className="mt-6 w-full rounded-md bg-val-red px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-white transition hover:brightness-110"
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
    <div className="rounded bg-black/30 px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-slate-400">
        {label}
      </p>
      <p className="font-black tabular-nums text-white">{value}</p>
    </div>
  );
}
