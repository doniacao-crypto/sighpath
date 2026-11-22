/**
 * Calibration — a port of the calibration widget in src/widgets/calibration_widget.py and of
 * the quality reporting in src/gaze_estimator.py.
 *
 * The grid is walked once per head-pose level. Without that spread the pitch/yaw coefficients
 * are fitted to landmark noise and the gaze estimate collapses as soon as the subject turns
 * their head, so the subject is given a notice before each level and the eye is given a moment
 * to settle on each dot.
 */

import type { CalibrationPoint, EyeSample } from "./types";
import { polynomialFeatures, fitRidge, predict } from "./ridge";
import {
  HEAD_POSES,
  POSE_TRANSITION_SECONDS,
  SAMPLES_PER_POINT,
  SETTLE_SECONDS,
} from "./patterns";
import {
  buildRawFeatures,
  gazeErrorPx,
  POLYNOMIAL_DEGREE,
  populationStd,
  RIDGE_ALPHA,
  scaleFeatures,
  type GazeModel,
} from "./features";

/**
 * Calibration must span at least this much head-pose spread (standard deviation, degrees) for
 * the model to learn head compensation at all (`GazeEstimator.MIN_HEAD_POSE_SPREAD_DEG`).
 * Below it the pitch/yaw coefficients are unidentifiable.
 */
export const MIN_HEAD_POSE_SPREAD_DEG = 3.0;

/** What the calibration is doing at the moment. */
export type CalibrationPhase =
  /** Nothing has started yet. */
  | "idle"
  /** The eye is settling on the current dot; no samples are collected yet. */
  | "settling"
  /** Samples are being collected at the current dot. */
  | "sampling"
  /** The subject is being told to move their head to the next level. */
  | "transition"
  /** Every level and dot has been visited. */
  | "done";

/** The state of a calibration session. */
export interface CalibrationState {
  phase: CalibrationPhase;
  /** Index of the head-pose level being calibrated. */
  poseIndex: number;
  /** Index of the dot within the grid. */
  pointIndex: number;
  /** Samples collected at the current dot. */
  samplesAtPoint: number;
  /** Seconds left of the notice before the next head-pose level. */
  noticeSecondsLeft: number;
}

/** How well the calibration went. */
export interface CalibrationQuality {
  /**
   * Mean held-out error in pixels: every screen location is held out in turn and the model is
   * refitted on the rest.
   */
  cvErrorPx: number;
  /** Mean error in pixels on the points the model was fitted on. */
  avgErrorPx: number;
  /** Standard deviation of the head yaw across the calibration samples, in degrees. */
  headYawSpreadDeg: number;
  /** Standard deviation of the head pitch across the calibration samples, in degrees. */
  headPitchSpreadDeg: number;
  /** Whether the head moved enough for the model to learn head compensation. */
  headPoseOk: boolean;
  /** Number of training rows the model was fitted on. */
  trainingRows: number;
  /** Number of calibration points. */
  points: number;
}

/**
 * Assess the quality of a calibration.
 *
 * The held-out error holds out a whole screen location rather than a random sample: samples
 * from the same dot are near duplicates, so a random split would leak and flatter the model.
 * What matters is generalising to a screen location the model never saw.
 */
