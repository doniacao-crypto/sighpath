"""Generate the parity fixtures for the web validation port.

Runs the desktop validation implementation in ``src/validation.py`` over a deterministic
synthetic validation run and writes the points plus the metrics it produced into
``web/tests/fixtures/``. The TypeScript port in ``web/lib/validation.ts`` must reproduce
those numbers: that is the contract that keeps the desktop app and the browser app measuring
the same thing.

Run it from the repository root:

    python tools/generate_parity_validation.py

Re-run it whenever the Python validation implementation changes, then run the TypeScript
suite (``cd web && npm test``): a mismatch between the two is the signal that the versions
have drifted apart.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from validation import ValidationConfig, ValidationPattern, ValidationTest  # noqa: E402

FIXTURES = ROOT / "web" / "tests" / "fixtures"

# The screen the fixtures were recorded on: a 27" 16:9 panel seen from 60 cm.
SCREEN = {
    "widthPx": 1920,
    "heightPx": 1080,
    "widthCm": 53.1,
    "heightCm": 29.9,
    "viewingDistanceCm": 60.0,
}

# The margin the desktop validation keeps between the dots and the screen edge.
MARGIN_PERCENT = 0.15

# The samples collected at every point of a run.
SAMPLES_PER_POINT = 12

# The scatter of the gaze estimate around the true position, in pixels.
NOISE_PX = 4.0


def config_for(pattern: ValidationPattern) -> ValidationConfig:
    """The desktop configuration that matches the screen above."""
    return ValidationConfig(
        pattern=pattern,
        samples_per_point=SAMPLES_PER_POINT,
        screen_width_px=SCREEN["widthPx"],
        screen_height_px=SCREEN["heightPx"],
        screen_width_cm=SCREEN["widthCm"],
        screen_height_cm=SCREEN["heightCm"],
        viewing_distance_cm=SCREEN["viewingDistanceCm"],
        margin_percent=MARGIN_PERCENT,
    )


def build_run(pattern: ValidationPattern, offsets, sample_counts, seed: int):
    """Run the desktop validation test over a synthetic run and return its result.

    ``offsets`` is the systematic error of the gaze estimate at every point, in pixels;
    ``sample_counts`` is how many samples were collected there.
    """
    # The desktop test lays out the dots itself, so the browser port is compared against
    # the very points the subject would have been shown.
    test = ValidationTest(config_for(pattern))
    rng = np.random.default_rng(seed)
    for index, point in enumerate(test._points):
        for sample in range(sample_counts[index]):
            point.gaze_samples_x.append(
                float(point.target_x + offsets[index][0] + rng.normal(0.0, NOISE_PX))
            )
            point.gaze_samples_y.append(
                float(point.target_y + offsets[index][1] + rng.normal(0.0, NOISE_PX))
            )
            point.timestamps.append(round(sample * 0.033, 6))
    test.result.points = test._points
    return test.result


def per_point_of(result) -> list:
    """The per-point breakdown, built from the desktop's own point properties."""
    rows = []
    px_per_deg = result._px_per_deg
    for point in result.points:
        if point.mean_gaze_x is None or point.mean_gaze_y is None:
            continue
        error_px = math.sqrt(
            (point.mean_gaze_x - point.target_x) ** 2
            + (point.mean_gaze_y - point.target_y) ** 2
        )
        std_x = point.std_gaze_x
        std_y = point.std_gaze_y
        has_spread = std_x is not None and std_y is not None
        rows.append({
            "x": point.target_x,
            "y": point.target_y,
            "meanX": round(point.mean_gaze_x, 6),
            "meanY": round(point.mean_gaze_y, 6),
            "stdDeg": round(math.sqrt(std_x ** 2 + std_y ** 2) / px_per_deg, 6)
            if has_spread and px_per_deg > 0 else 0.0,
            "errorDeg": round(error_px / px_per_deg, 6) if px_per_deg > 0 else 0.0,
        })
    return rows


