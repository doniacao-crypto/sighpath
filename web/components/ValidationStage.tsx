"use client";

/**
 * The fixed-head grid validation — the browser version of the desktop validation test
 * in src/validation.py and of its presentation in src/widgets/validation_widget.py.
 *
 * The patient looks at every point of a grid in turn and holds still there. The samples
 * of each point are collected and the library turns them into the accuracy, the spread
 * and the worst point of the run.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { ProtocolFrame, ProtocolStageHooks } from "./ProtocolStage";

import {
  computeValidationMetrics,
  validationPoints,
  type ValidationPointResult,
} from "../lib/validation";

import type { GazeModel } from "../lib/features";
import type { ScreenGeometry, ValidationSession } from "../lib/types";

/** The settings of the validation protocol. */
export interface ValidationSettings {
  /** The grid the patient is asked to look at. */
  pattern: "grid_9" | "grid_16" | "random_20";
  /** The share of the stage kept clear at the edges, as a fraction of the stage. */
  marginPercent: number;
  /** How many samples are collected at each point. */
  samplesPerPoint: number;
  /** How long the patient may look at a point, in milliseconds. */
  pointDurationMs: number;
  /** The time after the saccade that is skipped, in milliseconds. */
  settlingMs: number;
}

/** The settings the desktop app starts with (ValidationConfig in src/validation.py). */
export const DEFAULT_VALIDATION_SETTINGS: ValidationSettings = {
  pattern: "grid_9",
  marginPercent: 0.15,
  samplesPerPoint: 30,
  pointDurationMs: 2000,
  settlingMs: 500,
};

/** A finished validation run. */

export interface ValidationStageProps {
  /** The hooks of the shell; the stage installs its own. */
  hooksRef: RefObject<ProtocolStageHooks | null>;
  /** The gaze model; null when the tracker has not been calibrated yet. */
  model: GazeModel | null;
  /** The settings the stage starts with. */
  initialSettings: ValidationSettings;
  /** The finished run. */
  onComplete(session: ValidationSession): void;
  /** The operator left the protocol. */
  onCancel(): void;
}

/** How much a phase may fall short of its duration, in milliseconds. */
const PHASE_TOLERANCE_MS = 0.5;

/**
 * The running validation protocol.
 *
 * The desktop moves on to the next point when the time of the point is up, skips the
 * first samples after the saccade to the new point and collects the rest
 * (ValidationTest.update in src/validation.py).
 */
export class ValidationProtocol {
  private readonly settings: ValidationSettings;
  private readonly points: ValidationPointResult[] = [];
  private pointIndex = 0;
  private pointStart = 0;
  private screen: ScreenGeometry | null = null;

  constructor(settings: ValidationSettings) {
    this.settings = settings;
  }

  /** The points of the grid, with the samples collected at each of them. */
  get results(): ValidationPointResult[] {
    return this.points;
  }

  /** The point that is on the screen, or null before the first frame. */
  get currentPoint(): { x: number; y: number } | null {
    return this.points[this.pointIndex] ?? null;
  }

  /** The number of the point that is on the screen, counting from one. */
  get pointNumber(): number {
    return this.pointIndex + 1;
  }

  /** The number of points of the grid. */
  get pointCount(): number {
    return this.points.length;
  }

  /** The geometry of the stage the run happens on, or null before the first frame. */
  get stage(): ScreenGeometry | null {
    return this.screen;
  }

