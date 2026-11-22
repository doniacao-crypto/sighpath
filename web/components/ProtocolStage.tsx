"use client";

/**
 * The shell that runs the measurement protocols in the browser.
 *
 * The desktop app gives every protocol a full-screen widget and feeds it the eye
 * tracker. This shell does the same: it owns the camera, the tracker and the frame
 * loop, and hands the frames to the protocol stage that keeps the protocol state and
 * paints the stimulus on the stage.
 *
 * The stage opens the camera itself, so the app must not show its own camera preview
 * while a protocol is running.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { CameraView } from "./CameraView";
import { FixationStage } from "./FixationStage";
import { SaccadeStage } from "./SaccadeStage";
import { ValidationStage } from "./ValidationStage";

import { predictGaze, type GazeModel } from "../lib/features";
export type {
  FixationSession,
  ProtocolId,
  ProtocolSession,
  SaccadeSession,
  ValidationSession,
} from "../lib/types";

import type {
  EyeSample,
  ProtocolId,
  ProtocolSession,
  ScreenGeometry,
} from "../lib/types";
import { VisionTracker } from "../lib/vision";

import type { FixationSettings } from "./FixationStage";
import type { SaccadeSettings } from "./SaccadeStage";
import type { ValidationSettings } from "./ValidationStage";

/** The nominal panel the degree metrics assume: a 16:9 screen seen from 60 cm. */
const NOMINAL_WIDTH_CM = 53.1;
const NOMINAL_HEIGHT_CM = 29.9;
const VIEWING_DISTANCE_CM = 60;

/** A position on the stage, in pixels. */
export interface ProtocolGaze {
  x: number;
  y: number;
}

/** One camera frame as the protocol stages see it. */
export interface ProtocolFrame {
  /** Camera clock, in seconds. */
  timestamp: number;
  /** The newest eye sample, or null when the camera has not produced one yet. */
  sample: EyeSample | null;
  /** The newest gaze estimate in stage pixels, or null when there is no estimate. */
  gaze: ProtocolGaze | null;
  /** The geometry of the stage the protocol runs on. */
  screen: ScreenGeometry;
}

