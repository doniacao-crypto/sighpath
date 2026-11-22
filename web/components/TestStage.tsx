"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { StageController, StageFrame } from "./App";

import { computePursuitMetrics } from "../lib/metrics";
import { DEFAULT_TEST_CONFIG, targetPosition } from "../lib/patterns";
import type { GazeModel } from "../lib/features";
import type {
  ScreenGeometry,
  TargetPattern,
  TestConfig,
  TestSession,
  TrackingFrame,
} from "../lib/types";

/** The nominal panel the degree metrics assume: a 16:9 screen seen from 60 cm. */
const NOMINAL_WIDTH_CM = 53.1;
const NOMINAL_HEIGHT_CM = 29.9;
const VIEWING_DISTANCE_CM = 60;
/** Radius of the target dot, in pixels. */
const TARGET_RADIUS_PX = 16;

const PATTERNS: TargetPattern[] = [
  "horizontal",
  "vertical",
  "circular",
  "figure_eight",
  "fixation",
];
const DURATIONS = [10, 20, 30];
const SPEEDS = [0.25, 0.5, 0.75, 1.0];

export interface TestStageProps {
  controllerRef: RefObject<StageController | null>;
  model: GazeModel | null;
  onComplete(session: TestSession): void;
  onCancel(): void;
}

