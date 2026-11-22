/**
 * Gaze estimation — a port of `GazeEstimator` in src/gaze_estimator.py.
 *
 * The desktop app maps the iris position to a screen position with a
 * StandardScaler -> PolynomialFeatures(degree 2) -> Ridge pipeline, trained on every raw
 * calibration sample. The browser runs the same pipeline so both versions measure the same
 * thing.
 */

import type { CalibrationPoint, EyeSample } from "./types";
import {
  fitRidge,
  polynomialFeatures,
  predict,
  type RidgeModel,
} from "./ridge";

/**
 * Fixed physical scale for the head-pose features, in degrees
 * (`GazeEstimator.HEAD_POSE_SCALE_DEG`).
 *
 * It is used as a floor for the scaler: a still subject's landmark noise must never become the
 * unit of measurement, or a real head turn at test time becomes an enormous input that the
 * degree-two expansion then squares.
 */
export const HEAD_POSE_SCALE_DEG = 5.0;

/** Degree of the polynomial expansion of the four raw features. */
export const POLYNOMIAL_DEGREE = 2;

/**
 * Ridge penalty for the gaze model. The desktop app searches over
 * `[0.01, 0.1, 1.0, 10.0, 100.0]`; the browser fixes the middle of that range.
 */
export const RIDGE_ALPHA = 1.0;

/** A fitted gaze model: the standardiser and one ridge model per screen axis. */
export interface GazeModel {
  /** Mean of every raw feature column, as fitted by the standardiser. */
  scalerMean: number[];
  /** Scale of every raw feature column, as fitted by the standardiser. */
  scalerScale: number[];
  /** Ridge model for the horizontal screen position. */
  modelX: RidgeModel;
  /** Ridge model for the vertical screen position. */
  modelY: RidgeModel;
}

/**
 * The population standard deviation (ddof = 0), the convention numpy's `np.std` and sklearn's
 * StandardScaler use.
 */
export function populationStd(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  const mean = sum / values.length;
  let variance = 0;
  for (const value of values) variance += (value - mean) ** 2;
  return Math.sqrt(variance / values.length);
}

/**
 * The raw features of one sample: the iris position averaged over both eyes, then the head
 * pose.
 *
 * The iris values are the 0.5-centred positions normalised by eye width, exactly as the eye
 * tracker in the desktop app produces them.
 */
export function buildRawFeatures(samples: EyeSample[]): number[][] {
  return samples.map((sample) => [
    (sample.leftGazeX + sample.rightGazeX) / 2,
    (sample.leftGazeY + sample.rightGazeY) / 2,
    sample.headPitch,
    sample.headYaw,
  ]);
}

/**
 * The representative raw feature row of a calibration point: the iris position and head pose
 * averaged over the samples collected while the subject fixated it.
 */
export function pointFeatures(point: CalibrationPoint): number[] {
  const rows = buildRawFeatures(point.samples);
  if (rows.length === 0) return [0, 0, 0, 0];
  const averaged = [0, 0, 0, 0];
  for (const row of rows) {
    for (let column = 0; column < averaged.length; column += 1) {
      averaged[column] += row[column];
    }
  }
  return averaged.map((value) => value / rows.length);
}

/**
 * Apply a fitted standardiser: centre on the mean and divide by the scale.
 *
 * A scale of zero would produce infinities; the desktop app replaces those with the centred
 * value, so the same is done here.
 */
export function scaleFeatures(
  row: number[],
  mean: number[],
  scale: number[]
): number[] {
  return row.map((value, column) => {
    const divisor = scale[column] || 1;
    const scaled = (value - (mean[column] ?? 0)) / divisor;
    return Number.isFinite(scaled) ? scaled : 0;
  });
}

/**
 * Fit the gaze model from the calibration points.
 *
 * Every raw sample is a training row, not one averaged row per point: a degree-two polynomial
 * over four features expands to fifteen columns, so nine averaged rows would leave the fit
 * underdetermined.
 */
export function fitGazeModel(
  points: CalibrationPoint[],
  alpha: number = RIDGE_ALPHA
): GazeModel {
  const rows: number[][] = [];
  const targetX: number[] = [];
  const targetY: number[] = [];
  for (const point of points) {
    for (const row of buildRawFeatures(point.samples)) {
      rows.push(row);
      targetX.push(point.x);
      targetY.push(point.y);
    }
  }
  if (rows.length === 0) {
    throw new Error("fitGazeModel needs at least one calibration sample");
  }

  const columnCount = rows[0].length;
  const scalerMean: number[] = [];
  const scalerScale: number[] = [];
  for (let column = 0; column < columnCount; column += 1) {
    let sum = 0;
    for (const row of rows) sum += row[column];
    const mean = sum / rows.length;
    const deviation = populationStd(rows.map((row) => row[column]));
    scalerMean.push(mean);
    // A constant column keeps unit scale instead of dividing by zero.
    scalerScale.push(deviation > 0 ? deviation : 1);
  }

  // Floor the head-pose scales at a fixed physical unit, so a subject who holds still through
  // calibration still gets a sane input when they turn their head during the test.
  scalerScale[2] = Math.max(scalerScale[2], HEAD_POSE_SCALE_DEG);
  scalerScale[3] = Math.max(scalerScale[3], HEAD_POSE_SCALE_DEG);

  const design = rows.map((row) =>
    polynomialFeatures(
      scaleFeatures(row, scalerMean, scalerScale),
      POLYNOMIAL_DEGREE
    )
  );

  return {
    scalerMean,
    scalerScale,
    modelX: fitRidge(design, targetX, alpha),
    modelY: fitRidge(design, targetY, alpha),
  };
}

/**
 * Predict where the subject is looking, in screen pixels.
 *
 * The result is not clamped: the caller knows the size of the stage it draws on, and the
 * desktop app clamps to the screen bounds at that point.
 */
export function predictGaze(
  model: GazeModel,
  sample: EyeSample
): { x: number; y: number } {
  const [row] = buildRawFeatures([sample]);
  const features = polynomialFeatures(
    scaleFeatures(row, model.scalerMean, model.scalerScale),
    POLYNOMIAL_DEGREE
  );
  return {
    x: predict(model.modelX, features),
    y: predict(model.modelY, features),
  };
}

/**
 * The mean distance in pixels between the model's prediction and the position of the
 * calibration point it was fitted on.
 */
export function gazeErrorPx(
  model: GazeModel,
  points: CalibrationPoint[]
): number {
  if (points.length === 0) return 0;
  let total = 0;
  for (const point of points) {
    const features = polynomialFeatures(
      scaleFeatures(pointFeatures(point), model.scalerMean, model.scalerScale),
      POLYNOMIAL_DEGREE
    );
    const dx = predict(model.modelX, features) - point.x;
    const dy = predict(model.modelY, features) - point.y;
    total += Math.hypot(dx, dy);
  }
  return total / points.length;
}
