/**
 * Calibration maths and flow.
 *
 * The ridge fit, the polynomial expansion and the calibration flow are ports of the Python
 * implementation in src/gaze_estimator.py and src/widgets/calibration_widget.py. If these
 * numbers drift, the browser version measures something different from the desktop app.
 */

import { describe, expect, it } from "vitest";

import {
  assessCalibration,
  CalibrationSession,
  MIN_HEAD_POSE_SPREAD_DEG,
} from "../lib/calibration";
import { fitGazeModel, gazeErrorPx, predictGaze } from "../lib/features";
import { calibrationGrid } from "../lib/patterns";
import { fitRidge, polynomialFeatures, predict } from "../lib/ridge";
import type { CalibrationPoint, EyeSample } from "../lib/types";

const SCREEN_WIDTH = 1920;
const SCREEN_HEIGHT = 1080;

function sample(
  irisX: number,
  irisY: number,
  headPitch = 0,
  headYaw = 0,
  timestamp = 0
): EyeSample {
  return {
    timestamp,
    leftGazeX: irisX,
    leftGazeY: irisY,
    rightGazeX: irisX,
    rightGazeY: irisY,
    headPitch,
    headYaw,
    faceDetected: true,
    isBlinking: false,
  };
}

/**
 * The iris position the subject has to reach to look at a screen point: a linear map of the
 * screen position, shifted by the head pose the subject holds.
 */
function irisFor(
  screenX: number,
  screenY: number,
  headPitch: number,
  headYaw: number
): { x: number; y: number } {
  return {
    x: 0.45 + (0.1 * screenX) / SCREEN_WIDTH + 0.002 * headYaw,
    y: 0.45 + (0.1 * screenY) / SCREEN_HEIGHT + 0.002 * headPitch,
  };
}

/** A calibration that walks the nine-point grid once per head-pose level. */
function syntheticCalibration(
  yaws: number[],
  pitches: number[]
): CalibrationPoint[] {
  const grid = calibrationGrid(SCREEN_WIDTH, SCREEN_HEIGHT);
  const points: CalibrationPoint[] = [];
  for (let level = 0; level < yaws.length; level += 1) {
    for (const target of grid) {
      const iris = irisFor(target.x, target.y, pitches[level], yaws[level]);
      const samples: EyeSample[] = [];
      for (let index = 0; index < 5; index += 1) {
        samples.push(
          sample(iris.x, iris.y, pitches[level], yaws[level], index)
        );
      }
      points.push({ x: target.x, y: target.y, samples });
    }
  }
  return points;
}

describe("ridge regression", () => {
  it("reproduces a known line", () => {
    const xs = [0, 1, 2, 3, 4, 5];
    const design = xs.map((x) => [x]);
    const target = xs.map((x) => 2 * x + 1);

    const model = fitRidge(design, target, 0);

    expect(model.coefficients[0]).toBeCloseTo(2, 9);
    expect(model.intercept).toBeCloseTo(1, 9);
    expect(predict(model, [10])).toBeCloseTo(21, 9);
  });

  it("shrinks the slope as the penalty grows", () => {
    const xs = [0, 1, 2, 3, 4, 5];
    const design = xs.map((x) => [x]);
    const target = xs.map((x) => 2 * x + 1);

    const unpenalised = fitRidge(design, target, 0);
    const penalised = fitRidge(design, target, 100);

    expect(Math.abs(penalised.coefficients[0])).toBeLessThan(
      Math.abs(unpenalised.coefficients[0])
    );
  });

  it("orders the polynomial features the way sklearn does", () => {
    expect(polynomialFeatures([2, 3, 5, 7], 2)).toEqual([
      1, 2, 3, 5, 7, 4, 6, 10, 14, 9, 15, 21, 25, 35, 49,
    ]);
    expect(polynomialFeatures([2, 3], 1)).toEqual([1, 2, 3]);
    expect(polynomialFeatures([2, 3], 3)).toEqual([
      1, 2, 3, 4, 6, 9, 8, 12, 18, 27,
    ]);
  });
});

