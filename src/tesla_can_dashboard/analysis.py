import math
from dataclasses import dataclass, field
from pathlib import Path

import cantools

from .decoder import Decoder
from .recording import MAX_ANALYSIS_BYTES, MAX_ANALYSIS_FRAMES, InterruptedTailError, read_frames
from .signals import CATALOG, is_valid_signal

MAX_RUNS = 50
MAX_CURVE_POINTS = 240
MAX_SPEED_GAP = 0.5
QUARTER_MILE_METRES = 402.336
INTERVALS = (
    ("0-60-mph", 0, 60 * 1.609344),
    ("0-100-kmh", 0, 100),
    ("30-70-mph", 30 * 1.609344, 70 * 1.609344),
    ("80-120-kmh", 80, 120),
)


class AnalysisLimitError(ValueError):
    pass


@dataclass
class Observation:
    samples: int = 0
    invalid: int = 0
    first: float | None = None
    last: float | None = None
    minimum: float | None = None
    maximum: float | None = None
    previous: tuple[float, float] | None = None
    covered_seconds: float = 0
    integral: float = 0
    gaps: int = 0
    curve: list = field(default_factory=list)
    stride: int = 1
    events: int = 0

    def add(self, seconds: float, value: float | None, maximum_gap: float) -> None:
        self.events += 1
        if value is None:
            self.invalid += 1
            self.previous = None
        else:
            self.samples += 1
            self.first = value if self.first is None else self.first
            self.last = value
            self.minimum = value if self.minimum is None else min(value, self.minimum)
            self.maximum = value if self.maximum is None else max(value, self.maximum)
            if self.previous is not None:
                previous_time, previous_value = self.previous
                gap = seconds - previous_time
                if 0 < gap <= maximum_gap:
                    self.covered_seconds += gap
                    self.integral += (previous_value + value) / 2 * gap
                else:
                    self.gaps += 1
            self.previous = (seconds, value)
        if self.events % self.stride == 0:
            self.curve.append([seconds, value])
        if len(self.curve) > MAX_CURVE_POINTS:
            self.curve = self.curve[::2]
            self.stride *= 2

    def result(self, key: str) -> dict:
        return {
            "quality": "partial" if self.invalid or self.gaps else "observed" if self.samples else "unavailable",
            "unit": CATALOG[key].unit,
            "label": CATALOG[key].label,
            "samples": self.samples,
            "invalidSamples": self.invalid,
            "gaps": self.gaps,
            "first": self.first,
            "last": self.last,
            "minimum": self.minimum,
            "maximum": self.maximum,
            "observedDelta": self.last - self.first if self.last is not None and self.first is not None else None,
            "coveredSeconds": self.covered_seconds,
            "curve": self.curve,
            "curveSampled": self.stride > 1,
        }


@dataclass
class Run:
    start: float
    resolution: float = 0
    distance: float = 0


