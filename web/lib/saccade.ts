/**
 * Saccade protocols — a port of the Python implementation in src/saccade_test.py.
 *
 * The desktop app runs the protocol as a state machine: it presents the fixation, the
 * gap and the target, collects gaze samples while the target is up, and analyses the
 * trial when it ends. The browser splits the same protocol in two, because the part
 * that has to agree with the desktop is the analysis, not the choreography:
 *
 * - `planSaccadeTrials` says what to present and when, for a whole run.
 * - `computeSaccadeMetrics` reads the recorded trials and produces the measurements.
 *
 * The analysis mirrors `SaccadeTest._analyze_trial`: the saccade starts at the first
 * sample whose speed passes 30 deg/s, the latency is measured from the target onset, and
 * the amplitude is the displacement between the onset and the end of the saccade. The
 * fixtures in tests/fixtures were produced by running the desktop code over the same
 * trials, so the two versions cannot drift apart silently.
 */

import type { ScreenGeometry } from "./types";

/** The protocols the browser can run. */
export type SaccadeTestType = "horizontal" | "vertical" | "antisaccade";

/**
 * The side of the target.
 *
 * On the horizontal and anti-saccade protocols this is the side of the screen the target
 * appears on. The vertical protocol is the same protocol turned a quarter turn, so it
 * keeps the label in the rotated frame: "left" puts the target above the fixation point
 * and "right" puts it below.
 */
export type SaccadeDirection = "left" | "right";

/** What one trial of the protocol looks like. */
export interface SaccadeTrialPlan {
  index: number;
  type: SaccadeTestType;
  direction: SaccadeDirection;
  /** Eccentricity of the target in degrees. */
  eccentricityDeg: number;
  /** Where the subject has to look before the target appears. */
  fixateX: number;
  fixateY: number;
  /** Where the target appears. */
  targetX: number;
  targetY: number;
  /** Timing of the trial, in milliseconds from the trial start. */
  fixationDurationMs: number;
  gapDurationMs: number;
  targetDurationMs: number;
  responseWindowMs: number;
}

/** One recorded trial: the plan it followed and the gaze it produced. */
export interface SaccadeTrialRecord {
  plan: SaccadeTrialPlan;
  /** The gaze samples between the target appearing and the end of the trial. */
  samples: { x: number; y: number; t: number }[];
  /** When the target appeared, in the same time base as the samples. */
  targetOnsetT: number;
  /**
   * The subject's explicit response, if the protocol asked for one.
   *
   * The desktop protocol has no button press to score - its response window is the
   * period in which the gaze is collected - so these fields are recorded and not
   * measured. Every number below comes from the gaze samples.
   */
  responseX: number | null;
  responseY: number | null;
  responseT: number | null;
}

/** What one trial measured. */
export interface SaccadeTrialMetrics {
  index: number;
  latencyMs: number | null;
  durationMs: number | null;
  peakVelocityDegS: number | null;
  amplitudeDeg: number | null;
  accuracyDeg: number | null;
  /** Null when no saccade was detected, so the direction could not be judged. */
  directionCorrect: boolean | null;
  anticipatory: boolean;
  express: boolean;
}

/** The measurements of a whole run. */
export interface SaccadeMetrics {
  /** How many trials were analysed. */
  numTrials: number;
  /** How many of them were a saccade in the right direction. */
  numCorrect: number;
  /**
   * Share of trials with a wrong direction, 0-1.
   *
   * A trial in which no saccade was detected counts against the result: the subject
   * never made the movement the trial asked for.
   */
  errorRate: number;
  meanLatencyMs: number | null;
  stdLatencyMs: number | null;
  meanAccuracyDeg: number | null;
  meanPeakVelocityDegS: number | null;
  /** Share of trials whose saccade started before 80 ms. */
  anticipatoryRate: number;
  /** Share of trials whose saccade started between 80 and 130 ms. */
  expressSaccadeRate: number;
  perTrial: SaccadeTrialMetrics[];
}

/** The settings a run is planned with. */
export interface SaccadePlanOptions {
  numTrials: number;
  type: SaccadeTestType;
  eccentricitiesDeg: number[];
  randomizeDirection: boolean;
  randomizeTiming: boolean;
  seed: number;
  screen: ScreenGeometry;
  fixationDurationMs: number;
  gapDurationMs: number;
  targetDurationMs: number;
  responseWindowMs: number;
}

/** Speed above which the eye counts as saccading (src/saccade_test.py). */
const SACCADE_VELOCITY_THRESHOLD_DEG_S = 30;
/** A saccade that starts before this is anticipatory (src/saccade_test.py). */
const ANTICIPATORY_LATENCY_MS = 80;
/** A saccade that starts before this, but not before the anticipatory limit, is express. */
const EXPRESS_LATENCY_MS = 130;
/** The desktop jitters the fixation duration by up to this much (src/saccade_test.py). */
const FIXATION_JITTER_MS = 200;

