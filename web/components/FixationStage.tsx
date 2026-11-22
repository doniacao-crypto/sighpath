"use client";

/**
 * The fixation stability protocol — the browser version of the FIXATION pattern of the
 * desktop pursuit test (src/smooth_pursuit_test.py) measured with the metrics of
 * src/metrics.py.
 *
 * The patient holds a fixation cross in the middle of the screen while the gaze is
 * recorded. The library turns those frames into the bivariate contour ellipse area, the
 * microsaccade rate and the stability of the fixation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { ProtocolFrame, ProtocolStageHooks } from "./ProtocolStage";

import { computeFixationMetrics } from "../lib/fixation";

import type { GazeModel } from "../lib/features";
import type {
  FixationSession,
  ScreenGeometry,
  TrackingFrame,
} from "../lib/types";

/** The settings of the fixation protocol. */
export interface FixationSettings {
  /** How long the patient holds the fixation, in seconds. */
  durationSeconds: number;
}

/**
 * The settings the stage starts with. The desktop runs a test for ten seconds
 * (DEFAULT_TEST_DURATION_SECONDS in src/constants.py); a longer hold gives the
 * bivariate contour ellipse a steadier estimate, so twenty seconds is the default here.
 */
export const DEFAULT_FIXATION_SETTINGS: FixationSettings = {
  durationSeconds: 20,
};

/** A finished fixation run. */

export interface FixationStageProps {
  /** The hooks of the shell; the stage installs its own. */
  hooksRef: RefObject<ProtocolStageHooks | null>;
  /** The gaze model; null when the tracker has not been calibrated yet. */
  model: GazeModel | null;
  /** The settings the stage starts with. */
  initialSettings: FixationSettings;
  /** The finished run. */
  onComplete(session: FixationSession): void;
  /** The operator left the protocol. */
  onCancel(): void;
}

/** How much the hold may fall short of its duration, in seconds. */
const DURATION_TOLERANCE_S = 0.0005;

/**
 * The running fixation protocol.
 *
 * The fixation point is the centre of the screen, the same place the desktop keeps
 * the target of its FIXATION pattern. Every frame is recorded, with or without a gaze
 * estimate, because the library needs the whole series to tell how long the eye was
 * steady and how long it was not.
 */
export class FixationProtocol {
  private readonly settings: FixationSettings;
  private readonly recorded: TrackingFrame[] = [];
  private screen: ScreenGeometry | null = null;
  private started = 0;
  private last = 0;

  constructor(settings: FixationSettings) {
    this.settings = settings;
  }

  /** The frames that were recorded. */
  get frames(): TrackingFrame[] {
    return this.recorded;
  }

  /** The geometry of the stage the run happens on, or null before the first frame. */
  get stage(): ScreenGeometry | null {
    return this.screen;
  }

  /** How long the patient has held the fixation, in seconds. */
  get elapsedSeconds(): number {
    if (this.screen === null) return 0;
    return Math.max(0, this.last - this.started);
  }

  /**
   * Feeds one camera frame into the protocol.
   *
   * Returns true when the hold is over, so the caller can compute the measurements.
   */
  tick(frame: ProtocolFrame): boolean {
    // The size of the stage is only known once the camera has drawn a frame.
    if (this.screen === null) {
      if (frame.screen.widthPx <= 0 || frame.screen.heightPx <= 0) return false;
      this.screen = frame.screen;
      this.started = frame.timestamp;
    }

    this.last = frame.timestamp;
    const elapsed = frame.timestamp - this.started;
    if (elapsed < 0) return false;

    const fixationX = Math.floor(this.screen.widthPx / 2);
    const fixationY = Math.floor(this.screen.heightPx / 2);
    const sample = frame.sample;
    this.recorded.push({
      timestamp: elapsed,
      targetX: fixationX,
      targetY: fixationY,
      gazeX: frame.gaze === null ? null : frame.gaze.x,
      gazeY: frame.gaze === null ? null : frame.gaze.y,
      headPitch: sample === null ? 0 : sample.headPitch,
      headYaw: sample === null ? 0 : sample.headYaw,
      faceDetected: sample === null ? false : sample.faceDetected,
    });

    return elapsed >= this.settings.durationSeconds - DURATION_TOLERANCE_S;
  }
}

/** The screen the desktop sizes its stimuli for; the sizes are scaled from it. */
const REFERENCE_WIDTH_PX = 1920;
/** The length of one arm of the fixation cross, in reference pixels. */
const FIXATION_ARM_PX = 20;
/** The thickness of the fixation cross, in reference pixels. */
const FIXATION_LINE_PX = 3;

const DURATIONS = [10, 20, 30];

