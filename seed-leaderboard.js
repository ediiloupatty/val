/**
 * seed-leaderboard.js
 *
 * Generates SQL INSERT statements for the `scores` table to populate the
 * leaderboard with realistic-looking data for the next 100 days from today.
 *
 * Usage:
 *   node seed-leaderboard.js > seed.sql
 *
 * Then apply to your D1 database:
 *   npx wrangler d1 execute valorant-aim-trainer-db --remote --file=seed.sql
 */

// ─── Configuration ───────────────────────────────────────────────────────────

const DAY_START  = 100;                          // skip the first N days (already seeded)
const DAYS_AHEAD = 100;                         // how many days of data to generate
const RANKED_MODES = ['micro', 'wide', 'reflex', 'grid', 'head', 'strafe'];
const TARGET_SIZE_MIN = 0.25;
const TARGET_SIZE_MAX = 0.35;

// Fake player pool — each gets a unique device_id so they appear as separate
// users on the leaderboard.  Names are Indonesian-flavoured to match the app.
const PLAYERS = [
  { name: 'Budi',       tag: 'budi01' },
  { name: 'Sari',       tag: 'sari02' },
  { name: 'Andi',       tag: 'andi03' },
  { name: 'Rizky',      tag: 'rizky04' },
  { name: 'Putri',      tag: 'putri05' },
  { name: 'Dwi',        tag: 'dwi06' },
  { name: 'Fajar',      tag: 'fajar07' },
  { name: 'Nina',       tag: 'nina08' },
  { name: 'Hendra',     tag: 'hendra09' },
  { name: 'Dian',       tag: 'dian10' },
  { name: 'Agus',       tag: 'agus11' },
  { name: 'Lina',       tag: 'lina12' },
  { name: 'Yusuf',      tag: 'yusuf13' },
  { name: 'Mega',       tag: 'mega14' },
  { name: 'Taufik',     tag: 'taufik15' },
  { name: 'Wulan',      tag: 'wulan16' },
  { name: 'Raka',       tag: 'raka17' },
  { name: 'Ayu',        tag: 'ayu18' },
  { name: 'Bayu',       tag: 'bayu19' },
  { name: 'Citra',      tag: 'citra20' },
  { name: 'Galih',      tag: 'galih21' },
  { name: 'Indra',      tag: 'indra22' },
  { name: 'Eka',        tag: 'eka23' },
  { name: 'Joko',       tag: 'joko24' },
  { name: 'Kirana',     tag: 'kirana25' },
  { name: 'Prasetyo',   tag: 'prasetyo26' },
  { name: 'Dewi',       tag: 'dewi27' },
  { name: 'Bambang',    tag: 'bambang28' },
  { name: 'Fitri',      tag: 'fitri29' },
  { name: 'Arief',      tag: 'arief30' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Seeded PRNG (mulberry32) so the output is reproducible. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20261025); // deterministic seed (batch 2)

/** Random float in [min, max). */
function randFloat(min, max) { return min + rng() * (max - min); }

/** Random integer in [min, max]. */
function randInt(min, max) { return Math.floor(randFloat(min, max + 1)); }

/** Pick a random element from an array. */
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }

/** Round to N decimal places. */
function round(n, dp = 2) { const f = 10 ** dp; return Math.round(n * f) / f; }

// ─── Score ranges per mode ───────────────────────────────────────────────────
// Keep scores realistic and varied:
//  - Most scores land in the "average" band
//  - ~20% land in the "good" band
//  - ~5% land in the "great" band
//  - Nobody ever hits 100k; max is around 30k for a great run
//
// Score distribution tiers (normalised 60s equivalent):
//   bad    : 2 000 – 8 000   (beginners)
//   average: 8 000 – 16 000  (most players)
//   good   : 16 000 – 24 000 (solid)
//   great  : 24 000 – 35 000 (top)

function generateScore() {
  const roll = rng();
  if (roll < 0.25) {
    // bad tier — beginners
    return randInt(2000, 8000);
  } else if (roll < 0.70) {
    // average tier — bulk of players
    return randInt(8000, 16000);
  } else if (roll < 0.92) {
    // good tier
    return randInt(16000, 24000);
  } else {
    // great tier — top players, still well under 100k
    return randInt(24000, 35000);
  }
}

