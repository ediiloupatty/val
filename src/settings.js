/* Shared player settings — single source of truth in localStorage ('vat_settings').
 * Both the Landing settings panel and the in-arena AimTrainer read/write through
 * here, so a partial save from one view never clobbers keys owned by the other.
 * ------------------------------------------------------------------------------ */

// Preset target colours offered by the "Sphere Color" picker. All are bright
// enough to stay readable against the dark range background.
export const TARGET_COLORS = [
  { key: 'teal', hex: '#00e5c0' },
  { key: 'red', hex: '#ff4655' },
  { key: 'yellow', hex: '#ffd23f' },
  { key: 'green', hex: '#39ff7a' },
  { key: 'white', hex: '#f5f7fa' },
  { key: 'magenta', hex: '#ff4fd8' },
];

export const SETTINGS_DEFAULTS = {
  sensitivity: 0.35,
  crosshairColor: '#00e5c0',
  crosshairSize: 10,
  targetSize: 0.28,
  modeKey: 'micro',
  lang: 'en',
  // ---- QoL additions ----
  sfxVolume: 0.8, // 0..1 multiplier applied to the procedural SFX gain
  muzzleFlash: true, // show the weapon muzzle flash on each shot
  showGun: true, // render the first-person weapon model
  targetColor: '#00e5c0', // fill/emissive colour of standard (non-avoid) targets
  showPbReference: true, // osu!-style live personal-best chase HUD
};

export function loadSettings() {
  try {
    return { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem('vat_settings')) };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

// Merge a partial patch into the stored settings without dropping keys written
// by another view. Returns the merged object.
export function saveSettings(patch) {
  try {
    const next = { ...loadSettings(), ...patch };
    localStorage.setItem('vat_settings', JSON.stringify(next));
    return next;
  } catch {
    return { ...SETTINGS_DEFAULTS, ...patch };
  }
}

// Mute lives in its own key ('vat_muted') the trainer already manages; expose
// helpers so the settings panel can share the same toggle.
export function loadMuted() {
  try {
    return localStorage.getItem('vat_muted') === '1';
  } catch {
    return false;
  }
}

export function saveMuted(muted) {
  try {
    localStorage.setItem('vat_muted', muted ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/* ---- Per-mode personal bests (local, for the osu!-style chase HUD) ----------
 * Stored separately from the cloud profile's single overall "best" so every
 * training mode keeps its own record to chase. */
const PB_KEY = 'vat_pb';

export function loadPbs() {
  try {
    return JSON.parse(localStorage.getItem(PB_KEY)) || {};
  } catch {
    return {};
  }
}

export function getPb(modeKey) {
  const v = loadPbs()[modeKey];
  return Number.isFinite(v) ? v : 0;
}

// Record a finished score for a mode, keeping the maximum. Returns true when it
// sets a new personal best.
export function savePb(modeKey, score) {
  try {
    const pbs = loadPbs();
    const prev = Number.isFinite(pbs[modeKey]) ? pbs[modeKey] : 0;
    if (score > prev) {
      pbs[modeKey] = score;
      localStorage.setItem(PB_KEY, JSON.stringify(pbs));
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
