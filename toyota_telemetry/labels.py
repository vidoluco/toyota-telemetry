"""Readable labels for Toyota driving-analytics codes.

Toyota does not publish the meaning of ``coachingMsg`` codes. The labels below are inferred
from the event type, the ``good`` flag and how the codes group in observed data, and the
interface says so. Codes not listed fall back to a generic label.

Two things learned the hard way, both worth keeping in mind before trusting a label:

- **These events describe the driver, never the car.** They are coaching marks on how the
  pedal was pressed. None of them means the vehicle intervened: automatic emergency braking
  and the pre-collision system are not reported through this endpoint at all.
- **``severity`` is only meaningful for some codes.** Where the API sends ``10000.0`` it is a
  sentinel meaning "not reported", not a huge value. Real numbers appear only on the codes
  that share ``diagnosticMsg`` 2.
"""

from __future__ import annotations

EVENT_TYPES = {"A": "acceleration", "B": "braking", "C": "constant speed"}

# (type, coachingMsg) -> label
LABELS: dict[tuple[str, int], str] = {
    ("B", 1): "smooth stop",
    ("B", 2): "abrupt stop",
    ("B", 5): "hard brake",
    ("B", 10): "abrupt stop at low speed",  # same diagnostic family as B/2, seen only below 20 km/h
    ("B", 13): "late brake",
    ("A", 1): "smooth start",
    ("A", 20): "aggressive acceleration",
    ("A", 25): "hard acceleration",
    ("C", 31): "constant speed kept",
}

MODES = {0: "eco", 1: "normal", 2: "power"}  # inferred from hdc distance names


def label(event_type: str | None, code: int | None, good: bool | None) -> str:
    if event_type is not None and code is not None and (event_type, code) in LABELS:
        return LABELS[(event_type, code)]
    kind = EVENT_TYPES.get(event_type or "", "event")
    quality = "smooth" if good else "harsh"
    return f"{quality} {kind} (code {code})"


def is_harsh(good: bool | None) -> bool:
    return good is False


SEVERITY_NOT_REPORTED = 10000.0


def severity_or_none(value: float | None) -> float | None:
    """Toyota's ``severity``, or None where the API sends its not-reported sentinel."""
    return None if value is None or value == SEVERITY_NOT_REPORTED else value
