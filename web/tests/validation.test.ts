/**
 * Parity with the Python validation implementation.
 *
 * The fixtures in tests/fixtures were produced by running the desktop code in
 * src/validation.py over the same points. If this port changes a number, the browser version
 * no longer measures the same thing as the desktop app — and the ground truth the clinical
 * measurements rest on stops being ground truth.
 */

import { describe, expect, it } from "vitest";

import {
  computeValidationMetrics,
  validationPoints,
  type ValidationMetrics,
  type ValidationPointResult,
} from "../lib/validation";
import type { ScreenGeometry } from "../lib/types";

import grid from "./fixtures/parity-validation-grid.json";
import missingPoint from "./fixtures/parity-validation-missing-point.json";
import outlier from "./fixtures/parity-validation-outlier.json";
import patterns from "./fixtures/parity-validation-patterns.json";
import singleSample from "./fixtures/parity-validation-single-sample.json";

interface Fixture {
  input: {
    screen: ScreenGeometry;
    points: ValidationPointResult[];
  };
  expected: {
    accuracyDegrees: number | null;
    accuracyStdDegrees: number | null;
    precisionDegrees: number | null;
    worstPointAccuracy: number | null;
    validPoints: number;
    meetsClinicalThreshold: boolean;
    perPoint: {
      x: number;
      y: number;
      meanX: number;
      meanY: number;
      stdDeg: number;
      errorDeg: number;
    }[];
  };
}

interface PatternFixture {
  input: {
    screenWidthPx: number;
    screenHeightPx: number;
    marginPercent: number;
  };
  expected: {
    grid9: { x: number; y: number }[];
    grid16: { x: number; y: number }[];
    random20: { x: number; y: number }[];
  };
}

/** Compare a measurement with the one the desktop app produced. */
function expectClose(
  actual: number | null,
  expected: number | null,
  digits = 5
): void {
  if (expected === null) {
    expect(actual).toBeNull();
    return;
  }
  expect(actual).not.toBeNull();
  expect(actual ?? Number.NaN).toBeCloseTo(expected, digits);
}

/** Compare every measurement of a run with the ones the desktop app produced. */
function check(fixture: Fixture): ValidationMetrics {
  const metrics = computeValidationMetrics(
    fixture.input.points,
    fixture.input.screen
  );
  const expected = fixture.expected;

  expectClose(metrics.accuracyDegrees, expected.accuracyDegrees);
  expectClose(metrics.accuracyStdDegrees, expected.accuracyStdDegrees);
  expectClose(metrics.precisionDegrees, expected.precisionDegrees);
  expectClose(metrics.worstPointAccuracy, expected.worstPointAccuracy);
  expect(metrics.validPoints).toBe(expected.validPoints);
  expect(metrics.meetsClinicalThreshold).toBe(expected.meetsClinicalThreshold);

  expect(metrics.perPoint).toHaveLength(expected.perPoint.length);
  for (const [index, point] of expected.perPoint.entries()) {
    const outcome = metrics.perPoint[index];
    expect(outcome.x).toBe(point.x);
    expect(outcome.y).toBe(point.y);
    expectClose(outcome.meanX, point.meanX);
    expectClose(outcome.meanY, point.meanY);
    expectClose(outcome.stdDeg, point.stdDeg);
    expectClose(outcome.errorDeg, point.errorDeg);
  }

  return metrics;
}

