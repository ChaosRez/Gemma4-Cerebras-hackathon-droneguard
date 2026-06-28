# Data Contracts

This document defines the MVP data shapes for telemetry, agent outputs, scenario comparison, and final reports.

Use these contracts as the boundary between UI, orchestration, agents, and local tools.

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

Optional columns:

| Column | Type | Example | Notes |
| --- | --- | --- | --- |
| `heading_deg` | float | `270.0` | 0 to 360 |
| `gps_hdop` | float | `1.2` | Higher means lower precision |
| `wind_mps` | float | `4.0` | Can be synthetic for demo |
| `frame_id` | string | `frame_003` | Used to align telemetry with frame evidence |

Validation rules:

- `battery_pct` must be between 0 and 100.
- `link_quality_pct` must be between 0 and 100.
- `speed_mps` must be non-negative.
- `altitude_m` must be non-negative for the MVP.
- timestamps should be monotonic.

## Frame Metadata

```json
{
  "frame_id": "frame_003",
  "timestamp": "2026-06-28T10:00:03Z",
  "source_path": "data/samples/risky/frames/frame_003.jpg",
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
  "safe_landing_zones": [
    {
      "frame_id": "frame_004",
      "description": "Open paved area to the right side of the frame.",
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
  "risk_flags": [
    {
      "type": "low_link_quality",
      "severity": "medium",
      "timestamp": "2026-06-28T10:00:08Z",
      "observed_value": 41.0,
      "threshold": 50.0,
      "evidence": "Link quality dropped below operating threshold."
    }
  ],
  "summary": {
    "min_battery_pct": 31.0,
    "max_speed_mps": 9.8,
    "min_link_quality_pct": 41.0
  }
}
```

## World State

```json
{
  "mission_goal": "Inspect area and return safely.",
  "current_risk_score": 72,
  "risk_level": "high",
  "primary_hazards": [
    "person_near_flight_path",
    "low_link_quality",
    "battery_declining"
  ],
  "constraints": [
    "avoid people",
    "maintain safe altitude",
    "preserve return-to-home battery"
  ],
  "available_actions": [
    "keep_route",
    "slow_down",
    "climb",
    "reroute_left",
    "reroute_right",
    "emergency_land"
  ]
}
```

## Scenario Output

```json
{
  "action": "slow_down",
  "predicted_risk_score": 48,
  "risk_delta": -24,
  "confidence": 0.74,
  "benefits": [
    "More reaction time near visual hazards",
    "Lower kinetic risk"
  ],
  "failure_modes": [
    "May not resolve worsening link quality"
  ],
  "evidence_refs": [
    "vision.frame_003",
    "telemetry.2026-06-28T10:00:08Z"
  ]
}
```

## Commander Output

```json
{
  "recommended_action": "slow_down",
  "second_best_action": "reroute_right",
  "confidence": 0.76,
  "operator_message": "Slow down immediately while preparing a right-side reroute.",
  "why": [
    "Visual hazard appears near the current path.",
    "Slowing down reduces near-term risk without increasing battery risk sharply.",
    "Emergency landing is premature because a possible landing zone exists but is not confirmed."
  ],
  "rejected_actions": [
    {
      "action": "keep_route",
      "reason": "Highest residual risk near person and obstacle evidence."
    }
  ]
}
```

## Final Report

```json
{
  "title": "DroneGuard Mission Safety Report",
  "run_id": "run_20260628_100003",
  "risk_level": "high",
  "recommendation": "slow_down",
  "summary": "The drone should slow down and prepare to reroute because visual and telemetry evidence indicate elevated operational risk.",
  "supporting_evidence": [
    "Person or obstacle near flight path in frame_003.",
    "Link quality dropped to 41 percent at 10:00:08Z."
  ],
  "next_steps": [
    "Reduce speed.",
    "Monitor link quality.",
    "Confirm right-side reroute or safe landing zone."
  ]
}
```

