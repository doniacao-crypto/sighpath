/**
 * Saccade protocol — parity with the desktop implementation, and the behaviour the
 * protocol depends on.
 *
 * The fixtures in tests/fixtures were produced by running the desktop code in
 * src/saccade_test.py over the same trials. If this port changes a number, the two
 * versions no longer measure the same thing — that is what the parity tests protect.
 */

import { describe, expect, it } from "vitest";

import {
  computeSaccadeMetrics,
  planSaccadeTrials,
  type SaccadeMetrics,
  type SaccadePlanOptions,
  type SaccadeTrialMetrics,
  type SaccadeTrialPlan,
  type SaccadeTrialRecord,
} from "../lib/saccade";
import type { ScreenGeometry } from "../lib/types";

import antisaccadeFixture from "./fixtures/parity-saccade-antisaccade.json";
import proFixture from "./fixtures/parity-saccade-pro.json";

interface SaccadeFixture {
  description: string;
  screen: ScreenGeometry;
  planOptions: Omit<SaccadePlanOptions, "screen">;
  input: { trials: SaccadeTrialRecord[] };
  expected: SaccadeMetrics;
}

const PRO = proFixture as unknown as SaccadeFixture;
const ANTISACCADE = antisaccadeFixture as unknown as SaccadeFixture;

const SCREEN: ScreenGeometry = {
  widthPx: 1920,
  heightPx: 1080,
  widthCm: 52,
  heightCm: 29.25,
  viewingDistanceCm: 60,
};

/** The plan of a single pro-saccade trial with the target ten degrees to the right. */
function trialPlan(
  overrides: Partial<SaccadeTrialPlan> = {}
): SaccadeTrialPlan {
  return {
    index: 0,
    type: "horizontal",
    direction: "right",
    eccentricityDeg: 10,
    fixateX: 960,
    fixateY: 540,
    targetX: 1347,
    targetY: 540,
    fixationDurationMs: 1000,
    gapDurationMs: 200,
    targetDurationMs: 1000,
    responseWindowMs: 800,
    ...overrides,
  };
}

/**
 * Gaze samples for one trial: the eye holds the fixation point until the saccade
 * starts, crosses to the destination over three samples and then stays there.
 */
function gazeSamples(options: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  latencyMs: number;
  stepMs?: number;
  onsetT?: number;
  durationMs?: number;
}): { x: number; y: number; t: number }[] {
  const stepMs = options.stepMs ?? 10;
  const onsetT = options.onsetT ?? 0;
  const latencySamples = Math.round(options.latencyMs / stepMs);
  const count = Math.round((options.durationMs ?? 400) / stepMs);

  const samples: { x: number; y: number; t: number }[] = [];
  for (let index = 0; index <= count; index += 1) {
    let x = options.from.x;
    let y = options.from.y;
    if (index > latencySamples) {
      const fraction = Math.min(1, (index - latencySamples) / 3);
      x = options.from.x + (options.to.x - options.from.x) * fraction;
      y = options.from.y + (options.to.y - options.from.y) * fraction;
    }
    samples.push({ x, y, t: onsetT + (index * stepMs) / 1000 });
  }
  return samples;
}

/** A recorded trial that moves from the fixation point to the target. */
function trial(options: {
  plan?: Partial<SaccadeTrialPlan>;
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  latencyMs: number;
}): SaccadeTrialRecord {
  const plan = trialPlan(options.plan);
  return {
    plan,
    samples: gazeSamples({
      from: options.from ?? { x: plan.fixateX, y: plan.fixateY },
      to: options.to ?? { x: plan.targetX, y: plan.targetY },
      latencyMs: options.latencyMs,
    }),
    targetOnsetT: 0,
    responseX: null,
    responseY: null,
    responseT: null,
  };
}

function expectNumber(
  actual: number | null,
  expected: number | null,
  precision = 6
): void {
  if (expected === null) {
    expect(actual).toBeNull();
    return;
  }
  expect(actual).not.toBeNull();
  expect(actual as number).toBeCloseTo(expected, precision);
}

