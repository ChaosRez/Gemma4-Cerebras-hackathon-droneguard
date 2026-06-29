from __future__ import annotations

from typing import Any

from droneguard_multiverse.agents.common import AgentExecution, execute_agent
from droneguard_multiverse.cache.replay import ResponseCache
from droneguard_multiverse.integrations.cerebras.client import CerebrasClient
from droneguard_multiverse.integrations.cerebras.prompts import PROMPT_VERSION, telemetry_prompt
from droneguard_multiverse.schemas.agents import TelemetryAgentOutput, validate_telemetry_output
from droneguard_multiverse.schemas.scenario import Scenario
from droneguard_multiverse.schemas.telemetry import TelemetryRow
from droneguard_multiverse.simulation.reachability import (
    estimate_reachability,
    telemetry_risk_flags,
    telemetry_summary,
)


class TelemetryAgent:
    name = "telemetry"

    def run(
        self,
        *,
        scenario: Scenario,
        telemetry_rows: list[TelemetryRow],
        cache: ResponseCache,
        client: CerebrasClient,
        mode: str,
        simulate_latency: bool = True,
    ) -> AgentExecution:
        fallback = self.fallback_output(scenario, telemetry_rows)
        prompt = telemetry_prompt(scenario, telemetry_rows, fallback["mission_reachability"])
        messages = [{"role": "user", "content": prompt}]
        input_payload = {
            "prompt": prompt,
            "latest_telemetry": telemetry_rows[-1].to_dict(),
            "reachability": fallback["mission_reachability"],
        }
        return execute_agent(
            scenario_id=scenario.scenario_id,
            agent=self.name,
            prompt_version=PROMPT_VERSION,
            model=client.model,
            reasoning_effort=None,
            input_payload=input_payload,
            messages=messages,
            fallback_output=fallback,
            validator=validate_telemetry_output,
            output_type=TelemetryAgentOutput,
            cache=cache,
            client=client,
            mode=mode,
            simulate_latency=simulate_latency,
        )

    def fallback_output(self, scenario: Scenario, telemetry_rows: list[TelemetryRow]) -> dict[str, Any]:
        reachability = estimate_reachability(scenario, telemetry_rows)
        return {
            "agent": "telemetry",
            "mission_reachability": {
                "can_complete_final_waypoint_and_return": reachability.can_complete_final_waypoint_and_return,
                "estimated_remaining_range_m": reachability.estimated_remaining_range_m,
                "required_range_with_detour_m": reachability.required_range_with_detour_m,
                "reserve_after_return_m": reachability.reserve_after_return_m,
                "safety_buffer_m": reachability.safety_buffer_m,
            },
            "risk_flags": telemetry_risk_flags(scenario, telemetry_rows, reachability),
            "summary": telemetry_summary(telemetry_rows),
        }
