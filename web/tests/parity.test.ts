/**
 * Parity with the Python implementation.
 *
 * The fixtures in tests/fixtures were produced by running the Python code in
 * src/smooth_pursuit_test.py over the same frames. If this port changes a number, the two
 * versions no longer measure the same thing — that is what these tests protect.
 */

import { describe, expect, it } from "vitest";

import { computePursuitMetrics } from "../lib/metrics";
import type { ScreenGeometry, TrackingFrame } from "../lib/types";

import damped from "./fixtures/parity-damped.json";
import faithful from "./fixtures/parity-faithful.json";
import headDrift from "./fixtures/parity-head-drift.json";
import noisy from "./fixtures/parity-noisy.json";

interface Fixture {
  screen: ScreenGeometry;
  frames: TrackingFrame[];
  expected: Record<string, number>;
}

function check(fixture: Fixture) {
  const metrics = computePursuitMetrics(fixture.frames, fixture.screen);
  const expected = fixture.expected;

  expect(metrics.trackingRatio).toBeCloseTo(expected.trackingRatio, 3);
  expect(metrics.directionMatch).toBeCloseTo(expected.directionMatch, 3);
  expect(metrics.speedMatch).toBeCloseTo(expected.speedMatch, 3);
  expect(metrics.smoothScore).toBeCloseTo(expected.smoothScore, 3);
  expect(metrics.headStillness).toBeCloseTo(expected.headStillness, 3);
  expect(metrics.avgDistancePx).toBeCloseTo(expected.avgDistancePx, 3);
  expect(metrics.pursuitGain).toBeCloseTo(expected.pursuitGain, 3);
  expect(metrics.accuracyDegrees).toBeCloseTo(expected.accuracyDegrees, 3);
  expect(metrics.phaseLagMs).toBeCloseTo(expected.phaseLagMs, 3);
  expect(metrics.totalFrames).toBe(expected.totalFrames);
}

describe("parity with the desktop implementation", () => {
  it("matches a faithful tracker", () => {
    check(faithful as unknown as Fixture);
  });

  it("matches a damped tracker", () => {
    check(damped as unknown as Fixture);
  });

  it("matches a noisy tracker", () => {
    check(noisy as unknown as Fixture);
  });

  it("matches a run with head drift", () => {
    check(headDrift as unknown as Fixture);
  });
});
