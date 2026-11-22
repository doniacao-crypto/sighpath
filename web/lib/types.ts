import type { SaccadeMetrics, SaccadeTrialRecord } from "./saccade";
import type { FixationMetrics } from "./fixation";
import type { ValidationMetrics, ValidationPointResult } from "./validation";

/**
 * Shared types for the browser version of SightPath.
 *
 * The metric names mirror the Python implementation in src/smooth_pursuit_test.py so the
 * two versions can be compared directly; the parity fixtures in tests/fixtures are the
 * contract between them.
 */

/** One recorded frame of a test run. */
export interface TrackingFrame {
  /** Seconds since the start of the run. */
  timestamp: number;
  /** Target position on screen, in pixels. */
  targetX: number;
  targetY: number;
  /** Estimated gaze position, or null when there was no usable estimate. */
  gazeX: number | null;
  gazeY: number | null;
  /** Head pose in degrees. */
  headPitch: number;
  headYaw: number;
  faceDetected: boolean;
}

/** One eye sample taken during calibration. */
export interface EyeSample {
  timestamp: number;
  /** Iris position relative to the eye centre, normalised by eye width, centred on 0.5. */
  leftGazeX: number;
  leftGazeY: number;
  rightGazeX: number;
  rightGazeY: number;
  headPitch: number;
  headYaw: number;
  faceDetected: boolean;
  isBlinking: boolean;
}

/** One calibration point with the samples collected while the subject fixated it. */
export interface CalibrationPoint {
  x: number;
  y: number;
  samples: EyeSample[];
}

/** Screen geometry used to convert pixel error into degrees of visual angle. */
export interface ScreenGeometry {
  widthPx: number;
  heightPx: number;
  widthCm: number;
  heightCm: number;
  viewingDistanceCm: number;
}

/** The measurements produced by a test run. */
export interface PursuitMetrics {
  /** Share of frames that produced a usable gaze estimate (0-100). */
  trackingRatio: number;
  /** How often the gaze moved in the same direction as the target (0-100). */
  directionMatch: number;
  /** How closely the gaze speed matched the target speed (0-100). */
  speedMatch: number;
  /** How smooth the pursuit was (0-100). */
  smoothScore: number;
  /** How still the head was held (0-100). */
  headStillness: number;
  /** Mean distance between estimate and target, in pixels. */
  avgDistancePx: number;
  /** Eye velocity over target velocity. */
  pursuitGain: number;
  /** RMS error in degrees of visual angle. */
  accuracyDegrees: number;
  /** Delay between target and gaze, in milliseconds. */
  phaseLagMs: number;
  totalFrames: number;
  validFrames: number;
}

/** A finished pursuit run. */
export interface TestSession {
  /** The protocol the run belongs to. */
  protocol: "pursuit";
  id: string;
  startedAt: string;
  pattern: TargetPattern;
  durationSeconds: number;
  screen: ScreenGeometry;
  frames: TrackingFrame[];
  metrics: PursuitMetrics;
}

/** The target patterns the browser version can run. */
export type TargetPattern =
  "horizontal" | "vertical" | "circular" | "figure_eight" | "fixation";

/** Test settings the operator chooses. */
export interface TestConfig {
  pattern: TargetPattern;
  durationSeconds: number;
  /** 0-1, relative speed. */
  speed: number;
}

/** The protocols the browser version can run. */
export type ProtocolId = "pursuit" | "saccade" | "fixation" | "validation";

/** A finished saccade run. */
export interface SaccadeSession {
  protocol: "saccade";
  id: string;
  startedAt: string;
  screen: ScreenGeometry;
  durationSeconds: number;
  records: SaccadeTrialRecord[];
  metrics: SaccadeMetrics;
}

/** A finished fixation stability run. */
export interface FixationSession {
  protocol: "fixation";
  id: string;
  startedAt: string;
  screen: ScreenGeometry;
  durationSeconds: number;
  frames: TrackingFrame[];
  metrics: FixationMetrics;
}

/** A finished grid validation run. */
export interface ValidationSession {
  protocol: "validation";
  id: string;
  startedAt: string;
  screen: ScreenGeometry;
  durationSeconds: number;
  points: ValidationPointResult[];
  metrics: ValidationMetrics;
}

/** A finished run of any of the protocols. */
export type ProtocolSession =
  TestSession | SaccadeSession | FixationSession | ValidationSession;