describe("gaze model", () => {
  it("fits the same model as the sklearn pipeline", () => {
    const points = syntheticCalibration([0, -12, 12], [0, 0, 0]);
    const model = fitGazeModel(points);

    // The reference numbers come from sklearn's StandardScaler -> PolynomialFeatures(2) ->
    // Ridge(alpha=1.0) pipeline run over the same rows.
    expect(model.scalerMean[0]).toBeCloseTo(0.5, 12);
    expect(model.scalerMean[1]).toBeCloseTo(0.5, 12);
    expect(model.scalerScale[0]).toBeCloseTo(0.04164132562731407, 12);
    expect(model.scalerScale[1]).toBeCloseTo(0.03674234614174769, 12);
    expect(model.scalerScale[3]).toBeCloseTo(9.797958971132712, 12);
    expect(model.modelX.coefficients[1]).toBeCloseTo(790.3408302182422, 6);
    expect(model.modelX.coefficients[4]).toBeCloseTo(-369.1903532161337, 6);
    expect(model.modelX.intercept).toBeCloseTo(960, 6);
    expect(model.modelY.coefficients[2]).toBeCloseTo(393.89956378432436, 6);
    expect(model.modelY.intercept).toBeCloseTo(540, 6);
  });

  it("predicts the screen position of a synthetic calibration", () => {
    const points = syntheticCalibration([0, -12, 12], [0, 0, 0]);
    const model = fitGazeModel(points);

    for (const point of points) {
      const iris = irisFor(point.x, point.y, 0, 0);
      const prediction = predictGaze(model, sample(iris.x, iris.y));
      // The ridge penalty shrinks the slope a little, so the corners of the grid sit about ten
      // pixels off; anything larger means the pipeline is broken rather than penalised.
      expect(Math.abs(prediction.x - point.x)).toBeLessThan(12);
      expect(Math.abs(prediction.y - point.y)).toBeLessThan(6);
    }
  });

  it("reports the error of the points it was fitted on", () => {
    const points = syntheticCalibration([0, -12, 12], [0, 0, 0]);
    const model = fitGazeModel(points);

    expect(gazeErrorPx(model, points)).toBeCloseTo(8.144091412861648, 6);
  });

  it("keeps the head pose in physical units when the head never moves", () => {
    const points = syntheticCalibration([0, 0, 0], [0, 0, 0]);
    const model = fitGazeModel(points);

    // The observed spread is zero, so the scale would divide by nothing; the floor keeps the
    // head pose in degrees.
    expect(model.scalerScale[2]).toBe(5);
    expect(model.scalerScale[3]).toBe(5);
  });
});

describe("calibration quality", () => {
  it("holds out a screen location and still predicts it", () => {
    const points = syntheticCalibration([0, -12, 12], [0, 0, 0]);
    const model = fitGazeModel(points);

    const quality = assessCalibration(model, points);

    expect(quality.points).toBe(points.length);
    expect(quality.trainingRows).toBe(points.length * 5);
    // The reference value comes from the same leave-one-location-out loop in sklearn.
    expect(quality.cvErrorPx).toBeCloseTo(30.044033465088756, 6);
    expect(quality.avgErrorPx).toBeCloseTo(8.144091412861648, 6);
    expect(quality.cvErrorPx).toBeLessThan(35);
  });

  it("reports a still head as unusable for head compensation", () => {
    const points = syntheticCalibration([0, 0, 0], [0, 0, 0]);
    const model = fitGazeModel(points);

    const quality = assessCalibration(model, points);

    expect(quality.headPitchSpreadDeg).toBeCloseTo(0, 9);
    expect(quality.headYawSpreadDeg).toBeCloseTo(0, 9);
    expect(quality.headPoseOk).toBe(false);
  });

  it("accepts a head that moved far enough", () => {
    const points = syntheticCalibration([0, -12, 12], [0, 0, 0]);
    const model = fitGazeModel(points);

    const quality = assessCalibration(model, points);

    expect(quality.headYawSpreadDeg).toBeGreaterThanOrEqual(
      MIN_HEAD_POSE_SPREAD_DEG
    );
    expect(quality.headPoseOk).toBe(true);
  });
});

