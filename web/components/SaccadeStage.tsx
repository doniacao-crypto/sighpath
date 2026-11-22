"use client";

/**
 * The saccade protocol — a port of the desktop test in src/saccade_test.py and of its
 * presentation in src/widgets/saccade_widget.py.
 *
 * A trial runs through four phases: the fixation cross is shown, the screen goes blank
 * for the gap, the target appears beside the fixation point and the patient has the
 * response window to look at it. The gaze is collected from the moment the target
 * appears until the response window closes; the library turns those samples into the
 * measurements.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { ProtocolFrame, ProtocolStageHooks } from "./ProtocolStage";

import {
  computeSaccadeMetrics,
  planSaccadeTrials,
  type SaccadeTrialPlan,
  type SaccadeTrialRecord,
} from "../lib/saccade";

import type { GazeModel } from "../lib/features";
import type { SaccadeSession, ScreenGeometry } from "../lib/types";

/** The settings of the saccade protocol. */
export interface SaccadeSettings {
  /** How many trials the test runs. */
  numTrials: number;
  /** The paradigm: a horizontal or a vertical pro-saccade, or an anti-saccade. */
  type: "horizontal" | "vertical" | "antisaccade";
  /** The target eccentricities the trials are drawn from, in degrees. */
  eccentricitiesDeg: number[];
  /** Whether the direction of the target is drawn at random. */
  randomizeDirection: boolean;
  /** Whether the fixation time is jittered, so the patient cannot count the trials. */
  randomizeTiming: boolean;
  /** The seed of the trial sequence, so a run can be repeated. */
  seed: number;
  /** How long the fixation cross is shown, in milliseconds. */
  fixationDurationMs: number;
  /** How long the screen is blank between the fixation and the target, in milliseconds. */
  gapDurationMs: number;
  /** How long the target is shown, in milliseconds. */
  targetDurationMs: number;
  /** How long the patient has to look at the target, in milliseconds. */
  responseWindowMs: number;
}

/** The settings the desktop app starts with (SaccadeTestConfig in src/saccade_test.py). */
export const DEFAULT_SACCADE_SETTINGS: SaccadeSettings = {
  numTrials: 20,
  type: "horizontal",
  eccentricitiesDeg: [10],
  randomizeDirection: true,
  randomizeTiming: true,
  seed: 1,
  fixationDurationMs: 1000,
  gapDurationMs: 200,
  targetDurationMs: 1000,
  responseWindowMs: 800,
};

/** A finished saccade run. */

export interface SaccadeStageProps {
  /** The hooks of the shell; the stage installs its own. */
  hooksRef: RefObject<ProtocolStageHooks | null>;
  /** The gaze model; null when the tracker has not been calibrated yet. */
  model: GazeModel | null;
  /** The settings the stage starts with. */
  initialSettings: SaccadeSettings;
  /** The finished run. */
  onComplete(session: SaccadeSession): void;
  /** The operator left the protocol. */
  onCancel(): void;
}

/** The phases of a trial, named as the desktop names them. */
export type SaccadePhase = "fixation" | "gap" | "target" | "response";

/** One recorded gaze sample of a trial. */
type SaccadeSample = SaccadeTrialRecord["samples"][number];

/** How much a phase may fall short of its duration, in milliseconds. */
const PHASE_TOLERANCE_MS = 0.5;

/**
 * The running saccade protocol.
 *
 * The trial sequence is the one the desktop builds: a fixation period, a gap, the target
 * and the response window. The gaze is collected from the moment the target appears
 * until the response window closes, exactly as SaccadeTest.update does.
 */
export class SaccadeProtocol {
  private readonly settings: SaccadeSettings;
  private readonly records: SaccadeTrialRecord[] = [];
  private plans: SaccadeTrialPlan[] | null = null;
  private trialIndex = 0;
  private phase: SaccadePhase = "fixation";
  private phaseStart = 0;
  private targetOnset = 0;
  private samples: SaccadeSample[] = [];

  constructor(settings: SaccadeSettings) {
    this.settings = settings;
  }

  /** The number of trials the test runs. */
  get numTrials(): number {
    return this.settings.numTrials;
  }

  /** The trial that is on the screen, or null before the first frame. */
  get currentPlan(): SaccadeTrialPlan | null {
    if (this.plans === null) return null;
    return this.plans[this.trialIndex] ?? null;
  }

  /** The phase the trial is in. */
  get currentPhase(): SaccadePhase {
    return this.phase;
  }

  /** The number of the trial that is on the screen, counting from one. */
  get trialNumber(): number {
    return this.trialIndex + 1;
  }

  /** The trials that were finished. */
  get results(): SaccadeTrialRecord[] {
    return this.records;
  }

