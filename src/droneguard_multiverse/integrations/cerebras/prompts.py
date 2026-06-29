from __future__ import annotations

import json
from typing import Any

from droneguard_multiverse.schemas.agents import ACTIONS
from droneguard_multiverse.schemas.scenario import Scenario
from droneguard_multiverse.schemas.telemetry import TelemetryRow


PROMPT_VERSION = "v1"


def compact_json(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def vision_prompt(scenario: Scenario) -> str:
    frame_ids = [frame.frame_id for frame in scenario.frame_metadata[:5]]
    contract = {
        "agent": "vision",
        "hazards": [
            {
                "type": "obstacle_blocks_nominal_route",
                "severity": "high",
                "confidence": 0.84,
                "frame_ids": [frame_ids[0]] if frame_ids else [],
                "evidence": "Short visual evidence sentence.",
            }
        ],
        "route_observations": [
            {
                "frame_id": frame_ids[0] if frame_ids else "frame_001",
                "description": "Short visual route observation.",
                "confidence": 0.72,
            }
        ],
        "uncertainties": ["Short uncertainty sentence."],
    }
    return (
        "You are the DroneGuard Vision Agent. Analyze the provided drone keyframes for safety hazards. "
        "Return a raw compact JSON object only, with no Markdown fences or commentary. "
        "The agent field must be exactly \"vision\". "
        "Each hazard severity must be one of low, medium, high; map critical hazards to high. "
        "hazards, route_observations, and uncertainties must all be arrays. "
        f"Use this exact shape: {compact_json(contract)}. "
        f"Scenario: {scenario.label}. Mission goal: {scenario.mission_goal}. "
        f"Frame IDs in order: {', '.join(frame_ids)}."
    )


def telemetry_prompt(scenario: Scenario, rows: list[TelemetryRow], reachability: dict[str, Any]) -> str:
    sample = [row.to_dict() for row in rows[-4:]]
    contract = {
        "agent": "telemetry",
        "mission_reachability": {
            "can_complete_final_waypoint_and_return": True,
            "estimated_remaining_range_m": 1200.0,
            "required_range_with_detour_m": 700.0,
            "reserve_after_return_m": 500.0,
            "safety_buffer_m": 120.0,
        },
        "risk_flags": [
            {
                "type": "insufficient_battery_for_detour_and_return",
                "severity": "high",
                "timestamp": "2026-06-28T10:00:08Z",
                "evidence": "Short telemetry evidence sentence.",
            }
        ],
        "summary": {"min_battery_pct": 68.0, "max_speed_mps": 6.4},
    }
    return (
        "You are the DroneGuard Waypoint Agent. Focus on restricted-airspace proximity, "
        "time-to-breach at current speed, and whether a detour still fits within battery reserve. "
        "Return a complete telemetry agent object. Do not omit required fields. "
        f"Use this exact shape: {compact_json(contract)}. "
        f"Scenario: {scenario.label}. Reachability: {compact_json(reachability)}. "
        f"Recent telemetry rows: {compact_json(sample)}."
    )


def commander_prompt(
    scenario: Scenario,
    decision_context: dict[str, Any],
    vision_output: dict[str, Any],
    telemetry_output: dict[str, Any],
) -> str:
    contract = {
        "agent": "commander",
        "recommended_action": "continue_mission",
        "confidence": 0.81,
        "operator_message": "Short operator-facing decision message.",
        "why": ["Short evidence-backed reason."],
        "rejected_actions": [{"action": "return_to_start", "reason": "Short rejection reason."}],
        "evidence_refs": ["telemetry.latest"],
    }
    return (
        "You are the DroneGuard Commander Agent. Choose the safest operator action from this enum: "
        f"{', '.join(ACTIONS)}. Return a complete commander agent object. "
        "Never return a shortcut object such as {\"action\":\"continue_mission\"}; the selected action key is "
        "recommended_action. "
        f"Use this exact shape: {compact_json(contract)}. "
        "If range cannot cover the detour, final waypoint, return path, and safety buffer, choose return_to_start. "
        f"Scenario: {scenario.label}. Decision context: {compact_json(decision_context)}. "
        f"Vision output: {compact_json(vision_output)}. Telemetry output: {compact_json(telemetry_output)}."
    )