class Performance:
    def __init__(self) -> None:
        self.previous: tuple[float, float] | None = None
        self.gear: tuple[float, float | None] | None = None
        self.pending: dict[str, Run] = {}
        self.runs: dict[str, list[dict]] = {key: [] for key, _, _ in INTERVALS}
        self.runs["quarter-mile"] = []
        self.reasons: set[str] = set()
        self.speed_samples = 0
        self.omitted_runs = 0

    def interrupt(self, reason: str, *, report: bool = True) -> None:
        if report:
            self.reasons.add(reason)
        self.previous = None
        self.pending.clear()

    def update(self, seconds: float, values: dict[str, float | None]) -> None:
        if "driveGear" in values:
            self.gear = (seconds, values["driveGear"])
            if values["driveGear"] != 4:
                self.interrupt(self.direction_reason(), report=bool(self.pending) and values.get("speedKmh") != 0)
        if "speedKmh" not in values:
            return
        speed = values["speedKmh"]
        self.speed_samples += 1
        if speed is None:
            self.interrupt("invalid_speed", report=bool(self.pending) or self.previous is not None and self.previous[1] > 0)
            return
        if self.gear is None or self.gear[1] != 4 or seconds - self.gear[0] > CATALOG["driveGear"].stale_after:
            self.interrupt(self.direction_reason(), report=speed > 0 or bool(self.pending))
            return
        previous = self.previous
        self.previous = (seconds, speed)
        if previous is None:
            return
        previous_time, previous_speed = previous
        gap = seconds - previous_time
        if gap <= 0 or gap > MAX_SPEED_GAP:
            self.interrupt(
                "non_monotonic_speed" if gap <= 0 else "speed_gap", report=bool(self.pending) or speed > 0 or previous_speed > 0
            )
            self.previous = (seconds, speed)
            return
        for run in self.pending.values():
            run.resolution = max(run.resolution, gap)
        if previous_speed == 0 and speed > 0:
            for key in ("0-60-mph", "0-100-kmh", "quarter-mile"):
                self.pending[key] = Run(previous_time, gap)
        if speed == 0:
            self.pending.clear()
            return
        for key, lower, upper in INTERVALS:
            if lower > 0 and previous_speed < lower <= speed:
                start = previous_time + gap * (lower - previous_speed) / (speed - previous_speed)
                self.pending[key] = Run(start, gap)
            if lower > 0 and speed < lower:
                self.pending.pop(key, None)
            if previous_speed < upper <= speed and key in self.pending:
                end = previous_time + gap * (upper - previous_speed) / (speed - previous_speed)
                self.finish(key, end, upper)
        self.integrate_distance(previous_time, previous_speed, seconds, speed)

    def direction_reason(self) -> str:
        if self.gear is None or self.gear[1] not in {1, 2, 3}:
            return "unknown_direction"
        return "reverse_direction" if self.gear[1] == 2 else "non_forward_gear"

    def finish(self, key: str, end: float, speed: float) -> None:
        run = self.pending.pop(key)
        if len(self.runs[key]) >= MAX_RUNS:
            self.omitted_runs += 1
            return
        self.runs[key].append(
            {
                "startSeconds": run.start,
                "endSeconds": end,
                "durationSeconds": end - run.start,
                "endSpeedKmh": speed,
                "sampleResolutionSeconds": run.resolution,
            }
        )

    def integrate_distance(self, previous_time: float, previous_speed: float, seconds: float, speed: float) -> None:
        run = self.pending.get("quarter-mile")
        if run is None:
            return
        gap = seconds - previous_time
        previous_mps = previous_speed / 3.6
        acceleration = (speed - previous_speed) / 3.6 / gap
        distance = (previous_speed + speed) / 2 / 3.6 * gap
        remaining = QUARTER_MILE_METRES - run.distance
        if distance < remaining:
            run.distance += distance
            return
        discriminant = max(0, previous_mps**2 + 2 * acceleration * remaining)
        duration = 2 * remaining / (previous_mps + math.sqrt(discriminant))
        self.finish("quarter-mile", previous_time + duration, (previous_mps + acceleration * duration) * 3.6)

    def result(self, invalid: bool) -> dict:
        reasons = self.reasons
        groups = []
        for convention, keys in (
            ("standing-no-rollout-v1", ["0-60-mph", "0-100-kmh", "quarter-mile"]),
            ("rolling-threshold-v1", ["30-70-mph", "80-120-kmh"]),
        ):
            measurements = []
            for key in keys:
                runs = [] if invalid else self.runs[key]
                measurements.append(
                    {
                        "id": key,
                        "quality": "invalid" if invalid else "estimated" if runs else "unavailable",
                        "reasons": sorted(reasons | ({"incomplete_interval"} if not runs and self.speed_samples else set())),
                        "runs": runs,
                    }
                )
            groups.append({"convention": convention, "measurements": measurements})
        return {"groups": groups, "omittedRuns": self.omitted_runs}


def valid_values(values: dict[str, float | None]) -> dict[str, float | None]:
    return {key: value if is_valid_signal(key, value) else None for key, value in values.items() if key in CATALOG}


