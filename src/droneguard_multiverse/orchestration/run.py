from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any
from uuid import uuid4

from droneguard_multiverse.agents.commander import CommanderAgent
from droneguard_multiverse.agents.telemetry import TelemetryAgent
from droneguard_multiverse.agents.vision import VisionAgent
from droneguard_multiverse.cache.replay import ResponseCache
from droneguard_multiverse.integrations.cerebras.client import CerebrasClient
from droneguard_multiverse.observability.events import TraceEvent
from droneguard_multiverse.observability.phoenix import configure_phoenix
from droneguard_multiverse.observability.trace_store import TraceStore
from droneguard_multiverse.paths import DATA_DIR, TRACE_DIR
from droneguard_multiverse.schemas.agents import ACTIONS
from droneguard_multiverse.schemas.scenario import Scenario, load_scenario, load_scenarios
from droneguard_multiverse.schemas.telemetry import TelemetryRow, load_telemetry_csv
from droneguard_multiverse.simulation.reachability import risk_level_from_score


class RunOrchestrator:
    def __init__(
        self,
        *,
        data_dir: Path = DATA_DIR,
        trace_dir: Path = TRACE_DIR,
        cache: ResponseCache | None = None,
        client: CerebrasClient | None = None,
        simulate_latency: bool = True,
    ) -> None:
        self.data_dir = data_dir
        self.trace_dir = trace_dir
        self.cache = cache or ResponseCache(data_dir / "cache")
        self.client = client or CerebrasClient()
        self.simulate_latency = simulate_latency
        self.phoenix_status = configure_phoenix()
        self.vision_agent = VisionAgent()
        self.telemetry_agent = TelemetryAgent()
        self.commander_agent = CommanderAgent()

    def list_scenarios(self) -> list[dict[str, Any]]:
        return [scenario.summary() for scenario in load_scenarios(self.data_dir)]

    def get_scenario_detail(self, scenario_id: str) -> dict[str, Any]:
        scenario = load_scenario(scenario_id, self.data_dir)
        telemetry = self._load_telemetry(scenario)
        detail = scenario.to_dict()
        detail["frame_urls"] = [
            {
                **frame.to_dict(),
                "url": _sample_url(frame.source_path),
            }
            for frame in scenario.frame_metadata
        ]
        detail["telemetry"] = [row.to_dict() for row in telemetry]
        detail["starting_battery_pct"] = telemetry[0].battery_pct
        detail["latest_battery_pct"] = telemetry[-1].battery_pct
        return detail

    def run_scenario(self, scenario_id: str, mode: str = "replay") -> dict[str, Any]:
        if mode not in {"replay", "live", "refresh"}:
            raise ValueError("mode must be replay, live, or refresh")
        
        from opentelemetry import trace
        tracer = trace.get_tracer("droneguard-multiverse")
        
        with tracer.start_as_current_span("droneguard.orchestrator.run_scenario") as span:
            span.set_attribute("scenario_id", scenario_id)
            span.set_attribute("mode", mode)
            
            scenario = load_scenario(scenario_id, self.data_dir)
            telemetry_rows = self._load_telemetry(scenario)
            run_id = _new_run_id()
            trace_store = TraceStore(run_id, self.trace_dir)
            started = perf_counter()

            self._event(
                trace_store,
                scenario,
                "scenario_loaded",
                f"Loaded {scenario.label}.",
                metadata={
                    "mode": mode,
                    "expected_action": scenario.expected_action,
                    "agent_runtime": getattr(self.client, "agent_runtime", "unknown"),
                    "phoenix": self.phoenix_status.to_dict(),
                },
            )

            self._event(trace_store, scenario, "agent_request_started", "Vision Agent started.", agent="vision")
            vision = self.vision_agent.run(
                scenario=scenario,
                cache=self.cache,
                client=self.client,
                mode=mode,
                simulate_latency=self.simulate_latency,
            )
            self._agent_events(trace_store, scenario, vision.to_dict())

            self._event(trace_store, scenario, "agent_request_started", "Zone Monitor started.", agent="telemetry")
            telemetry = self.telemetry_agent.run(
                scenario=scenario,
                telemetry_rows=telemetry_rows,
                cache=self.cache,
                client=self.client,
                mode=mode,
                simulate_latency=self.simulate_latency,
            )
            self._agent_events(trace_store, scenario, telemetry.to_dict())

            decision_context = build_decision_context(
                scenario,
                telemetry_rows,
                vision.normalized_output,
                telemetry.normalized_output,
            )

            self._event(trace_store, scenario, "agent_request_started", "Commander Agent started.", agent="commander")
            commander = self.commander_agent.run(
                scenario=scenario,
                decision_context=decision_context,
                vision_output=vision.normalized_output,
                telemetry_output=telemetry.normalized_output,
                cache=self.cache,
                client=self.client,
                mode=mode,
                simulate_latency=self.simulate_latency,
            )
            self._agent_events(trace_store, scenario, commander.to_dict())
            self._event(
                trace_store,
                scenario,
                "commander_decision_selected",
                f"Commander selected {commander.normalized_output['recommended_action']}.",
                agent="commander",
                duration_ms=commander.response_time_ms,
                cache_hit=commander.cache_hit,
                metadata={"recommended_action": commander.normalized_output["recommended_action"]},
            )

            report = build_decision_report(run_id, decision_context, commander.normalized_output)
            total_ms = int((perf_counter() - started) * 1000)
            self._event(
                trace_store,
                scenario,
                "run_completed",
                "Run completed.",
                duration_ms=total_ms,
                metadata={"total_ms": total_ms, "risk_level": decision_context["risk_level"]},
            )

            agents = [vision.to_dict(), telemetry.to_dict(), commander.to_dict()]
            result_payload = {
                "run_id": run_id,
                "mode": mode,
                "scenario": self.get_scenario_detail(scenario_id),
                "agents": agents,
                "run_health": build_run_health(agents, requested_mode=mode),
                "decision_context": decision_context,
                "decision": commander.normalized_output,
                "report": report,
                "trace_events": trace_store.to_list(),
                "total_run_time_ms": total_ms,
            }
            
            span.set_attribute("output.value", f"Commander Action: {commander.normalized_output['recommended_action']}")
            span.set_attribute("risk_level", decision_context["risk_level"])
            span.set_attribute("total_latency_ms", total_ms)
            
            return result_payload

    def _load_telemetry(self, scenario: Scenario) -> list[TelemetryRow]:
        return load_telemetry_csv(scenario.resolve_asset_path(scenario.assets.telemetry_csv, self.data_dir))

    def _agent_events(self, trace: TraceStore, scenario: Scenario, execution: dict[str, Any]) -> None:
        if execution["status"] == "fallback":
            self._event(
                trace,
                scenario,
                "fallback_used",
                f"{execution['agent'].title()} Agent used fallback output.",
                agent=execution["agent"],
                duration_ms=execution["response_time_ms"],
                cache_hit=execution["cache_hit"],
                metadata={"error": execution.get("error")},
            )
        event_type = "agent_response_replayed" if execution["mode"] == "replay" else "agent_response_received"
        self._event(
            trace,
            scenario,
            event_type,
            f"{execution['agent'].title()} Agent response ready.",
            agent=execution["agent"],
            duration_ms=execution["response_time_ms"],
            cache_hit=execution["cache_hit"],
            metadata={"model": execution["model"], "status": execution["status"]},
        )
        self._event(
            trace,
            scenario,
            "agent_output_validated",
            f"{execution['agent'].title()} Agent output validated.",
            agent=execution["agent"],
            metadata={"cache_key": execution["cache_key"]},
        )

    def _event(
        self,
        trace: TraceStore,
        scenario: Scenario,
        event_type: str,
        message: str,
        *,
        agent: str | None = None,
        duration_ms: int | None = None,
        cache_hit: bool | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        trace.append(
            TraceEvent(
                run_id=trace.run_id,
                scenario_id=scenario.scenario_id,
                event_type=event_type,
                message=message,
                agent=agent,
                duration_ms=duration_ms,
                cache_hit=cache_hit,
                metadata=metadata or {},
            )
        )


def build_decision_context(
    scenario: Scenario,
    telemetry_rows: list[TelemetryRow],
    vision_output: dict[str, Any],
    telemetry_output: dict[str, Any],
) -> dict[str, Any]:
    reachability = telemetry_output["mission_reachability"]
    telemetry_flags = telemetry_output.get("risk_flags", [])
    hazards = [hazard["type"] for hazard in vision_output.get("hazards", [])]
    hazards.extend(flag["type"] for flag in telemetry_flags)
    score = 15
    has_high_visual_hazard = any(hazard.get("severity") == "high" for hazard in vision_output.get("hazards", []))
    score += 30 if has_high_visual_hazard else 0
    score += 35 if not reachability["can_complete_final_waypoint_and_return"] else 0
    score += 10 if any(flag.get("type") == "degraded_link_quality" for flag in telemetry_flags) else 0
    score += 25 if any(flag.get("type") == "breach_imminent" for flag in telemetry_flags) else 0
    score += 15 if any(flag.get("type") == "restricted_zone_proximity" for flag in telemetry_flags) else 0
    score += 20 if has_high_visual_hazard and scenario.route_metrics.detour_distance_m > 0 else 0
    score += 10 if scenario.obstacles else 0
    score = min(100, score)
    latest = telemetry_rows[-1]
    return {
        "scenario_id": scenario.scenario_id,
        "mission_goal": scenario.mission_goal,
        "current_risk_score": score,
        "risk_level": risk_level_from_score(score),
        "current_waypoint_id": latest.current_waypoint_id or scenario.route_metrics.current_waypoint_id,
        "remaining_mission_distance_m": scenario.route_metrics.remaining_mission_distance_m,
        "return_to_start_distance_m": scenario.route_metrics.return_to_start_distance_m,
        "detour_distance_m": scenario.route_metrics.detour_distance_m,
        "estimated_remaining_range_m": reachability["estimated_remaining_range_m"],
        "primary_hazards": hazards,
        "constraints": [
            "avoid obstacles",
            "maintain safe altitude",
            "preserve return-to-start battery",
        ],
        "available_actions": list(ACTIONS),
    }


def build_run_health(agents: list[dict[str, Any]], *, requested_mode: str) -> dict[str, Any]:
    if not agents:
        return {
            "status": "no_run",
            "label": "No run",
            "tone": "neutral",
            "summary": "No agent run has completed.",
            "counts": {"live": 0, "replay": 0, "fallback": 0, "error": 0, "total": 0},
        }

    fallback_count = sum(1 for agent in agents if agent.get("status") == "fallback")
    error_count = sum(1 for agent in agents if agent.get("status") == "error")
    live_count = sum(
        1
        for agent in agents
        if agent.get("status") == "complete" and agent.get("mode") == "live" and not agent.get("cache_hit")
    )
    replay_count = sum(
        1
        for agent in agents
        if agent.get("status") == "complete" and agent.get("mode") == "replay" and agent.get("cache_hit")
    )
    total = len(agents)
    counts = {
        "live": live_count,
        "replay": replay_count,
        "fallback": fallback_count,
        "error": error_count,
        "total": total,
    }
    if error_count:
        return {
            "status": "attention",
            "label": "Needs attention",
            "tone": "danger",
            "summary": f"{error_count} agent step reported an error.",
            "counts": counts,
        }
    if fallback_count:
        return {
            "status": "partial_fallback",
            "label": "Partial fallback",
            "tone": "warning",
            "summary": f"{fallback_count} of {total} agents used replay fallback after a live-call failure.",
            "counts": counts,
        }
    if live_count == total:
        return {
            "status": "all_live",
            "label": "All live",
            "tone": "success",
            "summary": f"All {total} agents completed live Cerebras calls.",
            "counts": counts,
        }
    if requested_mode == "replay" and replay_count == total:
        return {
            "status": "all_replay",
            "label": "Replay",
            "tone": "neutral",
            "summary": f"All {total} agents replayed cached responses.",
            "counts": counts,
        }
    return {
        "status": "mixed",
        "label": "Mixed run",
        "tone": "warning",
        "summary": f"{live_count} live, {replay_count} replay, {fallback_count} fallback.",
        "counts": counts,
    }


def build_decision_report(
    run_id: str,
    decision_context: dict[str, Any],
    commander_output: dict[str, Any],
) -> dict[str, Any]:
    action = commander_output["recommended_action"]
    summary = commander_output["operator_message"]
    next_steps = {
        "continue_mission": ["Continue the planned mission.", "Monitor battery reserve.", "Reassess at the next waypoint."],
        "return_to_start": ["Command return-to-start.", "Avoid the obstacle zone.", "Resume only after recharge or replanning."],
        "hold_position": ["Hold position.", "Recheck link and obstacle state.", "Choose a route update before proceeding."],
        "detour_obstacle": ["Execute the detour.", "Maintain visual clearance.", "Recalculate reserve before the final waypoint."],
    }[action]
    return {
        "title": "DroneGuard Mission Safety Report",
        "run_id": run_id,
        "risk_level": decision_context["risk_level"],
        "recommendation": action,
        "summary": summary,
        "supporting_evidence": commander_output["why"],
        "next_steps": next_steps,
    }


def _new_run_id() -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return f"run_{timestamp}_{uuid4().hex[:8]}"


def _sample_url(source_path: str) -> str:
    path = Path(source_path)
    if path.parts[:2] == ("data", "samples"):
        return "/samples/" + "/".join(path.parts[2:])
    return "/samples/" + source_path
