"use client";

/**
 * The results of any of the four protocols.
 *
 * The desktop app prints a report per protocol (generate_saccade_report,
 * generate_validation_report and the pursuit report in src/smooth_pursuit_test.py) and
 * offers the gaze trace in a separate window. This component brings both together for
 * the browser: the measurements of the run, the trace of the gaze and the actions the
 * operator needs afterwards.
 */

import { useMemo } from "react";

import { TrajectoryPanel } from "./TrajectoryPanel";

import { PROTOCOL_LABELS } from "./ProtocolStage";
import type {
  FixationSession,
  ProtocolId,
  ProtocolSession,
  SaccadeSession,
  ValidationSession,
} from "./ProtocolStage";

import type { TestSession, TrackingFrame } from "../lib/types";

export interface ProtocolResultsProps {
  /** The protocol the session belongs to. */
  protocol: ProtocolId;
  /** The finished run. */
  session: ProtocolSession;
  /** The operator wants to run another test. */
  onRunAnother(): void;
  /** The operator wants to go back to the start screen. */
  onHome(): void;
}

/** One measurement of the run. */
interface Reading {
  label: string;
  value: string;
  unit: string;
  note: string;
}

export function ProtocolResults({
  protocol,
  session,
  onRunAnother,
  onHome,
}: ProtocolResultsProps) {
  const readings = useMemo(
    () => readingsFor(protocol, session),
    [protocol, session]
  );
  const frames = useMemo(() => framesOf(session), [session]);

  const exportSession = () => {
    const payload = JSON.stringify(session, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = session.startedAt.slice(0, 19).replace(/[:T]/g, "-");
    const link = document.createElement("a");
    link.href = url;
    link.download = `sightpath-${protocol}-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="sp-card">
      <div className="sp-status">
        <div>
          <h2 className="sp-subtitle">{PROTOCOL_LABELS[protocol]} results</h2>
          <p className="sp-text-dim">
            {new Date(session.startedAt).toLocaleString()} ·{" "}
            {session.durationSeconds.toFixed(1)} s
          </p>
        </div>
      </div>

      <div className="sp-notice sp-notice--warn">
        <span className="sp-notice-title">Provisional thresholds</span>
        <p>
          The limits these measurements are compared against are provisional
          working values from the research build. They have not been clinically
          validated and must not be used for a diagnosis.
        </p>
      </div>

      <div className="sp-stats">
        {readings.map((reading) => (
          <div className="sp-stat" key={reading.label}>
            <div className="sp-stat-label">{reading.label}</div>
            <div className="sp-stat-value">
              {reading.value}
              <span className="sp-stat-unit">{reading.unit}</span>
            </div>
            <div className="sp-stat-note">{reading.note}</div>
          </div>
        ))}
      </div>

      {readings.length === 0 && (
        <p className="sp-empty">
          This session does not hold {PROTOCOL_LABELS[protocol]} measurements.
        </p>
      )}

      {isSaccadeSession(session) && <SaccadeTrialList session={session} />}

      {isValidationSession(session) && (
        <ValidationPointList session={session} />
      )}

      {frames !== null && frames.length > 0 && (
        <TrajectoryPanel
          frames={frames}
          width={session.screen.widthPx}
          height={session.screen.heightPx}
        />
      )}

      <div className="sp-actions">
        <button
          type="button"
          className="sp-button sp-button--primary"
          onClick={onRunAnother}
        >
          Run another test
        </button>
        <button
          type="button"
          className="sp-button"
          onClick={() => window.print()}
          title="Print the report, or save it as a PDF from the print dialog"
        >
          Print / Save as PDF
        </button>
        <button type="button" className="sp-button" onClick={exportSession}>
          Export session (JSON)
        </button>
        <button type="button" className="sp-button" onClick={onHome}>
          Back to home
        </button>
      </div>
    </section>
  );
}

/** The trials of a saccade run, one line each. */
function SaccadeTrialList({ session }: { session: SaccadeSession }) {
  return (
    <div>
      <h3 className="sp-subtitle">Trials</h3>
      <ul>
        {session.metrics.perTrial.map((trial) => (
          <li className="sp-history-item" key={trial.index}>
            <div>
              <div className="sp-history-pattern">
                Trial {trial.index + 1} ·{" "}
                {session.records[trial.index]?.plan.type}
              </div>
              <div className="sp-history-meta">
                Latency{" "}
                {trial.latencyMs === null
                  ? "—"
                  : `${trial.latencyMs.toFixed(0)} ms`}{" "}
                · Duration{" "}
                {trial.durationMs === null
                  ? "—"
                  : `${trial.durationMs.toFixed(0)} ms`}
                {trial.anticipatory ? " · anticipatory" : ""}
                {trial.express ? " · express" : ""}
              </div>
            </div>
            <div className="sp-history-metrics">
              {trial.directionCorrect === null
                ? "No saccade detected"
                : trial.directionCorrect
                  ? "Correct direction"
                  : "Wrong direction"}
              {" · "}
              {trial.accuracyDeg === null
                ? "—"
                : `${trial.accuracyDeg.toFixed(2)}°`}
              {" · "}
              {trial.peakVelocityDegS === null
                ? "—"
                : `${trial.peakVelocityDegS.toFixed(0)}°/s`}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The points of a validation run, one line each. */
function ValidationPointList({ session }: { session: ValidationSession }) {
  return (
    <div>
      <h3 className="sp-subtitle">Points</h3>
      <ul>
        {session.metrics.perPoint.map((point, index) => (
          <li
            className="sp-history-item"
            key={`${point.x}-${point.y}-${index}`}
          >
            <div>
              <div className="sp-history-pattern">Point {index + 1}</div>
              <div className="sp-history-meta">
                Mean {point.meanX.toFixed(0)}, {point.meanY.toFixed(0)} px ·
                Spread {point.stdDeg.toFixed(2)}°
              </div>
            </div>
            <div className="sp-history-metrics">
              Error {point.errorDeg.toFixed(2)}°
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The measurements of the session, in the order the protocol reports them. */
function readingsFor(
  protocol: ProtocolId,
  session: ProtocolSession
): Reading[] {
  switch (protocol) {
    case "pursuit":
      return isPursuitSession(session) ? pursuitReadings(session) : [];
    case "saccade":
      return isSaccadeSession(session) ? saccadeReadings(session) : [];
    case "fixation":
      return isFixationSession(session) ? fixationReadings(session) : [];
    case "validation":
      return isValidationSession(session) ? validationReadings(session) : [];
  }
}

/** The frames of the run, for the protocols that record them. */
function framesOf(session: ProtocolSession): TrackingFrame[] | null {
  if (isPursuitSession(session)) return session.frames;
  if (isFixationSession(session)) return session.frames;
  return null;
}

function pursuitReadings(session: TestSession): Reading[] {
  const metrics = session.metrics;
  return [
    {
      label: "Tracking rate",
      value: metrics.trackingRatio.toFixed(1),
      unit: "%",
      note: "Frames with a usable gaze estimate",
    },
    {
      label: "Direction match",
      value: metrics.directionMatch.toFixed(1),
      unit: "%",
      note: "How often the gaze moved with the target",
    },
    {
      label: "Speed match",
      value: metrics.speedMatch.toFixed(1),
      unit: "%",
      note: "How closely the gaze speed followed the target",
    },
    {
      label: "Smoothness",
      value: metrics.smoothScore.toFixed(1),
      unit: "%",
      note: "Consistency of the pursuit",
    },
    {
      label: "Head stillness",
      value: metrics.headStillness.toFixed(1),
      unit: "%",
      note: "How still the head was held during the run",
    },
    {
      label: "Pursuit gain",
      value: metrics.pursuitGain.toFixed(2),
      unit: "×",
      note: "Eye velocity over target velocity",
    },
    {
      label: "RMS error",
      value: metrics.accuracyDegrees.toFixed(2),
      unit: "°",
      note: "Root mean square error in degrees of visual angle",
    },
    {
      label: "Mean distance",
      value: metrics.avgDistancePx.toFixed(1),
      unit: "px",
      note: "Average distance between estimate and target",
    },
    {
      label: "Phase lag",
      value: metrics.phaseLagMs.toFixed(1),
      unit: "ms",
      note: "Delay between the target and the gaze",
    },
  ];
}

function saccadeReadings(session: SaccadeSession): Reading[] {
  const metrics = session.metrics;
  return [
    {
      label: "Trials",
      value: String(metrics.numTrials),
      unit: "",
      note: "Trials the test ran",
    },
    {
      label: "Correct trials",
      value: String(metrics.numCorrect),
      unit: "",
      note: "Trials with a saccade in the right direction",
    },
    {
      label: "Direction errors",
      value: (metrics.errorRate * 100).toFixed(1),
      unit: "%",
      note: "Share of the trials that were not correct",
    },
    {
      label: "Mean latency",
      value: formatNumber(metrics.meanLatencyMs, 1),
      unit: "ms",
      note: "Time from the target to the saccade, correct trials",
    },
    {
      label: "Latency spread",
      value: formatNumber(metrics.stdLatencyMs, 1),
      unit: "ms",
      note: "Standard deviation of the latency",
    },
    {
      label: "Mean accuracy",
      value: formatNumber(metrics.meanAccuracyDeg, 2),
      unit: "°",
      note: "Distance between the saccade and the target",
    },
    {
      label: "Mean peak velocity",
      value: formatNumber(metrics.meanPeakVelocityDegS, 1),
      unit: "°/s",
      note: "The fastest moment of the saccade",
    },
    {
      label: "Anticipatory",
      value: (metrics.anticipatoryRate * 100).toFixed(1),
      unit: "%",
      note: "Saccades that started before 80 ms",
    },
    {
      label: "Express",
      value: (metrics.expressSaccadeRate * 100).toFixed(1),
      unit: "%",
      note: "Saccades that started between 80 and 130 ms",
    },
  ];
}

function fixationReadings(session: FixationSession): Reading[] {
  const metrics = session.metrics;
  return [
    {
      label: "BCEA",
      value: metrics.bceaDeg2.toFixed(2),
      unit: "°²",
      note: "Bivariate contour ellipse area of the fixation",
    },
    {
      label: "Microsaccades",
      value: String(metrics.microsaccadeCount),
      unit: "",
      note: "Small eye movements during the hold",
    },
    {
      label: "Microsaccade rate",
      value: metrics.microsaccadeRateHz.toFixed(2),
      unit: "Hz",
      note: "Microsaccades per second of the hold",
    },
    {
      label: "Microsaccade size",
      value: metrics.meanMicrosaccadeAmplitudeDeg.toFixed(2),
      unit: "°",
      note: "Mean size of the small eye movements",
    },
    {
      label: "Stability",
      value: metrics.stabilityDeg.toFixed(2),
      unit: "°",
      note: "Spread of the fixation around its centre",
    },
    {
      label: "Smoothness",
      value: metrics.smoothness.toFixed(2),
      unit: "",
      note: "Steadiness of the hold, 1 is perfectly steady",
    },
    {
      label: "Tracking rate",
      value: metrics.trackingRatio.toFixed(1),
      unit: "%",
      note: "Frames with a usable gaze estimate",
    },
    {
      label: "RMS error",
      value: metrics.rmsErrorDeg.toFixed(2),
      unit: "°",
      note: "Root mean square error in degrees of visual angle",
    },
  ];
}

function validationReadings(session: ValidationSession): Reading[] {
  const metrics = session.metrics;
  return [
    {
      label: "Accuracy",
      value: formatNumber(metrics.accuracyDegrees, 2),
      unit: "°",
      note: "Mean distance between the estimate and the point",
    },
    {
      label: "Accuracy spread",
      value: formatNumber(metrics.accuracyStdDegrees, 2),
      unit: "°",
      note: "How much the accuracy differs from point to point",
    },
    {
      label: "Precision",
      value: formatNumber(metrics.precisionDegrees, 2),
      unit: "°",
      note: "How much the estimate moves around the point",
    },
    {
      label: "Worst point",
      value: formatNumber(metrics.worstPointAccuracy, 2),
      unit: "°",
      note: "The point the patient was worst at",
    },
    {
      label: "Valid points",
      value: String(metrics.validPoints),
      unit: "",
      note: "Points that carried samples",
    },
    {
      label: "Provisional threshold",
      value: metrics.meetsClinicalThreshold ? "met" : "not met",
      unit: "",
      note: "Against the provisional limit of 2°",
    },
  ];
}

/** A measurement that may be missing, shown as a dash. */
function formatNumber(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

/** The pursuit session is the one without a protocol tag. */
function isPursuitSession(session: ProtocolSession): session is TestSession {
  return !("protocol" in session);
}

function isSaccadeSession(session: ProtocolSession): session is SaccadeSession {
  return "protocol" in session && session.protocol === "saccade";
}

function isFixationSession(
  session: ProtocolSession
): session is FixationSession {
  return "protocol" in session && session.protocol === "fixation";
}

function isValidationSession(
  session: ProtocolSession
): session is ValidationSession {
  return "protocol" in session && session.protocol === "validation";
}
