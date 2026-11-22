"use client";

import type { TestSession } from "../lib/types";

export interface ResultsStageProps {
  session: TestSession | null;
  onRunAgain(): void;
  onHome(): void;
}

export function ResultsStage({
  session,
  onRunAgain,
  onHome,
}: ResultsStageProps) {
  if (session === null) {
    return (
      <section className="sp-card">
        <h2 className="sp-subtitle">No results</h2>
        <p className="sp-text-dim">There is no finished test to show yet.</p>
        <div className="sp-actions">
          <button
            type="button"
            className="sp-button sp-button--primary"
            onClick={onRunAgain}
          >
            Run another test
          </button>
          <button type="button" className="sp-button" onClick={onHome}>
            Back to home
          </button>
        </div>
      </section>
    );
  }

  const { metrics } = session;
  const readings = [
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
  ];

  const exportSession = () => {
    const payload = JSON.stringify(session, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = session.startedAt.slice(0, 19).replace(/[:T]/g, "-");
    const link = document.createElement("a");
    link.href = url;
    link.download = `sightpath-${session.pattern}-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="sp-card">
      <div className="sp-status">
        <div>
          <h2 className="sp-subtitle">Results</h2>
          <p className="sp-text-dim">
            {session.pattern.replace("_", " ")} · {session.durationSeconds} s ·{" "}
            {new Date(session.startedAt).toLocaleString()}
          </p>
        </div>
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

      <p className="sp-small sp-text-dim" style={{ marginTop: "1rem" }}>
        {metrics.validFrames} of {metrics.totalFrames} frames were usable ·
        phase lag {metrics.phaseLagMs.toFixed(0)} ms · recorded on{" "}
        {session.screen.widthPx} × {session.screen.heightPx} px
      </p>

      <div className="sp-notice sp-notice--warn" style={{ marginTop: "1rem" }}>
        <span className="sp-notice-title">Provisional thresholds</span>
        <p>
          These thresholds are provisional and have not been clinically
          validated. Use the numbers for research and for tracking change over
          time, not for diagnosis.
        </p>
      </div>

      <div className="sp-actions">
        <button
          type="button"
          className="sp-button sp-button--primary"
          onClick={onRunAgain}
        >
          Run another test
        </button>
        <button type="button" className="sp-button" onClick={exportSession}>
          Export JSON
        </button>
        <button type="button" className="sp-button" onClick={onHome}>
          Back to home
        </button>
      </div>
    </section>
  );
}
