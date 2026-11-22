/**
 * Trajectory, position-over-time and heatmap views of a recorded run.
 *
 * A port of the desktop plots in src/visualization.py. The desktop filters a run down to
 * the frames that carry a usable gaze estimate, bins the gaze over the screen for the
 * density map and colours that map with matplotlib's "hot" colormap. The browser keeps
 * the same data and the same colour ramp and paints them on a canvas instead.
 */

import type { TrackingFrame } from "./types";

/** A gaze sample on the trajectory: one for every recorded frame. */
export interface TrajectoryPoint {
  /** Estimated gaze position in screen pixels; zero when the frame carried no estimate. */
  x: number;
  /** Estimated gaze position in screen pixels; zero when the frame carried no estimate. */
  y: number;
  /** Seconds since the start of the run. */
  t: number;
  /** False when the frame carried no usable gaze estimate. */
  valid: boolean;
}

/** The gaze position of every frame against the time. */
export interface PositionSeries {
  /** Seconds since the first usable estimate. */
  t: number[];
  /** Horizontal gaze position in pixels; NaN where the frame carried no estimate. */
  x: number[];
  /** Vertical gaze position in pixels; NaN where the frame carried no estimate. */
  y: number[];
}

/** How densely the gaze visited each part of the screen. */
export interface HeatmapGrid {
  /** Column-major counts: grid[y * columns + x]. */
  cells: number[];
  columns: number;
  rows: number;
  max: number;
}

/** The colour the desktop draws the gaze path in. */
const DEFAULT_COLOR = "#3498db";
/** The line width the desktop draws the gaze path with. */
const DEFAULT_LINE_WIDTH = 1.5;
/** The opacity the desktop draws the gaze path with. */
const DEFAULT_LINE_ALPHA = 0.7;
/** The opacity the desktop draws the heatmap with. */
const DEFAULT_HEATMAP_ALPHA = 0.8;
/** Radius of the marker drawn on every sample when the caller asks for the points. */
const POINT_RADIUS = 2;
/** Space kept around the drawn content, as a fraction of the smaller canvas side. */
const CONTENT_MARGIN = 0.06;
/** The number of bins per axis the desktop uses for the heatmap. */
const DEFAULT_BINS = 50;
/** Colour of the grid lines behind a chart. */
const GRID_COLOR = "#e6e6e6";
/** Colour of the frame around a chart. */
const AXIS_COLOR = "#999999";
/** Colour of the tick labels of a chart. */
const LABEL_COLOR = "#555555";

/**
 * The knots of matplotlib's "hot" colormap, one list per channel: each entry is the
 * position on the ramp and the value of the channel there.
 */
const HOT_RED: ReadonlyArray<readonly [number, number]> = [
  [0, 0.0416],
  [0.365079, 1],
  [1, 1],
];
const HOT_GREEN: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.365079, 0],
  [0.746032, 1],
  [1, 1],
];
const HOT_BLUE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.746032, 0],
  [1, 1],
];
/** The size of matplotlib's lookup table. */
const HOT_LUT_SIZE = 256;

/**
 * Read one channel of the "hot" ramp at a position on the ramp.
 *
 * The ramp is linear between the knots, which is how matplotlib builds its lookup table.
 */
function hotChannel(
  knots: ReadonlyArray<readonly [number, number]>,
  position: number
): number {
  for (let index = 1; index < knots.length; index += 1) {
    const [startX, startValue] = knots[index - 1];
    const [endX, endValue] = knots[index];
    if (position <= endX) {
      const span = endX - startX;
      const ratio = span === 0 ? 0 : (position - startX) / span;
      return startValue + (endValue - startValue) * ratio;
    }
  }
  return knots[knots.length - 1][1];
}

/** matplotlib's lookup table for the "hot" colormap, sampled like matplotlib does. */
const HOT_LUT: ReadonlyArray<readonly [number, number, number]> = Array.from(
  { length: HOT_LUT_SIZE },
  (_, index) => {
    const position = index / (HOT_LUT_SIZE - 1);
    return [
      hotChannel(HOT_RED, position),
      hotChannel(HOT_GREEN, position),
      hotChannel(HOT_BLUE, position),
    ] as const;
  }
);

/**
 * The colour matplotlib's "hot" colormap gives a density between 0 and 1.
 *
 * The lookup table is sampled the way matplotlib samples it, so the browser and the
 * desktop shade the same density the same way.
 */