def metrics_of(result) -> dict:
    """The metrics the desktop reports, read from its own properties."""
    accuracy = result.accuracy_degrees
    accuracy_std = result.accuracy_std_degrees
    precision = result.precision_degrees
    worst = result.worst_point_accuracy
    return {
        "accuracyDegrees": round(accuracy, 6) if accuracy is not None else None,
        "accuracyStdDegrees": round(accuracy_std, 6) if accuracy_std is not None else None,
        "precisionDegrees": round(precision, 6) if precision is not None else None,
        "worstPointAccuracy": round(worst, 6) if worst is not None else None,
        "validPoints": result.valid_points,
        "meetsClinicalThreshold": result.meets_clinical_threshold,
        "perPoint": per_point_of(result),
    }


def points_of(result) -> list:
    """The points and their samples, in the shape the browser version takes them."""
    return [
        {
            "x": point.target_x,
            "y": point.target_y,
            "samples": [
                {"x": round(x, 6), "y": round(y, 6)}
                for x, y in zip(point.gaze_samples_x, point.gaze_samples_y)
            ],
        }
        for point in result.points
    ]


def write_fixture(name: str, description: str, result) -> None:
    """Write one fixture: the points of the run and the metrics the Python code produced."""
    payload = {
        "description": description,
        "input": {"screen": SCREEN, "points": points_of(result)},
        "expected": metrics_of(result),
    }
    path = FIXTURES / f"{name}.json"
    path.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    expected = payload["expected"]
    print(f"{path.name}: accuracy={expected['accuracyDegrees']} "
          f"std={expected['accuracyStdDegrees']} precision={expected['precisionDegrees']} "
          f"worst={expected['worstPointAccuracy']} points={expected['validPoints']} "
          f"clinical={expected['meetsClinicalThreshold']}")


def write_pattern_fixture() -> None:
    """Write the dots each pattern puts on the screen, generated by the desktop app."""
    expected = {}
    for key, pattern in (
        ("grid9", ValidationPattern.GRID_9),
        ("grid16", ValidationPattern.GRID_16),
        ("random20", ValidationPattern.RANDOM_20),
    ):
        test = ValidationTest(config_for(pattern))
        expected[key] = [
            {"x": point.target_x, "y": point.target_y} for point in test._points
        ]
    payload = {
        "description": "the dots each validation pattern puts on the screen",
        "input": {
            "screenWidthPx": SCREEN["widthPx"],
            "screenHeightPx": SCREEN["heightPx"],
            "marginPercent": MARGIN_PERCENT,
        },
        "expected": expected,
    }
    path = FIXTURES / "parity-validation-patterns.json"
    path.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print(f"{path.name}: grid9={len(expected['grid9'])} "
          f"grid16={len(expected['grid16'])} random20={len(expected['random20'])}")


def main() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)

    # A healthy run: the estimate is off by about half a degree to a degree at every point.
    offsets = [
        (18.0, -12.0),
        (-25.0, 14.0),
        (9.0, 22.0),
        (-14.0, -8.0),
        (6.0, 5.0),
        (30.0, -18.0),
        (-20.0, 9.0),
        (12.0, 25.0),
        (-7.0, -15.0),
    ]
    counts = [SAMPLES_PER_POINT] * 9

    write_fixture(
        "parity-validation-grid",
        "nine-point grid, gaze estimate with a known offset at every point and realistic scatter",
        build_run(ValidationPattern.GRID_9, offsets, counts, seed=7),
    )

    # One point is wildly wrong: the IQR rejection has to keep it out of the mean error.
    wild_offsets = list(offsets)
    wild_offsets[4] = (420.0, -260.0)
    write_fixture(
        "parity-validation-outlier",
        "nine-point grid where one point was tracked far away from the dot it was shown",
        build_run(ValidationPattern.GRID_9, wild_offsets, counts, seed=11),
    )

    # One point collected nothing: the subject never looked at that dot.
    missing_counts = list(counts)
    missing_counts[3] = 0
    write_fixture(
        "parity-validation-missing-point",
        "nine-point grid where one point collected no samples at all",
        build_run(ValidationPattern.GRID_9, offsets, missing_counts, seed=13),
    )

    # One point collected a single sample: it counts towards the accuracy, but a single
    # sample has no spread, so it stays out of the precision.
    single_counts = list(counts)
    single_counts[6] = 1
    write_fixture(
        "parity-validation-single-sample",
        "nine-point grid where one point collected a single sample",
        build_run(ValidationPattern.GRID_9, offsets, single_counts, seed=17),
    )

    write_pattern_fixture()


if __name__ == "__main__":
    main()
