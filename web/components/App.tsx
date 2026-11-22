"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CameraView } from "./CameraView";
import { CalibrationStage } from "./CalibrationStage";
import { HistoryPanel } from "./HistoryPanel";
import { HomeStage, type CameraOption } from "./HomeStage";
import { ProtocolResults } from "./ProtocolResults";
import { ProtocolStage } from "./ProtocolStage";
import { TestStage } from "./TestStage";
import type { ProtocolSession } from "../lib/types";

import { predictGaze, type GazeModel } from "../lib/features";
import { drawLandmarks, type NormalizedLandmark } from "../lib/landmarks";
import type { EyeSample } from "../lib/types";
import { VisionTracker } from "../lib/vision";

/** Where the finished sessions are kept. Nothing leaves the browser. */
const SESSION_STORAGE_KEY = "sightpath.sessions";
/** The camera the operator picked last, so a restart does not lose it. */
const CAMERA_STORAGE_KEY = "sightpath.cameraId";
/** How many sessions are kept before the oldest ones are dropped. */
const MAX_STORED_SESSIONS = 20;

/** The saccade protocol's defaults, taken from the desktop configuration. */
const SACADE_SETTINGS = {
  numTrials: 20,
  type: "horizontal" as const,
  eccentricitiesDeg: [10],
  randomizeDirection: true,
  randomizeTiming: true,
  seed: 20260101,
  fixationDurationMs: 1000,
  gapDurationMs: 200,
  targetDurationMs: 1000,
  responseWindowMs: 800,
};

/** The fixation protocol's defaults: a twenty second hold, as the desktop uses. */
const FIXATION_SETTINGS = { durationSeconds: 20 };

/** The validation protocol's defaults: the nine point grid of the desktop test. */
const VALIDATION_SETTINGS = {
  pattern: "grid_9" as const,
  marginPercent: 0.15,
  samplesPerPoint: 30,
  pointDurationMs: 2000,
  settlingMs: 500,
};

type Stage =
  | "home"
  | "calibration"
  | "test"
  | "saccade"
  | "fixation"
  | "validation"
  | "results";

/** A position on the stage, in pixels. */
export interface GazePoint {
  x: number;
  y: number;
}

/** What a stage is told about one camera frame. */
export interface StageFrame {
  /** Camera clock, in seconds. */
  timestamp: number;
  /** The newest eye sample, or null when the camera has not produced one yet. */
  sample: EyeSample | null;
  /** The newest gaze estimate in stage pixels, or null when there is no estimate. */
  gaze: GazePoint | null;
  /** The tracked landmarks of the newest frame, for the debug overlay. */
  landmarks: readonly NormalizedLandmark[] | null;
  /** Stage size in pixels. */
  width: number;
  height: number;
}

/**
 * The hooks a stage installs on the app.
 *
 * The camera animation loop runs outside React's render cycle, so the stages are
 * driven through these callbacks instead of through props: the app calls them on
 * every frame and every draw, and the stages keep their own state in refs.
 */
export interface StageController {
  onFrame(frame: StageFrame): void;
  onDraw(
    context: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void;
}

/** Narrowing guard for the sessions read back from storage. */
function isStoredSession(value: unknown): value is ProtocolSession {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ProtocolSession>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.startedAt === "string" &&
    typeof candidate.durationSeconds === "number" &&
    typeof candidate.metrics === "object" &&
    candidate.metrics !== null
  );
}

/**
 * The sessions stored before the other protocols existed have no protocol field; they were
 * all pursuit runs.
 */
function restoreStoredSession(value: ProtocolSession): ProtocolSession {
  const candidate = value as Partial<ProtocolSession> & { protocol?: string };
  if (candidate.protocol) return value;
  return { ...candidate, protocol: "pursuit" } as ProtocolSession;
}

