from __future__ import annotations

import csv
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REQUIRED_COLUMNS = {
    "timestamp",
    "lat",
    "lon",
    "altitude_m",
    "speed_mps",
    "battery_pct",
    "link_quality_pct",
    "distance_to_start_m",
    "distance_to_next_waypoint_m",
    "estimated_remaining_range_m",
}


class TelemetryValidationError(ValueError):
    pass


@dataclass(frozen=True)
class TelemetryRow:
    timestamp: str
    lat: float
    lon: float
    altitude_m: float
    speed_mps: float
    battery_pct: float
    link_quality_pct: float
    distance_to_start_m: float
    distance_to_next_waypoint_m: float
    estimated_remaining_range_m: float
    heading_deg: float | None = None
    gps_hdop: float | None = None
    wind_mps: float | None = None
    frame_id: str | None = None
    current_waypoint_id: str | None = None

    @classmethod
    def from_csv_row(cls, payload: dict[str, str]) -> "TelemetryRow":
        missing = sorted(REQUIRED_COLUMNS - payload.keys())
        if missing:
            raise TelemetryValidationError(f"telemetry CSV missing required columns: {', '.join(missing)}")

        def number(name: str, *, minimum: float | None = None, maximum: float | None = None) -> float:
            try:
                value = float(payload[name])
            except (KeyError, TypeError, ValueError) as exc:
                raise TelemetryValidationError(f"telemetry column {name} must be numeric") from exc
            if minimum is not None and value < minimum:
                raise TelemetryValidationError(f"telemetry column {name} must be >= {minimum}")
            if maximum is not None and value > maximum:
                raise TelemetryValidationError(f"telemetry column {name} must be <= {maximum}")
            return value

        return cls(
            timestamp=str(payload["timestamp"]),
            lat=number("lat"),
            lon=number("lon"),
            altitude_m=number("altitude_m", minimum=0.0),
            speed_mps=number("speed_mps", minimum=0.0),
            battery_pct=number("battery_pct", minimum=0.0, maximum=100.0),
            link_quality_pct=number("link_quality_pct", minimum=0.0, maximum=100.0),
            distance_to_start_m=number("distance_to_start_m", minimum=0.0),
            distance_to_next_waypoint_m=number("distance_to_next_waypoint_m", minimum=0.0),
            estimated_remaining_range_m=number("estimated_remaining_range_m", minimum=0.0),
            heading_deg=_optional_float(payload.get("heading_deg")),
            gps_hdop=_optional_float(payload.get("gps_hdop")),
            wind_mps=_optional_float(payload.get("wind_mps")),
            frame_id=_optional_str(payload.get("frame_id")),
            current_waypoint_id=_optional_str(payload.get("current_waypoint_id")),
        )

    def sort_key(self) -> float:
        return parse_timestamp_key(self.timestamp)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _optional_float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def _optional_str(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    return value


def parse_timestamp_key(timestamp: str) -> float:
    try:
        return float(timestamp)
    except ValueError:
        pass
    normalized = timestamp.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise TelemetryValidationError(f"invalid telemetry timestamp: {timestamp}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def load_telemetry_csv(path: Path) -> list[TelemetryRow]:
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            missing = sorted(REQUIRED_COLUMNS - set(reader.fieldnames or []))
            if missing:
                raise TelemetryValidationError(f"telemetry CSV missing required columns: {', '.join(missing)}")
            rows = [TelemetryRow.from_csv_row(row) for row in reader]
    except FileNotFoundError as exc:
        raise TelemetryValidationError(f"telemetry CSV not found: {path}") from exc
    if not rows:
        raise TelemetryValidationError(f"telemetry CSV has no rows: {path}")
    previous = rows[0].sort_key()
    for row in rows[1:]:
        current = row.sort_key()
        if current < previous:
            raise TelemetryValidationError("telemetry timestamps must be monotonic")
        previous = current
    return rows
