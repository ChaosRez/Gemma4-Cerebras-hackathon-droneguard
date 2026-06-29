from __future__ import annotations

from typing import Any

from droneguard_multiverse.agents.common import AgentExecution, execute_agent
from droneguard_multiverse.cache.replay import ResponseCache
from droneguard_multiverse.integrations.cerebras.client import CerebrasClient
from droneguard_multiverse.integrations.cerebras.prompts import PROMPT_VERSION, commander_prompt
from droneguard_multiverse.schemas.agents import ACTIONS, CommanderAgentOutput, validate_commander_output
from droneguard_multiverse.schemas.scenario import Scenario


class CommanderAgent:
    name = "commander"

    def run(
        self,
        *,
        scenario: Scenario,
        decision_context: dict[str, Any],
        vision_output: dict[str, Any],
        telemetry_output: dict[str, Any],
        cache: ResponseCache,
        client: CerebrasClient,
        mode: str,
        simulate_latency: bool = True,
    ) -> AgentExecution:
        fallback = self.fallback_output(decision_context, telemetry_output, vision_output)
        prompt = commander_prompt(scenario, decision_context, vision_output, telemetry_output)
        messages = [{"role": "user", "content": prompt}]
        input_payload = {
            "prompt": prompt,
            "decision_context": decision_context,
            "vision_output": vision_output,
            "telemetry_output": telemetry_output,
        }
        return execute_agent(
            scenario_id=scenario.scenario_id,
            agent=self.name,
            prompt_version=PROMPT_VERSION,
            model=client.model,
            reasoning_effort="medium",
            input_payload=input_payload,
            messages=messages,
            fallback_output=fallback,
            validator=validate_commander_output,
            output_type=CommanderAgentOutput,
            cache=cache,
            client=client,
            mode=mode,
            simulate_latency=simulate_latency,
        )

    def fallback_output(
        self,
        decision_context: dict[str, Any],
        telemetry_output: dict[str, Any],
        vision_output: dict[str, Any],
    ) -> dict[str, Any]:
        reachability = telemetry_output["mission_reachability"]
        can_complete = bool(reachability["can_complete_final_waypoint_and_return"])
        hazards = decision_context.get("primary_hazards", [])
        if not can_complete:
            action = "return_to_start"
            operator_message = (
                "Return to start now. The detour and final waypoint exceed the safe remaining range."
            )
            why = [
                "Telemetry shows the route cannot cover the final waypoint, return path, and reserve buffer.",
                f"Remaining range is {reachability['estimated_remaining_range_m']} m.",
                f"Required range before reserve is {reachability['required_range_with_detour_m']} m.",
            ]
            confidence = 0.86
        elif "obstacle_blocks_nominal_route" in hazards:
            action = "detour_obstacle"
            operator_message = "Detour around the obstacle, then reassess before committing to the final waypoint."
            why = [
                "Vision reports an obstacle on the nominal route.",
                "Telemetry still preserves the return-to-start reserve.",
                "A detour avoids the obstacle while keeping the operator in control.",
            ]
            confidence = 0.74
        else:
            action = "continue_mission"
            operator_message = "Continue the mission. Current telemetry preserves the return reserve."
            why = [
                "No high-severity visual hazard is active in sampled frames.",
                "Telemetry indicates enough range to complete the route and return.",
                "Link, speed, and altitude remain within MVP safety limits.",
            ]
            confidence = 0.81

        return {
            "agent": "commander",
            "recommended_action": action,
            "confidence": confidence,
            "operator_message": operator_message,
            "why": why,
            "rejected_actions": _rejected_actions(action, can_complete),
            "evidence_refs": _evidence_refs(vision_output, telemetry_output),
        }


def _rejected_actions(selected: str, can_complete: bool) -> list[dict[str, str]]:
    reasons = {
        "continue_mission": (
            "Insufficient range after accounting for obstacle detour and return reserve."
            if not can_complete
            else "A more conservative route update is available."
        ),
        "return_to_start": (
            "Telemetry preserves reserve, so aborting now is unnecessary."
            if can_complete
            else "Immediate return is already the selected safe action."
        ),
        "hold_position": "Holding does not improve battery reserve or route reachability.",
        "detour_obstacle": (
            "The detour is only safe if followed by return, not final waypoint completion."
            if not can_complete
            else "No active obstacle requires a detour."
        ),
    }
    return [
        {"action": action, "reason": reason}
        for action, reason in reasons.items()
        if action in ACTIONS and action != selected and reason
    ]


def _evidence_refs(vision_output: dict[str, Any], telemetry_output: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    for hazard in vision_output.get("hazards", []):
        for frame_id in hazard.get("frame_ids", []):
            refs.append(f"vision.{frame_id}")
    for flag in telemetry_output.get("risk_flags", []):
        timestamp = str(flag.get("timestamp", "")).replace(":", "")
        if timestamp:
            refs.append(f"telemetry.{timestamp}")
    return refs or ["telemetry.latest"]