export function assessCalibration(
  model: GazeModel,
  points: CalibrationPoint[]
): CalibrationQuality {
  const rows: number[][] = [];
  const targetX: number[] = [];
  const targetY: number[] = [];
  const groups: number[] = [];
  const groupKeys: string[] = [];

  for (const point of points) {
    // Group by screen location, not by point index: the calibration visits the same dot at
    // several head poses, so grouping by index would leave the same location in both folds.
    const key = `${point.x},${point.y}`;
    let group = groupKeys.indexOf(key);
    if (group === -1) {
      group = groupKeys.length;
      groupKeys.push(key);
    }
    for (const row of buildRawFeatures(point.samples)) {
      rows.push(row);
      targetX.push(point.x);
      targetY.push(point.y);
      groups.push(group);
    }
  }

  const design = rows.map((row) =>
    polynomialFeatures(
      scaleFeatures(row, model.scalerMean, model.scalerScale),
      POLYNOMIAL_DEGREE
    )
  );

  const errors: number[] = [];
  // The group ids were handed out consecutively, so they are exactly 0..groupKeys.length - 1.
  const heldOutGroups = groupKeys.map((_, index) => index);
  if (heldOutGroups.length >= 3) {
    for (const heldOut of heldOutGroups) {
      const trainDesign: number[][] = [];
      const trainX: number[] = [];
      const trainY: number[] = [];
      const testDesign: number[][] = [];
      const testX: number[] = [];
      const testY: number[] = [];
      for (let index = 0; index < groups.length; index += 1) {
        if (groups[index] === heldOut) {
          testDesign.push(design[index]);
          testX.push(targetX[index]);
          testY.push(targetY[index]);
        } else {
          trainDesign.push(design[index]);
          trainX.push(targetX[index]);
          trainY.push(targetY[index]);
        }
      }
      const foldX = fitRidge(trainDesign, trainX, RIDGE_ALPHA);
      const foldY = fitRidge(trainDesign, trainY, RIDGE_ALPHA);
      for (let index = 0; index < testDesign.length; index += 1) {
        const dx = predict(foldX, testDesign[index]) - testX[index];
        const dy = predict(foldY, testDesign[index]) - testY[index];
        errors.push(Math.hypot(dx, dy));
      }
    }
  }

  const pitchSpread = populationStd(rows.map((row) => row[2]));
  const yawSpread = populationStd(rows.map((row) => row[3]));

  return {
    cvErrorPx:
      errors.length > 0
        ? errors.reduce((total, error) => total + error, 0) / errors.length
        : Number.NaN,
    avgErrorPx: gazeErrorPx(model, points),
    headYawSpreadDeg: yawSpread,
    headPitchSpreadDeg: pitchSpread,
    headPoseOk: Math.max(pitchSpread, yawSpread) >= MIN_HEAD_POSE_SPREAD_DEG,
    trainingRows: rows.length,
    points: points.length,
  };
}

/** The head-pose level the subject is asked to hold. */
export interface CalibrationPose {
  title: string;
  subtitle: string;
}

/** The settings of a calibration session. */
export interface CalibrationOptions {
  /** The head-pose levels to walk through. */
  poses?: readonly CalibrationPose[];
  /** Frames collected at every dot. */
  samplesPerPoint?: number;
  /** Seconds the eye is given to settle on a dot before sampling starts. */
  settleSeconds?: number;
  /** Seconds of notice before the next head-pose level starts. */
  transitionSeconds?: number;
  /** The clock, so the session can be driven without a browser. */
  now?: () => number;
}

/**
 * The calibration session: it walks the grid once per head-pose level and collects the
 * samples that the gaze model is fitted on.
 *
 * The clock is injected, so the whole flow can be driven from a test.
 */
export class CalibrationSession {
  /** The live state of the session; its fields change as the session runs. */
  readonly state: CalibrationState = {
    phase: "idle",
    poseIndex: 0,
    pointIndex: 0,
    samplesAtPoint: 0,
    noticeSecondsLeft: 0,
  };

  private readonly grid: readonly { x: number; y: number }[];
  private readonly poses: readonly CalibrationPose[];
  private readonly samplesPerPoint: number;
  private readonly settleSeconds: number;
  private readonly transitionSeconds: number;
  private readonly clock: () => number;

  private samples: EyeSample[] = [];
  private collected: CalibrationPoint[] = [];
  private settleStartedAt = 0;
  private transitionStartedAt = 0;

  constructor(
    grid: { x: number; y: number }[],
    options: CalibrationOptions = {}
  ) {
    this.grid = grid;
    this.poses = options.poses ?? HEAD_POSES;
    this.samplesPerPoint = options.samplesPerPoint ?? SAMPLES_PER_POINT;
    this.settleSeconds = options.settleSeconds ?? SETTLE_SECONDS;
    this.transitionSeconds =
      options.transitionSeconds ?? POSE_TRANSITION_SECONDS;
    this.clock = options.now ?? (() => Date.now() / 1000);
  }

