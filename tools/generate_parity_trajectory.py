"""Generate the parity fixture for the browser trajectory port.

Runs the desktop visualisation code in ``src/visualization.py`` over a deterministic
synthetic run and records what it plotted: the gaze path, the position over time and the
density grid behind the heatmap. The browser port in ``web/lib/trajectory.ts`` has to
reproduce those numbers and the same colour ramp, so that both versions show the same
run in the same way.

Run it from the repository root::

    python tools/generate_parity_trajectory.py

Re-run it whenever the desktop visualisation changes, then run the TypeScript suite
(``cd web && npm test``): a mismatch between the two is the signal that the versions
have drifted apart.
"""

import json
import math
import sys
from pathlib import Path

import matplotlib
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

import visualization  # noqa: E402
from smooth_pursuit_test import TargetPattern, TestResult, TrackingFrame  # noqa: E402

FIXTURES = ROOT / "web" / "tests" / "fixtures"

# The screen and the bin count the desktop uses for the heatmap.
SCREEN_WIDTH = 1920
SCREEN_HEIGHT = 1080
BINS = 50


def build_frames():
    """A deterministic pursuit run with gaps in the tracking.

    Every 37th frame carries no estimate, and two frames put the estimate off the screen
    so that the binning has to leave them out.
    """
    frames = []
    for index in range(180):
        t = round(index / 30.0, 6)
        target_x = SCREEN_WIDTH / 2 + 700 * math.sin(2 * math.pi * t / 6.0)
        target_y = SCREEN_HEIGHT / 2 + 260 * math.sin(2 * math.pi * t / 3.0)
        gaze_x = target_x + 14 * math.sin(index * 0.9)
        gaze_y = target_y + 9 * math.cos(index * 0.6)
        tracked = index % 37 != 0
        frames.append(TrackingFrame(
            timestamp=t,
            target_x=int(round(target_x)),
            target_y=int(round(target_y)),
            gaze_x=int(round(gaze_x)) if tracked else None,
            gaze_y=int(round(gaze_y)) if tracked else None,
            head_pitch=round(1.5 * math.sin(index * 0.05), 6),
            head_yaw=round(-1.2 * math.cos(index * 0.04), 6),
            face_detected=True,
        ))
    # Two estimates land outside the screen: the desktop bins only what falls inside.
    frames[11].gaze_x = -40
    frames[23].gaze_y = SCREEN_HEIGHT + 75
    return frames


def capture(result):
    """Run the desktop visualiser over the run and return what it plotted.

    The plotting methods are wrapped so that the data they are handed is recorded, and
    so that the histograms the heatmap is built from can be read back.
    """
    visualizer = visualization.TrajectoryVisualizer()
    captured = {}

    original_xy = visualizer.plot_xy_trajectory
    original_time = visualizer.plot_time_series

    def spy_xy(gaze_x, gaze_y, target_x, target_y, timestamps=None, title=""):
        captured["trajectory"] = {
            "x": [float(value) for value in gaze_x],
            "y": [float(value) for value in gaze_y],
            "t": [float(value) for value in (timestamps or [])],
        }
        return original_xy(gaze_x, gaze_y, target_x, target_y, timestamps, title)

    def spy_time(gaze_x, gaze_y, target_x, target_y, timestamps, title=""):
        figure = original_time(gaze_x, gaze_y, target_x, target_y, timestamps, title)
        # Each axis holds the target first and the gaze second, on a time axis that
        # starts at zero.
        captured["timeSeries"] = {
            "t": np.asarray(figure.axes[0].lines[1].get_xdata()).tolist(),
            "x": np.asarray(figure.axes[0].lines[1].get_ydata()).tolist(),
            "y": np.asarray(figure.axes[1].lines[1].get_ydata()).tolist(),
        }
        return figure

    visualizer.plot_xy_trajectory = spy_xy
    visualizer.plot_time_series = spy_time

    visualization.generate_trajectory_from_result(result, visualizer)

    # The heatmap bins the gaze with numpy; the counts are read back from there.
    gaze_x = [f.gaze_x for f in result.frames if f.gaze_x is not None]
    gaze_y = [f.gaze_y for f in result.frames if f.gaze_y is not None]

    original_histogram2d = np.histogram2d
    counts = {}

    def spy_histogram2d(x, y, bins=None, range=None, density=None, weights=None):
        result_counts, x_edges, y_edges = original_histogram2d(
            x, y, bins=bins, range=range, density=density, weights=weights)
        counts["values"] = result_counts
        counts["xEdges"] = x_edges
        counts["yEdges"] = y_edges
        return result_counts, x_edges, y_edges

    np.histogram2d = spy_histogram2d
    try:
        visualizer.plot_heatmap(gaze_x, gaze_y, screen_width=SCREEN_WIDTH,
                                screen_height=SCREEN_HEIGHT, bins=BINS)
    finally:
        np.histogram2d = original_histogram2d

    # numpy counts the bins as [x][y]; the browser grid is column-major over [y][x].
    grid = counts["values"].T.ravel()
    captured["heatmap"] = {
        "columns": BINS,
        "rows": BINS,
        "cells": [int(value) for value in grid],
        "max": int(counts["values"].max()),
    }

    hot = matplotlib.colormaps["hot"](np.linspace(0.0, 1.0, 256))[:, :3]
    captured["hotLut"] = [[float(channel) for channel in row] for row in hot]
    return captured


def dump(path, frames, captured):
    """Write one fixture: the frames, and the data the Python code plotted."""
    payload = {
        "description": path.stem,
        "screen": {"widthPx": SCREEN_WIDTH, "heightPx": SCREEN_HEIGHT},
        "bins": BINS,
        "frames": [
            {
                "timestamp": f.timestamp,
                "targetX": f.target_x, "targetY": f.target_y,
                "gazeX": f.gaze_x, "gazeY": f.gaze_y,
                "headPitch": f.head_pitch, "headYaw": f.head_yaw,
                "faceDetected": f.face_detected,
            }
            for f in frames
        ],
        "expected": {
            "trajectory": captured["trajectory"],
            "timeSeries": captured["timeSeries"],
            "heatmap": captured["heatmap"],
            "hotLut": captured["hotLut"],
        },
    }
    path.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print(f"{path.name}: samples={len(captured['trajectory']['x'])} "
          f"frames={len(frames)} max={captured['heatmap']['max']}")


def main():
    FIXTURES.mkdir(parents=True, exist_ok=True)

    frames = build_frames()
    result = TestResult(pattern=TargetPattern.HORIZONTAL, duration=6.0)
    result.frames = frames

    dump(FIXTURES / "parity-trajectory.json", frames, capture(result))


if __name__ == "__main__":
    main()
