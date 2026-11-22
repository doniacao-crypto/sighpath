"""Generate the saccade parity fixtures for the web port.

Runs the desktop implementation in ``src/saccade_test.py`` over a deterministic set of
synthetic saccade trials and writes the trials plus the measurements the desktop code
produced into ``web/tests/fixtures/``. The TypeScript port in ``web/lib/saccade.ts`` must
reproduce those numbers: that is the contract that keeps the desktop app and the browser
app measuring the same thing.

Run it from the repository root:

    python tools/generate_parity_saccade.py

Re-run it whenever the Python saccade implementation changes, then run the TypeScript
suite (``cd web && npm test``): a mismatch between the two is the signal that the
versions have drifted apart.

The trial plan is not produced by the desktop app - the desktop plans its trials from
the global ``random`` module, which cannot be seeded - so this script carries its own
copy of the browser's seeded generator and the browser's planner. Both are the same
algorithm, draw for draw; see ``plan_trials`` below.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from saccade_test import (  # noqa: E402
    SaccadeTest,
    SaccadeTestConfig,
    SaccadeTestResult,
    SaccadeTestType,
    SaccadeTrialConfig,
    SaccadeTrialResult,
)

FIXTURES = ROOT / "web" / "tests" / "fixtures"

# The screen the fixtures were recorded on: a 52 cm wide 16:9 panel seen from 60 cm,
# which is the desktop app's own default for the saccade test.
SCREEN = {
    "widthPx": 1920,
    "heightPx": 1080,
    "widthCm": 52.0,
    "heightCm": 29.25,
    "viewingDistanceCm": 60.0,
}

# The sampling interval of the synthetic trials: the desktop app tracks at 30-60 Hz and
# a saccade is 40-60 ms long, so a 60 Hz grid puts two or three samples in the movement.
SAMPLE_INTERVAL_MS = 1000.0 / 60.0

# The desktop jitters the fixation duration by up to this much (src/saccade_test.py).
FIXATION_JITTER_MS = 200.0

# The browser's protocols and their desktop counterparts. The vertical protocol has no
# desktop counterpart: the desktop only ever measured horizontal saccades.
DESKTOP_TYPES = {
    "horizontal": SaccadeTestType.PRO_SACCADE,
    "antisaccade": SaccadeTestType.ANTI_SACCADE,
}


class Mulberry32:
    """The seeded generator of ``web/lib/saccade.ts``, draw for draw.

    mulberry32 keeps its state in a single 32-bit word and mixes it with two
    multiplications per draw. The browser implements the same thing with ``Math.imul``;
    the masking below keeps the arithmetic in 32-bit unsigned space, which is what the
    JavaScript bitwise operators do.
    """

    def __init__(self, seed: int):
        self._state = seed & 0xFFFFFFFF

    def next(self) -> float:
        self._state = (self._state + 0x6D2B79F5) & 0xFFFFFFFF
        t = self._state
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t = (t ^ ((t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


def pixels_per_degree(screen) -> float:
    """The desktop saccade module's own pixels-per-degree conversion."""
    screen_distance_px = (
        screen["widthPx"] / screen["widthCm"]
    ) * screen["viewingDistanceCm"]
    return float(screen_distance_px * np.tan(np.radians(1)))


def plan_trials(options) -> list:
    """The browser's ``planSaccadeTrials``, in Python.

    The desktop draws the eccentricity, then the direction, then the timing jitter of
    every trial, in that order, from the global ``random`` module. The browser draws
    them in the same order from a seeded generator, so the same seed produces the same
    run in both places. ``random.choice`` picks an element uniformly, which a uniform
    float scaled by the length of the list reproduces; ``random.uniform(a, b)`` is
    ``a + (b - a) * random()``, which is what the jitter below does.
    """
    random = Mulberry32(options["seed"])
    screen = options["screen"]
    px_per_deg = pixels_per_degree(screen)
    centre_x = screen["widthPx"] // 2
    centre_y = screen["heightPx"] // 2
    plans = []

    for index in range(options["numTrials"]):
        eccentricities = options["eccentricitiesDeg"]
        eccentricity = eccentricities[int(random.next() * len(eccentricities))]
        if options["randomizeDirection"]:
            direction = "left" if random.next() < 0.5 else "right"
        else:
            direction = "left" if index % 2 == 0 else "right"
        if options["randomizeTiming"]:
            jitter = -FIXATION_JITTER_MS + 2 * FIXATION_JITTER_MS * random.next()
        else:
            jitter = 0.0

        offset_px = int(eccentricity * px_per_deg)
        sign = 1 if direction == "right" else -1
        vertical = options["type"] == "vertical"

        plans.append({
            "index": index,
            "type": options["type"],
            "direction": direction,
            "eccentricityDeg": eccentricity,
            "fixateX": centre_x,
            "fixateY": centre_y,
            "targetX": centre_x if vertical else centre_x + sign * offset_px,
            "targetY": centre_y + sign * offset_px if vertical else centre_y,
            "fixationDurationMs": options["fixationDurationMs"] + jitter,
            "gapDurationMs": options["gapDurationMs"],
            "targetDurationMs": options["targetDurationMs"],
            "responseWindowMs": options["responseWindowMs"],
        })

    return plans