def analyze_recording(path: Path, decoder: Decoder) -> dict:
    if path.stat().st_size > MAX_ANALYSIS_BYTES:
        raise AnalysisLimitError("Recording exceeds the analysis byte limit")
    observations = {key: Observation() for key in CATALOG if key not in {"speedKmh", "driveGear"}}
    performance = Performance()
    reasons: set[str] = set()
    first_ns = None
    previous_ns = None
    frame_count = 0
    decode_errors = 0
    invalid = False
    try:
        for frame in read_frames(path, require_complete=True, maximum_bytes=MAX_ANALYSIS_BYTES):
            frame_count += 1
            if frame_count > MAX_ANALYSIS_FRAMES:
                raise AnalysisLimitError("Recording exceeds the analysis frame limit")
            first_ns = frame.monotonic_ns if first_ns is None else first_ns
            if previous_ns is not None and frame.monotonic_ns < previous_ns:
                raise ValueError("Recording timestamps run backwards")
            previous_ns = frame.monotonic_ns
            seconds = (frame.monotonic_ns - first_ns) / 1e9
            try:
                values, _ = decoder.decode(frame.identifier, frame.data)
            except (ValueError, cantools.database.errors.DecodeError):
                decode_errors += 1
                reasons.add("decode_errors")
                values = dict.fromkeys(decoder.signal_keys(frame.identifier))
            values = valid_values(values)
            performance.update(seconds, values)
            for key, value in values.items():
                if key in observations:
                    observations[key].add(seconds, value, CATALOG[key].stale_after)
    except AnalysisLimitError:
        raise
    except InterruptedTailError:
        performance.reasons.add("interrupted_tail")
        performance.pending.clear()
    except ValueError:
        reasons.add("invalid_recording")
        invalid = True
    if not frame_count:
        reasons.add("empty_recording")
    if performance.omitted_runs:
        performance.reasons.add("run_limit")
    if not performance.speed_samples:
        performance.reasons.add("missing_speed")
    reasons.update(performance.reasons)
    duration = (previous_ns - first_ns) / 1e9 if previous_ns is not None and first_ns is not None and not invalid else None
    power = observations["chargingPowerKw"]
    battery_signals = {key: observation.result(key) for key, observation in observations.items()}
    for signal in battery_signals.values():
        if invalid:
            signal.update(
                quality="invalid", first=None, last=None, minimum=None, maximum=None, observedDelta=None, curve=[], coveredSeconds=0
            )
        elif "interrupted_tail" in reasons and signal["samples"]:
            signal["quality"] = "partial"
    return {
        "schemaVersion": 1,
        "quality": "invalid" if invalid else "partial" if reasons else "observed",
        "reasons": sorted(reasons),
        "recording": {"frames": frame_count, "durationSeconds": duration, "decodeErrors": decode_errors},
        "timing": {
            "clock": "acquisition-monotonic",
            "rolloutMetres": 0,
            "standingStart": "last observed zero before movement",
            "speedInterpolation": "linear",
            "distanceIntegration": "trapezoidal with quadratic crossing",
            "maximumSpeedGapSeconds": MAX_SPEED_GAP,
            "direction": "fresh DBC drive gear required throughout",
            "precision": "estimates; sample resolution is not a sensor accuracy guarantee",
        },
        "decoder": {
            "profile": "current-operator-dbc" if decoder.database else "built-in",
            "sourceCompatibility": "not-established-by-analysis",
            "recordedProfile": "unknown",
        },
        "performance": performance.result(invalid),
        "battery": {
            "quality": "invalid" if invalid else "partial" if "interrupted_tail" in reasons else "observations-only",
            "currentDirection": "unqualified",
            "signals": battery_signals,
            "charging": {
                "boundary": "charger-line; not pack energy or DC fast charging",
                "observedEnergyKwh": power.integral / 3600 if power.covered_seconds and not invalid else None,
                "coveredSeconds": power.covered_seconds if not invalid else 0,
                "quality": "invalid"
                if invalid
                else "partial"
                if power.invalid or power.gaps or "interrupted_tail" in reasons
                else "estimated"
                if power.covered_seconds
                else "unavailable",
            },
            "curveConvention": "sampled observations; never interpolate across missing or stale intervals",
        },
    }
