from __future__ import annotations

from dataclasses import asdict, dataclass
import json
from pathlib import Path
from typing import Any

from droneguard_multiverse.paths import DATA_DIR


class ScenarioValidationError(ValueError):
    pass


@dataclass(frozen=True)
class GeoPoint:
    lat: float
    lon: float

    @classmethod
    def from_dict(cls, payload: dict[str, Any], field_name: str) -> "GeoPoint":
        try:
            return cls(lat=float(payload["lat"]), lon=float(payload["lon"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise ScenarioValidationError(f"{field_name} must include numeric lat and lon") from exc

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


@dataclass(frozen=True)
class Waypoint:
    id: str
    lat: float
    lon: float
    label: str

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "Waypoint":
        point = GeoPoint.from_dict(payload, "waypoint")
        waypoint_id = str(payload.get("id", "")).strip()
        if not waypoint_id:
            raise ScenarioValidationError("waypoint id is required")
        return cls(
            id=waypoint_id,
            lat=point.lat,
            lon=point.lon,
            label=str(payload.get("label", waypoint_id)),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class Obstacle:
    id: str
    type: str
    location: GeoPoint
    requires_detour_m: float
    first_visible_frame_id: str

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "Obstacle":
        obstacle_id = str(payload.get("id", "")).strip()
        obstacle_type = str(payload.get("type", "")).strip()
        if not obstacle_id or not obstacle_type:
            raise ScenarioValidationError("obstacle id and type are required")
        return cls(
            id=obstacle_id,
            type=obstacle_type,
            location=GeoPoint.from_dict(payload.get("location", {}), "obstacle.location"),
            requires_detour_m=float(payload.get("requires_detour_m", 0.0)),
            first_visible_frame_id=str(payload.get("first_visible_frame_id", "")),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "location": self.location.to_dict(),
            "requires_detour_m": self.requires_detour_m,
            "first_visible_frame_id": self.first_visible_frame_id,
        }


@dataclass(frozen=True)
class FrameMetadata:
    frame_id: str
    timestamp: str
    source_path: str
    mime_type: str
    width: int
    height: int

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "FrameMetadata":
        frame_id = str(payload.get("frame_id", "")).strip()
        source_path = str(payload.get("source_path", "")).strip()
        if not frame_id or not source_path:
            raise ScenarioValidationError("frame metadata requires frame_id and source_path")
        return cls(
            frame_id=frame_id,
            timestamp=str(payload.get("timestamp", "")),
            source_path=source_path,
            mime_type=str(payload.get("mime_type", "image/png")),
            width=int(payload.get("width", 0)),
            height=int(payload.get("height", 0)),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ScenarioAssets:
    frames_dir: str
    telemetry_csv: str

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "ScenarioAssets":
        frames_dir = str(payload.get("frames_dir", "")).strip()
        telemetry_csv = str(payload.get("telemetry_csv", "")).strip()
        if not frames_dir or not telemetry_csv:
            raise ScenarioValidationError("assets.frames_dir and assets.telemetry_csv are required")
        return cls(frames_dir=frames_dir, telemetry_csv=telemetry_csv)

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass(frozen=True)
class RouteMetrics:
    current_waypoint_id: str
    remaining_mission_distance_m: float
    distance_to_final_waypoint_m: float
    return_to_start_distance_m: float
    return_after_final_m: float
    detour_distance_m: float
    safety_buffer_m: float

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "RouteMetrics":
        try:
            return cls(
                current_waypoint_id=str(payload["current_waypoint_id"]),
                remaining_mission_distance_m=float(payload["remaining_mission_distance_m"]),
                distance_to_final_waypoint_m=float(payload["distance_to_final_waypoint_m"]),
                return_to_start_distance_m=float(payload["return_to_start_distance_m"]),
                return_after_final_m=float(payload["return_after_final_m"]),
                detour_distance_m=float(payload.get("detour_distance_m", 0.0)),
                safety_buffer_m=float(payload.get("safety_buffer_m", 120.0)),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ScenarioValidationError("route_metrics is missing required numeric fields") from exc

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class Scenario:
    scenario_id: str
    label: str
    expected_action: str
    mission_goal: str
    risk_label: str
    start: GeoPoint
    waypoints: tuple[Waypoint, ...]
    obstacles: tuple[Obstacle, ...]
    assets: ScenarioAssets
    route_metrics: RouteMetrics
    frame_metadata: tuple[FrameMetadata, ...]

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "Scenario":
        scenario_id = str(payload.get("scenario_id", "")).strip()
        if not scenario_id:
            raise ScenarioValidationError("scenario_id is required")
        waypoints = tuple(Waypoint.from_dict(item) for item in payload.get("waypoints", []))
        if not waypoints:
            raise ScenarioValidationError(f"{scenario_id} must include at least one waypoint")
        frames = tuple(FrameMetadata.from_dict(item) for item in payload.get("frame_metadata", []))
        if not frames:
            raise ScenarioValidationError(f"{scenario_id} must include frame metadata")
        return cls(
            scenario_id=scenario_id,
            label=str(payload.get("label", scenario_id)),
            expected_action=str(payload.get("expected_action", "")),
            mission_goal=str(payload.get("mission_goal", "")),
            risk_label=str(payload.get("risk_label", "unknown")),
            start=GeoPoint.from_dict(payload.get("start", {}), "start"),
            waypoints=waypoints,
            obstacles=tuple(Obstacle.from_dict(item) for item in payload.get("obstacles", [])),
            assets=ScenarioAssets.from_dict(payload.get("assets", {})),
            route_metrics=RouteMetrics.from_dict(payload.get("route_metrics", {})),
            frame_metadata=frames,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "scenario_id": self.scenario_id,
            "label": self.label,
            "expected_action": self.expected_action,
            "mission_goal": self.mission_goal,
            "risk_label": self.risk_label,
            "start": self.start.to_dict(),
            "waypoints": [waypoint.to_dict() for waypoint in self.waypoints],
            "obstacles": [obstacle.to_dict() for obstacle in self.obstacles],
            "assets": self.assets.to_dict(),
            "route_metrics": self.route_metrics.to_dict(),
            "frame_metadata": [frame.to_dict() for frame in self.frame_metadata],
        }

    def summary(self) -> dict[str, Any]:
        return {
            "scenario_id": self.scenario_id,
            "label": self.label,
            "risk_label": self.risk_label,
            "expected_action": self.expected_action,
            "waypoint_count": len(self.waypoints),
            "obstacle_count": len(self.obstacles),
        }

    def resolve_asset_path(self, relative_path: str, data_dir: Path = DATA_DIR) -> Path:
        path = Path(relative_path)
        if path.is_absolute():
            return path
        if path.parts[:2] == ("data", "samples"):
            return data_dir.parent.parent / path
        return data_dir / path


def load_scenarios(data_dir: Path = DATA_DIR) -> list[Scenario]:
    manifest_path = data_dir / "scenarios.json"
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ScenarioValidationError(f"scenario manifest not found: {manifest_path}") from exc
    if not isinstance(payload, list):
        raise ScenarioValidationError("scenario manifest must be a JSON list")
    return [Scenario.from_dict(item) for item in payload]


def load_scenario(scenario_id: str, data_dir: Path = DATA_DIR) -> Scenario:
    for scenario in load_scenarios(data_dir):
        if scenario.scenario_id == scenario_id:
            return scenario
    raise ScenarioValidationError(f"unknown scenario_id: {scenario_id}")
