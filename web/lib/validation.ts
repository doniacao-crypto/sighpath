/**
 * Fixed-head gaze validation — a port of src/validation.py.
 *
 * The subject holds their head still and looks at dots at known screen positions; the result
 * says how far the gaze estimate was off, in degrees of visual angle. This is the ground
 * truth the clinical measurements rest on, so the browser version has to measure exactly
 * what the desktop app measures.
 *
 * The fixtures in tests/fixtures were produced by the Python code, and the tests assert that
 * this port reproduces them.
 */

import { populationStd } from "./features";
import type { ScreenGeometry } from "./types";

/** The layouts the validation test can present. */
export type ValidationPattern = "grid_9" | "grid_16" | "random_20";

/** One validation point with the gaze samples collected while the subject looked at it. */
export interface ValidationPointResult {
  x: number;
  y: number;
  /** The gaze samples collected while the subject looked at the point. */
  samples: { x: number; y: number }[];
}

/** What the subject's gaze did at one validation point. */
export interface ValidationPointOutcome {
  x: number;
  y: number;
  /** Mean gaze position at that point. */
  meanX: number;
  meanY: number;
  /** Scatter of the samples around the mean, in degrees. */
  stdDeg: number;
  /** Distance between the point and the mean gaze position, in degrees. */
  errorDeg: number;
}

/** The measurements of a validation run. */
export interface ValidationMetrics {
  /** Mean error over the valid points, in degrees. */
  accuracyDegrees: number | null;
  /** Spread of the per-point errors, in degrees. */
  accuracyStdDegrees: number | null;
  /** Mean scatter of the samples, in degrees. */
  precisionDegrees: number | null;
  /** The worst point, in degrees. */
  worstPointAccuracy: number | null;
  validPoints: number;
  /** True when the accuracy is under the desktop's 2 degree threshold. */
  meetsClinicalThreshold: boolean;
  /** One entry per point that collected samples, in the order the points were measured. */
  perPoint: ValidationPointOutcome[];
}

/**
 * The accuracy the desktop app calls clinical (`ValidationResult.meets_clinical_threshold`).
 *
 * The limit is provisional: it has not been validated against a clinical population, so
 * passing it is not evidence that the tracker is fit for clinical use.
 */
export const CLINICAL_THRESHOLD_DEG = 2.0;

/**
 * The samples a point needs before it counts. The desktop counts a point as soon as it has
 * one sample; a point with none was never looked at.
 */
export const MIN_SAMPLES_PER_POINT = 1;

/**
 * The samples a point needs before its spread can be measured: a single sample has no
 * spread. The desktop leaves the standard deviation of such a point undefined and leaves the
 * point out of the precision.
 */
export const MIN_SAMPLES_FOR_SPREAD = 2;

/**
 * Pixels per degree of visual angle, the way the desktop validation test converts them.
 *
 * The desktop app converts with the span of one degree at the viewing distance for the
 * validation test, while the pursuit test converts with the centred formula in
 * src/metrics.py. The two differ in the fourth decimal, so each port keeps the conversion of
 * the module it mirrors.
 */
export function validationPixelsPerDegree(screen: ScreenGeometry): number {
  const screenDistancePx =
    (screen.widthPx / screen.widthCm) * screen.viewingDistanceCm;
  return screenDistancePx * Math.tan(Math.PI / 180);
}

/**
 * The dots the subject is shown.
 *
 * The desktop app measures the same way: a 3x3 or 4x4 grid that keeps a margin from the
 * screen edge, or twenty reproducible random positions. The margin is a fraction of the
 * screen, so the dots cover the same range of angles on any display.
 */
export function validationPoints(
  pattern: ValidationPattern,
  screenWidthPx: number,
  screenHeightPx: number,
  marginPercent: number
): { x: number; y: number }[] {
  const marginX = Math.trunc(screenWidthPx * marginPercent);
  const marginY = Math.trunc(screenHeightPx * marginPercent);
  const points: { x: number; y: number }[] = [];

  if (pattern === "grid_9") {
    const columns = [
      marginX,
      Math.floor(screenWidthPx / 2),
      screenWidthPx - marginX,
    ];
    const rows = [
      marginY,
      Math.floor(screenHeightPx / 2),
      screenHeightPx - marginY,
    ];
    for (const y of rows) {
      for (const x of columns) points.push({ x, y });
    }
  } else if (pattern === "grid_16") {
    const xStep = (screenWidthPx - 2 * marginX) / 3;
    const yStep = (screenHeightPx - 2 * marginY) / 3;
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        points.push({
          x: Math.trunc(marginX + column * xStep),
          y: Math.trunc(marginY + row * yStep),
        });
      }
    }
  } else {
    // The desktop seeds numpy's legacy generator with 42 for every run, so the twenty dots
    // are the same ones every time; the browser shows the same dots.
    const random = new MersenneTwister(42);
    for (let index = 0; index < 20; index += 1) {
      points.push({
        x: random.randint(marginX, screenWidthPx - marginX),
        y: random.randint(marginY, screenHeightPx - marginY),
      });
    }
  }

  return points;
}

/**
 * The measurements of a validation run.
 *
 * `points` are the dots the subject was shown, each with the gaze samples collected while
 * they looked at it. A point without samples was never looked at: it is left out of the
 * measurements entirely.
 */
