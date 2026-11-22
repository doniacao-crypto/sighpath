/**
 * Pursuit metrics — a faithful port of the Python implementation in
 * src/smooth_pursuit_test.py and src/metrics.py.
 *
 * The two versions must agree: the fixtures in tests/fixtures were produced by the Python
 * code and the tests assert that this port reproduces them.
 */

import type { PursuitMetrics, ScreenGeometry, TrackingFrame } from "./types";

/** Frames per second assumed by the windowed velocity differences. */
const SMOOTH_WINDOW = 3;
/** How far the gaze speed may differ from the target speed before it is charged. */
const SPEED_TOLERANCE = 0.35;
/** Head drift below this is landmark jitter, not movement. */
const HEAD_DEADBAND_DEG = 2.0;
/** Head drift at which the stillness factor reaches zero. */
const HEAD_DECAY_DEG = 8.0;
/** Coefficient of variation a perfectly smooth tracker still shows under pixel jitter. */
const NOISE_FLOOR_CV = 0.4;
/** Saccade velocity threshold in degrees per second (src/constants.py). */
const SACCADE_VELOCITY_THRESHOLD_DEG_S = 50.0;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function std(values: number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  let total = 0;
  for (const value of values) total += (value - average) ** 2;
  return Math.sqrt(total / values.length);
}

