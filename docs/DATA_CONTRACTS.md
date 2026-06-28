# Data Contracts

This document defines the MVP data shapes for predefined scenarios, telemetry, agent outputs, cached responses, and Commander decisions.

Use these contracts as the boundary between the web app, lightweight backend, scenario library, Cerebras cache, and agents.

## Scenario Manifest

The user does not upload data during the demo. The web app loads one predefined scenario.

```json
{
  "scenario_id": "dangerous_detour_low_battery",
  "label": "Dangerous: detour makes final waypoint unsafe",
  "expected_action": "return_to_start",
  "mission_goal": "Inspect all mission waypoints and return to start safely.",
  "start": {"lat": 37.7749, "lon": -122.4194},
  "waypoints": [
    {"id": "wp_1", "lat": 37.7751, "lon": -122.4189, "label": "Inspect north edge"},
    {"id": "wp_2", "lat": 37.7756, "lon": -122.4183, "label": "Inspect equipment yard"},
    {"id": "wp_3", "lat": 37.7762, "lon": -122.4179, "label": "Final inspection point"}
  ],
  "obstacles": [
    {
      "id": "obs_1",
      "type": "temporary_crane",
      "location": {"lat": 37.7757, "lon": -122.4182},
      "requires_detour_m": 180.0,
      "first_visible_frame_id": "frame_003"
    }
  ],
  "assets": {
    "frames_dir": "data/samples/dangerous/frames",
    "telemetry_csv": "data/samples/dangerous/telemetry.csv"
  }
}
```

## Commander Action Enum

```json
[
  "continue_mission",
  "return_to_start",
  "hold_position",
  "detour_obstacle"
]
```

## Telemetry CSV

Required columns:

| Column | Type | Example | Notes |
| --- | --- | --- | --- |
| `timestamp` | ISO-8601 string or seconds | `2026-06-28T10:00:03Z` | Must be monotonic after parsing |
| `lat` | float | `37.7749` | Decimal degrees |
| `lon` | float | `-122.4194` | Decimal degrees |
| `altitude_m` | float | `42.5` | Height above local reference |
| `speed_mps` | float | `6.2` | Ground speed |
| `battery_pct` | float | `54.0` | 0 to 100 |
| `link_quality_pct` | float | `87.0` | 0 to 100 |
| `distance_to_start_m` | float | `320.0` | Current return distance |
| `distance_to_next_waypoint_m` | float | `140.0` | Current mission segment distance |
| `estimated_remaining_range_m` | float | `460.0` | Range estimate from battery model |

Optional columns:

| Column | Type | Example | Notes |
| --- | --- | --- | --- |
| `heading_deg` | float | `270.0` | 0 to 360 |
| `gps_hdop` | float | `1.2` | Higher means lower precision |
| `wind_mps` | float | `4.0` | Can be synthetic for demo |
| `frame_id` | string | `frame_003` | Used to align telemetry with frame evidence |
| `current_waypoint_id` | string | `wp_2` | Current mission progress |

Validation rules:

- `battery_pct` must be between 0 and 100.
- `link_quality_pct` must be between 0 and 100.
- `speed_mps` must be non-negative.
- `altitude_m` must be non-negative for the MVP.
- `estimated_remaining_range_m` must be non-negative.
- timestamps should be monotonic.

## Frame Metadata

```json
{
  "frame_id": "frame_003",
  "timestamp": "2026-06-28T10:00:03Z",
  "source_path": "data/samples/dangerous/frames/frame_003.jpg",
  "mime_type": "image/jpeg",
  "width": 1280,
  "height": 720
}
```

## Vision Agent Output

```json
{
  "agent": "vision",
  "hazards": [
    {
      "type": "person_near_flight_path",
      "severity": "high",
      "confidence": 0.78,
      "frame_ids": ["frame_003", "frame_004"],
      "evidence": "A person appears near the drone's forward path."
    }
  ],
  "route_observations": [
    {
      "frame_id": "frame_004",
      "description": "Obstacle blocks the nominal corridor, with open space visible to the right.",
      "confidence": 0.62
    }
  ],
  "uncertainties": ["Distance to obstacle cannot be measured precisely from image alone."]
}
```

## Telemetry Agent Output

