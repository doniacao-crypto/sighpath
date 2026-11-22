"use client";

import { useEffect, useRef } from "react";

/** readyState value that means the video already holds a frame to draw. */
const HAVE_CURRENT_DATA = 2;

/**
 * Smallest picture size worth drawing into. A camera that reports less than this cannot
 * carry the overlay, and the display size is used instead.
 */
const MIN_DRAWABLE_SIZE = 16;

export interface CameraViewProps {
  /** The camera is only opened while this is true. */
  active: boolean;
  /** The camera to open; the default device is used when it is null. */
  deviceId?: string | null;
  /** Which camera to open. The front camera is mirrored for the subject. */
  facingMode?: "user" | "environment";
  /** Called after every animation frame with the capture timestamp in seconds. */
  onFrame?: (timestampSeconds: number) => void;
  /** Called when a frame has been drawn, so the parent can paint on top. */
  onDraw?: (
    context: CanvasRenderingContext2D,
    width: number,
    height: number
  ) => void;
  onError?: (message: string) => void;
}

/**
 * The camera picture with a transparent canvas on top of it.
 *
 * The component owns the camera and the drawing loop; the parent only reacts to the
 * frames it is handed and paints its own overlay in the canvas.
 */
export function CameraView({
  active,
  deviceId = null,
  facingMode = "user",
  onFrame,
  onDraw,
  onError,
}: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // The callbacks are held in refs: the parent usually passes new function identities on
  // every render, and restarting the camera for that would be ruinous.
  const onFrameRef = useRef(onFrame);
  const onDrawRef = useRef(onDraw);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onFrameRef.current = onFrame;
    onDrawRef.current = onDraw;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!active) {
      return;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      return;
    }

    let stream: MediaStream | null = null;
    let animationFrame: number | null = null;
    let cancelled = false;

    const report = (message: string) => {
      if (!cancelled) {
        onErrorRef.current?.(message);
      }
    };

    const openCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        report(
          "This browser does not offer a camera API. The test needs a secure context (https or localhost)."
        );
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            facingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (error) {
        report(describeCameraError(error));
        return;
      }
      if (cancelled) {
        // The camera was closed again while it was opening.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const context = canvas.getContext("2d");
      if (!context) {
        report(
          "The browser did not give the camera overlay a drawing context."
        );
        return;
      }

      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay may be refused; the frames arrive as soon as the video starts.
      }

      const draw = () => {
        animationFrame = requestAnimationFrame(draw);
        if (video.readyState < HAVE_CURRENT_DATA || video.videoWidth === 0) {
          return;
        }
        // Some cameras report a degenerate picture size. A canvas that small cannot carry
        // the overlay, so the display size is used instead.
        const usableVideoSize =
          video.videoWidth >= MIN_DRAWABLE_SIZE &&
          video.videoHeight >= MIN_DRAWABLE_SIZE;
        const width = usableVideoSize ? video.videoWidth : canvas.clientWidth;
        const height = usableVideoSize
          ? video.videoHeight
          : canvas.clientHeight;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        drawFrame(
          context,
          video,
          canvas.width,
          canvas.height,
          facingMode === "user"
        );
        // The parent needs the newest timestamp and gaze estimate before it paints.
        onFrameRef.current?.(performance.now() / 1000);
        onDrawRef.current?.(context, canvas.width, canvas.height);
      };
      animationFrame = requestAnimationFrame(draw);
    };

    void openCamera();

    return () => {
      cancelled = true;
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, [active, deviceId, facingMode]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        background: "#000",
        overflow: "hidden",
      }}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </div>
  );
}

/**
 * Draw the video into the canvas.
 *
 * The subject sees a mirror of themselves, so the picture is flipped horizontally. The
 * landmarks keep the orientation of the camera frame, because the tracker reads the video
 * element and not the canvas.
 */
function drawFrame(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
  mirrored: boolean
): void {
  if (mirrored) {
    context.save();
    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, width, height);
    context.restore();
  } else {
    context.drawImage(video, 0, 0, width, height);
  }
}

/**
 * Turn the browser's camera error into something the operator can act on.
 */
function describeCameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera permission was denied. Allow the camera for this site and start the test again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found on this device.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is busy in another application. Close it and start the test again.";
    case "OverconstrainedError":
      return "The camera does not support the requested picture size.";
    case "SecurityError":
      return "The camera is blocked because this page is not a secure context (https or localhost).";
    default:
      return `The camera could not be opened: ${
        error instanceof Error ? error.message : String(error)
      }`;
  }
}