function clip(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Pixels per degree of visual angle at the centre of the screen. */
export function pixelsPerDegree(screen: ScreenGeometry): number {
  const cmPerDegree =
    2 * screen.viewingDistanceCm * Math.tan((0.5 * Math.PI) / 180);
  return cmPerDegree * (screen.widthPx / screen.widthCm);
}

/** Convert a distance in pixels to degrees of visual angle. */
export function pixelsToDegrees(
  screen: ScreenGeometry,
  pixels: number
): number {
  return pixels / pixelsPerDegree(screen);
}

/**
 * Compute every measurement for a recorded run.
 *
 * `frames` must be the frames of one run; frames without a usable gaze estimate are
 * carried as null and excluded from the measurements, exactly as the Python version does.
 */
export function computePursuitMetrics(
  frames: TrackingFrame[],
  screen: ScreenGeometry
): PursuitMetrics {
  const empty: PursuitMetrics = {
    trackingRatio: 0,
    directionMatch: 0,
    speedMatch: 0,
    smoothScore: 0,
    headStillness: 0,
    avgDistancePx: 0,
    pursuitGain: 0,
    accuracyDegrees: 0,
    phaseLagMs: 0,
    totalFrames: frames.length,
    validFrames: 0,
  };
  if (frames.length === 0) return empty;

  const valid = frames.filter(
    (frame) =>
      frame.gazeX !== null && frame.gazeY !== null && frame.faceDetected
  );
  if (valid.length === 0) return empty;

  const gazeX = valid.map((frame) => frame.gazeX as number);
  const gazeY = valid.map((frame) => frame.gazeY as number);
  const targetX = valid.map((frame) => frame.targetX);
  const targetY = valid.map((frame) => frame.targetY);
  const timestamps = valid.map((frame) => frame.timestamp);

  // Mean distance between the estimate and the target.
  const distances = valid.map((_, index) =>
    Math.hypot(gazeX[index] - targetX[index], gazeY[index] - targetY[index])
  );
  const avgDistancePx = mean(distances);

  // Head stillness, measured against the median pose of the run.
  const pitches = valid.map((frame) => frame.headPitch);
  const yaws = valid.map((frame) => frame.headYaw);
  // The neutral pose of the run is the median pose: every frame is then scored for how
  // far it drifted from it.
  const sortedPitches = [...pitches].sort((a, b) => a - b);
  const sortedYaws = [...yaws].sort((a, b) => a - b);
  const middle = Math.floor(sortedPitches.length / 2);
  const referencePitch =
    sortedPitches.length % 2 === 0
      ? (sortedPitches[middle - 1] + sortedPitches[middle]) / 2
      : sortedPitches[middle];
  const referenceYaw =
    sortedYaws.length % 2 === 0
      ? (sortedYaws[middle - 1] + sortedYaws[middle]) / 2
      : sortedYaws[middle];

  const stillness = valid.map((frame) => {
    const drift = Math.hypot(
      frame.headPitch - referencePitch,
      frame.headYaw - referenceYaw
    );
    return clip(1 - (drift - HEAD_DEADBAND_DEG) / HEAD_DECAY_DEG, 0, 1);
  });
  const headStillness = mean(stillness) * 100;

  // The eye scores are charged for head movement as well, but gently: the head has its own
  // score, and charging it twice squashed every result.
  const stillnessWeight = (index: number) => Math.sqrt(stillness[index]);

  const directionScores: number[] = [];
  const speedScores: number[] = [];

  for (let i = 1; i < valid.length; i += 1) {
    const dt = timestamps[i] - timestamps[i - 1];
    if (dt <= 0) continue;

    const lo = Math.max(1, i - SMOOTH_WINDOW + 1);
    const tdx = targetX[i] - targetX[lo - 1];
    const tdy = targetY[i] - targetY[lo - 1];
    const span = timestamps[i] - timestamps[lo - 1];
    const targetSpeed = Math.hypot(tdx, tdy) / span;

    const gdx = gazeX[i] - gazeX[lo - 1];
    const gdy = gazeY[i] - gazeY[lo - 1];
    const gazeSpeed = Math.hypot(gdx, gdy) / span;

    if (targetSpeed <= 1) continue; // Target effectively stationary: nothing to match.

    if (gazeSpeed > 1) {
      const dot =
        (gdx * tdx + gdy * tdy) / (gazeSpeed * targetSpeed * span ** 2);
      directionScores.push(Math.max(0, dot) * stillnessWeight(i));
    }

    const ratio = gazeSpeed / targetSpeed;
    const deviation =
      Math.max(0, Math.abs(ratio - 1) - SPEED_TOLERANCE) /
      (1 - SPEED_TOLERANCE);
    speedScores.push(Math.max(0, 1 - deviation) * stillnessWeight(i));
  }

  const directionMatch = directionScores.length
    ? mean(directionScores) * 100
    : 0;
  const speedMatch = speedScores.length
    ? Math.min(100, mean(speedScores) * 100)
    : 0;
  const trackingRatio = (100 * valid.length) / frames.length;

  // Smoothness: the windowed velocity variation, with the camera's own jitter as a floor.
  let smoothScore = 0;
  const gazeVelocities: number[] = [];
  for (let i = 1; i < valid.length; i += 1) {
    const lo = Math.max(1, i - SMOOTH_WINDOW + 1);
    const span = timestamps[i] - timestamps[lo - 1];
    if (span > 0) {
      const dx = gazeX[i] - gazeX[lo - 1];
      const dy = gazeY[i] - gazeY[lo - 1];
      gazeVelocities.push(Math.hypot(dx, dy) / span);
    }
  }
  if (gazeVelocities.length > 0 && mean(gazeVelocities) > 0) {
    const coefficient = std(gazeVelocities) / (mean(gazeVelocities) + 1e-6);
    const excess = Math.max(0, coefficient - NOISE_FLOOR_CV);
    smoothScore = Math.max(0, Math.min(100, (1 - excess / 1.6) * 100));
  }

  const clinical = computeClinicalMetrics(
    targetX,
    targetY,
    gazeX,
    gazeY,
    timestamps,
    screen
  );

  return {
    trackingRatio,
    directionMatch,
    speedMatch,
    smoothScore,
    headStillness,
    avgDistancePx,
    pursuitGain: clinical.pursuitGain,
    accuracyDegrees: clinical.accuracyDegrees,
    phaseLagMs: clinical.phaseLagMs,
    totalFrames: frames.length,
    validFrames: valid.length,
  };
}

interface ClinicalResult {
  pursuitGain: number;
  accuracyDegrees: number;
  phaseLagMs: number;
}

/** The clinical measurements: pursuit gain, RMS error in degrees and phase lag. */
function computeClinicalMetrics(
  targetX: number[],
  targetY: number[],
  gazeX: number[],
  gazeY: number[],
  timestamps: number[],
  screen: ScreenGeometry
): ClinicalResult {
  if (timestamps.length < 3) {
    return { pursuitGain: 0, accuracyDegrees: 0, phaseLagMs: 0 };
  }

  // Pursuit gain: mean gaze velocity over mean target velocity, ignoring saccades.
  const targetVelocities: number[] = [];
  const gazeVelocities: number[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    const dt = Math.max(timestamps[i] - timestamps[i - 1], 1e-6);
    targetVelocities.push(
      pixelsToDegrees(
        screen,
        Math.hypot(targetX[i] - targetX[i - 1], targetY[i] - targetY[i - 1])
      ) / dt
    );
    gazeVelocities.push(
      pixelsToDegrees(
        screen,
        Math.hypot(gazeX[i] - gazeX[i - 1], gazeY[i] - gazeY[i - 1])
      ) / dt
    );
  }

  let pursuitGain = 0;
  const validVelocities: number[] = [];
  const targetValidVelocities: number[] = [];
  for (let i = 0; i < gazeVelocities.length; i += 1) {
    if (
      gazeVelocities[i] < SACCADE_VELOCITY_THRESHOLD_DEG_S &&
      targetVelocities[i] > 1.0
    ) {
      validVelocities.push(gazeVelocities[i]);
      targetValidVelocities.push(targetVelocities[i]);
    }
  }
  if (validVelocities.length > 0) {
    const meanTarget = mean(targetValidVelocities);
    if (meanTarget >= 1e-6) {
      pursuitGain = clip(mean(validVelocities) / meanTarget, 0, 2);
    }
  }

  // RMS error in degrees.
  const errors = targetX.map((_, index) =>
    pixelsToDegrees(
      screen,
      Math.hypot(targetX[index] - gazeX[index], targetY[index] - gazeY[index])
    )
  );
  const accuracyDegrees = Math.sqrt(mean(errors.map((error) => error ** 2)));

  return {
    pursuitGain,
    accuracyDegrees,
    phaseLagMs: calculatePhaseLag(targetX, gazeX, timestamps),
  };
}

/**
 * Delay between target and gaze in milliseconds, by cross-correlation of the horizontal
 * signals. Positive means the gaze lags behind the target.
 */
export function calculatePhaseLag(
  targetX: number[],
  gazeX: number[],
  timestamps: number[]
): number {
  if (timestamps.length < 10) return 0;

  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }
  const averageInterval = mean(intervals);
  if (averageInterval <= 0) return 0;
  const sampleRate = 1 / averageInterval;

  const targetMean = mean(targetX);
  const gazeMean = mean(gazeX);
  const centredTarget = targetX.map((value) => value - targetMean);
  const centredGaze = gazeX.map((value) => value - gazeMean);
  const targetStd = std(centredTarget);
  const gazeStd = std(centredGaze);
  const targetNorm = centredTarget.map((value) => value / (targetStd + 1e-8));
  const gazeNorm = centredGaze.map((value) => value / (gazeStd + 1e-8));

  // Full cross-correlation: correlation[k] = sum(gaze[i] * target[i - k]).
  const length = targetNorm.length;
  let bestLag = 0;
  let bestCorrelation = -Infinity;
  for (let lag = -(length - 1); lag <= length - 1; lag += 1) {
    let total = 0;
    for (let i = 0; i < length; i += 1) {
      const other = i - lag;
      if (other >= 0 && other < length)
        total += gazeNorm[i] * targetNorm[other];
    }
    if (total > bestCorrelation) {
      bestCorrelation = total;
      bestLag = lag;
    }
  }

  const lagMs = (bestLag / sampleRate) * 1000;
  return clip(lagMs, -500, 500);
}