describe("calibration session", () => {
  const grid = [
    { x: 100, y: 100 },
    { x: 200, y: 200 },
  ];
  const poses = [
    { title: "Look straight ahead", subtitle: "Head centred" },
    {
      title: "Turn your head slightly LEFT",
      subtitle: "Keep looking at the dot",
    },
  ];

  function newSession(): CalibrationSession {
    return new CalibrationSession(grid, {
      poses,
      samplesPerPoint: 3,
      settleSeconds: 0.5,
      transitionSeconds: 3,
    });
  }

  it("settles on a dot before it samples it", () => {
    const session = newSession();
    expect(session.state.phase).toBe("idle");

    session.start(0);
    expect(session.state.phase).toBe("settling");
    expect(session.currentTarget).toEqual(grid[0]);
    expect(session.nextPoseTitle).toBe(poses[0].title);

    // A frame that arrives during the settle period is not part of the calibration.
    session.addSample(sample(0.5, 0.5), 0.2);
    expect(session.state.samplesAtPoint).toBe(0);

    session.tick(0.6);
    expect(session.state.phase).toBe("sampling");

    session.addSample(sample(0.5, 0.5), 0.7);
    session.addSample(sample(0.5, 0.5), 0.8);
    expect(session.state.samplesAtPoint).toBe(2);
  });

  it("moves to the next dot once the samples are in", () => {
    const session = newSession();
    session.start(0);
    session.tick(0.6);

    session.addSample(sample(0.5, 0.5), 0.7);
    session.addSample(sample(0.5, 0.5), 0.8);
    session.addSample(sample(0.5, 0.5), 0.9);

    expect(session.state.samplesAtPoint).toBe(0);
    expect(session.state.pointIndex).toBe(1);
    expect(session.state.phase).toBe("settling");
    expect(session.currentTarget).toEqual(grid[1]);
  });

  it("gives the notice between head-pose levels and collects nothing during it", () => {
    const session = newSession();
    session.start(0);
    session.tick(0.6);
    for (let index = 0; index < 3; index += 1) {
      session.addSample(sample(0.5, 0.5), 0.7 + index * 0.1);
    }
    // The eye settles on the second dot before it is sampled.
    session.tick(1.5);
    expect(session.state.phase).toBe("sampling");
    for (let index = 0; index < 3; index += 1) {
      session.addSample(sample(0.5, 0.5), 1.6 + index * 0.1);
    }

    expect(session.state.phase).toBe("transition");
    expect(session.state.poseIndex).toBe(1);
    expect(session.state.pointIndex).toBe(0);
    expect(session.state.noticeSecondsLeft).toBeCloseTo(3, 6);
    expect(session.currentTarget).toBeNull();
    expect(session.nextPoseTitle).toBe(poses[1].title);

    // The subject is moving their head: no sample may be taken.
    session.addSample(sample(0.5, 0.5), 2.0);
    expect(session.state.samplesAtPoint).toBe(0);
    expect(session.state.phase).toBe("transition");

    session.tick(2.3);
    expect(session.state.noticeSecondsLeft).toBeCloseTo(2.5, 6);

    session.tick(4.8);
    expect(session.state.phase).toBe("settling");
    expect(session.state.noticeSecondsLeft).toBe(0);
    session.tick(5.4);
    expect(session.state.phase).toBe("sampling");
  });

  it("finishes after the last dot of the last level", () => {
    const session = newSession();
    let now = 0;
    session.start(now);

    for (let level = 0; level < poses.length; level += 1) {
      now += 0.6;
      session.tick(now);
      expect(session.state.phase).toBe("sampling");
      for (let dot = 0; dot < grid.length; dot += 1) {
        for (let frame = 0; frame < 3; frame += 1) {
          now += 0.05;
          session.addSample(sample(0.5, 0.5), now);
        }
        if (dot < grid.length - 1) {
          now += 0.6;
          session.tick(now);
        }
      }
      if (level < poses.length - 1) {
        now += 3.1;
        session.tick(now);
        expect(session.state.phase).toBe("settling");
      }
    }

    expect(session.state.phase).toBe("done");
    expect(session.finished).toBe(true);
    expect(session.currentTarget).toBeNull();

    const points = session.buildPoints();
    expect(points).toHaveLength(grid.length * poses.length);
    for (const point of points) {
      expect(point.samples).toHaveLength(3);
    }
  });

  it("ignores frames without a face or during a blink", () => {
    const session = newSession();
    session.start(0);
    session.tick(0.6);

    const blink: EyeSample = { ...sample(0.5, 0.5), isBlinking: true };
    const lost: EyeSample = { ...sample(0.5, 0.5), faceDetected: false };
    session.addSample(blink, 0.7);
    session.addSample(lost, 0.8);

    expect(session.state.samplesAtPoint).toBe(0);
  });
});
