/**
 * Target patterns — a port of the geometry in src/smooth_pursuit_test.py, so the browser
 * and the desktop app move the target the same way.
 */

import type { TargetPattern, TestConfig } from "./types";

/** Fraction of the screen kept clear at the edges. */
export const DEFAULT_MARGIN = 0.03;
/** Radius of the circular and figure-eight patterns, as a fraction of the screen height. */
export const DEFAULT_RADIUS_RATIO = 0.45;

/**
 * Position of the target at a given moment.
 *
 * `elapsed` is the seconds since the run started; `speed` is applied to the time base, so a
 * faster setting sweeps the same path more often.
 */
export function targetPosition(
  pattern: TargetPattern,
  elapsed: number,
  width: number,
  height: number,
  speed: number,
  margin: number = DEFAULT_MARGIN,
  radiusRatio: number = DEFAULT_RADIUS_RATIO
): { x: number; y: number } {
  const centreX = Math.floor(width / 2);
  const centreY = Math.floor(height / 2);
  const usableWidth = width - 2 * width * margin;
  const usableHeight = height - 2 * height * margin;
  const t = elapsed * speed;

  switch (pattern) {
    case "horizontal":
      return {
        x:
          centreX +
          Math.trunc((usableWidth / 2) * Math.sin((t * 2 * Math.PI) / 3)),
        y: centreY,
      };
    case "vertical":
      return {
        x: centreX,
        y:
          centreY +
          Math.trunc((usableHeight / 2) * Math.sin((t * 2 * Math.PI) / 3)),
      };
    case "circular": {
      const radius = height * radiusRatio;
      return {
        x: centreX + Math.trunc(radius * Math.cos((t * 2 * Math.PI) / 4)),
        y: centreY + Math.trunc(radius * Math.sin((t * 2 * Math.PI) / 4)),
      };
    }
    case "figure_eight": {
      const radius = height * radiusRatio;
      const theta = (t * 2 * Math.PI) / 4;
      return {
        x: centreX + Math.trunc(radius * Math.sin(theta)),
        y: centreY + Math.trunc(radius * Math.sin(theta) * Math.cos(theta)),
      };
    }
    case "fixation":
    default:
      return { x: centreX, y: centreY };
  }
}

/**
 * The calibration grid: nine points, in the order the desktop app visits them.
 *
 * The margin matches the desktop calibration (5% of the stage), so the subject's eye
 * movement covers the same range in both versions.
 */
export function calibrationGrid(
  width: number,
  height: number,
  margin = 0.05
): { x: number; y: number }[] {
  const marginX = Math.trunc(width * margin);
  const marginY = Math.trunc(height * margin);
  const points: { x: number; y: number }[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      points.push({
        x: marginX + Math.trunc((column * (width - 2 * marginX)) / 2),
        y: marginY + Math.trunc((row * (height - 2 * marginY)) / 2),
      });
    }
  }
  return points;
}

/** The three head-pose levels the calibration asks the subject to hold. */
export const HEAD_POSES = [
  { title: "Look straight ahead", subtitle: "Head centred, facing the screen" },
  {
    title: "Turn your head slightly LEFT",
    subtitle: "Keep looking at the dot with your eyes",
  },
  {
    title: "Turn your head slightly RIGHT",
    subtitle: "Keep looking at the dot with your eyes",
  },
] as const;

/** Seconds of notice given before the next head-pose level starts. */
export const POSE_TRANSITION_SECONDS = 3;
/** Frames collected at each calibration point. */
export const SAMPLES_PER_POINT = 20;
/** Seconds the subject is given to settle on a point before sampling starts. */
export const SETTLE_SECONDS = 0.5;

/** The default settings the browser version runs with. */
export const DEFAULT_TEST_CONFIG: TestConfig = {
  pattern: "horizontal",
  durationSeconds: 10,
  speed: 0.5,
};