/** The hooks a protocol stage installs on the shell. */
export interface ProtocolStageHooks {
  /** Called for every camera frame while the protocol runs. */
  onFrame(frame: ProtocolFrame): void;
  /** Called after every drawn frame, so the protocol can paint its stimulus. */
  onDraw(
    context: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void;
}

interface ProtocolStageBaseProps {
  /** The gaze model; null when the tracker has not been calibrated yet. */
  model: GazeModel | null;
  /** The camera to open; the default camera is used when it is null. */
  deviceId?: string | null;
  /** The size of the stage the gaze model was fitted on, in pixels. */
  calibrationSize?: { width: number; height: number };
  /** The finished run. */
  onComplete(session: ProtocolSession): void;
  /** The operator left the protocol. */
  onCancel(): void;
}

export type ProtocolStageProps =
  | (ProtocolStageBaseProps & {
      protocol: "saccade";
      settings: SaccadeSettings;
    })
  | (ProtocolStageBaseProps & {
      protocol: "fixation";
      settings: FixationSettings;
    })
  | (ProtocolStageBaseProps & {
      protocol: "validation";
      settings: ValidationSettings;
    });

import { PROTOCOL_LABELS } from "../lib/sessions";

export { PROTOCOL_LABELS };

const PROTOCOL_DESCRIPTIONS: Record<ProtocolId, string> = {
  pursuit:
    "The patient follows the moving target with the eyes only. The head should stay still.",
  saccade:
    "The patient holds the fixation cross, then looks at the target that appears beside it.",
  fixation:
    "The patient holds the fixation cross in the middle of the screen and keeps the head still.",
  validation:
    "The patient looks at every point of the grid in turn and holds still at each point.",
};

export function ProtocolStage(props: ProtocolStageProps) {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [trackerError, setTrackerError] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const hooksRef = useRef<ProtocolStageHooks | null>(null);
  const trackerRef = useRef<VisionTracker | null>(null);
  const modelRef = useRef<GazeModel | null>(props.model);
  const sampleRef = useRef<EyeSample | null>(null);
  const gazeRef = useRef<ProtocolGaze | null>(null);
  const screenRef = useRef<ScreenGeometry>({
    widthPx: 0,
    heightPx: 0,
    widthCm: NOMINAL_WIDTH_CM,
    heightCm: NOMINAL_HEIGHT_CM,
    viewingDistanceCm: VIEWING_DISTANCE_CM,
  });
  const calibrationSizeRef = useRef(
    props.calibrationSize ?? { width: 0, height: 0 }
  );
  const requestRef = useRef(0);

  useEffect(() => {
    modelRef.current = props.model;
  }, [props.model]);

  useEffect(() => {
    calibrationSizeRef.current = props.calibrationSize ?? {
      width: 0,
      height: 0,
    };
  }, [props.calibrationSize]);

  /* Tracker ---------------------------------------------------------------- */

  useEffect(() => {
    let disposed = false;

    VisionTracker.create()
      .then((tracker) => {
        if (disposed) {
          tracker.close();
          return;
        }
        trackerRef.current = tracker;
      })
      .catch((error: unknown) => {
        setTrackerError(
          error instanceof Error
            ? `The eye tracker could not be started: ${error.message}`
            : "The eye tracker could not be started."
        );
      });

    return () => {
      disposed = true;
      trackerRef.current?.close();
      trackerRef.current = null;
    };
  }, []);

  /* Frames ----------------------------------------------------------------- */

  /**
   * The preview owns the camera, so the tracker is fed from the video element inside
   * it. The landmarks must not see the marks the protocol paints on the overlay
   * canvas, which is why the raw video is measured and not the canvas.
   */
  const captureSource = useCallback((): HTMLVideoElement | null => {
    const host = hostRef.current;
    if (!host) return null;
    const video = host.querySelector("video");
    if (video instanceof HTMLVideoElement && video.readyState >= 2)
      return video;
    return null;
  }, []);

  /** Turns the newest eye sample into a gaze position on the stage. */
  const applySample = useCallback((sample: EyeSample | null) => {
    sampleRef.current = sample;
    const currentModel = modelRef.current;
    if (!currentModel || !sample) {
      gazeRef.current = null;
      return;
    }
    const estimate = predictGaze(currentModel, sample);
    const { widthPx, heightPx } = screenRef.current;
    // The model was fitted on the pixels of the stage it was calibrated on, so the
    // estimate is scaled when the stage has a different size now.
    const calibration = calibrationSizeRef.current;
    const scaleX =
      calibration.width > 0 && widthPx > 0 ? widthPx / calibration.width : 1;
    const scaleY =
      calibration.height > 0 && heightPx > 0
        ? heightPx / calibration.height
        : 1;
    const scaledX = estimate.x * scaleX;
    const scaledY = estimate.y * scaleY;
    gazeRef.current =
      widthPx > 0 && heightPx > 0
        ? {
            x: Math.min(Math.max(scaledX, 0), widthPx),
            y: Math.min(Math.max(scaledY, 0), heightPx),
          }
        : { x: scaledX, y: scaledY };
  }, []);

  const handleFrame = useCallback(
    (timestamp: number) => {
      const tracker = trackerRef.current;
      if (tracker) {
        const source = captureSource();
        if (source) {
          requestRef.current += 1;
          const requestId = requestRef.current;
          void tracker
            .detect(source, timestamp * 1000)
            .then((result) => {
              // A slow detection must not overwrite the sample of a newer frame.
              if (requestId !== requestRef.current) return;
              applySample(result ? result.sample : null);
            })
            .catch(() => {
              // A failed detection simply means this frame has no eye sample.
            });
        }
      }

      hooksRef.current?.onFrame({
        timestamp,
        sample: sampleRef.current,
        gaze: gazeRef.current,
        screen: screenRef.current,
      });
    },
    [applySample, captureSource]
  );

  const handleDraw = useCallback(
    (context: CanvasRenderingContext2D, width: number, height: number) => {
      const current = screenRef.current;
      if (current.widthPx !== width || current.heightPx !== height) {
        screenRef.current = { ...current, widthPx: width, heightPx: height };
      }
      hooksRef.current?.onDraw(context, width, height);
    },
    []
  );

  /* Render ----------------------------------------------------------------- */

  return (
    <section className="sp-card">
      <div className="sp-status">
        <div>
          <h2 className="sp-subtitle">{PROTOCOL_LABELS[props.protocol]}</h2>
          <p className="sp-text-dim">{PROTOCOL_DESCRIPTIONS[props.protocol]}</p>
        </div>
      </div>

      {cameraError !== null && (
        <div className="sp-notice sp-notice--error">
          <span className="sp-notice-title">Camera problem</span>
          <p>{cameraError}</p>
        </div>
      )}

      {trackerError !== null && (
        <div className="sp-notice sp-notice--error">
          <span className="sp-notice-title">Tracker problem</span>
          <p>{trackerError}</p>
        </div>
      )}

      <div className="sp-camera-wrap">
        <div className="sp-camera" ref={hostRef}>
          <CameraView
            active
            deviceId={props.deviceId ?? null}
            facingMode="user"
            onFrame={handleFrame}
            onDraw={handleDraw}
            onError={setCameraError}
          />
        </div>
        <p className="sp-camera-note">
          The camera picture is processed in this browser. No video and no
          measurement is sent anywhere.
        </p>
      </div>

      {props.protocol === "saccade" && (
        <SaccadeStage
          hooksRef={hooksRef}
          model={props.model}
          initialSettings={props.settings}
          onComplete={props.onComplete}
          onCancel={props.onCancel}
        />
      )}

      {props.protocol === "fixation" && (
        <FixationStage
          hooksRef={hooksRef}
          model={props.model}
          initialSettings={props.settings}
          onComplete={props.onComplete}
          onCancel={props.onCancel}
        />
      )}

      {props.protocol === "validation" && (
        <ValidationStage
          hooksRef={hooksRef}
          model={props.model}
          initialSettings={props.settings}
          onComplete={props.onComplete}
          onCancel={props.onCancel}
        />
      )}
    </section>
  );
}