  /**
   * Feeds one camera frame into the protocol.
   *
   * Returns true when the last point is over, so the caller can compute the
   * measurements.
   */
  tick(frame: ProtocolFrame): boolean {
    // The grid depends on the size of the stage, which is only known once the camera
    // has drawn its first frame.
    if (this.points.length === 0) {
      if (frame.screen.widthPx <= 0 || frame.screen.heightPx <= 0) return false;
      const positions = validationPoints(
        this.settings.pattern,
        frame.screen.widthPx,
        frame.screen.heightPx,
        this.settings.marginPercent
      );
      for (const position of positions) {
        this.points.push({ x: position.x, y: position.y, samples: [] });
      }
      this.screen = frame.screen;
      this.pointStart = frame.timestamp;
    }

    // The desktop moves on to the next point when the time of the point is up.
    let elapsedMs = (frame.timestamp - this.pointStart) * 1000;
    if (elapsedMs >= this.settings.pointDurationMs - PHASE_TOLERANCE_MS) {
      this.pointIndex += 1;
      if (this.pointIndex >= this.points.length) return true;
      this.pointStart = frame.timestamp;
      elapsedMs = 0;
    }

    // The first samples after the saccade to the new point are skipped: the eye is
    // still moving and the estimate has not settled.
    if (elapsedMs < this.settings.settlingMs) return false;

    const point = this.points[this.pointIndex];
    if (point === undefined) return false;
    if (point.samples.length >= this.settings.samplesPerPoint) return false;
    if (frame.gaze === null) return false;

    point.samples.push({ x: frame.gaze.x, y: frame.gaze.y });
    return false;
  }
}

/** The screen the desktop sizes its stimuli for; the sizes are scaled from it. */
const REFERENCE_WIDTH_PX = 1920;
/** The diameter of the ring around the target, in reference pixels. */
const RING_DIAMETER_PX = 40;
/** The diameter of the target dot, in reference pixels. */
const TARGET_DIAMETER_PX = 15;

const PATTERNS: ValidationSettings["pattern"][] = [
  "grid_9",
  "grid_16",
  "random_20",
];
const MARGINS = [0.1, 0.15, 0.2];

