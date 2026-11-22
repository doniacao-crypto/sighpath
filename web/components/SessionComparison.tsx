"use client";

/**
 * The comparison of two stored sessions.
 *
 * The desktop app compares two runs with the SessionComparator in
 * src/session_comparison.py: for every metric both runs have it shows the two values,
 * the change between them and whether the change is an improvement. This component
 * does the same for the four protocols of the browser version.
 */

import type { CSSProperties } from "react";

import { PROTOCOL_LABELS } from "./ProtocolStage";
import type {
  FixationSession,
  ProtocolId,
  ProtocolSession,
  SaccadeSession,
  ValidationSession,
} from "./ProtocolStage";

import type { TestSession } from "../lib/types";

export interface SessionComparisonProps {
  /** The older run, the baseline of the comparison. */
  baseline: ProtocolSession;
  /** The newer run, compared with the baseline. */
  current: ProtocolSession;
}

/** One metric of a protocol and how to read it out of a session. */
interface MetricDefinition<T> {
  /** The name of the metric in the table. */
  label: string;
  /** The unit the value is shown in. */
  unit: string;
  /** Whether a bigger value is the better result. */
  higherIsBetter: boolean;
  /** The value of the metric in the session, or null when the run has no value. */
  read(session: T): number | null;
}

/** One line of the comparison table. */
interface ComparisonRow {
  label: string;
  unit: string;
  baseline: number | null;
  current: number | null;
  /** The change in percent, or null when it cannot be computed. */
  percentChange: number | null;
  /** Whether the change is an improvement, or null when it cannot be told. */
  improved: boolean | null;
}

