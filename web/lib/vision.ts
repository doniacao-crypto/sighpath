"use client";

/**
 * Eye tracking in the browser — a port of the MediaPipe wrapper in src/eye_tracker.py.
 *
 * The desktop app measures where the iris sits inside the eye socket and how the head is
 * turned; the calibration model is fitted on those numbers. This module produces the same
 * measurements from a webcam so that a browser run can be compared with a desktop run.
 */

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { Matrix, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { EyeSample } from "./types";

/** The model and the wasm runtime are served from /public by the Next.js server. */
const DEFAULT_MODEL_PATH = "/models/face_landmarker.task";
const DEFAULT_WASM_PATH = "/wasm";

/** Iris centres in the MediaPipe face mesh; the mesh only carries irises from index 468 on. */
const LEFT_IRIS_CENTRE = 468;
const RIGHT_IRIS_CENTRE = 473;

/**
 * Outer and inner corner of each eye, picked the way the desktop app picks them: the
 * first and the ninth entry of its eye index list.
 */
const LEFT_EYE_OUTER = 33;
const LEFT_EYE_INNER = 133;
const RIGHT_EYE_OUTER = 362;
const RIGHT_EYE_INNER = 263;

/**
 * The six points per eye that form the contour of the eye aspect ratio:
 * [outer corner, upper 1, upper 2, inner corner, lower 2, lower 1].
 */
const LEFT_EYE_EAR_INDICES = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_EAR_INDICES = [362, 385, 387, 263, 373, 380];

/** Eye aspect ratio under which the eye counts as closed (EAR_THRESHOLD in src/eye_tracker.py). */
const EAR_THRESHOLD = 0.21;

/** Number of consecutive closed-eye frames needed before a blink is confirmed. */
const EAR_CONSEC_FRAMES = 2;

/** The mesh has to carry all 478 points for the iris landmarks to exist. */
const IRIS_LANDMARK_COUNT = 478;

export interface VisionOptions {
  /** Where the face landmarker model is served from. */
  modelPath?: string;
  /** Where the MediaPipe wasm runtime is served from. */
  wasmPath?: string;
  /** How many faces are tracked at the same time. */
  numFaces?: number;
}

/** One measured frame: the sample the calibration model is fitted on, plus the raw mesh. */
export interface VisionFrame {
  sample: EyeSample;
  landmarks: unknown[];
}

/**
 * A face landmarker that turns camera frames into eye samples.
 *
 * The model is loaded once and then fed frames in video mode, which is both faster and
 * steadier than treating every frame as an independent picture.
 */
export class VisionTracker {
  private readonly landmarker: FaceLandmarker;

  /** MediaPipe only accepts strictly increasing timestamps, so the last one is remembered. */
  private lastTimestampMs = 0;

  /** Consecutive frames with a closed eye, used to confirm a blink. */
  private blinkCounter = 0;

  private closed = false;

  private constructor(landmarker: FaceLandmarker) {
    this.landmarker = landmarker;
  }

  /**
   * Load the face landmarker. The model and the wasm runtime are fetched from the Next.js
   * server, so this only works in the browser.
   */
  static async create(options: VisionOptions = {}): Promise<VisionTracker> {
    const modelPath = options.modelPath ?? DEFAULT_MODEL_PATH;
    const wasmPath = options.wasmPath ?? DEFAULT_WASM_PATH;
    const numFaces = options.numFaces ?? 1;
    try {
      const fileset = await FilesetResolver.forVisionTasks(wasmPath);
      const landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath },
        runningMode: "VIDEO",
        numFaces,
        outputFaceBlendshapes: false,
        // The head pose is read from the transformation matrix; without it the
        // calibration would have no pitch and yaw feature.
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      return new VisionTracker(landmarker);
    } catch (error) {
      throw new Error(
        `Could not start the face landmarker (model "${modelPath}", wasm "${wasmPath}"): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Measure one frame. Returns null when no face was found.
   *
   * @param source the picture to measure, normally the camera video element.
   * @param timestamp capture time in milliseconds. The value is forwarded to the
   *   landmarker, which insists on strictly increasing timestamps, so a timestamp that
   *   repeats or goes backwards is nudged forward by a millisecond.
   */
  async detect(
    source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap,
    timestamp: number
  ): Promise<VisionFrame | null> {
    if (this.closed) {
      throw new Error("The eye tracker has been closed.");
    }
    const frameMs = Math.max(timestamp, this.lastTimestampMs + 1);
    this.lastTimestampMs = frameMs;

    const result = this.landmarker.detectForVideo(source, frameMs);
    const landmarks = result.faceLandmarks?.[0];
    // Without the iris landmarks there is nothing to measure, so the frame is dropped.
    if (!landmarks || landmarks.length < IRIS_LANDMARK_COUNT) {
      return null;
    }

    const { width, height } = frameDimensions(source);
    const left = irisOffsetInEye(
      landmarks[LEFT_IRIS_CENTRE],
      landmarks[LEFT_EYE_OUTER],
      landmarks[LEFT_EYE_INNER],
      width,
      height
    );
    const right = irisOffsetInEye(
      landmarks[RIGHT_IRIS_CENTRE],
      landmarks[RIGHT_EYE_OUTER],
      landmarks[RIGHT_EYE_INNER],
      width,
      height
    );
    const pose = headPose(result.facialTransformationMatrixes?.[0]);
    const isBlinking = this.detectBlink(
      eyeAspectRatio(landmarks, LEFT_EYE_EAR_INDICES),
      eyeAspectRatio(landmarks, RIGHT_EYE_EAR_INDICES)
    );

    const sample: EyeSample = {
      // The rest of the app measures time in seconds, so the millisecond stamp of the
      // frame is reported in seconds as well.
      timestamp: frameMs / 1000,
      leftGazeX: left.x,
      leftGazeY: left.y,
      rightGazeX: right.x,
      rightGazeY: right.y,
      headPitch: pose.pitch,
      headYaw: pose.yaw,
      faceDetected: true,
      isBlinking,
    };
    return { sample, landmarks };
  }

  /** Release the model. The tracker cannot be used afterwards. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.landmarker.close();
  }

  /**
   * Confirm a blink the way the desktop app does: the average eye aspect ratio has to
   * stay below the threshold for a number of consecutive frames, which keeps a single
   * noisy frame from being read as a blink.
   */
  private detectBlink(leftEar: number, rightEar: number): boolean {
    if ((leftEar + rightEar) / 2 < EAR_THRESHOLD) {
      this.blinkCounter += 1;
    } else {
      this.blinkCounter = 0;
    }
    return this.blinkCounter >= EAR_CONSEC_FRAMES;
  }
}

/**
 * The iris position inside the eye socket, normalised by the eye width and centred on
 * 0.5. This isolates the gaze from the head position: the iris moves inside the socket
 * while the whole face travels across the frame.
 *
 * The desktop app measures this on pixel coordinates, so the landmarks are scaled to the
 * frame before the offset is taken.
 */
function irisOffsetInEye(
  iris: NormalizedLandmark,
  outerCorner: NormalizedLandmark,
  innerCorner: NormalizedLandmark,
  frameWidth: number,
  frameHeight: number
): { x: number; y: number } {
  const outerX = outerCorner.x * frameWidth;
  const outerY = outerCorner.y * frameHeight;
  const innerX = innerCorner.x * frameWidth;
  const innerY = innerCorner.y * frameHeight;
  const centreX = (outerX + innerX) / 2;
  const centreY = (outerY + innerY) / 2;
  const eyeWidth = Math.hypot(innerX - outerX, innerY - outerY);
  // An eye that is too small to measure carries no information; the neutral position is
  // the only safe answer.
  if (eyeWidth < 1) {
    return { x: 0.5, y: 0.5 };
  }
  const offsetX = (iris.x * frameWidth - centreX) / eyeWidth;
  const offsetY = (iris.y * frameHeight - centreY) / eyeWidth;
  // The camera picture is not mirrored: looking to the left of the screen moves the iris
  // to the right of the image, so x is negated to keep the direction of the gaze.
  return { x: 0.5 - offsetX, y: 0.5 + offsetY };
}

/**
 * Eye aspect ratio of one eye: how far the eye is open relative to its width. An open eye
 * sits around 0.25, a closed one below 0.15.
 *
 * The desktop app measures the ratio on the normalised landmarks, so it is computed the
 * same way here.
 */
function eyeAspectRatio(
  landmarks: NormalizedLandmark[],
  indices: number[]
): number {
  const [p1, p2, p3, p4, p5, p6] = indices.map((index) => landmarks[index]);
  const vertical1 = Math.hypot(p2.x - p6.x, p2.y - p6.y);
  const vertical2 = Math.hypot(p3.x - p5.x, p3.y - p5.y);
  const horizontal = Math.hypot(p1.x - p4.x, p1.y - p4.y);
  if (horizontal < 0.001) {
    return 0;
  }
  return (vertical1 + vertical2) / (2 * horizontal);
}

/**
 * Head pose in degrees, read from the facial transformation matrix.
 *
 * The matrix maps the canonical face onto the camera space of MediaPipe: +x points to the
 * right of the image, +y up and +z away from the camera. The canonical face looks down its
 * own -z, so a face that looks straight at the screen gives a rotation matrix of about the
 * identity and the angles below come out near zero.
 *
 * The rotation is decomposed as R = Ry(yaw) * Rx(pitch) * Rz(roll):
 *  - yaw turns the head around the vertical axis; positive turns it towards the subject's
 *    own right, which is the left of the image.
 *  - pitch nods the head around the horizontal axis; positive lifts the chin.
 *  - roll tilts the head around the viewing axis; positive tips it towards the subject's
 *    own right.
 *
 * The convention is the browser's own. The calibration fits the scale of the head pose
 * features to the subject, so what matters is that the values are consistent and steady,
 * not how they relate to the desktop app.
 */
function headPose(matrix: Matrix | undefined): {
  pitch: number;
  yaw: number;
  roll: number;
} {
  if (!matrix) {
    return { pitch: 0, yaw: 0, roll: 0 };
  }
  // The matrix is column major, so the entry of row r and column c sits at data[c * 4 + r].
  const data = matrix.data;
  const r10 = data[1];
  const r11 = data[5];
  const r02 = data[8];
  const r12 = data[9];
  const r22 = data[10];
  // The argument of asin is clamped because the decomposition can push it just past one
  // when the head is turned far past the point where pitch and roll are separable.
  const pitch = Math.asin(Math.min(1, Math.max(-1, -r12)));
  const yaw = Math.atan2(r02, r22);
  const roll = Math.atan2(r10, r11);
  return {
    pitch: (pitch * 180) / Math.PI,
    yaw: (yaw * 180) / Math.PI,
    roll: (roll * 180) / Math.PI,
  };
}

/**
 * The pixel size of the frame that was handed to the landmarker. The landmarks are
 * normalised, so the iris offset is measured in pixels of this frame.
 */
function frameDimensions(
  source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap
): { width: number; height: number } {
  const video = source as HTMLVideoElement;
  if (typeof video.videoWidth === "number" && video.videoWidth > 0) {
    return { width: video.videoWidth, height: video.videoHeight };
  }
  return { width: source.width, height: source.height };
}
