"use client";

import type { TestSession } from "../lib/types";

export interface HistoryPanelProps {
  sessions: TestSession[];
  onDelete(id: string): void;
  onClose(): void;
}

export function HistoryPanel({
  sessions,
  onDelete,
  onClose,
}: HistoryPanelProps) {
  return (
    <section className="sp-card">
      <div className="sp-status">
        <div>
          <h2 className="sp-subtitle">Session history</h2>
          <p className="sp-text-dim">
            The last {sessions.length === 0 ? "0" : sessions.length} run
            {sessions.length === 1 ? "" : "s"} stored in this browser. Nothing
            is sent anywhere.
          </p>
        </div>
        <button type="button" className="sp-button" onClick={onClose}>
          Close
        </button>
      </div>

      {sessions.length === 0 ? (
        <p className="sp-empty">
          No sessions yet. Run a test to create the first one.
        </p>
      ) : (
        <ul>
          {sessions.map((session) => (
            <li className="sp-history-item" key={session.id}>
              <div>
                <div className="sp-history-pattern">
                  {session.pattern.replace("_", " ")}
                </div>
                <div className="sp-history-meta">
                  {new Date(session.startedAt).toLocaleString()} ·{" "}
                  {session.durationSeconds} s
                </div>
              </div>
              <div className="sp-history-metrics">
                Gain {session.metrics.pursuitGain.toFixed(2)}× · RMS{" "}
                {session.metrics.accuracyDegrees.toFixed(2)}°
              </div>
              <button
                type="button"
                className="sp-button sp-button--danger"
                onClick={() => onDelete(session.id)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