export function hotColor(density: number): string {
  const index = Math.min(
    HOT_LUT_SIZE - 1,
    Math.max(0, Math.floor(density * HOT_LUT_SIZE))
  );
  const [red, green, blue] = HOT_LUT[index];
  return `rgb(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(
    blue * 255
  )})`;
}

/**
 * The gaze path of a run, one point for every recorded frame.
 *
 * The desktop drops the frames without an estimate before it draws anything. The browser
 * keeps them so that the caller can tell a gap from a fixation, and flags them as
 * invalid; only the valid points are drawn.
 */
export function buildTrajectory(frames: TrackingFrame[]): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = [];
  for (const frame of frames) {
    const gazeX = frame.gazeX;
    const gazeY = frame.gazeY;
    if (gazeX === null || gazeY === null) {
      points.push({ x: 0, y: 0, t: frame.timestamp, valid: false });
      continue;
    }
    points.push({ x: gazeX, y: gazeY, t: frame.timestamp, valid: true });
  }
  return points;
}

/**
 * The gaze position of every frame against the time.
 *
 * The desktop plots the estimate it has and leaves out the frames without one; the
 * browser keeps a slot for every frame and marks the missing ones with NaN, so the chart
 * shows a gap instead of a jump to the corner of the screen. The time runs from the
 * first usable estimate, the way the desktop normalises it.
 */
export function buildPositionOverTime(frames: TrackingFrame[]): PositionSeries {
  const first = frames.find(
    (frame) => frame.gazeX !== null && frame.gazeY !== null
  );
  const origin = first
    ? first.timestamp
    : frames.length > 0
      ? frames[0].timestamp
      : 0;

  const t: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  for (const frame of frames) {
    t.push(frame.timestamp - origin);
    const gazeX = frame.gazeX;
    const gazeY = frame.gazeY;
    if (gazeX === null || gazeY === null) {
      x.push(Number.NaN);
      y.push(Number.NaN);
      continue;
    }
    x.push(gazeX);
    y.push(gazeY);
  }
  return { t, x, y };
}

/**
 * The bin edges of a uniform grid over an axis, built the way numpy builds them.
 *
 * numpy takes the edges of a histogram from linspace, which is what the desktop bins
 * the gaze with; the same edges keep the browser in the same bins.
 */
function uniformEdges(extent: number, bins: number): number[] {
  const step = extent / bins;
  const edges: number[] = [];
  for (let index = 0; index < bins; index += 1) edges.push(index * step);
  edges.push(extent);
  return edges;
}

/**
 * The bin a value falls into, or -1 when it falls outside the edges.
 *
 * A value on an edge belongs to the bin that starts there, and the last bin reaches the
 * last edge, the way numpy counts them.
 */
