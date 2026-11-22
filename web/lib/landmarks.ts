/**
 * The tracked landmarks, drawn over the camera picture.
 *
 * The desktop app shows the same overlay in its preview (`EyeTracker.draw_debug`): the iris
 * centres and the eye corners, so the operator can see at a glance whether the tracker is
 * following the right eyes.
 */

import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

/** A landmark as MediaPipe reports it: normalised to the frame. */
export type { NormalizedLandmark };

/** The iris centre landmarks: 468 for the left eye, 473 for the right. */
const IRIS_CENTERS = [468, 473];

/** The eye corners: the outer and inner corner of each eye. */
const EYE_CORNERS = [33, 159, 362, 263];

/**
 * Draw the tracked points.
 *
 * The picture is mirrored for the subject, so the landmarks are mirrored with it; otherwise
 * the overlay would sit on the wrong side of the face.
 */
export function drawLandmarks(
  context: CanvasRenderingContext2D,
  landmarks: readonly NormalizedLandmark[] | null,
  width: number,
  height: number
): void {
  if (!landmarks || landmarks.length === 0) return;

  const point = (index: number): { x: number; y: number } | null => {
    const landmark = landmarks[index];
    if (!landmark) return null;
    return { x: (1 - landmark.x) * width, y: landmark.y * height };
  };

  context.save();
  context.fillStyle = "rgba(255, 190, 60, 0.95)";
  for (const index of EYE_CORNERS) {
    const position = point(index);
    if (!position) continue;
    context.beginPath();
    context.arc(position.x, position.y, 3, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = "rgba(80, 220, 255, 0.95)";
  for (const index of IRIS_CENTERS) {
    const position = point(index);
    if (!position) continue;
    context.beginPath();
    context.arc(position.x, position.y, 5, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}