function checkFixture(fixture: SaccadeFixture): void {
  const metrics = computeSaccadeMetrics(fixture.input.trials, fixture.screen);
  const expected = fixture.expected;

  expect(metrics.numTrials).toBe(expected.numTrials);
  expect(metrics.numCorrect).toBe(expected.numCorrect);
  // The fixtures carry six decimals, so that is the precision they can be compared at.
  expect(metrics.errorRate).toBeCloseTo(expected.errorRate, 6);
  expectNumber(metrics.meanLatencyMs, expected.meanLatencyMs);
  expectNumber(metrics.stdLatencyMs, expected.stdLatencyMs);
  expectNumber(metrics.meanAccuracyDeg, expected.meanAccuracyDeg);
  expectNumber(metrics.meanPeakVelocityDegS, expected.meanPeakVelocityDegS);
  expect(metrics.anticipatoryRate).toBeCloseTo(expected.anticipatoryRate, 6);
  expect(metrics.expressSaccadeRate).toBeCloseTo(
    expected.expressSaccadeRate,
    6
  );

  expect(metrics.perTrial.length).toBe(expected.perTrial.length);
  metrics.perTrial.forEach(
    (trialMetrics: SaccadeTrialMetrics, index: number) => {
      const want = expected.perTrial[index];
      expect(trialMetrics.index).toBe(want.index);
      expectNumber(trialMetrics.latencyMs, want.latencyMs);
      expectNumber(trialMetrics.durationMs, want.durationMs);
      expectNumber(trialMetrics.peakVelocityDegS, want.peakVelocityDegS);
      expectNumber(trialMetrics.amplitudeDeg, want.amplitudeDeg);
      expectNumber(trialMetrics.accuracyDeg, want.accuracyDeg);
      expect(trialMetrics.directionCorrect).toBe(want.directionCorrect);
      expect(trialMetrics.anticipatory).toBe(want.anticipatory);
      expect(trialMetrics.express).toBe(want.express);
    }
  );
}

describe("parity with the desktop implementation", () => {
  it("matches a pro-saccade run", () => {
    checkFixture(PRO);
  });

  it("matches an anti-saccade run", () => {
    checkFixture(ANTISACCADE);
  });

  it("plans the same trials from the same seed", () => {
    for (const fixture of [PRO, ANTISACCADE]) {
      const plans = planSaccadeTrials({
        ...fixture.planOptions,
        screen: fixture.screen,
      });
      expect(plans).toEqual(fixture.input.trials.map((record) => record.plan));
    }
  });
});