export function computeValidationMetrics(
  points: ValidationPointResult[],
  screen: ScreenGeometry
): ValidationMetrics {
  const pxPerDegree = validationPixelsPerDegree(screen);
  const perPoint: ValidationPointOutcome[] = [];
  const errors: number[] = [];
  const precisions: number[] = [];

  for (const point of points) {
    if (point.samples.length < MIN_SAMPLES_PER_POINT) continue;

    const xs = point.samples.map((sample) => sample.x);
    const ys = point.samples.map((sample) => sample.y);
    const meanX = mean(xs);
    const meanY = mean(ys);
    const errorDeg =
      pxPerDegree > 0
        ? Math.hypot(meanX - point.x, meanY - point.y) / pxPerDegree
        : 0;

    // A single sample has no spread of its own: the desktop leaves the standard deviation
    // of such a point undefined and leaves the point out of the precision.
    const hasSpread = point.samples.length >= MIN_SAMPLES_FOR_SPREAD;
    const stdDeg =
      hasSpread && pxPerDegree > 0
        ? Math.hypot(populationStd(xs), populationStd(ys)) / pxPerDegree
        : 0;

    perPoint.push({ x: point.x, y: point.y, meanX, meanY, stdDeg, errorDeg });
    if (pxPerDegree > 0) {
      errors.push(errorDeg);
      if (hasSpread) precisions.push(stdDeg);
    }
  }

  const accuracyDegrees = robustMean(errors);

  return {
    accuracyDegrees,
    accuracyStdDegrees: errors.length > 1 ? populationStd(errors) : null,
    precisionDegrees: precisions.length > 0 ? mean(precisions) : null,
    worstPointAccuracy:
      errors.length > 0
        ? errors.reduce(
            (worst, error) => (error > worst ? error : worst),
            -Infinity
          )
        : null,
    validPoints: perPoint.length,
    meetsClinicalThreshold:
      accuracyDegrees !== null && accuracyDegrees < CLINICAL_THRESHOLD_DEG,
    perPoint,
  };
}

/**
 * The mean error with the wild points taken out.
 *
 * The desktop rejects the points beyond Q3 + 1.5*IQR: one blink or one badly tracked point
 * would otherwise drag the accuracy of the whole run with it.
 */
function robustMean(errors: number[]): number | null {
  if (errors.length === 0) return null;
  const q1 = percentile(errors, 25);
  const q3 = percentile(errors, 75);
  const upperBound = q3 + 1.5 * (q3 - q1);
  const kept = errors.filter((error) => error <= upperBound);
  return mean(kept.length > 0 ? kept : errors);
}

/**
 * The percentile of a sample, the way numpy computes it: the value at that percentage of the
 * sorted sample, interpolated linearly between the two neighbours.
 */
function percentile(values: number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (q / 100) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
}

/** The mean of the values. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/**
 * The Mersenne Twister the desktop app uses for the random validation pattern.
 *
 * `np.random.seed(42)` seeds numpy's legacy generator with a key array numpy builds from the
 * seed, and `np.random.randint` draws from it with masked rejection sampling: the value is
 * masked down to the smallest bit range that covers the span and redrawn until it fits.
 * Both steps are reproduced here so the browser app puts the same dots in front of the
 * subject as the desktop app does.
 */
class MersenneTwister {
  private readonly key = new Uint32Array(624);
  private index = 624;

  constructor(seed: number) {
    let state = seed >>> 0;
    for (let position = 0; position < 624; position += 1) {
      this.key[position] = state;
      // Math.imul keeps the 32-bit product exact; a plain multiply would lose precision.
      state =
        (Math.imul(1812433253, state ^ (state >>> 30)) + position + 1) >>> 0;
    }
  }

  /** The next 32-bit value of the stream. */
  private nextUint32(): number {
    if (this.index >= 624) {
      for (let i = 0; i < 624; i += 1) {
        const y =
          (this.key[i] & 0x80000000) | (this.key[(i + 1) % 624] & 0x7fffffff);
        let next = this.key[(i + 397) % 624] ^ (y >>> 1);
        if (y & 1) next ^= 0x9908b0df;
        this.key[i] = next >>> 0;
      }
      this.index = 0;
    }
    let value = this.key[this.index];
    this.index += 1;
    value ^= value >>> 11;
    value ^= (value << 7) & 0x9d2c5680;
    value ^= (value << 15) & 0xefc60000;
    value ^= value >>> 18;
    return value >>> 0;
  }

  /** A draw in the range [low, high), the way `np.random.randint(low, high)` makes it. */
  randint(low: number, high: number): number {
    const span = high - low - 1;
    if (span <= 0) return low;
    const mask = maskCovering(span);
    for (;;) {
      const value = (this.nextUint32() & mask) >>> 0;
      if (value <= span) return low + value;
    }
  }
}

/** The smallest bit mask that covers the span: 1, 3, 7, 15, ... */
function maskCovering(span: number): number {
  let mask = span >>> 0;
  mask |= mask >>> 1;
  mask |= mask >>> 2;
  mask |= mask >>> 4;
  mask |= mask >>> 8;
  mask |= mask >>> 16;
  return mask >>> 0;
}