def make_samples(fixate, destination, latency_ms, onset_t, duration_ms=700.0,
                 move_ms=50.0):
    """Gaze samples for one trial: fixation, a saccade, then fixation on the target.

    The eye holds the fixation point until the saccade starts, covers the distance in
    ``move_ms`` and then stays where it landed.
    """
    step_ms = SAMPLE_INTERVAL_MS
    latency_samples = int(round(latency_ms / step_ms))
    move_samples = int(round(move_ms / step_ms))
    count = int(round(duration_ms / step_ms))

    samples = []
    for index in range(count + 1):
        if index <= latency_samples:
            x, y = fixate
        elif index <= latency_samples + move_samples:
            fraction = (index - latency_samples) / move_samples
            x = fixate[0] + (destination[0] - fixate[0]) * fraction
            y = fixate[1] + (destination[1] - fixate[1]) * fraction
        else:
            x, y = destination
        samples.append({
            "x": round(x, 6),
            "y": round(y, 6),
            "t": round(onset_t + index * step_ms / 1000.0, 12),
        })
    return samples


def analyse_with_desktop(plan, samples, onset_t, desktop_type, screen):
    """Run the desktop's own analysis over one recorded trial.

    The desktop analyses a trial when it ends, from the gaze it collected and the time
    the target appeared. Driving those two inputs through ``_analyze_trial`` is the
    desktop implementation doing the measuring; nothing here re-implements it.
    """
    config = SaccadeTestConfig(
        test_type=desktop_type,
        num_trials=1,
        screen_width_px=screen["widthPx"],
        screen_height_px=screen["heightPx"],
        viewing_distance_cm=screen["viewingDistanceCm"],
        screen_width_cm=screen["widthCm"],
    )
    test = SaccadeTest(config)
    test._trial_configs = [SaccadeTrialConfig(
        target_eccentricity_deg=plan["eccentricityDeg"],
        target_direction=plan["direction"],
        fixation_duration_ms=plan["fixationDurationMs"],
        gap_duration_ms=plan["gapDurationMs"],
        target_duration_ms=plan["targetDurationMs"],
        response_window_ms=plan["responseWindowMs"],
    )]
    test._current_trial_index = 0

    trial = SaccadeTrialResult(
        trial_number=plan["index"] + 1,
        test_type=desktop_type,
        target_direction=plan["direction"],
        target_eccentricity_deg=plan["eccentricityDeg"],
        # The dataclass defaults direction_correct to True, which would count a trial in
        # which the eye never moved as correct. The browser counts such a trial as not
        # correct, so the trial starts at False here and _analyze_trial overwrites it
        # when it finds a saccade.
        direction_correct=False,
    )
    trial.gaze_x = [sample["x"] for sample in samples]
    trial.gaze_y = [sample["y"] for sample in samples]
    trial.timestamps = [sample["t"] for sample in samples]

    test._current_result = trial
    test._target_onset_time = onset_t
    test._analyze_trial()
    return trial


def round_optional(value):
    return None if value is None else round(float(value), 6)


def expected_metrics(desktop_type, trials):
    """The desktop's own aggregates over the analysed trials."""
    result = SaccadeTestResult(test_type=desktop_type)
    result.trials = trials
    return {
        "numTrials": result.num_trials,
        "numCorrect": result.num_correct,
        "errorRate": round(float(result.error_rate), 6),
        "meanLatencyMs": round_optional(result.mean_latency_ms),
        "stdLatencyMs": round_optional(result.std_latency_ms),
        "meanAccuracyDeg": round_optional(result.mean_accuracy_deg),
        "meanPeakVelocityDegS": round_optional(result.mean_peak_velocity),
        "anticipatoryRate": round(float(result.anticipatory_rate), 6),
        "expressSaccadeRate": round(float(result.express_saccade_rate), 6),
    }