```json
{
  "agent": "telemetry",
  "mission_reachability": {
    "can_complete_final_waypoint_and_return": false,
    "estimated_remaining_range_m": 460.0,
    "required_range_with_detour_m": 690.0,
    "reserve_after_return_m": -230.0,
    "safety_buffer_m": 120.0
  },
  "risk_flags": [
    {
      "type": "insufficient_battery_for_detour_and_return",
      "severity": "high",
      "timestamp": "2026-06-28T10:00:08Z",
      "observed_value": -230.0,
      "threshold": 120.0,
      "evidence": "Remaining range cannot cover obstacle detour, final waypoint, and return-to-start buffer."
    }
  ],
  "summary": {
    "min_battery_pct": 31.0,
    "max_speed_mps": 9.8,
    "min_link_quality_pct": 41.0
  }
}
```

## Decision Context

```json
{
  "scenario_id": "dangerous_detour_low_battery",
  "mission_goal": "Inspect area and return safely.",
  "current_risk_score": 72,
  "risk_level": "high",
  "current_waypoint_id": "wp_2",
  "remaining_mission_distance_m": 510.0,
  "return_to_start_distance_m": 320.0,
  "detour_distance_m": 180.0,
  "estimated_remaining_range_m": 460.0,
  "primary_hazards": [
    "obstacle_blocks_nominal_route",
    "insufficient_battery_for_detour_and_return"
  ],
  "constraints": [
    "avoid obstacle",
    "maintain safe altitude",
    "preserve return-to-home battery"
  ],
  "available_actions": [
    "continue_mission",
    "return_to_start",
    "hold_position",
    "detour_obstacle"
  ]
}
```

## Commander Output

```json
{
  "agent": "commander",
  "recommended_action": "return_to_start",
  "confidence": 0.82,
  "operator_message": "Return to the start now. The detour and final waypoint exceed the safe remaining range.",
  "why": [
    "The obstacle requires a detour before reaching the final waypoint.",
    "Telemetry estimates 460 meters of remaining range.",
    "The detour, final waypoint, and return path require 690 meters plus safety buffer."
  ],
  "rejected_actions": [
    {
      "action": "continue_mission",
      "reason": "Insufficient range after accounting for obstacle detour and return-to-start buffer."
    },
    {
      "action": "detour_obstacle",
      "reason": "The detour is safe only if followed by return, not final waypoint completion."
    },
    {
      "action": "hold_position",
      "reason": "Holding does not improve battery reserve or mission reachability."
    }
  ],
  "evidence_refs": [
    "vision.frame_003",
    "telemetry.2026-06-28T10:00:08Z"
  ]
}
```

## Cached Agent Response

```json
{
  "cache_key": "dangerous_detour_low_battery:commander:v1:gemma-4-31b:abc123",
  "scenario_id": "dangerous_detour_low_battery",
  "agent": "commander",
  "model": "gemma-4-31b",
  "prompt_version": "v1",
  "mode": "live",
  "cache_hit": false,
  "request": {},
  "response": {},
  "normalized_output": {},
  "response_time_ms": 842,
  "created_at": "2026-06-28T10:00:03Z"
}
```

## Trace Event

```json
{
  "run_id": "run_20260628_100003",
  "scenario_id": "dangerous_detour_low_battery",
  "timestamp": "2026-06-28T10:00:03Z",
  "event_type": "agent_response",
  "agent": "commander",
  "message": "Commander selected return_to_start.",
  "duration_ms": 842,
  "cache_hit": false,
  "metadata": {
    "model": "gemma-4-31b",
    "recommended_action": "return_to_start"
  }
}
```

## Final Decision Report

```json
{
  "title": "DroneGuard Mission Safety Report",
  "run_id": "run_20260628_100003",
  "risk_level": "high",
  "recommendation": "return_to_start",
  "summary": "The drone should return to start because the obstacle detour and final waypoint exceed the safe remaining range.",
  "supporting_evidence": [
    "Obstacle blocks the nominal route in frame_003.",
    "Remaining range is 460 meters, while detour plus final waypoint plus return requires 690 meters before safety buffer."
  ],
  "next_steps": [
    "Command return-to-start.",
    "Avoid the obstacle zone.",
    "Resume the mission only after battery replacement or route replanning."
  ]
}
```