export function App() {
  const [stage, setStage] = useState<Stage>("home");
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [model, setModel] = useState<GazeModel | null>(null);
  const [session, setSession] = useState<ProtocolSession | null>(null);
  const [history, setHistory] = useState<ProtocolSession[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [trackerError, setTrackerError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [calibrationRun, setCalibrationRun] = useState(0);

  // Resources shared by every stage.
  const trackerRef = useRef<VisionTracker | null>(null);
  const modelRef = useRef<GazeModel | null>(null);
  const sampleRef = useRef<EyeSample | null>(null);
  const gazeRef = useRef<GazePoint | null>(null);
  const landmarksRef = useRef<readonly NormalizedLandmark[] | null>(null);
  const stageSizeRef = useRef({ width: 0, height: 0 });
  const calibrationSizeRef = useRef({ width: 0, height: 0 });
  const controllerRef = useRef<StageController | null>(null);
  const cameraHostRef = useRef<HTMLDivElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const detectRequestRef = useRef(0);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  /* Cameras ------------------------------------------------------------- */

  const enumerateCameras = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    // Before the operator grants access the devices carry no id, so there is nothing
    // that could be selected; they are listed again once the permission is there.
    const inputs = devices.filter(
      (device) => device.kind === "videoinput" && device.deviceId !== ""
    );
    setCameras(
      inputs.map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      }))
    );
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(CAMERA_STORAGE_KEY);
    if (saved) setDeviceId(saved);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const requestAccess = async () => {
      try {
        // The preview opens its own stream, but the labels of the devices are only
        // readable once the operator has granted access, so the permission is asked
        // for up front and the stream is released again straight away.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        stream.getTracks().forEach((track) => track.stop());
        if (!cancelled) await enumerateCameras();
      } catch {
        if (!cancelled) {
          setCameraError(
            "The camera could not be opened. Allow the camera for this site in the browser, then start again."
          );
        }
      }
    };

    void requestAccess();
    return () => {
      cancelled = true;
    };
  }, [enumerateCameras]);

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.addEventListener) return;
    const handleChange = () => {
      void enumerateCameras();
    };
    media.addEventListener("devicechange", handleChange);
    return () => media.removeEventListener("devicechange", handleChange);
  }, [enumerateCameras]);

  useEffect(() => {
    if (cameras.length === 0) return;
    const known = cameras.some((camera) => camera.deviceId === deviceId);
    if (known) return;
    const fallback = cameras[0].deviceId;
    setDeviceId(fallback);
    try {
      window.localStorage.setItem(CAMERA_STORAGE_KEY, fallback);
    } catch {
      setStorageError("This browser refused to remember the chosen camera.");
    }
  }, [cameras, deviceId]);

  const handleDeviceChange = useCallback((nextDeviceId: string) => {
    setDeviceId(nextDeviceId);
    try {
      window.localStorage.setItem(CAMERA_STORAGE_KEY, nextDeviceId);
    } catch {
      setStorageError("This browser refused to remember the chosen camera.");
    }
  }, []);

  /* Eye tracker ---------------------------------------------------------- */

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

  /* Per-frame plumbing ---------------------------------------------------- */

  /**
   * The preview owns the camera, so the tracker is fed from the preview instead of
   * from a second camera stream. A canvas preview is copied into an offscreen
   * canvas first, because the stage draws its overlay on top of the preview and
   * the landmarks must not see those marks.
   */
  const captureSource = useCallback(():
    HTMLVideoElement | HTMLCanvasElement | null => {
    const host = cameraHostRef.current;
    if (!host) return null;

    const video = host.querySelector("video");
    if (video instanceof HTMLVideoElement && video.readyState >= 2)
      return video;

    const canvas = host.querySelector("canvas");
    if (canvas instanceof HTMLCanvasElement) {
      let copy = offscreenRef.current;
      if (!copy) {
        copy = document.createElement("canvas");
        offscreenRef.current = copy;
      }
      if (copy.width !== canvas.width) copy.width = canvas.width;
      if (copy.height !== canvas.height) copy.height = canvas.height;
      const context = copy.getContext("2d");
      if (context) {
        context.drawImage(canvas, 0, 0);
        return copy;
      }
    }

    return null;
  }, []);

  /** Turns the newest eye sample into a gaze position, clamped to the stage. */
  const applySample = useCallback((sample: EyeSample | null) => {
    sampleRef.current = sample;
    const currentModel = modelRef.current;
    if (!currentModel || !sample) {
      gazeRef.current = null;
      return;
    }
    const estimate = predictGaze(currentModel, sample);
    const { width, height } = stageSizeRef.current;
    // The model was fitted on the pixels of the stage it was calibrated on, so the
    // estimate is scaled when the stage has a different size now.
    const calibration = calibrationSizeRef.current;
    const scaleX =
      calibration.width > 0 && width > 0 ? width / calibration.width : 1;
    const scaleY =
      calibration.height > 0 && height > 0 ? height / calibration.height : 1;
    const scaledX = estimate.x * scaleX;
    const scaledY = estimate.y * scaleY;
    gazeRef.current =
      width > 0 && height > 0
        ? {
            x: Math.min(Math.max(scaledX, 0), width),
            y: Math.min(Math.max(scaledY, 0), height),
          }
        : { x: scaledX, y: scaledY };
  }, []);

  const handleFrame = useCallback(
    (timestamp: number) => {
      const tracker = trackerRef.current;
      if (tracker) {
        const source = captureSource();
        if (source) {
          detectRequestRef.current += 1;
          const requestId = detectRequestRef.current;
          void tracker
            .detect(source, timestamp * 1000)
            .then((result) => {
              // A slow detection must not overwrite the sample of a newer frame.
              if (requestId !== detectRequestRef.current) return;
              landmarksRef.current = result?.landmarks ?? null;
              applySample(result ? result.sample : null);
            })
            .catch(() => {
              // A failed detection simply means this frame has no eye sample.
            });
        }
      }

      const { width, height } = stageSizeRef.current;
      controllerRef.current?.onFrame({
        timestamp,
        sample: sampleRef.current,
        gaze: gazeRef.current,
        landmarks: landmarksRef.current,
        width,
        height,
      });
    },
    [applySample, captureSource]
  );

  const handleDraw = useCallback(
    (context: CanvasRenderingContext2D, width: number, height: number) => {
      stageSizeRef.current = { width, height };
      // The tracked points are drawn first, so the stage's own overlay sits on top of them.
      drawLandmarks(context, landmarksRef.current, width, height);
      controllerRef.current?.onDraw(context, width, height);
    },
    []
  );

  const handleCameraError = useCallback((message: string) => {
    setCameraError(message);
  }, []);

  /** Keep the size of the stage the model was fitted on, so the estimate can be scaled. */
  const handleModelReady = useCallback((fitted: GazeModel) => {
    calibrationSizeRef.current = { ...stageSizeRef.current };
    setModel(fitted);
  }, []);

  /* Sessions -------------------------------------------------------------- */

  const persistHistory = useCallback((sessions: ProtocolSession[]) => {
    try {
      window.localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify(sessions)
      );
    } catch {
      setStorageError("This browser refused to store the session history.");
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setHistory(
          parsed
            .filter(isStoredSession)
            .map(restoreStoredSession)
            .slice(0, MAX_STORED_SESSIONS)
        );
      }
    } catch {
      setStorageError("The stored session history could not be read.");
    }
  }, []);

  const handleSessionComplete = useCallback(
    (completed: ProtocolSession) => {
      const next = [completed, ...history].slice(0, MAX_STORED_SESSIONS);
      setHistory(next);
      persistHistory(next);
      setSession(completed);
      setStage("results");
    },
    [history, persistHistory]
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      const next = history.filter((entry) => entry.id !== id);
      setHistory(next);
      persistHistory(next);
    },
    [history, persistHistory]
  );

  /* Render ---------------------------------------------------------------- */

  const cameraStage = stage === "calibration" || stage === "test";

  return (
    <div className="sp-app">
      <header className="sp-header">
        <div className="sp-brand">
          <span className="sp-brand-mark">SightPath</span>
          <span className="sp-brand-tag">
            Research build — not clinically validated
          </span>
        </div>
      </header>

      <main className="sp-main">
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

        {storageError !== null && (
          <div className="sp-notice sp-notice--warn">
            <span className="sp-notice-title">Storage problem</span>
            <p>{storageError}</p>
          </div>
        )}

        {cameraStage && (
          <div className="sp-camera-wrap">
            <div className="sp-camera" ref={cameraHostRef}>
              <CameraView
                active
                deviceId={deviceId}
                facingMode="user"
                onFrame={handleFrame}
                onDraw={handleDraw}
                onError={handleCameraError}
              />
            </div>
            <p className="sp-camera-note">
              The camera picture is processed in this browser. No video and no
              measurement is sent anywhere.
            </p>
          </div>
        )}

        {stage === "home" && (
          <HomeStage
            cameras={cameras}
            deviceId={deviceId}
            hasModel={model !== null}
            onDeviceChange={handleDeviceChange}
            onStartCalibration={() => setStage("calibration")}
            onStartTest={() => setStage("test")}
            onStartProtocol={(protocol) =>
              setStage(
                protocol === "saccade"
                  ? "saccade"
                  : protocol === "fixation"
                    ? "fixation"
                    : "validation"
              )
            }
            onShowHistory={() => setHistoryOpen((open) => !open)}
          />
        )}

        {stage === "calibration" && (
          <CalibrationStage
            key={calibrationRun}
            controllerRef={controllerRef}
            onModelReady={handleModelReady}
            onContinue={() => setStage("test")}
            onCancel={() => setStage("home")}
            onRestart={() => setCalibrationRun((run) => run + 1)}
          />
        )}

        {stage === "test" && (
          <TestStage
            controllerRef={controllerRef}
            model={model}
            onComplete={handleSessionComplete}
            onCancel={() => setStage("home")}
          />
        )}

        {stage === "saccade" && (
          <ProtocolStage
            protocol="saccade"
            settings={SACADE_SETTINGS}
            model={model}
            deviceId={deviceId}
            calibrationSize={calibrationSizeRef.current}
            onComplete={handleSessionComplete}
            onCancel={() => setStage("home")}
          />
        )}

        {stage === "fixation" && (
          <ProtocolStage
            protocol="fixation"
            settings={FIXATION_SETTINGS}
            model={model}
            deviceId={deviceId}
            calibrationSize={calibrationSizeRef.current}
            onComplete={handleSessionComplete}
            onCancel={() => setStage("home")}
          />
        )}

        {stage === "validation" && (
          <ProtocolStage
            protocol="validation"
            settings={VALIDATION_SETTINGS}
            model={model}
            deviceId={deviceId}
            calibrationSize={calibrationSizeRef.current}
            onComplete={handleSessionComplete}
            onCancel={() => setStage("home")}
          />
        )}

        {stage === "results" && session !== null && (
          <ProtocolResults
            protocol={session.protocol}
            session={session}
            onRunAnother={() => setStage("test")}
            onHome={() => setStage("home")}
          />
        )}

        {historyOpen && (
          <HistoryPanel
            sessions={history}
            onDelete={handleDeleteSession}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </main>

      <footer className="sp-footer">
        <p>
          SightPath keeps every measurement in this browser only. There are no
          accounts, no patient records and no server-side storage.
        </p>
        <p>
          The thresholds shown here are provisional and have not been clinically
          validated.
        </p>
      </footer>
    </div>
  );
}