export function TestStage({
  controllerRef,
  model,
  onComplete,
  onCancel,
}: TestStageProps) {
  const [config, setConfig] = useState<TestConfig>(DEFAULT_TEST_CONFIG);
  const [running, setRunning] = useState(false);
  const [clock, setClock] = useState("0.0 s / 10.0 s");
  const [elapsedRatio, setElapsedRatio] = useState(0);

  // The frame loop runs outside React, so the running state lives in refs as well.
  const configRef = useRef<TestConfig>(config);
  const runningRef = useRef(false);
  const framesRef = useRef<TrackingFrame[]>([]);
  const startRef = useRef(0);
  const nowRef = useRef(0);
  const startWallClockRef = useRef(0);
  const completedRef = useRef(false);
  const runStartedRef = useRef(false);
  const clockRef = useRef("");
  const ratioRef = useRef(0);

  const handleFrame = useCallback(
    (frame: StageFrame) => {
      nowRef.current = frame.timestamp;
      if (!runningRef.current || completedRef.current) return;

      const { width, height } = frame;
      if (width <= 0 || height <= 0) return;

      // The run starts on the first frame after the operator presses the button, so the
      // camera clock is the only sensible time base.
      if (!runStartedRef.current) {
        runStartedRef.current = true;
        startRef.current = frame.timestamp;
      }
      const elapsed = frame.timestamp - startRef.current;
      if (elapsed < 0) return;

      const current = configRef.current;
      const target = targetPosition(
        current.pattern,
        elapsed,
        width,
        height,
        current.speed
      );
      const sample = frame.sample;

      framesRef.current.push({
        timestamp: elapsed,
        targetX: target.x,
        targetY: target.y,
        gazeX: frame.gaze ? frame.gaze.x : null,
        gazeY: frame.gaze ? frame.gaze.y : null,
        headPitch: sample ? sample.headPitch : 0,
        headYaw: sample ? sample.headYaw : 0,
        faceDetected: sample ? sample.faceDetected : false,
      });

      const nextClock = `${elapsed.toFixed(1)} s / ${current.durationSeconds.toFixed(1)} s`;
      if (nextClock !== clockRef.current) {
        clockRef.current = nextClock;
        setClock(nextClock);
      }
      const nextRatio = Math.min(1, elapsed / current.durationSeconds);
      if (Math.abs(nextRatio - ratioRef.current) > 0.005) {
        ratioRef.current = nextRatio;
        setElapsedRatio(nextRatio);
      }

      if (elapsed >= current.durationSeconds) {
        completedRef.current = true;
        runningRef.current = false;
        setRunning(false);

        const screen: ScreenGeometry = {
          widthPx: width,
          heightPx: height,
          widthCm: NOMINAL_WIDTH_CM,
          heightCm: NOMINAL_HEIGHT_CM,
          viewingDistanceCm: VIEWING_DISTANCE_CM,
        };
        const frames = framesRef.current.slice();
        const metrics = computePursuitMetrics(frames, screen);
        const id =
          typeof crypto !== "undefined" &&
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `session-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const session: TestSession = {
          id,
          startedAt: new Date(startWallClockRef.current).toISOString(),
          pattern: current.pattern,
          durationSeconds: current.durationSeconds,
          screen,
          frames,
          metrics,
        };
        onComplete(session);
      }
    },
    [onComplete]
  );

  const handleDraw = useCallback(
    (context: CanvasRenderingContext2D, width: number, height: number) => {
      if (!runningRef.current || !runStartedRef.current) return;
      const elapsed = nowRef.current - startRef.current;
      if (elapsed < 0) return;
      const current = configRef.current;
      const target = targetPosition(
        current.pattern,
        elapsed,
        width,
        height,
        current.speed
      );

      context.save();
      context.beginPath();
      context.arc(target.x, target.y, TARGET_RADIUS_PX, 0, Math.PI * 2);
      context.fillStyle = "#ffd250";
      context.fill();
      context.restore();
    },
    []
  );

  const stageController = useRef<StageController | null>(null);
  if (stageController.current === null) {
    stageController.current = { onFrame: handleFrame, onDraw: handleDraw };
  }

  useEffect(() => {
    controllerRef.current = stageController.current;
    return () => {
      controllerRef.current = null;
    };
  }, [controllerRef]);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    completedRef.current = false;
    runStartedRef.current = false;
    framesRef.current = [];
    startWallClockRef.current = Date.now();
    clockRef.current = "";
    ratioRef.current = 0;
    setClock(`0.0 s / ${configRef.current.durationSeconds.toFixed(1)} s`);
    setElapsedRatio(0);
    setRunning(true);
  }, []);

  const updateConfig = useCallback((next: TestConfig) => {
    configRef.current = next;
    setConfig(next);
  }, []);

  return (
    <section className="sp-card">
      <div className="sp-status">
        <div>
          <h2 className="sp-subtitle">Pursuit test</h2>
          <p className="sp-text-dim">
            The patient follows the yellow dot with the eyes only. The head
            should stay still.
          </p>
        </div>
        {!running && (
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

      <div className="sp-field-row">
        <div className="sp-field">
          <label className="sp-label" htmlFor="sp-pattern">
            Pattern
          </label>
          <select
            id="sp-pattern"
            className="sp-select"
            disabled={running}
            value={config.pattern}
            onChange={(event) =>
              updateConfig({
                ...configRef.current,
                pattern: event.target.value as TargetPattern,
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
          <label className="sp-label" htmlFor="sp-duration">
            Duration
          </label>
          <select
            id="sp-duration"
            className="sp-select"
            disabled={running}
            value={config.durationSeconds}
            onChange={(event) =>
              updateConfig({
                ...configRef.current,
                durationSeconds: Number(event.target.value),
              })
            }
          >
            {DURATIONS.map((duration) => (
              <option key={duration} value={duration}>
                {duration} s
              </option>
            ))}
          </select>
        </div>

        <div className="sp-field">
          <label className="sp-label" htmlFor="sp-speed">
            Speed
          </label>
          <select
            id="sp-speed"
            className="sp-select"
            disabled={running}
            value={config.speed}
            onChange={(event) =>
              updateConfig({
                ...configRef.current,
                speed: Number(event.target.value),
              })
            }
          >
            {SPEEDS.map((speed) => (
              <option key={speed} value={speed}>
                {speed.toFixed(2)}×
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="sp-progress" aria-hidden="true">
        <div
          className="sp-progress-bar"
          style={{ width: `${elapsedRatio * 100}%` }}
        />
      </div>

      <div className="sp-status" style={{ marginTop: "0.75rem" }}>
        <span className="sp-status-strong">{clock}</span>
        <div className="sp-actions" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="sp-button sp-button--primary"
            onClick={start}
            disabled={running || model === null}
          >
            {running ? "Test running" : "Start test"}
          </button>
        </div>
      </div>
    </section>
  );
}