export function FixationStage({
  hooksRef,
  model,
  initialSettings,
  onComplete,
  onCancel,
}: FixationStageProps) {
  const [settings, setSettings] = useState<FixationSettings>(initialSettings);
  const [status, setStatus] = useState(
    "Press start when the patient is ready to hold the fixation."
  );
  const [clock, setClock] = useState("0.0 s / 20.0 s");
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);

  const settingsRef = useRef<FixationSettings>(initialSettings);
  const runningRef = useRef(false);
  const completedRef = useRef(false);
  const protocolRef = useRef<FixationProtocol | null>(null);
  const nowRef = useRef(0);
  const startedWallClockRef = useRef(0);
  const clockRef = useRef("");
  const progressRef = useRef(0);

  /** Ends the run and reports the measurements of the frames that were recorded. */
  const completeRun = useCallback(
    (elapsed: number) => {
      if (completedRef.current) return;
      completedRef.current = true;
      runningRef.current = false;
      setRunning(false);

      const protocol = protocolRef.current;
      const screen = protocol?.stage ?? null;
      const frames = protocol?.frames ?? [];
      if (screen === null || frames.length === 0) {
        // Nothing was recorded, so there is no session to report.
        onCancel();
        return;
      }

      const fixationX = Math.floor(screen.widthPx / 2);
      const fixationY = Math.floor(screen.heightPx / 2);
      const metrics = computeFixationMetrics(frames, screen, {
        x: fixationX,
        y: fixationY,
      });
      const id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `fixation-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const session: FixationSession = {
        protocol: "fixation",
        id,
        startedAt: new Date(startedWallClockRef.current).toISOString(),
        screen,
        durationSeconds: elapsed,
        frames,
        metrics,
      };
      onComplete(session);
    },
    [onCancel, onComplete]
  );

  const handleFrame = useCallback(
    (frame: ProtocolFrame) => {
      nowRef.current = frame.timestamp;
      if (!runningRef.current || completedRef.current) return;

      const protocol = protocolRef.current;
      if (protocol === null) return;
      const finished = protocol.tick(frame);

      const duration = settingsRef.current.durationSeconds;
      const elapsed = protocol.elapsedSeconds;
      const nextClock = `${elapsed.toFixed(1)} s / ${duration.toFixed(1)} s`;
      if (nextClock !== clockRef.current) {
        clockRef.current = nextClock;
        setClock(nextClock);
      }

      const ratio = Math.min(1, elapsed / duration);
      if (Math.abs(ratio - progressRef.current) > 0.005) {
        progressRef.current = ratio;
        setProgress(ratio);
      }

      if (finished) completeRun(elapsed);
    },
    [completeRun]
  );

  const handleDraw = useCallback(
    (context: CanvasRenderingContext2D, width: number, height: number) => {
      if (!runningRef.current) return;

      // The cross sits in the middle of the stage, the same place the desktop keeps
      // the target of its FIXATION pattern.
      drawFixationCross(
        context,
        Math.floor(width / 2),
        Math.floor(height / 2),
        width
      );
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
    protocolRef.current = new FixationProtocol(settingsRef.current);
    nowRef.current = 0;
    startedWallClockRef.current = Date.now();
    clockRef.current = "";
    progressRef.current = 0;
    setProgress(0);
    setClock(`0.0 s / ${settingsRef.current.durationSeconds.toFixed(1)} s`);
    setStatus("Hold the fixation cross. Keep the head still.");
    setRunning(true);
  }, []);

  const stop = useCallback(() => {
    if (!runningRef.current) return;
    runningRef.current = false;
    const protocol = protocolRef.current;
    if (protocol === null || protocol.frames.length === 0) {
      // Nothing was recorded, so there is no session to report.
      onCancel();
      return;
    }
    completeRun(protocol.elapsedSeconds);
  }, [completeRun, onCancel]);

  const updateSettings = useCallback((next: FixationSettings) => {
    settingsRef.current = next;
    setSettings(next);
  }, []);

  return (
    <div>
      <div className="sp-status">
        <div>
          <h3 className="sp-subtitle">Fixation stability</h3>
          <p className="sp-text-dim">{status}</p>
          <p className="sp-text-dim">{clock}</p>
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

      <div className="sp-field-row">
        <div className="sp-field">
          <label className="sp-label" htmlFor="sp-fixation-duration">
            Duration
          </label>
          <select
            id="sp-fixation-duration"
            className="sp-select"
            disabled={running}
            value={settings.durationSeconds}
            onChange={(event) =>
              updateSettings({
                ...settingsRef.current,
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

/** The white fixation cross, the same mark the desktop uses for its saccade fixation. */
function drawFixationCross(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  widthPx: number
): void {
  const scale = widthPx / REFERENCE_WIDTH_PX;
  const arm = Math.max(6, Math.round(FIXATION_ARM_PX * scale));
  context.save();
  context.strokeStyle = "#ffffff";
  context.lineWidth = Math.max(1, Math.round(FIXATION_LINE_PX * scale));
  context.beginPath();
  context.moveTo(x - arm, y);
  context.lineTo(x + arm, y);
  context.moveTo(x, y - arm);
  context.lineTo(x, y + arm);
  context.stroke();
  context.restore();
}
