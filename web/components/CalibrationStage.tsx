"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { StageController, StageFrame } from "./App";

import {
  assessCalibration,
  CalibrationSession,
  type CalibrationQuality,
} from "../lib/calibration";
import { fitGazeModel, type GazeModel } from "../lib/features";
import {
  calibrationGrid,
  HEAD_POSES,
  POSE_TRANSITION_SECONDS,
  SAMPLES_PER_POINT,
  SETTLE_SECONDS,
} from "../lib/patterns";

export interface CalibrationStageProps {
  controllerRef: RefObject<StageController | null>;
  onModelReady(model: GazeModel): void;
  onContinue(): void;
  onCancel(): void;
  onRestart(): void;
}

export function CalibrationStage({
  controllerRef,
  onModelReady,
  onContinue,
  onCancel,
  onRestart,
}: CalibrationStageProps) {
  const [status, setStatus] = useState("Waiting for the camera…");
  const [summary, setSummary] = useState<{
    model: GazeModel;
    quality: CalibrationQuality;
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // The session keeps the live state, so everything that changes per frame lives in refs.
  const sessionRef = useRef<CalibrationSession | null>(null);
  const gridRef = useRef<{ x: number; y: number }[]>([]);
  const nowRef = useRef(0);
  const startedRef = useRef(false);
  const completedRef = useRef(false);
  const statusRef = useRef("");

  /**
   * The grid depends on the size of the stage, which is only known once the preview
   * has drawn its first frame.
   */
  const ensureSession = useCallback(
    (width: number, height: number): CalibrationSession | null => {
      if (sessionRef.current) return sessionRef.current;
      if (width <= 0 || height <= 0) return null;
      const grid = calibrationGrid(width, height);
      gridRef.current = grid;
      const session = new CalibrationSession(grid, {
        poses: HEAD_POSES,
        samplesPerPoint: SAMPLES_PER_POINT,
        settleSeconds: SETTLE_SECONDS,
        transitionSeconds: POSE_TRANSITION_SECONDS,
        now: () => nowRef.current,
      });
      sessionRef.current = session;
      return session;
    },
    []
  );

  const complete = useCallback(
    (session: CalibrationSession) => {
      if (completedRef.current) return;
      completedRef.current = true;
      try {
        const points = session.buildPoints();
        const fitted = fitGazeModel(points);
        const quality = assessCalibration(fitted, points);
        setSummary({ model: fitted, quality });
        onModelReady(fitted);
      } catch (error: unknown) {
        setFailure(
          error instanceof Error
            ? `The gaze model could not be fitted: ${error.message}`
            : "The gaze model could not be fitted."
        );
      }
    },
    [onModelReady]
  );

  const handleFrame = useCallback(
    (frame: StageFrame) => {
      nowRef.current = frame.timestamp;
      // The stage size normally arrives with the first draw; the frame carries it too, so
      // the session can start even if the first draw is late.
      const session =
        sessionRef.current ?? ensureSession(frame.width, frame.height);
      if (!session || completedRef.current) return;

      if (!startedRef.current) {
        session.start(frame.timestamp);
        startedRef.current = true;
      }
      session.tick(frame.timestamp);
      if (frame.sample && session.state.phase === "sampling") {
        session.addSample(frame.sample, frame.timestamp);
      }

      const state = session.state;
      const pose = HEAD_POSES[state.poseIndex] ?? HEAD_POSES[0];
      const pointTotal = gridRef.current.length;
      let nextStatus: string;
      if (state.phase === "transition") {
        nextStatus = `Next level starts in ${Math.ceil(
          Math.max(state.noticeSecondsLeft, 0)
        )} s — ${pose.title}`;
      } else if (state.phase === "done") {
        nextStatus = "Calibration finished";
      } else {
        nextStatus = `Level ${state.poseIndex + 1} of ${HEAD_POSES.length} · Point ${
          state.pointIndex + 1
        } of ${pointTotal} — keep looking at the dot`;
      }
      if (nextStatus !== statusRef.current) {
        statusRef.current = nextStatus;
        setStatus(nextStatus);
      }

      if (session.finished) complete(session);
    },
    [complete, ensureSession]
  );

  const handleDraw = useCallback(
    (context: CanvasRenderingContext2D, width: number, height: number) => {
      const session = ensureSession(width, height);
      if (!session) return;
      const state = session.state;
      const grid = gridRef.current;
      const pose = HEAD_POSES[state.poseIndex] ?? HEAD_POSES[0];

      context.save();
      context.textAlign = "center";
      context.textBaseline = "alphabetic";

      // The nine points of the grid: the ones already visited in this level, the
      // current one, and the ones still to come.
      grid.forEach((point, index) => {
        if (index === state.pointIndex && state.phase !== "transition") return;
        context.beginPath();
        context.arc(point.x, point.y, 15, 0, Math.PI * 2);
        context.fillStyle =
          index < state.pointIndex
            ? "rgba(86, 211, 100, 0.85)"
            : "rgba(120, 130, 145, 0.4)";
        context.fill();
      });

      // The current point, pulsing, with a ring that fills up as samples arrive.
      const current = session.currentTarget;
      if (current && state.phase !== "transition") {
        const pulse = Math.abs(Math.sin(nowRef.current * 4)) * 10 + 20;
        context.beginPath();
        context.arc(current.x, current.y, pulse, 0, Math.PI * 2);
        context.fillStyle = "rgba(255, 77, 77, 0.85)";
        context.fill();

        const progress = Math.min(1, state.samplesAtPoint / SAMPLES_PER_POINT);
        context.beginPath();
        context.strokeStyle = "#56d364";
        context.lineWidth = 4;
        context.arc(
          current.x,
          current.y,
          35,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * progress
        );
        context.stroke();
      }

      // The head pose of the current level.
      context.fillStyle = "#ffcc66";
      context.font = "bold 26px system-ui, sans-serif";
      context.fillText(pose.title, width / 2, 48);
      context.fillStyle = "#c8c8c8";
      context.font = "15px system-ui, sans-serif";
      context.fillText(pose.subtitle, width / 2, 74);

      // The between-level notice: the patient has to move their head, and the first
      // samples of the new level must not be taken while the head is still turning.
      if (state.phase === "transition") {
        const bandTop = height / 2 - 130;
        context.fillStyle = "rgba(0, 0, 0, 0.8)";
        context.fillRect(0, bandTop, width, 260);

        const nextTitle = session.nextPoseTitle ?? pose.title;
        context.fillStyle = "#ffcc66";
        context.font = "bold 28px system-ui, sans-serif";
        context.fillText(`NEXT LEVEL: ${nextTitle}`, width / 2, bandTop + 50);

        context.fillStyle = "#e6e6e6";
        context.font = "17px system-ui, sans-serif";
        context.fillText(pose.subtitle, width / 2, bandTop + 86);

        context.fillStyle = "#ffffff";
        context.font = "bold 60px system-ui, sans-serif";
        context.fillText(
          `Starting in ${Math.ceil(Math.max(state.noticeSecondsLeft, 0))}`,
          width / 2,
          bandTop + 160
        );

        context.fillStyle = "#ffcc66";
        context.font = "16px system-ui, sans-serif";
        context.fillText(
          "Move your head now — hold still when the count reaches zero",
          width / 2,
          bandTop + 210
        );
      }

      context.restore();
    },
    [ensureSession]
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

  return (
    <section className="sp-card">
      <div className="sp-status">
        <div>
          <h2 className="sp-subtitle">Calibration</h2>
          <p className="sp-text-dim">{status}</p>
        </div>
        {!summary && (
          <button
            type="button"
            className="sp-button sp-button--danger"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>

      <p className="sp-small sp-text-dim">
        The patient looks at each dot while holding the requested head pose. The
        grid is walked once per pose, because the model can only learn head
        compensation if the head actually moves between levels.
      </p>

      {failure !== null && (
        <div className="sp-notice sp-notice--error">
          <span className="sp-notice-title">Calibration failed</span>
          <p>{failure}</p>
        </div>
      )}

      {summary !== null && (
        <div style={{ marginTop: "1rem" }}>
          <h3 className="sp-subtitle">Calibration summary</h3>
          <div className="sp-stats">
            <div className="sp-stat">
              <div className="sp-stat-label">Held-out error</div>
              <div className="sp-stat-value">
                {summary.quality.cvErrorPx.toFixed(1)}
                <span className="sp-stat-unit">px</span>
              </div>
              <div className="sp-stat-note">
                Leave-one-point-out: every point predicted from the other eight.
              </div>
            </div>
            <div className="sp-stat">
              <div className="sp-stat-label">Head-pose spread</div>
              <div className="sp-stat-value">
                {summary.quality.headPitchSpreadDeg.toFixed(1)} /{" "}
                {summary.quality.headYawSpreadDeg.toFixed(1)}
                <span className="sp-stat-unit">°</span>
              </div>
              <div className="sp-stat-note">
                Pitch / yaw spread across the calibration.
              </div>
            </div>
            <div className="sp-stat">
              <div className="sp-stat-label">Average error</div>
              <div className="sp-stat-value">
                {summary.quality.avgErrorPx.toFixed(1)}
                <span className="sp-stat-unit">px</span>
              </div>
              <div className="sp-stat-note">
                Error of the fitted model on the calibration itself.
              </div>
            </div>
            <div className="sp-stat">
              <div className="sp-stat-label">Calibration points</div>
              <div className="sp-stat-value">{summary.quality.points}</div>
              <div className="sp-stat-note">
                {summary.quality.trainingRows} samples were used to fit the
                model.
              </div>
            </div>
          </div>

          {!summary.quality.headPoseOk && (
            <div
              className="sp-notice sp-notice--warn"
              style={{ marginTop: "1rem" }}
            >
              <span className="sp-notice-title">Head pose barely varied</span>
              <p>
                The model could not learn head compensation, so the gaze
                estimate will fall apart as soon as the patient turns their
                head. Please redo the calibration and hold the requested head
                poses.
              </p>
            </div>
          )}

          <div className="sp-actions">
            <button
              type="button"
              className="sp-button sp-button--primary"
              onClick={onContinue}
            >
              Continue to test
            </button>
            <button type="button" className="sp-button" onClick={onRestart}>
              Redo calibration
            </button>
            <button
              type="button"
              className="sp-button sp-button--danger"
              onClick={onCancel}
            >
              Back to home
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
