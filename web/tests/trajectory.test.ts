/**
 * The trajectory views of a run, and their parity with the desktop plots.
 *
 * The fixture in tests/fixtures was produced by running the Python code in
 * src/visualization.py over the same frames: the gaze path it drew, the position over
 * time it drew, the density grid behind its heatmap and the colour ramp it shaded that
 * grid with. If this port changes a number, the two versions no longer show the same
 * run — that is what these tests protect.
 */

import { describe, expect, it } from "vitest";

import {
  buildHeatmap,
  buildPositionOverTime,
  buildTrajectory,
  drawHeatmap,
  drawPositionOverTime,
  drawTrajectory,
  hotColor,
} from "../lib/trajectory";
import type { TrackingFrame } from "../lib/types";

import fixture from "./fixtures/parity-trajectory.json";

interface Fixture {
  screen: { widthPx: number; heightPx: number };
  bins: number;
  frames: TrackingFrame[];
  expected: {
    trajectory: { x: number[]; y: number[]; t: number[] };
    timeSeries: { t: number[]; x: number[]; y: number[] };
    heatmap: { columns: number; rows: number; cells: number[]; max: number };
    hotLut: number[][];
  };
}

interface StubCall {
  name: string;
  args: unknown[];
}

/** A 2D context that records what it is asked to draw. */
function createStubContext(): {
  context: CanvasRenderingContext2D;
  calls: StubCall[];
} {
  const calls: StubCall[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push({ name, args });
    };

  const stub = {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    lineCap: "butt",
    lineJoin: "miter",
    save: record("save"),
    restore: record("restore"),
    clearRect: record("clearRect"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    stroke: record("stroke"),
    fill: record("fill"),
    fillRect: record("fillRect"),
    strokeRect: record("strokeRect"),
    arc: record("arc"),
    fillText: record("fillText"),
    setLineDash: record("setLineDash"),
  };

  return { context: stub as unknown as CanvasRenderingContext2D, calls };
}

/** A frame with a gaze estimate, or without one when the estimate is null. */
function frame(
  timestamp: number,
  gazeX: number | null,
  gazeY: number | null
): TrackingFrame {
  return {
    timestamp,
    targetX: 0,
    targetY: 0,
    gazeX,
    gazeY,
    headPitch: 0,
    headYaw: 0,
    faceDetected: true,
  };
}

const parity = fixture as unknown as Fixture;

describe("the trajectory of a run", () => {
  it("keeps the frames with a usable estimate and flags the rest as invalid", () => {
    const points = buildTrajectory(parity.frames);
    expect(points).toHaveLength(parity.frames.length);

    const usable = points.filter((point) => point.valid);
    const flagged = points.filter((point) => !point.valid);
    const missing = parity.frames.filter(
      (frame) => frame.gazeX === null || frame.gazeY === null
    );

    expect(usable).toHaveLength(parity.frames.length - missing.length);
    expect(flagged).toHaveLength(missing.length);
    for (const point of flagged) {
      expect(point.x).toBe(0);
      expect(point.y).toBe(0);
    }
  });

  it("has one position for every frame", () => {
    const series = buildPositionOverTime(parity.frames);
    expect(series.t).toHaveLength(parity.frames.length);
    expect(series.x).toHaveLength(parity.frames.length);
    expect(series.y).toHaveLength(parity.frames.length);
  });

  it("counts every sample that falls on the screen exactly once", () => {
    const grid = buildHeatmap(
      parity.frames,
      parity.screen.widthPx,
      parity.screen.heightPx,
      parity.bins
    );
    const total = grid.cells.reduce((sum, count) => sum + count, 0);
    const onScreen = parity.frames.filter(
      (frame) =>
        frame.gazeX !== null &&
        frame.gazeY !== null &&
        frame.gazeX >= 0 &&
        frame.gazeX <= parity.screen.widthPx &&
        frame.gazeY >= 0 &&
        frame.gazeY <= parity.screen.heightPx
    ).length;

    expect(total).toBe(onScreen);
    expect(grid.max).toBe(parity.expected.heatmap.max);
  });

  it("puts the busiest cell at the right count", () => {
    const frames = [
      frame(0, 5, 5),
      frame(1, 6, 7),
      frame(2, 8, 9),
      frame(3, 95, 95),
      frame(4, 150, 5),
    ];
    const grid = buildHeatmap(frames, 100, 100, 10);

    expect(grid.columns).toBe(10);
    expect(grid.rows).toBe(10);
    expect(grid.max).toBe(3);
    expect(grid.cells[0]).toBe(3);
    expect(grid.cells[99]).toBe(1);
    // The sample off the screen is left out of the grid.
    expect(grid.cells.reduce((sum, count) => sum + count, 0)).toBe(4);
  });
});

describe("parity with the desktop implementation", () => {
  it("walks the same gaze path", () => {
    const usable = buildTrajectory(parity.frames).filter(
      (point) => point.valid
    );

    expect(usable.map((point) => point.x)).toEqual(
      parity.expected.trajectory.x
    );
    expect(usable.map((point) => point.y)).toEqual(
      parity.expected.trajectory.y
    );
    expect(usable.map((point) => point.t)).toEqual(
      parity.expected.trajectory.t
    );
  });

  it("plots the same position over time", () => {
    const series = buildPositionOverTime(parity.frames);
    const kept = parity.frames
      .map((frame, index) =>
        frame.gazeX !== null && frame.gazeY !== null ? index : -1
      )
      .filter((index) => index >= 0);

    expect(kept.map((index) => series.t[index])).toEqual(
      parity.expected.timeSeries.t
    );
    expect(kept.map((index) => series.x[index])).toEqual(
      parity.expected.timeSeries.x
    );
    expect(kept.map((index) => series.y[index])).toEqual(
      parity.expected.timeSeries.y
    );
  });

  it("bins the gaze into the same grid", () => {
    const grid = buildHeatmap(
      parity.frames,
      parity.screen.widthPx,
      parity.screen.heightPx,
      parity.bins
    );

    expect(grid.columns).toBe(parity.expected.heatmap.columns);
    expect(grid.rows).toBe(parity.expected.heatmap.rows);
    expect(grid.max).toBe(parity.expected.heatmap.max);
    expect(grid.cells).toEqual(parity.expected.heatmap.cells);
  });

  it("shades the heatmap with the same colour ramp", () => {
    const lut = parity.expected.hotLut;
    for (let index = 0; index < lut.length; index += 1) {
      const [red, green, blue] = lut[index];
      expect(hotColor(index / 256)).toBe(
        `rgb(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(
          blue * 255
        )})`
      );
    }
  });
});

describe("drawing the views", () => {
  it("survives an empty run", () => {
    const { context } = createStubContext();

    expect(() => drawTrajectory(context, [], 400, 300)).not.toThrow();
    expect(() =>
      drawPositionOverTime(context, { t: [], x: [], y: [] }, 400, 300)
    ).not.toThrow();
    expect(() =>
      drawHeatmap(context, { cells: [], columns: 0, rows: 0, max: 0 }, 400, 300)
    ).not.toThrow();
  });

  it("draws the path through every usable sample", () => {
    const { context, calls } = createStubContext();
    const points = buildTrajectory(parity.frames);

    drawTrajectory(context, points, 400, 300);

    const usable = points.filter((point) => point.valid).length;
    expect(calls.filter((call) => call.name === "moveTo")).toHaveLength(1);
    expect(calls.filter((call) => call.name === "lineTo")).toHaveLength(
      usable - 1
    );
  });

  it("draws the axes only when they are asked for", () => {
    const withAxes = createStubContext();
    drawPositionOverTime(
      withAxes.context,
      buildPositionOverTime(parity.frames),
      400,
      300
    );
    expect(withAxes.calls.some((call) => call.name === "fillText")).toBe(true);

    const withoutAxes = createStubContext();
    drawPositionOverTime(
      withoutAxes.context,
      buildPositionOverTime(parity.frames),
      400,
      300,
      { showAxes: false }
    );
    expect(withoutAxes.calls.some((call) => call.name === "fillText")).toBe(
      false
    );
  });

  it("covers the canvas with the heatmap", () => {
    const { context, calls } = createStubContext();
    const grid = buildHeatmap(
      parity.frames,
      parity.screen.widthPx,
      parity.screen.heightPx,
      parity.bins
    );

    drawHeatmap(context, grid, 400, 300);

    expect(calls.filter((call) => call.name === "fillRect")).toHaveLength(
      grid.columns * grid.rows
    );
  });
});
