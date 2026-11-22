/**
 * Fixation stability metrics — a port of the Python implementation in src/metrics.py
 * (MetricsCalculator.calculate_bcea, detect_microsaccades, calculate_smoothness and
 * calculate_rms_error) and of the frame filtering the desktop app does in
 * src/smooth_pursuit_test.py.
 *
 * The two versions must agree: the fixtures in tests/fixtures were produced by the Python
 * code and the tests assert that this port reproduces them.
 */

import { pixelsToDegrees } from "./metrics";
import type { ScreenGeometry, TrackingFrame } from "./types";

/**
 * Chi-squared value for the 68% contour on two degrees of freedom, the factor that turns
 * the standard deviation ellipse into the contour the desktop app measures. The desktop
 * takes it from scipy.stats.chi2.ppf(0.68, df=2) with the probability from
 * src/constants.py (BCEA_PROBABILITY); with two degrees of freedom the chi-square
 * distribution has the CDF 1 - exp(-x/2), so its quantile is -2 ln(1 - 0.68).
 */
const BCEA_CHI_SQUARED = 2.27886856637673;
/** Speed above which a movement counts as a microsaccade (src/constants.py). */
const MICROSACCADE_VELOCITY_THRESHOLD_DEG_S = 15.0;
/** Amplitude below which a movement counts as a microsaccade (src/constants.py). */
const MICROSACCADE_MAX_AMPLITUDE_DEG = 1.0;
/**
 * Shortest movement that counts as a microsaccade. The desktop passes 10 ms here instead
 * of the 20 ms it uses for saccades (MIN_SACCADE_DURATION_MS), because a microsaccade is
 * brief by nature and a 20 ms floor would throw most of them away.
 */
const MICROSACCADE_MIN_DURATION_MS = 10.0;

/** The measurements of one fixation run. */
export interface FixationMetrics {
  /** Bivariate Contour Ellipse Area in square degrees. */
  bceaDeg2: number;
  /** Number of microsaccades detected in the run. */
  microsaccadeCount: number;
  /** Microsaccades per second. */
  microsaccadeRateHz: number;
  /** Mean microsaccade amplitude in degrees. */
  meanMicrosaccadeAmplitudeDeg: number;
  /** RMS scatter of the fixation around its mean, in degrees. */
  stabilityDeg: number;
  /** Smoothness of the fixation, 0-1 (the metrics.py measure). */
  smoothness: number;
  /** Share of frames with a usable gaze estimate, 0-100. */
  trackingRatio: number;
  /** RMS error against the fixation point, in degrees. */
  rmsErrorDeg: number;
}

/** One detected movement of the gaze. */
interface Movement {
  /** How far the gaze moved, in degrees of visual angle. */
  amplitudeDeg: number;
}

/**
 * Compute every measurement of a fixation run.
 *
 * `frames` must be the frames of one run; frames without a usable gaze estimate are
 * carried as null and excluded from the measurements, exactly as the desktop app does.
 */