function binOf(edges: number[], value: number, bins: number): number {
  if (!Number.isFinite(value)) return -1;
  if (value < edges[0] || value > edges[bins]) return -1;
  let low = 0;
  let high = bins - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (edges[middle] <= value) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * How densely the gaze visited each part of the screen.
 *
 * The screen is divided into `bins` columns and `bins` rows and every frame with a
 * usable estimate is counted into the cell it falls in. Estimates outside the screen
 * are left out, the way the desktop leaves them out of its histogram. The bin count
 * defaults to the fifty the desktop uses.
 */
export function buildHeatmap(
  frames: TrackingFrame[],
  widthPx: number,
  heightPx: number,
  bins: number = DEFAULT_BINS
): HeatmapGrid {
  const columns = Math.max(0, Math.floor(bins));
  const rows = columns;
  const cells = new Array<number>(columns * rows).fill(0);
  if (columns === 0 || widthPx <= 0 || heightPx <= 0) {
    return { cells, columns, rows, max: 0 };
  }

  const xEdges = uniformEdges(widthPx, columns);
  const yEdges = uniformEdges(heightPx, rows);
  let max = 0;
  for (const frame of frames) {
    const gazeX = frame.gazeX;
    const gazeY = frame.gazeY;
    if (gazeX === null || gazeY === null) continue;
    const column = binOf(xEdges, gazeX, columns);
    const row = binOf(yEdges, gazeY, rows);
    if (column < 0 || row < 0) continue;
    const index = row * columns + column;
    const count = cells[index] + 1;
    cells[index] = count;
    if (count > max) max = count;
  }
  return { cells, columns, rows, max };
}

/**
 * Clear the canvas before a view is drawn.
 *
 * Each view here paints the whole of the canvas, so the previous frame has to go; the
 * caller still owns the canvas and its background.
 */
function clearCanvas(
  context: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number
): void {
  if (widthPx <= 0 || heightPx <= 0) return;
  context.clearRect(0, 0, widthPx, heightPx);
}

/**
 * Draw the gaze path of a run.
 *
 * The path is scaled to the canvas with the aspect ratio kept, the way the desktop plot
 * keeps it, so that the shape of the trajectory is the shape of the real movement.
 */
export function drawTrajectory(
  context: CanvasRenderingContext2D,
  points: TrajectoryPoint[],
  widthPx: number,
  heightPx: number,
  options?: { color?: string; showPoints?: boolean }
): void {
  clearCanvas(context, widthPx, heightPx);

  const usable = points.filter((point) => point.valid);
  if (usable.length === 0 || widthPx <= 0 || heightPx <= 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of usable) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  // A single sample, or a path that does not move, still has to land in the middle.
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const margin = Math.min(widthPx, heightPx) * CONTENT_MARGIN;
  const scale = Math.min(
    (widthPx - 2 * margin) / spanX,
    (heightPx - 2 * margin) / spanY
  );
  const originX = (widthPx - spanX * scale) / 2 - minX * scale;
  const originY = (heightPx - spanY * scale) / 2 - minY * scale;
  // Screen coordinates grow downwards, so the canvas needs no flip: the path looks the
  // way the subject saw it.
  const toX = (x: number): number => originX + x * scale;
  const toY = (y: number): number => originY + y * scale;

  context.save();
  context.strokeStyle = options?.color ?? DEFAULT_COLOR;
  context.globalAlpha = DEFAULT_LINE_ALPHA;
  context.lineWidth = DEFAULT_LINE_WIDTH;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(toX(usable[0].x), toY(usable[0].y));
  for (let index = 1; index < usable.length; index += 1) {
    context.lineTo(toX(usable[index].x), toY(usable[index].y));
  }
  context.stroke();
  context.restore();

  if (!options?.showPoints) return;

  context.save();
  context.fillStyle = options?.color ?? DEFAULT_COLOR;
  for (const point of usable) {
    context.beginPath();
    context.arc(toX(point.x), toY(point.y), POINT_RADIUS, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

/**
 * A round tick step that covers a span in about the wanted number of intervals: one, two
 * or five times a power of ten.
 */
function niceStep(span: number, target: number): number {
  const rough = span / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const factor =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return factor * magnitude;
}

/**
 * Draw the gaze position against the time.
 *
 * The horizontal and the vertical position share one pair of axes, because both are
 * screen pixels. Frames without an estimate leave a gap in the line, the way the
 * desktop plot leaves the missing samples out.
 */
export function drawPositionOverTime(
  context: CanvasRenderingContext2D,
  series: PositionSeries,
  widthPx: number,
  heightPx: number,
  options?: { color?: string; showAxes?: boolean }
): void {
  clearCanvas(context, widthPx, heightPx);

  const count = Math.min(series.t.length, series.x.length, series.y.length);
  if (count === 0 || widthPx <= 0 || heightPx <= 0) return;

  let tMin = Infinity;
  let tMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const time = series.t[index];
    if (Number.isFinite(time)) {
      if (time < tMin) tMin = time;
      if (time > tMax) tMax = time;
    }
    for (const value of [series.x[index], series.y[index]]) {
      if (!Number.isFinite(value)) continue;
      if (value < vMin) vMin = value;
      if (value > vMax) vMax = value;
    }
  }
  if (!Number.isFinite(tMin) || !Number.isFinite(vMin)) return;

  if (tMax - tMin < 1e-9) {
    tMin -= 0.5;
    tMax += 0.5;
  }
  const valuePad = (vMax - vMin) * 0.05;
  if (vMax - vMin < 1e-9) {
    vMin -= 0.5;
    vMax += 0.5;
  } else {
    vMin -= valuePad;
    vMax += valuePad;
  }

  const showAxes = options?.showAxes ?? true;
  const plotLeft = showAxes ? 46 : 8;
  const plotRight = widthPx - (showAxes ? 14 : 8);
  const plotTop = showAxes ? 14 : 8;
  const plotBottom = heightPx - (showAxes ? 28 : 8);
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);

  const timeStep = niceStep(tMax - tMin, 6);
  const valueStep = niceStep(vMax - vMin, 4);

  const timeToX = (time: number): number =>
    plotLeft + ((time - tMin) / (tMax - tMin)) * plotWidth;
  const valueToY = (value: number): number =>
    plotBottom - ((value - vMin) / (vMax - vMin)) * plotHeight;

  context.save();
  context.strokeStyle = GRID_COLOR;
  context.lineWidth = 1;
  context.beginPath();
  const firstValue = Math.ceil(vMin / valueStep);
  for (let index = firstValue; index * valueStep <= vMax; index += 1) {
    const y = valueToY(index * valueStep);
    context.moveTo(plotLeft, y);
    context.lineTo(plotLeft + plotWidth, y);
  }
  const firstTime = Math.ceil(tMin / timeStep);
  for (let index = firstTime; index * timeStep <= tMax; index += 1) {
    const x = timeToX(index * timeStep);
    context.moveTo(x, plotTop);
    context.lineTo(x, plotTop + plotHeight);
  }
  context.stroke();
  context.restore();

  const color = options?.color ?? DEFAULT_COLOR;
  const drawSeries = (values: number[], dashed: boolean): void => {
    context.save();
    context.strokeStyle = color;
    context.lineWidth = DEFAULT_LINE_WIDTH;
    context.lineJoin = "round";
    context.lineCap = "round";
    if (dashed) context.setLineDash([4, 3]);
    context.beginPath();
    let started = false;
    for (let index = 0; index < count; index += 1) {
      const value = values[index];
      const time = series.t[index];
      if (!Number.isFinite(value) || !Number.isFinite(time)) continue;
      const x = timeToX(time);
      const y = valueToY(value);
      if (!started) {
        context.moveTo(x, y);
        started = true;
      } else {
        context.lineTo(x, y);
      }
    }
    context.stroke();
    context.restore();
  };
  drawSeries(series.x, false);
  drawSeries(series.y, true);

  if (!showAxes) return;

  context.save();
  context.strokeStyle = AXIS_COLOR;
  context.lineWidth = 1;
  context.strokeRect(plotLeft, plotTop, plotWidth, plotHeight);

  context.fillStyle = LABEL_COLOR;
  context.font = "10px sans-serif";
  context.textBaseline = "middle";
  context.textAlign = "right";
  for (let index = firstValue; index * valueStep <= vMax; index += 1) {
    const value = index * valueStep;
    context.fillText(
      String(Number(value.toFixed(2))),
      plotLeft - 6,
      valueToY(value)
    );
  }
  context.textBaseline = "top";
  context.textAlign = "center";
  for (let index = firstTime; index * timeStep <= tMax; index += 1) {
    const time = index * timeStep;
    context.fillText(
      String(Number(time.toFixed(2))),
      timeToX(time),
      plotTop + plotHeight + 6
    );
  }

  // A legend, so the two lines can be told apart.
  const legendX = plotLeft + 8;
  const legendY = plotTop + 8;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.strokeStyle = color;
  context.lineWidth = DEFAULT_LINE_WIDTH;
  context.beginPath();
  context.moveTo(legendX, legendY);
  context.lineTo(legendX + 14, legendY);
  context.stroke();
  context.fillText("X", legendX + 18, legendY);

  context.setLineDash([4, 3]);
  context.beginPath();
  context.moveTo(legendX, legendY + 12);
  context.lineTo(legendX + 14, legendY + 12);
  context.stroke();
  context.fillText("Y", legendX + 18, legendY + 12);
  context.restore();
}

/**
 * Draw the density of the gaze over the screen.
 *
 * Every cell is shaded with the "hot" colormap the desktop uses, from the colour of an
 * empty cell up to the colour of the busiest one.
 */
export function drawHeatmap(
  context: CanvasRenderingContext2D,
  grid: HeatmapGrid,
  widthPx: number,
  heightPx: number,
  options?: { opacity?: number }
): void {
  clearCanvas(context, widthPx, heightPx);

  if (grid.columns === 0 || grid.rows === 0 || grid.max <= 0) return;
  if (widthPx <= 0 || heightPx <= 0) return;

  const cellWidth = widthPx / grid.columns;
  const cellHeight = heightPx / grid.rows;
  context.save();
  context.globalAlpha = options?.opacity ?? DEFAULT_HEATMAP_ALPHA;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const index = row * grid.columns + column;
      if (index >= grid.cells.length) continue;
      const count = grid.cells[index];
      context.fillStyle = hotColor(count / grid.max);
      // The cells overlap by a hair, so that the seams between them do not show.
      context.fillRect(
        column * cellWidth,
        row * cellHeight,
        cellWidth + 0.5,
        cellHeight + 0.5
      );
    }
  }
  context.restore();
}
