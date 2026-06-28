from __future__ import annotations

from pathlib import Path
from typing import Any

from droneguard_multiverse.agents.common import AgentExecution, execute_agent
from droneguard_multiverse.cache.replay import ResponseCache
from droneguard_multiverse.integrations.cerebras.client import CerebrasClient
from droneguard_multiverse.integrations.cerebras.image_inputs import (
    ImageInputError,
    build_image_content_parts,
)
from droneguard_multiverse.integrations.cerebras.prompts import PROMPT_VERSION, vision_prompt
from droneguard_multiverse.schemas.agents import validate_vision_output
from droneguard_multiverse.schemas.scenario import Scenario


class VisionAgent:
    name = "vision"

    def run(
        self,
        *,
        scenario: Scenario,
        cache: ResponseCache,
        client: CerebrasClient,
        mode: str,
        simulate_latency: bool = True,
    ) -> AgentExecution:
        frame_paths = [
            scenario.resolve_asset_path(frame.source_path)
            for frame in scenario.frame_metadata[:5]
        ]
        prompt = vision_prompt(scenario)
        content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        image_error: str | None = None
        try:
            content.extend(build_image_content_parts(frame_paths))
        except (ImageInputError, FileNotFoundError) as exc:
            image_error = str(exc)
        messages = [{"role": "user", "content": content}]
        input_payload = {
            "prompt": prompt,
            "frames": [
                {
                    "frame_id": frame.frame_id,
                    "path": frame.source_path,
                    "mtime": _mtime_or_none(scenario.resolve_asset_path(frame.source_path)),
                }
                for frame in scenario.frame_metadata[:5]
            ],
            "image_error": image_error,
        }
        return execute_agent(
            scenario_id=scenario.scenario_id,
            agent=self.name,
            prompt_version=PROMPT_VERSION,
            model=client.model,
            reasoning_effort=None,
            input_payload=input_payload,
            messages=messages,
            fallback_output=self.fallback_output(scenario),
            validator=validate_vision_output,
            cache=cache,
            client=client,
            mode=mode,
            simulate_latency=simulate_latency,
        )

    def fallback_output(self, scenario: Scenario) -> dict[str, Any]:
        if scenario.obstacles:
            first = scenario.obstacles[0]
            return {
                "agent": "vision",
                "hazards": [
                    {
                        "type": "obstacle_blocks_nominal_route",
                        "severity": "high",
                        "confidence": 0.84,
                        "frame_ids": [first.first_visible_frame_id],
                        "evidence": "A temporary structure blocks the nominal inspection corridor.",
                    }
                ],
                "route_observations": [
                    {
                        "frame_id": first.first_visible_frame_id,
                        "description": "Open space is visible to the east, but using it requires a detour.",
                        "confidence": 0.68,
                    }
                ],
                "uncertainties": ["Exact obstacle clearance cannot be measured from keyframes alone."],
            }
        return {
            "agent": "vision",
            "hazards": [],
            "route_observations": [
                {
                    "frame_id": scenario.frame_metadata[-1].frame_id,
                    "description": "Nominal route remains visually clear across sampled keyframes.",
                    "confidence": 0.79,
                }
            ],
            "uncertainties": ["Frame sampling cannot rule out transient hazards between keyframes."],
        }


def _mtime_or_none(path: Path) -> float | None:
    try:
        return path.stat().st_mtime
    except FileNotFoundError:
        return None
