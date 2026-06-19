/* Sensitivity advisor — a pure heuristic that turns flick metrics gathered by
 * the "Find My Sens" calibration into a suggested Valorant sensitivity.
 *
 * No React/Three dependencies on purpose: it can be unit-tested or poked from
 * the browser console in isolation, e.g.
 *   recommendSens({ currentSens: 0.8, overshootRate: 0.7, samples: 40 })
 *
 * Signal model
 * ------------
 *  - overshootRate (0..1): fraction of flicks whose crosshair flew *past* the
 *    target before settling. High → sens too HIGH (aim runs "hot").
 *  - avgReversals: mean micro-corrections per flick. A jittery settle also hints
 *    at a mismatch, so it nudges the bias but is secondary to overshoot.
 *  - accuracy (0..100) and samples gate confidence.
 */

// Largest adjustment a single calibration may suggest (±fraction of current
// sens). Keeps the nudge incremental so players converge instead of lurching.
const MAX_STEP = 0.12;

// Practical Valorant sens clamp for the suggested value.
const SENS_MIN = 0.05;
const SENS_MAX = 2.0;

// Flick counts below MIN_SAMPLES are too noisy to act on; CONFIDENT_SAMPLES is
// where we call the read "high" confidence.
export const MIN_SAMPLES = 12;
export const CONFIDENT_SAMPLES = 30;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * @returns {{
 *   suggested: number, direction: 'lower'|'higher'|'keep',
 *   deltaPct: number, confidence: 'low'|'medium'|'high',
 *   reasonKey: 'overshoot'|'undershoot'|'balanced'|'lowSamples',
 *   overshootRate: number, samples: number
 * }}
 */
export function recommendSens({
  currentSens,
  overshootRate = 0,
  avgReversals = 0,
  accuracy = 0, // reserved for future weighting; kept for a stable call shape
  samples = 0,
} = {}) {
  const sens = Number.isFinite(currentSens) && currentSens > 0 ? currentSens : 0.35;

  // Too little data — never suggest a change off a handful of flicks.
  if (samples < MIN_SAMPLES) {
    return base(sens, 'keep', 0, 'low', 'lowSamples', overshootRate, samples);
  }

  // Bias in [-1, +1]. Positive = aim runs HOT (overshoots → sens too high);
  // negative = aim runs COLD (undershoots, lots of creeping corrections → low).
  const overshootBias = (overshootRate - 0.5) * 2;
  const reversalBias = clamp((avgReversals - 1) / 4, -0.5, 0.5);
  const bias = clamp(overshootBias * 0.8 + reversalBias * 0.2, -1, 1);

  const confidence = samples >= CONFIDENT_SAMPLES ? 'high' : 'medium';

  // Dead zone: balanced flicks → keep current sens.
  if (Math.abs(bias) < 0.18) {
    return base(sens, 'keep', 0, confidence, 'balanced', overshootRate, samples);
  }

  // bias > 0 (hot/overshoot) → LOWER sens; bias < 0 (cold) → RAISE sens.
  const step = clamp(bias * MAX_STEP, -MAX_STEP, MAX_STEP);
  const suggested = round3(clamp(sens * (1 - step), SENS_MIN, SENS_MAX));
  const deltaPct = Math.round(((suggested - sens) / sens) * 100);
  const direction = suggested < sens ? 'lower' : suggested > sens ? 'higher' : 'keep';
  const reasonKey = bias > 0 ? 'overshoot' : 'undershoot';

  return base(suggested, direction, deltaPct, confidence, reasonKey, overshootRate, samples);
}

function base(suggested, direction, deltaPct, confidence, reasonKey, overshootRate, samples) {
  return { suggested, direction, deltaPct, confidence, reasonKey, overshootRate, samples };
}
