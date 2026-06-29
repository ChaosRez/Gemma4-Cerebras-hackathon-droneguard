from __future__ import annotations

from dataclasses import asdict, dataclass
import math
from typing import Any

from droneguard_multiverse.schemas.scenario import GeoPoint, Scenario
from droneguard_multiverse.schemas.telemetry import TelemetryRow


@dataclass(frozen=True)
class ReachabilityEstimate:
    can_complete_final_waypoint_and_return: bool
    estimated_remaining_range_m: float
    required_range_with_detour_m: float
    reserve_after_return_m: float
    safety_buffer_m: float
    return_to_start_distance_m: float
    remaining_mission_distance_m: float
    detour_distance_m: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def estimate_reachability(scenario: Scenario, telemetry_rows: list[TelemetryRow]) -> ReachabilityEstimate:
    latest = telemetry_rows[-1]
    metrics = scenario.route_metrics
    estimated_range = latest.estimated_remaining_range_m
    required = (
        metrics.detour_distance_m
        + metrics.distance_to_final_waypoint_m
        + metrics.return_after_final_m
    )
    reserve = estimated_range - required
    return ReachabilityEstimate(
        can_complete_final_waypoint_and_return=reserve >= metrics.safety_buffer_m,
        estimated_remaining_range_m=round(estimated_range, 1),
        required_range_with_detour_m=round(required, 1),
        reserve_after_return_m=round(reserve, 1),
        safety_buffer_m=round(metrics.safety_buffer_m, 1),
        return_to_start_distance_m=round(metrics.return_to_start_distance_m, 1),
        remaining_mission_distance_m=round(metrics.remaining_mission_distance_m, 1),
        detour_distance_m=round(metrics.detour_distance_m, 1),
    )


def risk_level_from_score(score: int) -> str:
    if score >= 70:
        return "high"
    if score >= 40:
        return "medium"
    return "low"


def haversine_distance_m(a: GeoPoint, b: GeoPoint) -> float:
    radius_m = 6_371_000.0
    lat1 = math.radians(a.lat)
    lat2 = math.radians(b.lat)
    dlat = lat2 - lat1
    dlon = math.radians(b.lon - a.lon)
    sin_lat = math.sin(dlat / 2)
    sin_lon = math.sin(dlon / 2)
    root = sin_lat * sin_lat + math.cos(lat1) * math.cos(lat2) * sin_lon * sin_lon
    return radius_m * 2 * math.atan2(math.sqrt(root), math.sqrt(max(0.0, 1 - root)))


def telemetry_summary(rows: list[TelemetryRow], scenario: Scenario | None = None) -> dict[str, float]:
    latest = rows[-1]
    summary = {
        "min_battery_pct": round(min(row.battery_pct for row in rows), 1),
        "max_speed_mps": round(max(row.speed_mps for row in rows), 1),
        "min_link_quality_pct": round(min(row.link_quality_pct for row in rows), 1),
    }
    if scenario and scenario.obstacles:
        obstacle = scenario.obstacles[0]
        distance_m = haversine_distance_m(
            GeoPoint(lat=latest.lat, lon=latest.lon),
            obstacle.location,
        )
        speed_mps = max(latest.speed_mps, 0.1)
        summary["distance_to_restricted_zone_m"] = round(distance_m, 1)
        summary["seconds_to_breach_at_current_speed"] = round(distance_m / speed_mps, 1)
    return summary


def telemetry_risk_flags(
    scenario: Scenario,
    rows: list[TelemetryRow],
    reachability: ReachabilityEstimate,
) -> list[dict[str, Any]]:
    latest = rows[-1]
    flags: list[dict[str, Any]] = []
    if not reachability.can_complete_final_waypoint_and_return:
        flags.append(
            {
                "type": "insufficient_battery_for_detour_and_return",
                "severity": "high",
                "timestamp": latest.timestamp,
                "observed_value": reachability.reserve_after_return_m,
                "threshold": reachability.safety_buffer_m,
                "evidence": (
                    "Remaining range cannot cover obstacle detour, final waypoint, "
                    "return-to-start path, and reserve buffer."
                ),
            }
        )
    min_link = min(row.link_quality_pct for row in rows)
    if min_link < 50.0:
        flags.append(
            {
                "type": "degraded_link_quality",
                "severity": "medium",
                "timestamp": latest.timestamp,
                "observed_value": round(min_link, 1),
                "threshold": 50.0,
                "evidence": "Radio link quality dipped below the demo safety threshold.",
            }
        )
    max_speed = max(row.speed_mps for row in rows)
    if max_speed > 10.0:
        flags.append(
            {
                "type": "high_ground_speed",
                "severity": "medium",
                "timestamp": latest.timestamp,
                "observed_value": round(max_speed, 1),
                "threshold": 10.0,
                "evidence": "Ground speed is high for a constrained inspection corridor.",
            }
        )
    if scenario.obstacles:
        obstacle = scenario.obstacles[0]
        distance_m = haversine_distance_m(
            GeoPoint(lat=latest.lat, lon=latest.lon),
            obstacle.location,
        )
        speed_mps = max(latest.speed_mps, 0.1)
        seconds_to_breach = distance_m / speed_mps
        if distance_m <= 200.0:
            flags.append(
                {
                    "type": "restricted_zone_proximity",
                    "severity": "medium",
                    "timestamp": latest.timestamp,
                    "observed_value": round(distance_m, 1),
                    "threshold": 200.0,
                    "evidence": (
                        f"Drone is {round(distance_m)} m from restricted airspace on the autopilot heading."
                    ),
                }
            )
        if seconds_to_breach <= 12.0 and latest.speed_mps > 0:
            flags.append(
                {
                    "type": "breach_imminent",
                    "severity": "high",
                    "timestamp": latest.timestamp,
                    "observed_value": round(seconds_to_breach, 1),
                    "threshold": 12.0,
                    "evidence": (
                        f"At {latest.speed_mps:.1f} m/s the drone breaches the no-fly boundary in "
                        f"~{round(seconds_to_breach, 1)} s if autopilot is not overridden."
                    ),
                }
            )
        elif reachability.detour_distance_m > 0:
            flags.append(
                {
                    "type": "obstacle_detour_required",
                    "severity": "medium",
                    "timestamp": latest.timestamp,
                    "observed_value": reachability.detour_distance_m,
                    "threshold": 0.0,
                    "evidence": "Scenario route includes restricted airspace that requires a detour.",
                }
            )
    return flags