export function ValidationStage({
  hooksRef,
  model,
  initialSettings,
  onComplete,
  onCancel,
}: ValidationStageProps) {
  const [settings, setSettings] = useState<ValidationSettings>(initialSettings);
  const [status, setStatus] = useState(
    "Press start when the patient is ready to look at the grid."
  );
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);

  const settingsRef = useRef<ValidationSettings>(initialSettings);
  const runningRef = useRef(false);
  const completedRef = useRef(false);
  const protocolRef = useRef<ValidationProtocol | null>(null);
  const runStartRef = useRef(0);
  const nowRef = useRef(0);
  const startedWallClockRef = useRef(0);
  const pointRef = useRef(0);

  /** Ends the run and reports the measurements of the points that were visited. */
  const completeRun = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    runningRef.current = false;
    setRunning(false);

    const protocol = protocolRef.current;
    const screen = protocol?.stage ?? null;
    if (screen === null || protocol === null) {
      // Nothing was measured, so there is no session to report.
      onCancel();
      return;
    }

    // Only the points that were actually visited carry samples, so the rest are
    // dropped before the measurements are computed.
    const points = protocol.results.filter((point) => point.samples.length > 0);
    if (points.length === 0) {
      onCancel();
      return;
    }

    const metrics = computeValidationMetrics(points, screen);
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `validation-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const session: ValidationSession = {
      protocol: "validation",
      id,
      startedAt: new Date(startedWallClockRef.current).toISOString(),
      screen,
      durationSeconds: Math.max(0, nowRef.current - runStartRef.current),
      points,
      metrics,
    };
    onComplete(session);
  }, [onCancel, onComplete]);

  const handleFrame = useCallback(
    (frame: ProtocolFrame) => {
      nowRef.current = frame.timestamp;
      if (!runningRef.current || completedRef.current) return;

      const protocol = protocolRef.current;
      if (protocol === null) return;
      if (runStartRef.current === 0) runStartRef.current = frame.timestamp;
      const finished = protocol.tick(frame);

      // The status follows the point, so it only changes when the point changes.
      if (protocol.pointNumber !== pointRef.current) {
        pointRef.current = protocol.pointNumber;
        setStatus(`Point ${protocol.pointNumber}/${protocol.pointCount}`);
        const ratio = (protocol.pointNumber - 1) / protocol.pointCount;
        setProgress(ratio);
      }

      if (finished) completeRun();
    },
    [completeRun]
  );

  const handleDraw = useCallback(
    (context: CanvasRenderingContext2D, width: number, _height: number) => {
      if (!runningRef.current) return;
      const protocol = protocolRef.current;
      if (protocol === null) return;
      const point = protocol.currentPoint;
      if (point === null) return;

      // The desktop draws a ring around the target dot, so the patient can see where
      // the point is without a second fixation mark.
      const scale = width / REFERENCE_WIDTH_PX;
      const ring = Math.max(10, Math.round(RING_DIAMETER_PX * scale));
      const dot = Math.max(5, Math.round(TARGET_DIAMETER_PX * scale));
      context.save();
      context.strokeStyle = "#64ff64";
      context.lineWidth = Math.max(1, Math.round(2 * scale));
      context.beginPath();
      context.arc(point.x, point.y, ring / 2, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = "#00ff00";
      context.beginPath();
      context.arc(point.x, point.y, dot / 2, 0, Math.PI * 2);
      context.fill();
      context.restore();
    },
    []
  );

  const controllerRef = useRef<ProtocolStageHooks | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = { onFrame: handleFrame, onDraw: handleDraw };
  }

  useEffect(() => {
    hooksRef.current = controllerRef.current;
    return () => {
      hooksRef.current = null;
    };
  }, [hooksRef]);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    completedRef.current = false;
    protocolRef.current = new ValidationProtocol(settingsRef.current);
    runStartRef.current = 0;
    nowRef.current = 0;
    startedWallClockRef.current = Date.now();
    pointRef.current = 0;
    setProgress(0);
    setStatus("Look at the point and hold still.");
    setRunning(true);
  }, []);

  const stop = useCallback(() => {
    if (!runningRef.current) return;
    runningRef.current = false;
    completeRun();
  }, [completeRun]);

  const updateSettings = useCallback((next: ValidationSettings) => {
    settingsRef.current = next;
    setSettings(next);
  }, []);

  return (
    <div>
      <div className="sp-status">
        <div>
          <h3 className="sp-subtitle">Gaze accuracy validation</h3>
          <p className="sp-text-dim">{status}</p>
        </div>
        {running ? (
          <button
            type="button"
            className="sp-button sp-button--danger"
            onClick={stop}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="sp-button sp-button--danger"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>

      {model === null && (
        <div className="sp-notice sp-notice--warn">
          <span className="sp-notice-title">No gaze model</span>
          <p>
            The tracker has not been calibrated on this patient yet, so the gaze
            estimate would be meaningless. Calibrate first.
          </p>
        </div>
      )}

      <div className="sp-notice sp-notice--warn">
        <span className="sp-notice-title">Provisional threshold</span>
        <p>
          The two degree limit this test is compared against is a provisional
          working value from the research build. It has not been clinically
          validated and must not be used for a diagnosis.
        </p>
      </div>

      <div className="sp-field-row">
        <div className="sp-field">
          <label className="sp-label" htmlFor="sp-validation-pattern">
            Pattern
          </label>
          <select
            id="sp-validation-pattern"
            className="sp-select"
            disabled={running}
            value={settings.pattern}
            onChange={(event) =>
              updateSettings({
                ...settingsRef.current,
                pattern: event.target.value as ValidationSettings["pattern"],
              })
            }
          >
            {PATTERNS.map((pattern) => (
              <option key={pattern} value={pattern}>
                {pattern.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>

        <div className="sp-field">
          <label className="sp-label" htmlFor="sp-validation-margin">
            Margin
          </label>
          <select
            id="sp-validation-margin"
            className="sp-select"
            disabled={running}
            value={settings.marginPercent}
            onChange={(event) =>
              updateSettings({
                ...settingsRef.current,
                marginPercent: Number(event.target.value),
              })
            }
          >
            {MARGINS.map((margin) => (
              <option key={margin} value={margin}>
                {Math.round(margin * 100)}%
              </option>
            ))}
          </select>
        </div>

        <div className="sp-field">
          <span className="sp-label">Samples per point</span>
          <span className="sp-text-dim">{settings.samplesPerPoint}</span>
        </div>

        <div className="sp-field">
          <span className="sp-label">Time per point</span>
          <span className="sp-text-dim">
            {(settings.pointDurationMs / 1000).toFixed(1)} s
          </span>
        </div>
      </div>

      <div className="sp-progress">
        <div
          className="sp-progress-bar"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <div className="sp-actions">
        <button
          type="button"
          className="sp-button sp-button--primary"
          onClick={start}
          disabled={running || model === null}
        >
          Start
        </button>
      </div>
    </div>
  );
}