export function computeFixationMetrics(
  frames: TrackingFrame[],
  screen: ScreenGeometry,
  fixationPoint: { x: number; y: number }
): FixationMetrics {
  // Not enough data to measure anything: every measurement is reported as zero rather
  // than as NaN, so a run that failed to track cannot be mistaken for a good one.
  const neutral: FixationMetrics = {
    bceaDeg2: 0,
    microsaccadeCount: 0,
    microsaccadeRateHz: 0,
    meanMicrosaccadeAmplitudeDeg: 0,
    stabilityDeg: 0,
    smoothness: 0,
    trackingRatio: 0,
    rmsErrorDeg: 0,
  };

  // The desktop keeps only the frames that produced a usable gaze estimate on a detected
  // face (src/smooth_pursuit_test.py); every other frame is dropped before measuring.
  const valid = frames.filter(
    (frame) =>
      frame.gazeX !== null && frame.gazeY !== null && frame.faceDetected
  );
  // Fewer than three usable frames leave no scatter to describe.
  if (valid.length < 3) return neutral;

  const gazeX = valid.map((frame) => frame.gazeX as number);
  const gazeY = valid.map((frame) => frame.gazeY as number);
  const timestamps = valid.map((frame) => frame.timestamp);

  // The share of frames that produced a usable gaze estimate: a data-validity measure,
  // not a score of the patient.
  const trackingRatio = (100 * valid.length) / frames.length;

  // The centre of the fixation: where the gaze spent the run.
  const centreX = mean(gazeX);
  const centreY = mean(gazeY);

  // The scatter of the fixation: the RMS distance of every frame from the centre of the
  // run. The desktop measures the same thing as the RMS error against the mean position
  // (MetricsCalculator.calculate_rms_error).
  const scatter = valid.map((_, index) => {
    const dx = pixelsToDegrees(screen, gazeX[index] - centreX);
    const dy = pixelsToDegrees(screen, gazeY[index] - centreY);
    return dx * dx + dy * dy;
  });
  const stabilityDeg = Math.sqrt(mean(scatter));

  // The RMS error against the point the subject was asked to hold.
  const errors = valid.map((_, index) =>
    pixelsToDegrees(
      screen,
      Math.hypot(fixationPoint.x - gazeX[index], fixationPoint.y - gazeY[index])
    )
  );
  const rmsErrorDeg = Math.sqrt(mean(errors.map((error) => error * error)));

  // BCEA: the area of the 68% contour ellipse around the scatter of the fixation. The
  // desktop works on the centred positions converted to degrees
  // (MetricsCalculator.calculate_bcea).
  const centredX = gazeX.map((x) => pixelsToDegrees(screen, x - centreX));
  const centredY = gazeY.map((y) => pixelsToDegrees(screen, y - centreY));
  const sigmaH = std(centredX);
  const sigmaV = std(centredY);
  // A flat axis carries no direction, so the correlation is undefined and left at zero.
  const rho =
    sigmaH > 1e-6 && sigmaV > 1e-6 ? pearsonCorrelation(centredX, centredY) : 0;
  const bceaDeg2 =
    2 *
    BCEA_CHI_SQUARED *
    Math.PI *
    sigmaH *
    sigmaV *
    // Guarded against a correlation a rounding error pushed past one.
    Math.sqrt(Math.max(0, 1 - rho * rho));

  // Smoothness: the metrics.py measure, a 0-1 score built from the variation of the gaze
  // speed. A fixation that never moves has no speed to vary and is perfectly smooth
  // (MetricsCalculator.calculate_smoothness).
  const speeds: number[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    const dt = Math.max(timestamps[i] - timestamps[i - 1], 1e-6);
    speeds.push(
      pixelsToDegrees(
        screen,
        Math.hypot(gazeX[i] - gazeX[i - 1], gazeY[i] - gazeY[i - 1]) / dt
      )
    );
  }
  let smoothness = 1;
  const meanSpeed = mean(speeds);
  if (speeds.length >= 2 && meanSpeed >= 1e-6) {
    const variation = std(speeds) / meanSpeed;
    smoothness = Math.max(0, Math.min(1, 1 - variation / 2));
  }

  // The microsaccades: the small involuntary movements that break a fixation.
  const movements = detectMicrosaccades(
    speeds,
    gazeX,
    gazeY,
    timestamps,
    screen
  );
  const microsaccadeCount = movements.length;
  const runSeconds = timestamps[timestamps.length - 1] - timestamps[0];
  const microsaccadeRateHz =
    runSeconds > 0 ? microsaccadeCount / runSeconds : 0;
  const meanMicrosaccadeAmplitudeDeg =
    microsaccadeCount > 0
      ? mean(movements.map((movement) => movement.amplitudeDeg))
      : 0;

  return {
    bceaDeg2,
    microsaccadeCount,
    microsaccadeRateHz,
    meanMicrosaccadeAmplitudeDeg,
    stabilityDeg,
    smoothness,
    trackingRatio,
    rmsErrorDeg,
  };
}

/**
 * Find the microsaccades in a fixation: the movements that are fast enough to be a
 * deliberate flick of the eye, but small enough to be involuntary.
 *
 * The segmentation is the desktop's own (MetricsCalculator.detect_saccades): the frames
 * whose speed is above the threshold form one movement, which is closed by the first
 * frame below it. The amplitude is measured from the frame the movement started on to
 * the frame after it ended, and the duration the same way — the desktop's convention,
 * kept here so that both versions count the same movements.
 *
 * `speeds` holds the speed of each pair of frames, in degrees per second.
 */
function detectMicrosaccades(
  speeds: number[],
  gazeX: number[],
  gazeY: number[],
  timestamps: number[],
  screen: ScreenGeometry
): Movement[] {
  const movements: Movement[] = [];
  let open = false;
  let onset = 0;
  for (let i = 0; i < speeds.length; i += 1) {
    if (speeds[i] > MICROSACCADE_VELOCITY_THRESHOLD_DEG_S && !open) {
      open = true;
      onset = i;
    } else if (speeds[i] <= MICROSACCADE_VELOCITY_THRESHOLD_DEG_S && open) {
      open = false;
      const durationMs = (timestamps[i + 1] - timestamps[onset]) * 1000;
      if (durationMs >= MICROSACCADE_MIN_DURATION_MS) {
        movements.push({
          amplitudeDeg: pixelsToDegrees(
            screen,
            Math.hypot(gazeX[i + 1] - gazeX[onset], gazeY[i + 1] - gazeY[onset])
          ),
        });
      }
    }
  }

  // A movement that is still running when the recording ends.
  if (open) {
    const last = timestamps.length - 1;
    const durationMs = (timestamps[last] - timestamps[onset]) * 1000;
    if (durationMs >= MICROSACCADE_MIN_DURATION_MS) {
      movements.push({
        amplitudeDeg: pixelsToDegrees(
          screen,
          Math.hypot(gazeX[last] - gazeX[onset], gazeY[last] - gazeY[onset])
        ),
      });
    }
  }

  // A movement bigger than the maximum amplitude is a saccade, not a microsaccade.
  return movements.filter(
    (movement) => movement.amplitudeDeg <= MICROSACCADE_MAX_AMPLITUDE_DEG
  );
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/** The population standard deviation, the way numpy computes it. */
function std(values: number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  let total = 0;
  for (const value of values) total += (value - average) ** 2;
  return Math.sqrt(total / values.length);
}

/** The Pearson correlation of two series, the way numpy's corrcoef computes it. */
function pearsonCorrelation(a: number[], b: number[]): number {
  const meanA = mean(a);
  const meanB = mean(b);
  let covariance = 0;
  let spreadA = 0;
  let spreadB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    covariance += da * db;
    spreadA += da * da;
    spreadB += db * db;
  }
  const denominator = Math.sqrt(spreadA * spreadB);
  return denominator > 0 ? covariance / denominator : 0;
}