  /**
   * Feeds one camera frame into the protocol.
   *
   * Returns true when the last trial is over, so the caller can compute the
   * measurements.
   */
  tick(frame: ProtocolFrame): boolean {
    // The trial sequence needs the size of the stage, which is only known once the
    // camera has drawn its first frame.
    if (this.plans === null) {
      if (frame.screen.widthPx <= 0 || frame.screen.heightPx <= 0) return false;
      this.plans = planSaccadeTrials({
        numTrials: this.settings.numTrials,
        type: this.settings.type,
        eccentricitiesDeg: this.settings.eccentricitiesDeg,
        randomizeDirection: this.settings.randomizeDirection,
        randomizeTiming: this.settings.randomizeTiming,
        seed: this.settings.seed,
        screen: frame.screen,
        fixationDurationMs: this.settings.fixationDurationMs,
        gapDurationMs: this.settings.gapDurationMs,
        targetDurationMs: this.settings.targetDurationMs,
        responseWindowMs: this.settings.responseWindowMs,
      });
      this.phaseStart = frame.timestamp;
    }

    const plans = this.plans;
    const plan = plans[this.trialIndex];
    if (plan === undefined) return false;

    // The desktop collects the gaze from the moment the target appears until the
    // response window closes (SaccadeTest.update in src/saccade_test.py).
    if (this.phase === "target" || this.phase === "response") {
      if (frame.gaze !== null) {
        this.samples.push({
          x: frame.gaze.x,
          y: frame.gaze.y,
          t: frame.timestamp,
        });
      }
    }

    const elapsedMs = (frame.timestamp - this.phaseStart) * 1000;
    // The times come from a float clock, so a phase must not slip a whole frame
    // because a rounding error left it a fraction of a millisecond short.
    if (elapsedMs < phaseDurationMs(this.phase, plan) - PHASE_TOLERANCE_MS) {
      return false;
    }

    if (this.phase === "fixation") {
      // A gap of zero makes it an overlap paradigm: the target appears while the
      // fixation cross is still on the screen.
      if (plan.gapDurationMs > 0) {
        this.phase = "gap";
      } else {
        this.phase = "target";
        this.targetOnset = frame.timestamp;
      }
      this.phaseStart = frame.timestamp;
      return false;
    }

    if (this.phase === "gap") {
      this.phase = "target";
      this.targetOnset = frame.timestamp;
      this.phaseStart = frame.timestamp;
      return false;
    }

    if (this.phase === "target") {
      this.phase = "response";
      this.phaseStart = frame.timestamp;
      return false;
    }

    // The response window has closed, so the trial is over.
    const samples = this.samples;
    const last = samples.length > 0 ? samples[samples.length - 1] : null;
    this.records.push({
      plan,
      samples: samples.slice(),
      targetOnsetT: this.targetOnset,
      // The desktop has no button to press: the response window is the time the gaze is
      // collected. The last estimate is where the patient was looking when it closed.
      responseX: last === null ? null : last.x,
      responseY: last === null ? null : last.y,
      responseT: last === null ? null : last.t,
    });
    this.samples = [];
    this.trialIndex += 1;

    if (this.trialIndex >= plans.length) return true;

    this.phase = "fixation";
    this.phaseStart = frame.timestamp;
    return false;
  }
}

/** The screen the desktop sizes its stimuli for; the sizes are scaled from it. */
const REFERENCE_WIDTH_PX = 1920;
/** The length of one arm of the fixation cross, in reference pixels. */
const FIXATION_ARM_PX = 20;
/** The thickness of the fixation cross, in reference pixels. */
const FIXATION_LINE_PX = 3;
/** The diameter of the target, in reference pixels. */
const TARGET_DIAMETER_PX = 25;

const TRIAL_COUNTS = [10, 20, 30];
const ECCENTRICITIES_DEG = [5, 10, 15];
const PROTOCOL_TYPES: SaccadeSettings["type"][] = [
  "horizontal",
  "vertical",
  "antisaccade",
];

