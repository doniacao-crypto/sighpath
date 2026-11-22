"""Generate the parity fixtures for the web fixation port.

Runs the desktop implementation (src/metrics.py and src/smooth_pursuit_test.py) over
deterministic synthetic fixation runs and writes the frames plus the metrics it produced
into ``web/tests/fixtures/``. The TypeScript port in ``web/lib/fixation.ts`` must reproduce
those numbers: that is the contract that keeps the desktop app and the browser app
measuring the same thing.

Run it from the repository root:

    python tools/generate_parity_fixation.py

Re-run it whenever the Python metric implementation changes, then run the TypeScript suite
(``cd web && npm test``): a mismatch between the two is the signal that the versions have
drifted apart.
"""

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from metrics import MetricsCalculator, ScreenConfig  # noqa: E402
from smooth_pursuit_test import TargetPattern, TestResult, TrackingFrame  # noqa: E402

FIXTURES = ROOT / "web" / "tests" / "fixtures"

# The screen the fixtures were recorded on: a 27" 16:9 panel seen from 60 cm.
SCREEN = ScreenConfig(width_px=1920, height_px=1080, width_cm=53.1, height_cm=29.9,
                      viewing_distance_cm=60.0)

# The screen diagonal in pixels, the distance the desktop metrics are given.
SCREEN_DIAGONAL_PX = 2202.0

# The fixation point the subject holds: the centre of the screen.
FIXATION_POINT = (960, 540)

# Camera rate of the recorded runs.
DT = 1.0 / 30.0

# Pixels per degree of visual angle on that screen, used to size the synthetic movements.
PIXELS_PER_DEGREE = SCREEN.pixels_per_degree


def run(count=300, noise=1.2, seed=5, offsets=(), drops=()):
    """Record a fixation run: a steady gaze with sensor noise and scripted movements.

    Args:
        count: Number of frames.
        noise: Standard deviation of the gaze noise, in pixels.
        seed: Seed of the noise generator, so the run is reproducible.
        offsets: Scripted movements as (first_frame, last_frame, dx, dy). The gaze is
            displaced by (dx, dy) pixels for the frames in [first_frame, last_frame).
        drops: Frame indices whose gaze estimate is missing, as if the subject blinked.
    """
    rng = np.random.default_rng(seed)
    frames = []
    for i in range(count):
        dx = 0.0
        dy = 0.0
        for first, last, ox, oy in offsets:
            if first <= i < last:
                dx += ox
                dy += oy

        gaze_x = None
        gaze_y = None
        if i not in drops:
            gaze_x = int(round(FIXATION_POINT[0] + dx + rng.normal(0, noise)))
            gaze_y = int(round(FIXATION_POINT[1] + dy + rng.normal(0, noise)))

        frames.append(TrackingFrame(
            timestamp=round(i * DT, 6),
            target_x=FIXATION_POINT[0], target_y=FIXATION_POINT[1],
            gaze_x=gaze_x, gaze_y=gaze_y,
            head_pitch=0.0, head_yaw=0.0,
            face_detected=True,
        ))
    return frames


def measure(frames):
    """Run the desktop implementation over the frames and return the fixation metrics."""
    result = TestResult(pattern=TargetPattern.FIXATION, duration=len(frames) * DT)
    result.frames = frames
    # The desktop computes the share of frames that produced a usable gaze estimate here.
    result.compute_metrics(SCREEN_DIAGONAL_PX, screen_config=SCREEN)

    valid = [f for f in frames if f.gaze_x is not None and f.face_detected]
    timestamps = np.array([f.timestamp for f in valid])
    gaze = np.array([[f.gaze_x, f.gaze_y] for f in valid])

    calc = MetricsCalculator(SCREEN)

    # BCEA, the microsaccade count and the microsaccade rate come straight from the
    # desktop's own fixation metrics.
    fixation = calc.calculate_fixation_metrics(gaze, timestamps)
    microsaccades = calc.detect_microsaccades(gaze, timestamps)

    # The scatter of the gaze around its own mean, measured with the desktop's RMS error.
    mean_position = np.tile(np.mean(gaze, axis=0), (len(gaze), 1))
    stability = calc.calculate_rms_error(mean_position, gaze)

    # The RMS error against the fixation point the subject was asked to hold.
    target = np.tile(FIXATION_POINT, (len(gaze), 1))
    rms_error = calc.calculate_rms_error(target, gaze)

    mean_amplitude = (
        float(np.mean([m.amplitude_deg for m in microsaccades])) if microsaccades else 0.0
    )

    return {
        "bceaDeg2": fixation.bcea_degrees_sq,
        "microsaccadeCount": fixation.microsaccade_count,
        "microsaccadeRateHz": fixation.microsaccade_rate_hz,
        "meanMicrosaccadeAmplitudeDeg": mean_amplitude,
        "stabilityDeg": stability,
        "smoothness": calc.calculate_smoothness(gaze, timestamps),
        "trackingRatio": result.tracking_ratio,
        "rmsErrorDeg": rms_error,
    }


def dump(path, description, frames, metrics):
    """Write one fixture: the input run, and the metrics the Python code produced."""
    payload = {
        "description": description,
        "input": {
            "screen": {"widthPx": 1920, "heightPx": 1080, "widthCm": 53.1,
                       "heightCm": 29.9, "viewingDistanceCm": 60.0},
            "fixationPoint": {"x": FIXATION_POINT[0], "y": FIXATION_POINT[1]},
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
        },
        "expected": {
            key: (value if isinstance(value, int) else round(value, 8))
            for key, value in metrics.items()
        },
    }
    path.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print(f"{path.name}: {description}")
    print(f"    bcea={metrics['bceaDeg2']:.4f} deg2 microsaccades={metrics['microsaccadeCount']} "
          f"({metrics['microsaccadeRateHz']:.3f} Hz) stability={metrics['stabilityDeg']:.4f} deg "
          f"smoothness={metrics['smoothness']:.4f} tracking={metrics['trackingRatio']:.2f}% "
          f"rms={metrics['rmsErrorDeg']:.4f} deg")


def main():
    FIXTURES.mkdir(parents=True, exist_ok=True)

    # A steady fixation: the noise alone never reaches the microsaccade velocity
    # threshold, so the count is zero. Three dropped frames stand in for a blink.
    steady = run(noise=1.2, seed=5, drops=(120, 121, 122))
    dump(
        FIXTURES / "parity-fixation-stable.json",
        "a steady fixation with sensor noise and a blink",
        steady,
        measure(steady),
    )

    # Three small steps of about 0.7 degrees: above the microsaccade velocity threshold
    # and below the maximum amplitude, so each one is counted.
    microsaccade_steps = (
        (60, 300, 24, 10),
        (140, 300, -24, -10),
        (220, 300, 24, -14),
    )
    with_microsaccades = run(noise=1.0, seed=11, offsets=microsaccade_steps)
    dump(
        FIXTURES / "parity-fixation-microsaccades.json",
        "a steady fixation interrupted by three microsaccades",
        with_microsaccades,
        measure(with_microsaccades),
    )

    # A five degree excursion away from the fixation point and back: far above the
    # maximum microsaccade amplitude, so it is not counted as one.
    excursion = ((150, 200, int(round(5.0 * PIXELS_PER_DEGREE)), 0),)
    with_excursion = run(noise=1.0, seed=7, offsets=excursion)
    dump(
        FIXTURES / "parity-fixation-excursion.json",
        "a fixation with a five degree excursion that is not a microsaccade",
        with_excursion,
        measure(with_excursion),
    )


if __name__ == "__main__":
    main()
