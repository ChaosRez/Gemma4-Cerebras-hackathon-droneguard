from __future__ import annotations

import os

from droneguard_multiverse.agents.commander import CommanderAgent
from droneguard_multiverse.cache.replay import ResponseCache
from droneguard_multiverse.config import load_project_env
from droneguard_multiverse.integrations.cerebras.image_inputs import ImageInputError, encode_image_data_uri
from droneguard_multiverse.orchestration.run import RunOrchestrator
from droneguard_multiverse.paths import DATA_DIR
from droneguard_multiverse.schemas.agents import AgentOutputValidationError, validate_commander_output
from droneguard_multiverse.schemas.scenario import load_scenario

import pytest


def test_image_encoder_accepts_png_frame() -> None:
    frame = DATA_DIR / "safe" / "frames" / "frame_001.png"

    data_uri = encode_image_data_uri(frame)

    assert data_uri.startswith("data:image/png;base64,")


def test_image_encoder_rejects_unsupported_formats(tmp_path) -> None:
    text_file = tmp_path / "frame.txt"
    text_file.write_text("not an image", encoding="utf-8")

    with pytest.raises(ImageInputError):
        encode_image_data_uri(text_file)


def test_project_env_loader_sets_missing_values_without_overriding_exports(tmp_path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "CEREBRAS_API_KEY='from-file'",
                'DRONEGUARD_MODEL="from-file-model"',
                "EXPORTED_ONLY=from-file",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.delenv("CEREBRAS_API_KEY", raising=False)
    monkeypatch.setenv("DRONEGUARD_MODEL", "from-shell")

    load_project_env(env_file)

    assert os.environ["CEREBRAS_API_KEY"] == "from-file"
    assert os.environ["DRONEGUARD_MODEL"] == "from-shell"


def test_seed_cache_replay_returns_recorded_latency() -> None:
    cache = ResponseCache(DATA_DIR / "cache")

    entry = cache.load("test-key", "dangerous_detour_low_battery", "commander")

    assert entry["cache_key"] == "test-key"
    assert entry["cache_hit"] is True
    assert entry["response_time_ms"] == 918
    assert entry["normalized_output"]["recommended_action"] == "return_to_start"


def test_commander_validation_catches_bad_action() -> None:
    with pytest.raises(AgentOutputValidationError):
        validate_commander_output(
            {
                "agent": "commander",
                "recommended_action": "land_somewhere",
                "confidence": 0.5,
                "operator_message": "Bad action.",
                "why": [],
                "rejected_actions": [],
                "evidence_refs": [],
            }
        )


def test_commander_fallback_returns_to_start_when_reserve_is_insufficient() -> None:
    output = CommanderAgent().fallback_output(
        decision_context={"primary_hazards": ["obstacle_blocks_nominal_route"]},
        vision_output={
            "agent": "vision",
            "hazards": [{"frame_ids": ["frame_003"]}],
            "route_observations": [],
            "uncertainties": [],
        },
        telemetry_output={
            "agent": "telemetry",
            "mission_reachability": {
                "can_complete_final_waypoint_and_return": False,
                "estimated_remaining_range_m": 460.0,
                "required_range_with_detour_m": 690.0,
                "reserve_after_return_m": -230.0,
                "safety_buffer_m": 120.0,
            },
            "risk_flags": [
                {"type": "insufficient_battery_for_detour_and_return", "timestamp": "2026-06-28T10:00:08Z"}
            ],
            "summary": {},
        },
    )

    assert output["recommended_action"] == "return_to_start"


def test_full_dangerous_replay_run_returns_expected_decision() -> None:
    orchestrator = RunOrchestrator(simulate_latency=False)

    result = orchestrator.run_scenario("dangerous_detour_low_battery", mode="replay")

    assert result["decision"]["recommended_action"] == "return_to_start"
    assert result["decision_context"]["risk_level"] == "high"
    assert [agent["agent"] for agent in result["agents"]] == ["vision", "telemetry", "commander"]
    assert all(agent["mode"] == "replay" for agent in result["agents"])


def test_scenario_detail_includes_frame_urls() -> None:
    detail = RunOrchestrator(simulate_latency=False).get_scenario_detail("safe_mission")

    assert detail["frame_urls"][0]["url"] == "/samples/safe/frames/frame_001.png"
    assert load_scenario("safe_mission").scenario_id == detail["scenario_id"]