describe("validation points", () => {
  it("puts nine points of the 3x3 grid inside the margin", () => {
    const points = validationPoints("grid_9", 1920, 1080, 0.15);

    expect(points).toHaveLength(9);
    const marginX = 288;
    const marginY = 162;
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(marginX);
      expect(point.x).toBeLessThanOrEqual(1920 - marginX);
      expect(point.y).toBeGreaterThanOrEqual(marginY);
      expect(point.y).toBeLessThanOrEqual(1080 - marginY);
    }
    // The middle of the grid is the middle of the screen.
    expect(points).toContainEqual({ x: 960, y: 540 });
  });

  it("keeps the margin relative to the screen", () => {
    const points = validationPoints("grid_9", 1280, 720, 0.15);

    expect(points).toHaveLength(9);
    expect(points).toContainEqual({ x: 192, y: 108 });
    expect(points).toContainEqual({ x: 640, y: 360 });
    expect(points).toContainEqual({ x: 1088, y: 612 });
  });

  it("puts the same dots on the screen as the desktop app", () => {
    const fixture = patterns as unknown as PatternFixture;

    expect(validationPoints("grid_9", 1920, 1080, 0.15)).toEqual(
      fixture.expected.grid9
    );
    expect(validationPoints("grid_16", 1920, 1080, 0.15)).toEqual(
      fixture.expected.grid16
    );
    expect(validationPoints("random_20", 1920, 1080, 0.15)).toEqual(
      fixture.expected.random20
    );
  });
});

describe("validation metrics", () => {
  it("matches the desktop implementation on a healthy run", () => {
    const metrics = check(grid as unknown as Fixture);

    expect(metrics.accuracyDegrees).toBeLessThan(2);
    expect(metrics.meetsClinicalThreshold).toBe(true);
  });

  it("matches the desktop when one point was tracked far away", () => {
    check(outlier as unknown as Fixture);
  });

  it("matches the desktop when a point collected nothing", () => {
    check(missingPoint as unknown as Fixture);
  });

  it("matches the desktop when a point collected a single sample", () => {
    check(singleSample as unknown as Fixture);
  });

  it("leaves a point without samples out of the accuracy", () => {
    const fixture = missingPoint as unknown as Fixture;
    const metrics = computeValidationMetrics(
      fixture.input.points,
      fixture.input.screen
    );

    // The point that collected nothing was never looked at.
    expect(metrics.validPoints).toBe(8);
    expect(metrics.perPoint).toHaveLength(8);

    // The accuracy is the one of the eight points that were looked at.
    const looked = fixture.input.points.filter(
      (point) => point.samples.length > 0
    );
    const withoutEmptyPoint = computeValidationMetrics(
      looked,
      fixture.input.screen
    );
    expect(metrics.accuracyDegrees).toBe(withoutEmptyPoint.accuracyDegrees);
    expectClose(metrics.accuracyDegrees, fixture.expected.accuracyDegrees);
  });

  it("counts a single-sample point in the accuracy, not the precision", () => {
    const fixture = singleSample as unknown as Fixture;
    const metrics = computeValidationMetrics(
      fixture.input.points,
      fixture.input.screen
    );

    const single = fixture.input.points.find(
      (point) => point.samples.length === 1
    );
    if (!single)
      throw new Error("the fixture must hold a point with one sample");

    expect(metrics.validPoints).toBe(9);
    expect(metrics.perPoint).toHaveLength(9);

    // One sample has no spread of its own, so the point stays out of the precision.
    const outcome = metrics.perPoint.find(
      (point) => point.x === single.x && point.y === single.y
    );
    expect(outcome).toBeDefined();
    expect(outcome?.stdDeg).toBe(0);
  });

  it("keeps one wild point out of the mean error", () => {
    const fixture = outlier as unknown as Fixture;
    const metrics = computeValidationMetrics(
      fixture.input.points,
      fixture.input.screen
    );

    // The mean over every point would be dragged up by the wild one.
    const plainMean =
      fixture.expected.perPoint.reduce(
        (total, point) => total + point.errorDeg,
        0
      ) / fixture.expected.perPoint.length;
    const accuracy = metrics.accuracyDegrees;
    expect(accuracy).not.toBeNull();
    if (accuracy === null) throw new Error("the run must have an accuracy");
    expect(accuracy).toBeLessThan(plainMean);

    // The wild point is still the worst point of the run.
    let worstError = 0;
    for (const point of fixture.expected.perPoint) {
      if (point.errorDeg > worstError) worstError = point.errorDeg;
    }
    expect(worstError).toBeGreaterThan(5);
    expectClose(
      metrics.worstPointAccuracy,
      fixture.expected.worstPointAccuracy
    );
  });
});