def expected_trial(trial, index):
    """What the desktop measured on one trial."""
    detected = trial.saccade_latency_ms is not None
    return {
        "index": index,
        "latencyMs": round_optional(trial.saccade_latency_ms),
        "durationMs": round_optional(trial.saccade_duration_ms),
        "peakVelocityDegS": round_optional(trial.peak_velocity_deg_s),
        "amplitudeDeg": round_optional(trial.saccade_amplitude_deg),
        "accuracyDeg": round_optional(trial.saccade_accuracy_deg),
        # A trial without a saccade could not be judged; the browser reports that as
        # null rather than as a wrong direction.
        "directionCorrect": trial.direction_correct if detected else None,
        "anticipatory": trial.anticipatory_error,
        "express": trial.express_saccade,
    }


def build_case(name, description, protocol, script, plan_options):
    """Build one fixture: the trials, and what the desktop measured on them."""
    desktop_type = DESKTOP_TYPES[protocol]
    options = dict(plan_options)
    options["screen"] = SCREEN
    options["type"] = protocol
    options["numTrials"] = len(script)

    plans = plan_trials(options)

    records = []
    trials = []
    for index, step in enumerate(script):
        plan = plans[index]
        fixate = (plan["fixateX"], plan["fixateY"])
        target = (plan["targetX"], plan["targetY"])
        # The wrong way is the same distance on the other side of the fixation point.
        mirror = (2 * fixate[0] - target[0], 2 * fixate[1] - target[1])

        if step["kind"] == "still":
            destination = fixate
        elif step["kind"] == "correct":
            destination = mirror if desktop_type == SaccadeTestType.ANTI_SACCADE else target
        else:
            destination = target if desktop_type == SaccadeTestType.ANTI_SACCADE else mirror

        onset_t = 2.5 + index * 4.0
        samples = make_samples(fixate, destination, step["latency_ms"], onset_t)
        trials.append(analyse_with_desktop(plan, samples, onset_t, desktop_type, SCREEN))
        records.append({
            "plan": plan,
            "samples": samples,
            "targetOnsetT": onset_t,
            "responseX": None,
            "responseY": None,
            "responseT": None,
        })

    payload = {
        "description": description,
        "screen": SCREEN,
        "planOptions": {key: value for key, value in options.items() if key != "screen"},
        "input": {"trials": records},
        "expected": expected_metrics(desktop_type, trials),
    }
    payload["expected"]["perTrial"] = [
        expected_trial(trial, index) for index, trial in enumerate(trials)
    ]

    path = FIXTURES / f"{name}.json"
    path.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print(f"{path.name}: correct={payload['expected']['numCorrect']}/"
          f"{payload['expected']['numTrials']} "
          f"error={payload['expected']['errorRate']:.3f} "
          f"latency={payload['expected']['meanLatencyMs']} "
          f"accuracy={payload['expected']['meanAccuracyDeg']} "
          f"peak={payload['expected']['meanPeakVelocityDegS']}")


def main():
    FIXTURES.mkdir(parents=True, exist_ok=True)

    build_case(
        "parity-saccade-pro",
        "Pro-saccade run: ordinary trials, a wrong direction, an anticipatory saccade, "
        "an express saccade and a trial where the eye never moved.",
        "horizontal",
        [
            {"kind": "correct", "latency_ms": 150.0},
            {"kind": "correct", "latency_ms": 183.3},
            {"kind": "wrong", "latency_ms": 166.7},
            {"kind": "correct", "latency_ms": 66.7},
            {"kind": "correct", "latency_ms": 100.0},
            {"kind": "correct", "latency_ms": 250.0},
            {"kind": "still", "latency_ms": 150.0},
            {"kind": "correct", "latency_ms": 216.7},
        ],
        {
            "eccentricitiesDeg": [10.0, 15.0],
            "randomizeDirection": True,
            "randomizeTiming": True,
            "seed": 20240611,
            "fixationDurationMs": 1000.0,
            "gapDurationMs": 200.0,
            "targetDurationMs": 1000.0,
            "responseWindowMs": 800.0,
        },
    )

    build_case(
        "parity-saccade-antisaccade",
        "Anti-saccade run: the subject has to look away from the target, so the trials "
        "that move towards it are the direction errors.",
        "antisaccade",
        [
            {"kind": "correct", "latency_ms": 200.0},
            {"kind": "wrong", "latency_ms": 183.3},
            {"kind": "correct", "latency_ms": 116.7},
            {"kind": "correct", "latency_ms": 233.3},
            {"kind": "wrong", "latency_ms": 150.0},
            {"kind": "still", "latency_ms": 150.0},
        ],
        {
            "eccentricitiesDeg": [10.0],
            "randomizeDirection": False,
            "randomizeTiming": False,
            "seed": 7,
            "fixationDurationMs": 1000.0,
            "gapDurationMs": 200.0,
            "targetDurationMs": 1000.0,
            "responseWindowMs": 800.0,
        },
    )


if __name__ == "__main__":
    main()