describe("trial analysis", () => {
  it("measures nothing when the eye never moved", () => {
    const record = trial({ latencyMs: 200 });
    // The eye holds the fixation point for the whole trial.
    record.samples = record.samples.map((sample) => ({
      x: record.plan.fixateX,
      y: record.plan.fixateY,
      t: sample.t,
    }));

    const metrics = computeSaccadeMetrics([record], SCREEN);

    expect(metrics.perTrial[0].latencyMs).toBeNull();
    expect(metrics.perTrial[0].durationMs).toBeNull();
    expect(metrics.perTrial[0].amplitudeDeg).toBeNull();
    expect(metrics.perTrial[0].directionCorrect).toBeNull();
    // The subject never made the movement the trial asked for, so the trial is not
    // correct either.
    expect(metrics.numCorrect).toBe(0);
    expect(metrics.errorRate).toBe(1);
    expect(metrics.meanLatencyMs).toBeNull();
  });

  it("calls a saccade at 80 ms express and one at 130 ms neither", () => {
    const anticipatory = computeSaccadeMetrics(
      [trial({ latencyMs: 70 })],
      SCREEN
    ).perTrial[0];
    const express = computeSaccadeMetrics([trial({ latencyMs: 80 })], SCREEN)
      .perTrial[0];
    const late = computeSaccadeMetrics([trial({ latencyMs: 130 })], SCREEN)
      .perTrial[0];

    expect(anticipatory.latencyMs).toBeCloseTo(70, 9);
    expect(anticipatory.anticipatory).toBe(true);
    expect(anticipatory.express).toBe(false);

    expect(express.latencyMs).toBe(80);
    expect(express.anticipatory).toBe(false);
    expect(express.express).toBe(true);

    expect(late.latencyMs).toBe(130);
    expect(late.anticipatory).toBe(false);
    expect(late.express).toBe(false);
  });

  it("scores an anti-saccade trial that looked away from the target as correct", () => {
    // The target is to the right, so looking away means looking to the left.
    const record = trial({
      plan: { type: "antisaccade", direction: "right" },
      to: { x: 573, y: 540 },
      latencyMs: 200,
    });

    const metrics = computeSaccadeMetrics([record], SCREEN);

    expect(metrics.perTrial[0].directionCorrect).toBe(true);
    expect(metrics.numCorrect).toBe(1);
    expect(metrics.errorRate).toBe(0);
    // The landing error is measured against the amplitude the protocol asked for. The
    // target sits on a whole pixel, so the error is the rounding of that pixel.
    expect(metrics.meanAccuracyDeg).toBeCloseTo(0.0078, 3);
  });

  it("scores an anti-saccade trial that looked at the target as wrong", () => {
    const record = trial({
      plan: { type: "antisaccade", direction: "right" },
      latencyMs: 200,
    });

    const metrics = computeSaccadeMetrics([record], SCREEN);

    expect(metrics.perTrial[0].directionCorrect).toBe(false);
    expect(metrics.numCorrect).toBe(0);
    expect(metrics.errorRate).toBe(1);
  });

  it("measures the vertical protocol on the vertical axis", () => {
    // On the vertical protocol "left" puts the target above the fixation point.
    const record = trial({
      plan: {
        type: "vertical",
        direction: "left",
        targetX: 960,
        targetY: 153,
      },
      to: { x: 960, y: 153 },
      latencyMs: 200,
    });

    const metrics = computeSaccadeMetrics([record], SCREEN);

    expect(metrics.perTrial[0].directionCorrect).toBe(true);
    // The target sits on a whole pixel, so the amplitude is the eccentricity to within
    // the rounding of that pixel.
    expect(metrics.perTrial[0].amplitudeDeg).toBeCloseTo(10.0078, 3);
    expect(metrics.perTrial[0].accuracyDeg).toBeCloseTo(0.0078, 3);
  });
});

describe("trial planning", () => {
  const options: SaccadePlanOptions = {
    numTrials: 6,
    type: "horizontal",
    eccentricitiesDeg: [10, 15],
    randomizeDirection: true,
    randomizeTiming: true,
    seed: 20240611,
    screen: SCREEN,
    fixationDurationMs: 1000,
    gapDurationMs: 200,
    targetDurationMs: 1000,
    responseWindowMs: 800,
  };

  it("is deterministic for a seed", () => {
    expect(planSaccadeTrials(options)).toEqual(planSaccadeTrials(options));
    expect(planSaccadeTrials({ ...options, seed: 7 })).not.toEqual(
      planSaccadeTrials(options)
    );
  });

  it("alternates the direction when the direction is not randomised", () => {
    const plans = planSaccadeTrials({
      ...options,
      randomizeDirection: false,
    });

    expect(plans.map((plan) => plan.direction)).toEqual([
      "left",
      "right",
      "left",
      "right",
      "left",
      "right",
    ]);
  });

  it("keeps the fixation at the centre of the screen", () => {
    for (const plan of planSaccadeTrials(options)) {
      expect(plan.fixateX).toBe(960);
      expect(plan.fixateY).toBe(540);
      expect(plan.targetY).toBe(540);
      expect(Math.abs(plan.targetX - 960)).toBeGreaterThan(300);
      expect(Math.abs(plan.targetX - 960)).toBeLessThan(700);
    }
  });

  it("jitters the fixation duration by up to 200 ms", () => {
    for (const plan of planSaccadeTrials(options)) {
      expect(Math.abs(plan.fixationDurationMs - 1000)).toBeLessThanOrEqual(200);
    }
  });
});