/**
 * Pixels per degree of visual angle, using the desktop saccade module's own conversion.
 *
 * The pursuit metrics in lib/metrics.ts use the small-angle approximation; the saccade
 * numbers have to match src/saccade_test.py, which converts with the tangent of a full
 * degree. The two differ by 0.008%, which is far below the clinical resolution and far
 * above the parity tolerance.
 */
function pixelsPerDegree(screen: ScreenGeometry): number {
  const screenDistancePx =
    (screen.widthPx / screen.widthCm) * screen.viewingDistanceCm;
  return screenDistancePx * Math.tan(Math.PI / 180);
}

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

/**
 * A seeded generator (mulberry32), so the browser and the Python fixture generator draw
 * the same numbers from the same seed.
 *
 * mulberry32 keeps its state in a single 32-bit word and mixes it with two
 * multiplications per draw. It is not cryptographic and does not need to be: it only has
 * to be the same function in both ports. tools/generate_parity_saccade.py implements the
 * same generator, draw for draw.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plan the trials of a run.
 *
 * The desktop draws the eccentricity, then the direction, then the timing jitter of
 * every trial, in that order, from the global `random` module. This port draws them in
 * the same order from a seeded generator, so the same seed produces the same run in the
 * browser and in the fixture generator.
 */
export function planSaccadeTrials(
  options: SaccadePlanOptions
): SaccadeTrialPlan[] {
  const random = mulberry32(options.seed);
  const pxPerDeg = pixelsPerDegree(options.screen);
  const centreX = Math.floor(options.screen.widthPx / 2);
  const centreY = Math.floor(options.screen.heightPx / 2);
  const plans: SaccadeTrialPlan[] = [];

  for (let index = 0; index < options.numTrials; index += 1) {
    const eccentricities = options.eccentricitiesDeg;
    const eccentricityDeg =
      eccentricities[Math.floor(random() * eccentricities.length)];
    const direction: SaccadeDirection = options.randomizeDirection
      ? random() < 0.5
        ? "left"
        : "right"
      : index % 2 === 0
        ? "left"
        : "right";
    const jitterMs = options.randomizeTiming
      ? -FIXATION_JITTER_MS + 2 * FIXATION_JITTER_MS * random()
      : 0;

    const offsetPx = Math.trunc(eccentricityDeg * pxPerDeg);
    const sign = direction === "right" ? 1 : -1;
    const vertical = options.type === "vertical";

    plans.push({
      index,
      type: options.type,
      direction,
      eccentricityDeg,
      fixateX: centreX,
      fixateY: centreY,
      targetX: vertical ? centreX : centreX + sign * offsetPx,
      targetY: vertical ? centreY + sign * offsetPx : centreY,
      fixationDurationMs: options.fixationDurationMs + jitterMs,
      gapDurationMs: options.gapDurationMs,
      targetDurationMs: options.targetDurationMs,
      responseWindowMs: options.responseWindowMs,
    });
  }

  return plans;
}

/**
 * The speed of the eye between consecutive samples, in degrees per second.
 *
 * Mirrors `SaccadeTest._calculate_velocities`: the distance covered between two
 * samples over the interval between them, with the interval floored so a repeated
 * timestamp cannot divide by zero.
 */
function calculateVelocities(
  samples: SaccadeTrialRecord["samples"],
  pxPerDeg: number
): number[] {
  if (samples.length < 2) return [0];

  const velocities: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const dx = samples[index].x - samples[index - 1].x;
    const dy = samples[index].y - samples[index - 1].y;
    const dt = Math.max(samples[index].t - samples[index - 1].t, 1e-6);
    velocities.push(Math.sqrt(dx * dx + dy * dy) / dt / pxPerDeg);
  }
  return velocities;
}