  /** Begin the calibration at the first dot of the first head-pose level. */
  start(now: number = this.clock()): void {
    this.state.phase = this.grid.length === 0 ? "done" : "settling";
    this.state.poseIndex = 0;
    this.state.pointIndex = 0;
    this.state.samplesAtPoint = 0;
    this.state.noticeSecondsLeft = 0;
    this.samples = [];
    this.collected = [];
    this.settleStartedAt = now;
  }

  /** Advance the clock: the settle period ends and the notice counts down. */
  tick(now: number = this.clock()): void {
    if (this.state.phase === "settling") {
      if (now - this.settleStartedAt >= this.settleSeconds) {
        this.state.phase = "sampling";
      }
      return;
    }
    if (this.state.phase === "transition") {
      const remaining =
        this.transitionSeconds - (now - this.transitionStartedAt);
      this.state.noticeSecondsLeft = Math.max(0, remaining);
      if (remaining <= 0) {
        // The notice is over: the eye settles on the first dot of the new level.
        this.state.phase = "settling";
        this.settleStartedAt = now;
      }
    }
  }

  /**
   * Feed one camera frame into the session.
   *
   * Frames are only collected while the session is sampling: during the settle period the eye
   * is still moving towards the dot, and during the notice the subject is moving their head.
   */
  addSample(sample: EyeSample, now: number = this.clock()): void {
    // Advancing the clock here keeps the session consistent when the caller only feeds
    // samples, which is what a camera stream does.
    this.tick(now);
    if (this.state.phase !== "sampling") return;
    // A blink or a lost face says nothing about where the subject is looking.
    if (!sample.faceDetected || sample.isBlinking) return;

    this.samples.push(sample);
    this.state.samplesAtPoint = this.samples.length;
    if (this.state.samplesAtPoint >= this.samplesPerPoint) {
      this.finishPoint(now);
    }
  }

  /** The dot the subject should be looking at, or null while no dot is shown. */
  get currentTarget(): { x: number; y: number } | null {
    // During the notice the subject is moving their head, not chasing the dot, so no target is
    // shown then.
    if (
      this.state.phase === "idle" ||
      this.state.phase === "transition" ||
      this.state.phase === "done"
    ) {
      return null;
    }
    return this.grid[this.state.pointIndex] ?? null;
  }

  /** The instruction for the head-pose level the subject is moving to or holding. */
  get nextPoseTitle(): string | null {
    return this.poses[this.state.poseIndex]?.title ?? null;
  }

  /** The second line of the instruction for the current head-pose level. */
  get nextPoseSubtitle(): string | null {
    return this.poses[this.state.poseIndex]?.subtitle ?? null;
  }

  /** Whether every level and dot has been visited. */
  get finished(): boolean {
    return this.state.phase === "done";
  }

  /** The calibration points collected so far, one per dot per head-pose level. */
  buildPoints(): CalibrationPoint[] {
    return this.collected.map((point) => ({
      x: point.x,
      y: point.y,
      samples: [...point.samples],
    }));
  }

  private finishPoint(now: number): void {
    const target = this.grid[this.state.pointIndex];
    if (!target) {
      this.state.phase = "done";
      return;
    }
    this.collected.push({ x: target.x, y: target.y, samples: this.samples });
    this.samples = [];
    this.state.samplesAtPoint = 0;
    this.state.pointIndex += 1;

    if (this.state.pointIndex < this.grid.length) {
      // The next dot of the same level: let the eye settle on it first.
      this.state.phase = "settling";
      this.settleStartedAt = now;
      return;
    }

    this.state.pointIndex = 0;
    this.state.poseIndex += 1;
    if (this.state.poseIndex >= this.poses.length) {
      this.state.phase = "done";
      this.state.noticeSecondsLeft = 0;
      return;
    }

    // The subject has to move their head before the next level starts. Without the notice the
    // first samples of the new level are taken mid-turn, which pollutes the head-pose
    // coefficients the level exists to teach.
    this.state.phase = "transition";
    this.transitionStartedAt = now;
    this.state.noticeSecondsLeft = this.transitionSeconds;
  }
}
