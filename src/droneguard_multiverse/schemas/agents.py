from __future__ import annotations

from typing import Any


ACTIONS = ("continue_mission", "return_to_start", "hold_position", "detour_obstacle")
SEVERITIES = ("low", "medium", "high")


class AgentOutputValidationError(ValueError):
    pass


def validate_vision_output(output: dict[str, Any]) -> dict[str, Any]:
    _require_agent(output, "vision")
    hazards = _require_list(output, "hazards")
    _require_list(output, "route_observations")
    _require_list(output, "uncertainties")
    for hazard in hazards:
        if hazard.get("severity") not in SEVERITIES:
            raise AgentOutputValidationError("vision hazard severity must be low, medium, or high")
        _require_list(hazard, "frame_ids")
        _require_number(hazard, "confidence", 0.0, 1.0)
    return output


def validate_telemetry_output(output: dict[str, Any]) -> dict[str, Any]:
    _require_agent(output, "telemetry")
    reachability = _require_dict(output, "mission_reachability")
    for field in (
        "can_complete_final_waypoint_and_return",
        "estimated_remaining_range_m",
        "required_range_with_detour_m",
        "reserve_after_return_m",
        "safety_buffer_m",
    ):
        if field not in reachability:
            raise AgentOutputValidationError(f"telemetry reachability missing {field}")
    if not isinstance(reachability["can_complete_final_waypoint_and_return"], bool):
        raise AgentOutputValidationError("can_complete_final_waypoint_and_return must be boolean")
    _require_list(output, "risk_flags")
    _require_dict(output, "summary")
    return output


def validate_commander_output(output: dict[str, Any]) -> dict[str, Any]:
    _require_agent(output, "commander")
    if output.get("recommended_action") not in ACTIONS:
        raise AgentOutputValidationError("commander recommended_action is not in the allowed enum")
    _require_number(output, "confidence", 0.0, 1.0)
    if not str(output.get("operator_message", "")).strip():
        raise AgentOutputValidationError("commander operator_message is required")
    _require_list(output, "why")
    _require_list(output, "rejected_actions")
    _require_list(output, "evidence_refs")
    return output


def _require_agent(output: dict[str, Any], expected: str) -> None:
    if output.get("agent") != expected:
        raise AgentOutputValidationError(f"expected agent={expected}")


def _require_dict(output: dict[str, Any], key: str) -> dict[str, Any]:
    value = output.get(key)
    if not isinstance(value, dict):
        raise AgentOutputValidationError(f"{key} must be an object")
    return value


def _require_list(output: dict[str, Any], key: str) -> list[Any]:
    value = output.get(key)
    if not isinstance(value, list):
        raise AgentOutputValidationError(f"{key} must be a list")
    return value


def _require_number(output: dict[str, Any], key: str, minimum: float, maximum: float) -> float:
    value = output.get(key)
    if not isinstance(value, int | float):
        raise AgentOutputValidationError(f"{key} must be numeric")
    if value < minimum or value > maximum:
        raise AgentOutputValidationError(f"{key} must be between {minimum} and {maximum}")
    return float(value)