export function SaccadeStage({
  hooksRef,
  model,
  initialSettings,
  onComplete,
  onCancel,
}: SaccadeStageProps) {
  const [settings, setSettings] = useState<SaccadeSettings>(initialSettings);
  const [status, setStatus] = useState(
    "Press start when the patient is ready to look at the screen."
  );
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const settingsRef = useRef<SaccadeSettings>(initialSettings);
  const runningRef = useRef(false);
  const completedRef = useRef(false);
  const protocolRef = useRef<SaccadeProtocol | null>(null);
  const screenRef = useRef<ScreenGeometry | null>(null);
  const runStartRef = useRef(0);
  const nowRef = useRef(0);
  const startedWallClockRef = useRef(0);
  const phaseRef = useRef("");

  /** Ends the run and reports the measurements of the trials that were finished. */
  const completeRun = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    runningRef.current = false;
    setRunning(false);

    const screen = screenRef.current;
    const records = protocolRef.current?.results ?? [];
    if (screen === null || records.length === 0) {
      // Nothing was measured, so there is no session to report.
      onCancel();
      return;
    }

    const metrics = computeSaccadeMetrics(records, screen);
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `saccade-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const session: SaccadeSession = {
      protocol: "saccade",
      id,
      startedAt: new Date(startedWallClockRef.current).toISOString(),
      screen,
      durationSeconds: Math.max(0, nowRef.current - runStartRef.current),
      records,
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
      const finished = protocol.tick(frame);
      if (screenRef.current === null) {
        screenRef.current = frame.screen;
        runStartRef.current = frame.timestamp;
      }

      // The status follows the phase, so it only changes when the phase changes.
      const phase = `${protocol.trialNumber}/${protocol.numTrials} - ${protocol.currentPhase}`;
      if (phase !== phaseRef.current) {
        phaseRef.current = phase;
        setStatus(`Trial ${phase}`);
        const ratio = protocol.results.length / protocol.numTrials;
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
      const plan = protocol.currentPlan;
      if (plan === null) return;

      // The gap phase shows nothing at all: the fixation cross is gone and the target
      // has not appeared yet (get_display_state in src/saccade_test.py).
      if (protocol.currentPhase === "fixation") {
        drawFixationCross(context, plan.fixateX, plan.fixateY, width);
      } else if (
        protocol.currentPhase === "target" ||
        protocol.currentPhase === "response"
      ) {
        drawTarget(context, plan.targetX, plan.targetY, width);
      }
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
    protocolRef.current = new SaccadeProtocol(settingsRef.current);
    screenRef.current = null;
    runStartRef.current = 0;
    nowRef.current = 0;
    startedWallClockRef.current = Date.now();
    phaseRef.current = "";
    setProgress(0);
    setStatus(`Trial 1/${settingsRef.current.numTrials} - fixation`);
    setRunning(true);
  }, []);

  const stop = useCallback(() => {
    if (!runningRef.current) return;
    runningRef.current = false;
    const records = protocolRef.current?.results ?? [];
    if (records.length === 0) {
      // The first trial was not finished, so there is nothing to measure yet.
      onCancel();
      return;
    }
    completeRun();
  }, [completeRun, onCancel]);

  const updateSettings = useCallback((next: SaccadeSettings) => {
    settingsRef.current = next;
    setSettings(next);
  }, []);

  return (
    <div>
      <div className="sp-status">
        <div>
          <h3 className="sp-subtitle">Saccade test</h3>
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

      <div className="sp-field-row">
        <div className="sp-field">
          <label className="sp-label" htmlFor="sp-saccade-trials">
            Trials
          </label>
          <select
            id="sp-saccade-trials"
            className="sp-select"
            disabled={running}
            value={settings.numTrials}
            onChange={(event) =>
              updateSettings({
                ...settingsRef.current,
                numTrials: Number(event.target.value),
              })
            }
          >
            {TRIAL_COUNTS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </div>

        <div className="sp-field">
          <label className="sp-label" htmlFor="sp-saccade-type">
            Paradigm
          </label>
          <select
            id="sp-saccade-type"
            className="sp-select"
            disabled={running}
            value={settings.type}
            onChange={(event) =>
              updateSettings({
                ...settingsRef.current,
                type: event.target.value as SaccadeSettings["type"],
              })
            }
          >
            {PROTOCOL_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div className="sp-field">
          <label className="sp-label" htmlFor="sp-saccade-eccentricity">
            Eccentricity
          </label>
          <select
            id="sp-saccade-eccentricity"
            className="sp-select"
            disabled={running}
            value={settings.eccentricitiesDeg[0] ?? 10}
            onChange={(event) =>
              updateSettings({
                ...settingsRef.current,
                eccentricitiesDeg: [Number(event.target.value)],
              })
            }
          >
            {ECCENTRICITIES_DEG.map((eccentricity) => (
              <option key={eccentricity} value={eccentricity}>
                {eccentricity}°
              </option>
            ))}
          </select>
        </div>

        <div className="sp-field">
          <label className="sp-label" htmlFor="sp-saccade-direction">
            Random direction
          </label>
          <input
            id="sp-saccade-direction"
            type="checkbox"
            disabled={running}
            checked={settings.randomizeDirection}
            onChange={(event) =>
              updateSettings({
                ...settingsRef.current,
                randomizeDirection: event.target.checked,
              })
            }
          />
        </div>

        <div className="sp-field">
          <label className="sp-label" htmlFor="sp-saccade-timing">
            Random timing
          </label>
          <input
            id="sp-saccade-timing"
            type="checkbox"
            disabled={running}
            checked={settings.randomizeTiming}
            onChange={(event) =>
              updateSettings({
                ...settingsRef.current,
                randomizeTiming: event.target.checked,
              })
            }
          />
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

/** How long the current phase of a trial lasts, in milliseconds. */
function phaseDurationMs(phase: SaccadePhase, plan: SaccadeTrialPlan): number {
  switch (phase) {
    case "fixation":
      return plan.fixationDurationMs;
    case "gap":
      return plan.gapDurationMs;
    case "target":
      return plan.targetDurationMs;
    case "response":
      return plan.responseWindowMs;
  }
}

/** The white fixation cross of the desktop widget. */
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

/** The yellow target of the desktop widget. */
function drawTarget(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  widthPx: number
): void {
  const scale = widthPx / REFERENCE_WIDTH_PX;
  const diameter = Math.max(6, Math.round(TARGET_DIAMETER_PX * scale));
  context.save();
  context.fillStyle = "#ffff00";
  context.beginPath();
  context.arc(x, y, diameter / 2, 0, Math.PI * 2);
  context.fill();
  context.restore();
}