/** Analyse one recorded trial, mirroring `SaccadeTest._analyze_trial`. */
function analyzeTrial(
  record: SaccadeTrialRecord,
  pxPerDeg: number
): SaccadeTrialMetrics {
  const noSaccade: SaccadeTrialMetrics = {
    index: record.plan.index,
    latencyMs: null,
    durationMs: null,
    peakVelocityDegS: null,
    amplitudeDeg: null,
    accuracyDeg: null,
    directionCorrect: null,
    anticipatory: false,
    express: false,
  };

  const velocities = calculateVelocities(record.samples, pxPerDeg);

  // The saccade starts at the first sample that is moving faster than the threshold.
  let onset = -1;
  for (let index = 0; index < velocities.length; index += 1) {
    if (velocities[index] > SACCADE_VELOCITY_THRESHOLD_DEG_S) {
      onset = index;
      break;
    }
  }
  // Without a saccade there is nothing to measure, and no direction to judge.
  if (onset < 0) return noSaccade;

  const latencyMs = (record.samples[onset].t - record.targetOnsetT) * 1000;
  const anticipatory = latencyMs < ANTICIPATORY_LATENCY_MS;
  const express = !anticipatory && latencyMs < EXPRESS_LATENCY_MS;

  // The saccade ends at the first sample after the onset where the eye is slow again;
  // if it never slows down it lasts until the end of the trial.
  let end = velocities.length - 1;
  for (let index = onset; index < velocities.length; index += 1) {
    if (velocities[index] < SACCADE_VELOCITY_THRESHOLD_DEG_S) {
      end = index;
      break;
    }
  }

  const durationMs = (record.samples[end].t - record.samples[onset].t) * 1000;

  let peakVelocityDegS = velocities[onset];
  for (let index = onset + 1; index <= end; index += 1) {
    if (velocities[index] > peakVelocityDegS)
      peakVelocityDegS = velocities[index];
  }

  // The amplitude is the displacement along the axis of the saccade. The desktop only
  // ever measured horizontal saccades; the browser adds the vertical protocol, which is
  // measured on the vertical axis.
  const vertical = record.plan.type === "vertical";
  const displacementPx = vertical
    ? record.samples[end].y - record.samples[onset].y
    : record.samples[end].x - record.samples[onset].x;
  const amplitudeDeg = Math.abs(displacementPx) / pxPerDeg;

  // The expected side of the saccade: the side the target is on, inverted for the
  // anti-saccade protocol, where the subject has to look away from the target.
  let expectedDirection = record.plan.direction === "right" ? 1 : -1;
  if (record.plan.type === "antisaccade") expectedDirection *= -1;
  const actualDirection = displacementPx > 0 ? 1 : -1;

  // The landing error against the amplitude the protocol asked for.
  const expectedAmplitudePx =
    expectedDirection * record.plan.eccentricityDeg * pxPerDeg;
  const accuracyDeg = Math.abs(displacementPx - expectedAmplitudePx) / pxPerDeg;

  return {
    index: record.plan.index,
    latencyMs,
    durationMs,
    peakVelocityDegS,
    amplitudeDeg,
    accuracyDeg,
    directionCorrect: actualDirection === expectedDirection,
    anticipatory,
    express,
  };
}

/**
 * Measure a run of recorded trials.
 *
 * The aggregates follow the desktop's `SaccadeTestResult`: the latency and the landing
 * error are averaged over the correct trials, the peak velocity over every trial that
 * produced a saccade, and the error rate is one minus the share of correct trials.
 *
 * A trial in which no saccade was detected is not counted as correct: the subject never
 * made the movement the trial asked for, and calling it correct would flatter the
 * result. Such a trial still counts towards the error rate.
 */
export function computeSaccadeMetrics(
  records: SaccadeTrialRecord[],
  screen: ScreenGeometry
): SaccadeMetrics {
  const pxPerDeg = pixelsPerDegree(screen);
  const perTrial = records.map((record) => analyzeTrial(record, pxPerDeg));

  const numTrials = records.length;
  const numCorrect = perTrial.filter(
    (trial) => trial.directionCorrect === true
  ).length;
  const errorRate = numTrials === 0 ? 0 : 1 - numCorrect / numTrials;

  const correctLatencies: number[] = [];
  const correctAccuracies: number[] = [];
  const peakVelocities: number[] = [];
  for (const trial of perTrial) {
    if (trial.directionCorrect === true && trial.latencyMs !== null) {
      correctLatencies.push(trial.latencyMs);
    }
    if (trial.directionCorrect === true && trial.accuracyDeg !== null) {
      correctAccuracies.push(trial.accuracyDeg);
    }
    if (trial.peakVelocityDegS !== null) {
      peakVelocities.push(trial.peakVelocityDegS);
    }
  }

  return {
    numTrials,
    numCorrect,
    errorRate,
    meanLatencyMs: correctLatencies.length > 0 ? mean(correctLatencies) : null,
    stdLatencyMs: correctLatencies.length > 0 ? std(correctLatencies) : null,
    meanAccuracyDeg:
      correctAccuracies.length > 0 ? mean(correctAccuracies) : null,
    meanPeakVelocityDegS:
      peakVelocities.length > 0 ? mean(peakVelocities) : null,
    anticipatoryRate:
      numTrials === 0
        ? 0
        : perTrial.filter((trial) => trial.anticipatory).length / numTrials,
    expressSaccadeRate:
      numTrials === 0
        ? 0
        : perTrial.filter((trial) => trial.express).length / numTrials,
    perTrial,
  };
}
