"use client";

import { useEffect, useRef } from "react";

import {
  buildHeatmap,
  buildPositionOverTime,
  buildTrajectory,
  drawHeatmap,
  drawPositionOverTime,
  drawTrajectory,
} from "../lib/trajectory";
import type { TrackingFrame } from "../lib/types";

export interface TrajectoryPanelProps {
  frames: TrackingFrame[];
  /** The size the drawings are rendered at. */
  width: number;
  height: number;
}

/**
 * The three views of a run: where the gaze went, how it moved over time, and where the
 * time was spent. The desktop app exports the same three as images (`visualization.py`).
 */
export function TrajectoryPanel({
  frames,
  width,
  height,
}: TrajectoryPanelProps) {
  const trajectoryRef = useRef<HTMLCanvasElement | null>(null);
  const timeRef = useRef<HTMLCanvasElement | null>(null);
  const heatmapRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const trajectory = trajectoryRef.current;
    const time = timeRef.current;
    const heatmap = heatmapRef.current;
    if (!trajectory || !time || !heatmap || width <= 0 || height <= 0) return;

    const draw = (
      canvas: HTMLCanvasElement,
      painter: (
        context: CanvasRenderingContext2D,
        width: number,
        height: number
      ) => void
    ) => {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = "#11111f";
      context.fillRect(0, 0, width, height);
      painter(context, width, height);
    };

    draw(trajectory, (context, w, h) =>
      drawTrajectory(context, buildTrajectory(frames), w, h)
    );
    draw(time, (context, w, h) =>
      drawPositionOverTime(context, buildPositionOverTime(frames), w, h)
    );
    draw(heatmap, (context, w, h) =>
      drawHeatmap(context, buildHeatmap(frames, w, h, 50), w, h)
    );
  }, [frames, width, height]);

  const download = (canvas: HTMLCanvasElement | null, name: string) => {
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${name}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="sp-plots">
      <figure className="sp-plot">
        <canvas ref={trajectoryRef} />
        <figcaption>
          Gaze trajectory
          <button
            type="button"
            className="sp-button sp-button--small"
            onClick={() =>
              download(trajectoryRef.current, "sightpath-trajectory")
            }
          >
            PNG
          </button>
        </figcaption>
      </figure>
      <figure className="sp-plot">
        <canvas ref={timeRef} />
        <figcaption>
          Position over time
          <button
            type="button"
            className="sp-button sp-button--small"
            onClick={() =>
              download(timeRef.current, "sightpath-position-over-time")
            }
          >
            PNG
          </button>
        </figcaption>
      </figure>
      <figure className="sp-plot">
        <canvas ref={heatmapRef} />
        <figcaption>
          Gaze heatmap
          <button
            type="button"
            className="sp-button sp-button--small"
            onClick={() => download(heatmapRef.current, "sightpath-heatmap")}
          >
            PNG
          </button>
        </figcaption>
      </figure>
    </div>
  );
}
