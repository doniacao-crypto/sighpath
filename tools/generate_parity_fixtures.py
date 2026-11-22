"""Generate the parity fixtures for the web port.

Runs the Python implementation over a deterministic synthetic frame set and writes the
frames plus the metrics it produced into ``web/tests/fixtures/``. The TypeScript port
in ``web/lib/metrics.ts`` must reproduce those numbers: that is the contract that
keeps the desktop app and the browser app measuring the same thing.

Run it from the repository root:

    python tools/generate_parity_fixtures.py

Re-run it whenever the Python metric implementation changes, then run the TypeScript
suite (``cd web && npm test``): a mismatch between the two is the signal that the
versions have drifted apart.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from metrics import ScreenConfig  # noqa: E402
from smooth_pursuit_test import TestResult, TrackingFrame, TargetPattern  # noqa: E402

FIXTURES = ROOT / "web" / "tests" / "fixtures"

# The screen the fixtures were recorded on: a 27" 16:9 panel seen from 60 cm.
SCREEN = ScreenConfig(width_px=1920, height_px=1080, width_cm=53.1, height_cm=29.9,
                      viewing_distance_cm=60.0)

# The screen diagonal in pixels, the distance the metrics convert pixel error over.
SCREEN_DIAGONAL_PX = 2202.0


def sweep(gain, count=300, dt=1 / 30.0, amplitude=880.0, period=6.0, center=960.0,
          noise=4.0, head_drift=0.0, seed=7):
    """Target sweeps a sinusoid; the gaze follows it scaled by `gain`, with noise."""
    rng = np.random.default_rng(seed)
    frames = []
    for i in range(count):
        t = i * dt
        offset = amplitude * math.sin(2 * math.pi * t / period)
        frames.append(TrackingFrame(
            timestamp=round(t, 6),
            target_x=int(center + offset), target_y=540,
            gaze_x=int(center + gain * offset + rng.normal(0, noise)),
            gaze_y=int(540 + rng.normal(0, noise)),
            head_pitch=round(head_drift * math.sin(2 * math.pi * t / 11.0), 6),
            head_yaw=round(head_drift * math.cos(2 * math.pi * t / 13.0), 6),
            face_detected=True,
        ))
    return frames


def build(frames):
    """Run the desktop implementation over the frames and return its result."""
    result = TestResult(pattern=TargetPattern.HORIZONTAL, duration=10.0)
    result.frames = frames
    result.compute_metrics(SCREEN_DIAGONAL_PX, screen_config=SCREEN)
    return result


def dump(path, frames, result):
    """Write one fixture: the frames, and the metrics the Python code produced."""
    payload = {
        "description": path.stem,
        "screen": {"widthPx": 1920, "heightPx": 1080, "widthCm": 53.1, "heightCm": 29.9,
                   "viewingDistanceCm": 60.0},
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
            "trackingRatio": round(result.tracking_ratio, 6),
            "directionMatch": round(result.accuracy_score, 6),
            "speedMatch": round(result.speed_match_score, 6),
            "smoothScore": round(result.smooth_score, 6),
            "headStillness": round(result.head_stillness_score, 6),
            "avgDistancePx": round(result.avg_distance_px, 6),
            "pursuitGain": round(result.pursuit_gain, 6),
            "accuracyDegrees": round(result.accuracy_degrees, 6),
            "phaseLagMs": round(result.lag_ms, 6),
            "totalFrames": len(result.frames),
        },
    }
    path.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print(f"{path.name}: tracking={result.tracking_ratio:.2f} "
          f"direction={result.accuracy_score:.2f} speed={result.speed_match_score:.2f} "
          f"gain={result.pursuit_gain:.4f} err={result.accuracy_degrees:.4f} "
          f"lag={result.lag_ms:.2f}")


def main():
    FIXTURES.mkdir(parents=True, exist_ok=True)

    for name, kwargs in (
        ("parity-faithful", {}),
        ("parity-damped", {"gain": 0.5}),
        ("parity-noisy", {"gain": 0.7, "noise": 12.0, "seed": 11}),
        ("parity-head-drift", {"gain": 0.8, "head_drift": 6.0, "seed": 3}),
    ):
        frames = sweep(kwargs.pop("gain", 1.0), **kwargs)
        dump(FIXTURES / f"{name}.json", frames, build(frames))


if __name__ == "__main__":
    main()