function generateAccuracy() {
  // accuracy 40% – 98%, weighted towards 55-80%
  const roll = rng();
  if (roll < 0.15) return round(randFloat(40, 55));
  if (roll < 0.75) return round(randFloat(55, 80));
  if (roll < 0.95) return round(randFloat(80, 92));
  return round(randFloat(92, 98));
}

function generateSplit() {
  // average split (reaction time) in ms: 120 – 500ms
  const roll = rng();
  if (roll < 0.10) return round(randFloat(120, 180));   // very fast
  if (roll < 0.60) return round(randFloat(180, 320));   // normal
  if (roll < 0.90) return round(randFloat(320, 450));   // slow
  return round(randFloat(450, 600));                     // very slow
}

function generateTargetSize() {
  // between 0.25 and 0.35, rounded to 2 decimal places
  return round(randFloat(TARGET_SIZE_MIN, TARGET_SIZE_MAX));
}

// ─── Generate data ───────────────────────────────────────────────────────────

const today = new Date();
today.setHours(0, 0, 0, 0);

const rows = [];
const dayOffset = DAY_START; // start from this day offset

for (let day = dayOffset; day < dayOffset + DAYS_AHEAD; day++) {
  const date = new Date(today.getTime() + day * 24 * 60 * 60 * 1000);

  // Each day: 8-18 score entries from random players across random modes
  const entriesPerDay = randInt(8, 18);

  for (let e = 0; e < entriesPerDay; e++) {
    const player = pick(PLAYERS);
    const mode = pick(RANKED_MODES);
    const score = generateScore();
    const accuracy = generateAccuracy();
    const split = generateSplit();
    const targetSize = generateTargetSize();

    // Random time within that day (hours 6–23)
    const hour = randInt(6, 23);
    const minute = randInt(0, 59);
    const second = randInt(0, 59);
    const createdAt = new Date(date);
    createdAt.setHours(hour, minute, second, 0);

    rows.push({
      deviceId: `dev-seed-${player.tag}-${String(Math.abs(hashCode(player.tag + mode))).slice(0, 8)}`,
      name: player.name,
      score,
      accuracy,
      split,
      mode,
      targetSize,
      createdAt: createdAt.toISOString(),
    });
  }
}

// Simple string hash for deterministic device IDs per player+mode combo
function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  }
  return h;
}

// ─── Output SQL ──────────────────────────────────────────────────────────────

// Escape single quotes for SQL strings
function esc(s) { return String(s).replace(/'/g, "''"); }

console.log('-- Leaderboard seed data: ' + rows.length + ' score entries over ' + DAYS_AHEAD + ' days');
console.log('-- Generated on ' + new Date().toISOString());
console.log('-- Target size range: ' + TARGET_SIZE_MIN + ' – ' + TARGET_SIZE_MAX);
console.log('-- Score ceiling: ~35 000 (well under 100k)');
console.log('');

// D1 supports multi-row INSERT; batch in chunks of 50 to stay under query limits
const BATCH = 50;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  console.log('INSERT INTO scores (device_id, name, score, accuracy, split, mode, target_size, created_at) VALUES');
  const values = batch.map((r) =>
    `  ('${esc(r.deviceId)}', '${esc(r.name)}', ${r.score}, ${r.accuracy}, ${r.split}, '${esc(r.mode)}', ${r.targetSize}, '${esc(r.createdAt)}')`
  );
  console.log(values.join(',\n') + ';');
  console.log('');
}

// Also seed the profiles table so names show up correctly on the leaderboard
console.log('-- Seed profiles for the fake players');
for (const p of PLAYERS) {
  // Use the first device_id for each player
  const deviceId = `dev-seed-${p.tag}-00000000`;
  console.log(
    `INSERT OR IGNORE INTO profiles (device_id, name, score, accuracy, split, updated_at) ` +
    `VALUES ('${esc(deviceId)}', '${esc(p.name)}', 0, 0, 0, '${new Date().toISOString()}');`
  );
}

console.log('');
console.log('-- Done! ' + rows.length + ' scores + ' + PLAYERS.length + ' profiles seeded.');
