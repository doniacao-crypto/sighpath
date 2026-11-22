/**
 * One line about a finished run, whichever protocol it came from.
 *
 * The browser keeps the sessions of every protocol in one history, so the list has to say
 * what each run measured.
 */

import type { ProtocolId, ProtocolSession, TrackingFrame } from "./types";

/** The name of every protocol, as it is shown to the operator. */
export const PROTOCOL_LABELS: Record<ProtocolId, string> = {
  pursuit: "Pursuit test",
  saccade: "Saccade test",
  fixation: "Fixation stability",
  validation: "Gaze accuracy validation",
};

/** What one run measured, in a single line. */
export interface SessionSummary {
  protocol: ProtocolId;
  title: string;
  startedAt: string;
  headline: string;
}

/** The protocol a session belongs to. */
export function sessionProtocol(session: ProtocolSession): ProtocolId {
  return session.protocol === "pursuit" ? "pursuit" : session.protocol;
}

/** The gaze samples of a session, whichever protocol recorded them. */
export function sessionFrames(session: ProtocolSession): TrackingFrame[] {
  if (session.protocol === "pursuit") return session.frames;
  if (session.protocol === "fixation") return session.frames;
  return [];
}

/** A one line summary of a finished run. */
export function sessionSummary(session: ProtocolSession): SessionSummary {
  const protocol = sessionProtocol(session);
  const startedAt = session.startedAt;
  const title = PROTOCOL_LABELS[protocol];

  switch (session.protocol) {
    case "saccade": {
      const metrics = session.metrics;
      const latency =
        metrics.meanLatencyMs === null
          ? "no latency"
          : `${metrics.meanLatencyMs.toFixed(0)} ms`;
      return {
        protocol,
        title,
        startedAt,
        headline: `${latency} · ${((1 - metrics.errorRate) * 100).toFixed(0)}% correct`,
      };
    }
    case "fixation": {
      const metrics = session.metrics;
      return {
        protocol,
        title,
        startedAt,
        headline: `BCEA ${metrics.bceaDeg2.toFixed(2)} deg² · ${metrics.microsaccadeRateHz.toFixed(2)} Hz`,
      };
    }
    case "validation": {
      const metrics = session.metrics;
      const accuracy =
        metrics.accuracyDegrees === null
          ? "no accuracy"
          : `${metrics.accuracyDegrees.toFixed(2)}°`;
      return {
        protocol,
        title,
        startedAt,
        headline: `${accuracy} · ${metrics.validPoints} points`,
      };
    }
    case "pursuit":
    default: {
      const metrics = session.metrics;
      return {
        protocol,
        title,
        startedAt,
        headline: `Gain ${metrics.pursuitGain.toFixed(2)} · RMS ${metrics.accuracyDegrees.toFixed(2)}°`,
      };
    }
  }
}
