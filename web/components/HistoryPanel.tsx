"use client";

import { sessionSummary } from "../lib/sessions";
import { SessionComparison } from "./SessionComparison";
import type { ProtocolSession } from "../lib/types";

export interface HistoryPanelProps {
  sessions: ProtocolSession[];
  onDelete(id: string): void;
  onClose(): void;
}

export function HistoryPanel({
  sessions,
  onDelete,
  onClose,
}: HistoryPanelProps) {
  // The two newest runs of the same protocol can be compared, the way the desktop app
  // compares two sessions.
  const comparable = (() => {
    if (sessions.length < 2) return null;
    const [current, baseline] = sessions;
    if (current.protocol !== baseline.protocol) return null;
    return { baseline, current };
  })();

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
          {sessions.map((session) => {
            const summary = sessionSummary(session);
            return (
              <li className="sp-history-item" key={session.id}>
                <div>
                  <div className="sp-history-pattern">{summary.title}</div>
                  <div className="sp-history-meta">
                    {new Date(summary.startedAt).toLocaleString()} ·{" "}
                    {session.durationSeconds} s
                  </div>
                </div>
                <div className="sp-history-metrics">{summary.headline}</div>
                <button
                  type="button"
                  className="sp-button sp-button--danger"
                  onClick={() => onDelete(session.id)}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {comparable && (
        <>
          <h3 className="sp-subtitle" style={{ marginTop: "1.5rem" }}>
            Compared with the previous run
          </h3>
          <SessionComparison
            baseline={comparable.baseline}
            current={comparable.current}
          />
        </>
      )}
    </section>
  );
}