const TABLE_STYLE: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};
const HEADER_STYLE: CSSProperties = {
  padding: "0.4rem 0.5rem",
  borderBottom: "1px solid #2b333d",
  textAlign: "left",
};
const NUMBER_HEADER_STYLE: CSSProperties = {
  ...HEADER_STYLE,
  textAlign: "right",
};
const CELL_STYLE: CSSProperties = {
  padding: "0.4rem 0.5rem",
  borderBottom: "1px solid #2b333d",
};
const NUMBER_CELL_STYLE: CSSProperties = {
  ...CELL_STYLE,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const PURSUIT_METRICS: MetricDefinition<TestSession>[] = [
  {
    label: "Tracking ratio",
    unit: "%",
    higherIsBetter: true,
    read: (session) => session.metrics.trackingRatio,
  },
  {
    label: "Direction match",
    unit: "%",
    higherIsBetter: true,
    read: (session) => session.metrics.directionMatch,
  },
  {
    label: "Speed match",
    unit: "%",
    higherIsBetter: true,
    read: (session) => session.metrics.speedMatch,
  },
  {
    label: "Smoothness",
    unit: "%",
    higherIsBetter: true,
    read: (session) => session.metrics.smoothScore,
  },
  {
    label: "Head stillness",
    unit: "%",
    higherIsBetter: true,
    read: (session) => session.metrics.headStillness,
  },
  {
    label: "Pursuit gain",
    unit: "×",
    higherIsBetter: true,
    read: (session) => session.metrics.pursuitGain,
  },
  {
    label: "Accuracy (RMS error)",
    unit: "°",
    higherIsBetter: false,
    read: (session) => session.metrics.accuracyDegrees,
  },
  {
    label: "Mean distance",
    unit: "px",
    higherIsBetter: false,
    read: (session) => session.metrics.avgDistancePx,
  },
  {
    label: "Phase lag",
    unit: "ms",
    higherIsBetter: false,
    read: (session) => session.metrics.phaseLagMs,
  },
];

const SACCADE_METRICS: MetricDefinition<SaccadeSession>[] = [
  {
    label: "Mean latency",
    unit: "ms",
    higherIsBetter: false,
    read: (session) => session.metrics.meanLatencyMs,
  },
  {
    label: "Latency spread",
    unit: "ms",
    higherIsBetter: false,
    read: (session) => session.metrics.stdLatencyMs,
  },
  {
    label: "Direction errors",
    unit: "%",
    higherIsBetter: false,
    read: (session) => session.metrics.errorRate * 100,
  },
  {
    label: "Mean accuracy",
    unit: "°",
    higherIsBetter: false,
    read: (session) => session.metrics.meanAccuracyDeg,
  },
  {
    label: "Mean peak velocity",
    unit: "°/s",
    higherIsBetter: true,
    read: (session) => session.metrics.meanPeakVelocityDegS,
  },
  {
    label: "Anticipatory",
    unit: "%",
    higherIsBetter: false,
    read: (session) => session.metrics.anticipatoryRate * 100,
  },
  {
    label: "Express",
    unit: "%",
    higherIsBetter: false,
    read: (session) => session.metrics.expressSaccadeRate * 100,
  },
];

const FIXATION_METRICS: MetricDefinition<FixationSession>[] = [
  {
    label: "BCEA",
    unit: "°²",
    higherIsBetter: false,
    read: (session) => session.metrics.bceaDeg2,
  },
  {
    label: "Microsaccades",
    unit: "",
    higherIsBetter: false,
    read: (session) => session.metrics.microsaccadeCount,
  },
  {
    label: "Microsaccade rate",
    unit: "Hz",
    higherIsBetter: false,
    read: (session) => session.metrics.microsaccadeRateHz,
  },
  {
    label: "Microsaccade size",
    unit: "°",
    higherIsBetter: false,
    read: (session) => session.metrics.meanMicrosaccadeAmplitudeDeg,
  },
  {
    label: "Stability",
    unit: "°",
    higherIsBetter: false,
    read: (session) => session.metrics.stabilityDeg,
  },
  {
    label: "Smoothness",
    unit: "",
    higherIsBetter: true,
    read: (session) => session.metrics.smoothness,
  },
  {
    label: "Tracking ratio",
    unit: "%",
    higherIsBetter: true,
    read: (session) => session.metrics.trackingRatio,
  },
  {
    label: "RMS error",
    unit: "°",
    higherIsBetter: false,
    read: (session) => session.metrics.rmsErrorDeg,
  },
];

const VALIDATION_METRICS: MetricDefinition<ValidationSession>[] = [
  {
    label: "Accuracy",
    unit: "°",
    higherIsBetter: false,
    read: (session) => session.metrics.accuracyDegrees,
  },
  {
    label: "Accuracy spread",
    unit: "°",
    higherIsBetter: false,
    read: (session) => session.metrics.accuracyStdDegrees,
  },
  {
    label: "Precision",
    unit: "°",
    higherIsBetter: false,
    read: (session) => session.metrics.precisionDegrees,
  },
  {
    label: "Worst point",
    unit: "°",
    higherIsBetter: false,
    read: (session) => session.metrics.worstPointAccuracy,
  },
  {
    label: "Valid points",
    unit: "",
    higherIsBetter: true,
    read: (session) => session.metrics.validPoints,
  },
];

export function SessionComparison({
  baseline,
  current,
}: SessionComparisonProps) {
  const protocol = protocolOf(baseline);
  const comparable = protocolOf(current) === protocol;
  const rows = comparable ? rowsFor(protocol, baseline, current) : [];

  const improved = rows.filter((row) => row.improved === true).length;
  const declined = rows.filter((row) => row.improved === false).length;
  const overall =
    improved > declined
      ? "Improvement"
      : declined > improved
        ? "Decline"
        : "No significant change";

  return (
    <section className="sp-card">
      <div className="sp-status">
        <div>
          <h2 className="sp-subtitle">Session comparison</h2>
          <p className="sp-text-dim">
            {PROTOCOL_LABELS[protocol]} · baseline{" "}
            {new Date(baseline.startedAt).toLocaleString()} · current{" "}
            {new Date(current.startedAt).toLocaleString()}
          </p>
        </div>
      </div>

      {!comparable ? (
        <p className="sp-empty">
          These two runs are from different protocols, so there is nothing to
          compare. Pick two runs of the same protocol.
        </p>
      ) : (
        <>
          <table style={TABLE_STYLE}>
            <thead>
              <tr>
                <th style={HEADER_STYLE}>Metric</th>
                <th style={NUMBER_HEADER_STYLE}>Baseline</th>
                <th style={NUMBER_HEADER_STYLE}>Current</th>
                <th style={NUMBER_HEADER_STYLE}>Change</th>
                <th style={NUMBER_HEADER_STYLE}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td style={CELL_STYLE}>{row.label}</td>
                  <td style={NUMBER_CELL_STYLE}>
                    {formatValue(row.baseline, row.unit)}
                  </td>
                  <td style={NUMBER_CELL_STYLE}>
                    {formatValue(row.current, row.unit)}
                  </td>
                  <td style={NUMBER_CELL_STYLE}>
                    {row.percentChange === null
                      ? "—"
                      : `${row.percentChange >= 0 ? "+" : ""}${row.percentChange.toFixed(1)}%`}
                  </td>
                  <td style={NUMBER_CELL_STYLE}>
                    {row.improved === null ? "—" : row.improved ? "↑" : "↓"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="sp-text-dim">
            Improved: {improved} metrics · declined: {declined} metrics ·
            overall: {overall}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * The rows of the comparison: one per metric both runs have, with the change and
 * whether the change is an improvement.
 */
function rowsFor(
  protocol: ProtocolId,
  baseline: ProtocolSession,
  current: ProtocolSession
): ComparisonRow[] {
  if (protocol === "pursuit") {
    if (isPursuitSession(baseline) && isPursuitSession(current)) {
      return compare(PURSUIT_METRICS, baseline, current);
    }
    return [];
  }
  if (protocol === "saccade") {
    if (isSaccadeSession(baseline) && isSaccadeSession(current)) {
      return compare(SACCADE_METRICS, baseline, current);
    }
    return [];
  }
  if (protocol === "fixation") {
    if (isFixationSession(baseline) && isFixationSession(current)) {
      return compare(FIXATION_METRICS, baseline, current);
    }
    return [];
  }
  if (isValidationSession(baseline) && isValidationSession(current)) {
    return compare(VALIDATION_METRICS, baseline, current);
  }
  return [];
}

/** Reads every metric out of both sessions and works out the change. */
function compare<T>(
  definitions: MetricDefinition<T>[],
  baseline: T,
  current: T
): ComparisonRow[] {
  return definitions.map((definition) => {
    const baselineValue = definition.read(baseline);
    const currentValue = definition.read(current);
    let percentChange: number | null = null;
    let improved: boolean | null = null;
    if (baselineValue !== null && currentValue !== null) {
      const difference = currentValue - baselineValue;
      if (baselineValue !== 0) {
        percentChange = (difference / Math.abs(baselineValue)) * 100;
      }
      // A metric that did not change is neither an improvement nor a decline. The
      // desktop counts it as a decline, which would label every unchanged metric.
      improved =
        difference === 0
          ? null
          : definition.higherIsBetter
            ? difference > 0
            : difference < 0;
    }
    return {
      label: definition.label,
      unit: definition.unit,
      baseline: baselineValue,
      current: currentValue,
      percentChange,
      improved,
    };
  });
}

/** The protocol a session belongs to; the pursuit session is the one without a tag. */
function protocolOf(session: ProtocolSession): ProtocolId {
  return "protocol" in session ? session.protocol : "pursuit";
}

/** A measured value, shown with its unit. */
function formatValue(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(2)}${unit}`;
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
