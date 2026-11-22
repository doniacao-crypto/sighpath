/**
 * Fixation stability metrics.
 *
 * The fixtures in tests/fixtures were produced by running the Python code in
 * src/metrics.py and src/smooth_pursuit_test.py over the same frames. If this port changes
 * a number, the two versions no longer measure the same thing — that is what these tests
 * protect.
 */

import { describe, expect, it } from "vitest";

import { computeFixationMetrics } from "../lib/fixation";
import type { ScreenGeometry, TrackingFrame } from "../lib/types";

import excursion from "./fixtures/parity-fixation-excursion.json";
import microsaccades from "./fixtures/parity-fixation-microsaccades.json";
import stable from "./fixtures/parity-fixation-stable.json";

interface Fixture {
  input: {
    screen: ScreenGeometry;
    fixationPoint: { x: number; y: number };
    frames: TrackingFrame[];
  };
  expected: {
    bceaDeg2: number;
    microsaccadeCount: number;
    microsaccadeRateHz: number;
    meanMicrosaccadeAmplitudeDeg: number;
    stabilityDeg: number;
    smoothness: number;
    trackingRatio: number;
    rmsErrorDeg: number;
  };
}

const SCREEN: ScreenGeometry = {
  widthPx: 1920,
  heightPx: 1080,
  widthCm: 53.1,
  heightCm: 29.9,
  viewingDistanceCm: 60,
};

const FIXATION = { x: 960, y: 540 };

/** One frame of a run, with the gaze where it was put. */
function frame(
  timestamp: number,
  gazeX: number | null,
  gazeY: number | null
): TrackingFrame {
  return {
    timestamp,
    targetX: FIXATION.x,
    targetY: FIXATION.y,
    gazeX,
    gazeY,
    headPitch: 0,
    headYaw: 0,
    faceDetected: true,
  };
}

function check(fixture: Fixture) {
  const { screen, fixationPoint, frames } = fixture.input;
  const metrics = computeFixationMetrics(frames, screen, fixationPoint);
  const expected = fixture.expected;

  expect(metrics.bceaDeg2).toBeCloseTo(expected.bceaDeg2, 6);
  expect(metrics.microsaccadeCount).toBe(expected.microsaccadeCount);
  expect(metrics.microsaccadeRateHz).toBeCloseTo(
    expected.microsaccadeRateHz,
    6
  );
  expect(metrics.meanMicrosaccadeAmplitudeDeg).toBeCloseTo(
    expected.meanMicrosaccadeAmplitudeDeg,
    6
  );
  expect(metrics.stabilityDeg).toBeCloseTo(expected.stabilityDeg, 6);
  expect(metrics.smoothness).toBeCloseTo(expected.smoothness, 6);
  expect(metrics.trackingRatio).toBeCloseTo(expected.trackingRatio, 6);
  expect(metrics.rmsErrorDeg).toBeCloseTo(expected.rmsErrorDeg, 6);
}

describe("parity with the desktop implementation", () => {
  it("matches a steady fixation", () => {
    check(stable as unknown as Fixture);
  });

  it("matches a fixation interrupted by microsaccades", () => {
    check(microsaccades as unknown as Fixture);
  });

  it("matches a fixation with an excursion", () => {
    check(excursion as unknown as Fixture);
  });
});

describe("fixation metrics", () => {
  it("reports neutral values when nothing was tracked", () => {
    const frames = [
      frame(0, null, null),
      frame(1 / 30, null, null),
      frame(2 / 30, null, null),
    ];

    const metrics = computeFixationMetrics(frames, SCREEN, FIXATION);

    expect(metrics).toEqual({
      bceaDeg2: 0,
      microsaccadeCount: 0,
      microsaccadeRateHz: 0,
      meanMicrosaccadeAmplitudeDeg: 0,
      stabilityDeg: 0,
      smoothness: 0,
      trackingRatio: 0,
      rmsErrorDeg: 0,
    });
    for (const value of Object.values(metrics)) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });

  it("reports a still fixation as perfectly stable", () => {
    const frames = Array.from({ length: 60 }, (_, index) =>
      frame(index / 30, FIXATION.x, FIXATION.y)
    );

    const metrics = computeFixationMetrics(frames, SCREEN, FIXATION);

    expect(metrics.stabilityDeg).toBe(0);
    expect(metrics.bceaDeg2).toBe(0);
    expect(metrics.rmsErrorDeg).toBe(0);
    expect(metrics.microsaccadeCount).toBe(0);
    expect(metrics.smoothness).toBe(1);
  });

  it("does not count a large excursion as a microsaccade", () => {
    // A five degree jump away from the fixation point and back: far above the maximum
    // microsaccade amplitude, so it is a saccade and not a microsaccade.
    const frames = Array.from({ length: 60 }, (_, index) => {
      const away = index >= 30 && index < 45;
      return frame(
        index / 30,
        away ? FIXATION.x + 190 : FIXATION.x,
        away ? FIXATION.y : FIXATION.y
      );
    });

    const metrics = computeFixationMetrics(frames, SCREEN, FIXATION);

    expect(metrics.microsaccadeCount).toBe(0);
    expect(metrics.meanMicrosaccadeAmplitudeDeg).toBe(0);
  });

  it("leaves out the frames without a usable gaze estimate", () => {
    const frames = [
      ...Array.from({ length: 30 }, (_, index) =>
        frame(index / 30, FIXATION.x, FIXATION.y)
      ),
      ...Array.from({ length: 30 }, (_, index) =>
        frame((30 + index) / 30, null, null)
      ),
    ];

    const metrics = computeFixationMetrics(frames, SCREEN, FIXATION);

    expect(metrics.trackingRatio).toBeCloseTo(50, 6);
    expect(metrics.stabilityDeg).toBe(0);
  });
});
