from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


ACTIONS = ("continue_mission", "return_to_start", "hold_position", "detour_obstacle")
SEVERITIES = ("low", "medium", "high")


class AgentOutputValidationError(ValueError):
    pass


ActionName = Literal["continue_mission", "return_to_start", "hold_position", "detour_obstacle"]
SeverityName = Literal["low", "medium", "high"]


class MissionReachabilityOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    can_complete_final_waypoint_and_return: bool
    estimated_remaining_range_m: float
    required_range_with_detour_m: float
    reserve_after_return_m: float
    safety_buffer_m: float


class TelemetryRiskFlagOutput(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    severity: SeverityName
    timestamp: str | None = None
    observed_value: float | None = None
    threshold: float | None = None
    evidence: str | None = None


class TelemetryAgentOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent: Literal["telemetry"]
    mission_reachability: MissionReachabilityOutput
    risk_flags: list[TelemetryRiskFlagOutput]
    summary: dict[str, float]


class RejectedActionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: ActionName
    reason: str


class CommanderAgentOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent: Literal["commander"]
    recommended_action: ActionName
    confidence: float = Field(ge=0.0, le=1.0)
    operator_message: str
    why: list[str]
    rejected_actions: list[RejectedActionOutput]
    evidence_refs: list[str]


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
    try:
        output = TelemetryAgentOutput.model_validate(output).model_dump()
    except ValueError as exc:
        raise AgentOutputValidationError(str(exc)) from exc
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
    try:
        output = CommanderAgentOutput.model_validate(output).model_dump()
    except ValueError as exc:
        raise AgentOutputValidationError(str(exc)) from exc
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
