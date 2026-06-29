from __future__ import annotations

import json
import os

from droneguard_multiverse.agents.commander import CommanderAgent
from droneguard_multiverse.agents.common import execute_agent
from droneguard_multiverse.cache.replay import ResponseCache
from droneguard_multiverse.config import load_project_env
from droneguard_multiverse.integrations.cerebras.image_inputs import ImageInputError, encode_image_data_uri
from droneguard_multiverse.integrations.cerebras.client import CerebrasClient
from droneguard_multiverse.integrations.cerebras.prompts import vision_prompt
from droneguard_multiverse.integrations.pydantic_ai import (
    PydanticAIIntegrationError,
    messages_to_text_prompt,
    model_settings,
    run_text_agent,
)
from droneguard_multiverse.observability.phoenix import configure_phoenix
from droneguard_multiverse.orchestration.run import RunOrchestrator, build_run_health
from droneguard_multiverse.paths import DATA_DIR
from droneguard_multiverse.schemas.agents import (
    AgentOutputValidationError,
    CommanderAgentOutput,
    TelemetryAgentOutput,
    validate_commander_output,
    validate_telemetry_output,
)
from droneguard_multiverse.schemas.scenario import load_scenario

import pytest


@pytest.fixture(autouse=True)
def _disable_external_phoenix_for_tests(monkeypatch) -> None:
    monkeypatch.setenv("PHOENIX_TRACING", "false")
    monkeypatch.setenv("PHOENIX_PROJECT_NAME", "droneguard-multiverse")


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


def test_pydantic_ai_prompt_bridge_accepts_text_parts() -> None:
    prompt = messages_to_text_prompt(
        [
            {"role": "system", "content": "Return JSON only."},
            {"role": "user", "content": [{"type": "text", "text": "Assess route risk."}]},
        ]
    )

    assert "SYSTEM:\nReturn JSON only." in prompt
    assert "USER:\nAssess route risk." in prompt


def test_pydantic_ai_prompt_bridge_rejects_multimodal_parts() -> None:
    with pytest.raises(PydanticAIIntegrationError):
        messages_to_text_prompt(
            [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Analyze frame."},
                        {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
                    ],
                }
            ]
        )


def test_pydantic_ai_model_settings_include_reasoning_effort() -> None:
    settings = model_settings(0.1, "medium")

    assert settings["temperature"] == 0.1
    assert settings["openai_reasoning_effort"] == "medium"


def test_vision_prompt_pins_raw_json_contract() -> None:
    prompt = vision_prompt(load_scenario("dangerous_detour_low_battery"))

    assert 'agent field must be exactly "vision"' in prompt
    assert "map critical hazards to high" in prompt
    assert '"route_observations":[{' in prompt


def test_commander_prompt_rejects_action_shortcut() -> None:
    scenario = load_scenario("safe_mission")
    from droneguard_multiverse.integrations.cerebras.prompts import commander_prompt

    text = commander_prompt(
        scenario,
        decision_context={"risk_level": "low"},
        vision_output={"agent": "vision", "hazards": [], "route_observations": [], "uncertainties": []},
        telemetry_output={
            "agent": "telemetry",
            "mission_reachability": {
                "can_complete_final_waypoint_and_return": True,
                "estimated_remaining_range_m": 1200,
                "required_range_with_detour_m": 700,
                "reserve_after_return_m": 500,
                "safety_buffer_m": 120,
            },
            "risk_flags": [],
            "summary": {},
        },
    )

    assert '"recommended_action":"continue_mission"' in text
    assert '{"action":"continue_mission"}' in text
    assert "Never return a shortcut object" in text


def test_pydantic_ai_agent_uses_retries_for_structured_outputs(monkeypatch) -> None:
    created = {}

    class FakeToolOutput:
        def __init__(self, type_, *, name, description, max_retries):
            self.type_ = type_
            self.name = name
            self.description = description
            self.max_retries = max_retries

    class FakeAgent:
        def __init__(self, model, *, output_type, instructions, retries, name):
            created["output_type"] = output_type
            created["instructions"] = instructions
            created["name"] = name
            created["retries"] = retries

        def run_sync(self, prompt, model_settings=None):
            class Result:
                output = "ok"

            return Result()

    class FakeModel:
        def __init__(self, model_name, provider):
            created["model_name"] = model_name

    class FakeProvider:
        def __init__(self, api_key):
            created["api_key"] = api_key

    import sys
    import types

    fake_module = types.SimpleNamespace(Agent=FakeAgent, ToolOutput=FakeToolOutput)
    fake_model_module = types.SimpleNamespace(CerebrasModel=FakeModel)
    fake_provider_module = types.SimpleNamespace(CerebrasProvider=FakeProvider)
    monkeypatch.setitem(sys.modules, "pydantic_ai", fake_module)
    monkeypatch.setitem(sys.modules, "pydantic_ai.models.cerebras", fake_model_module)
    monkeypatch.setitem(sys.modules, "pydantic_ai.providers.cerebras", fake_provider_module)

    response = run_text_agent(
        api_key="key",
        model_name="gemma-4-31b",
        messages=[{"role": "user", "content": "Return ok."}],
        output_type=TelemetryAgentOutput,
        retries=3,
    )

    assert created["output_type"].type_ is TelemetryAgentOutput
    assert created["output_type"].name == "return_telemetry_agent_output"
    assert created["output_type"].max_retries == 3
    assert "output tool" in created["instructions"]
    assert created["retries"] == 3
    assert response["choices"][0]["message"]["content"] == "ok"
    assert response["pydantic_ai_output_mode"] == "tool"


def test_structured_text_agents_route_to_pydantic_ai_even_when_raw_runtime_is_configured(monkeypatch) -> None:
    from droneguard_multiverse.integrations.pydantic_ai import runner

    captured = {}

    def fake_run_text_agent(**kwargs):
        captured.update(kwargs)
        payload = {
            "agent": "commander",
            "recommended_action": "continue_mission",
            "confidence": 0.9,
            "operator_message": "Continue mission.",
            "why": ["Route remains safe."],
            "rejected_actions": [],
            "evidence_refs": ["telemetry.latest"],
        }
        return {"provider": "pydantic_ai:cerebras", "choices": [{"message": {"content": json.dumps(payload)}}]}

    monkeypatch.setenv("DRONEGUARD_AGENT_RUNTIME", "cerebras_chat_completions")
    monkeypatch.setattr(runner, "run_text_agent", fake_run_text_agent)
    client = CerebrasClient(api_key="key")

    response = client.chat_completion([{"role": "user", "content": "Choose action."}], output_type=CommanderAgentOutput)

    assert response["provider"] == "pydantic_ai:cerebras"
    assert captured["output_type"] is CommanderAgentOutput
    assert client.effective_agent_runtime([{"role": "user", "content": "Choose action."}], CommanderAgentOutput) == "pydantic_ai"


def test_cerebras_raw_client_prefers_openai_compatible_sdk(monkeypatch) -> None:
    captured = {}

    class FakeCompletions:
        def create(self, **payload):
            captured["payload"] = payload

            class Response:
                def model_dump(self, mode):
                    captured["mode"] = mode
                    return {"choices": [{"message": {"content": "{\"ok\": true}"}}]}

            return Response()

    class FakeChat:
        completions = FakeCompletions()

    class FakeOpenAI:
        def __init__(self, *, api_key, base_url, timeout):
            captured["api_key"] = api_key
            captured["base_url"] = base_url
            captured["timeout"] = timeout
            self.chat = FakeChat()

    import sys
    import types

    monkeypatch.setitem(sys.modules, "openai", types.SimpleNamespace(OpenAI=FakeOpenAI))
    monkeypatch.setenv("DRONEGUARD_AGENT_RUNTIME", "cerebras_chat_completions")
    client = CerebrasClient(api_key="key", model="gemma-4-31b", timeout_s=7)

    response = client.chat_completion([{"role": "user", "content": "Return JSON."}], reasoning_effort="medium")

    assert captured["base_url"] == "https://api.cerebras.ai/v1"
    assert captured["payload"]["reasoning_effort"] == "medium"
    assert captured["mode"] == "json"
    assert response["choices"][0]["message"]["content"] == "{\"ok\": true}"


def test_telemetry_validator_uses_structured_output_model() -> None:
    output = validate_telemetry_output(
        {
            "agent": "telemetry",
            "mission_reachability": {
                "can_complete_final_waypoint_and_return": True,
                "estimated_remaining_range_m": 1280,
                "required_range_with_detour_m": 570,
                "reserve_after_return_m": 710,
                "safety_buffer_m": 120,
            },
            "risk_flags": [],
            "summary": {"min_battery_pct": 68, "max_speed_mps": 6.4},
        }
    )

    assert TelemetryAgentOutput.model_validate(output).agent == "telemetry"
    assert output["mission_reachability"]["estimated_remaining_range_m"] == 1280.0


def test_execute_agent_forwards_pydantic_output_type(tmp_path) -> None:
    class FakeClient:
        model = "gemma-4-31b"
        agent_runtime = "pydantic_ai"
        output_type = None

        def chat_completion(self, messages, *, output_type=None, reasoning_effort=None):
            self.output_type = output_type
            payload = {
                "agent": "commander",
                "recommended_action": "return_to_start",
                "confidence": 0.86,
                "operator_message": "Return to start.",
                "why": ["Reserve is insufficient."],
                "rejected_actions": [{"action": "continue_mission", "reason": "Range is insufficient."}],
                "evidence_refs": ["telemetry.latest"],
            }
            return {"choices": [{"message": {"content": json.dumps(payload)}}]}

    client = FakeClient()
    execution = execute_agent(
        scenario_id="demo",
        agent="commander",
        prompt_version="test",
        model=client.model,
        reasoning_effort="medium",
        input_payload={"prompt": "choose"},
        messages=[{"role": "user", "content": "choose"}],
        fallback_output={},
        validator=validate_commander_output,
        output_type=CommanderAgentOutput,
        cache=ResponseCache(tmp_path / "cache"),
        client=client,
        mode="live",
        simulate_latency=False,
    )

    assert client.output_type is CommanderAgentOutput
    assert execution.normalized_output["recommended_action"] == "return_to_start"
    assert execution.request["output_type"] == "CommanderAgentOutput"


def test_phoenix_config_is_disabled_without_tracing(monkeypatch) -> None:
    monkeypatch.setenv("PHOENIX_TRACING", "false")
    monkeypatch.setenv("PHOENIX_COLLECTOR_ENDPOINT", "http://127.0.0.1:6006")
    monkeypatch.setenv("PHOENIX_PROJECT_NAME", "droneguard-multiverse")

    status = configure_phoenix()

    assert status.enabled is False
    assert status.project == "droneguard-multiverse"
    assert status.endpoint == "http://127.0.0.1:6006"


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
    assert result["run_health"]["status"] == "all_replay"
    assert "phoenix" in result["trace_events"][0]["metadata"]


def test_full_alexanderplatz_replay_run_returns_expected_decision() -> None:
    orchestrator = RunOrchestrator(simulate_latency=False)

    result = orchestrator.run_scenario("alexanderplatz_restricted", mode="replay")

    assert result["decision"]["recommended_action"] == "detour_obstacle"
    assert result["decision_context"]["risk_level"] == "high"
    assert [agent["agent"] for agent in result["agents"]] == ["vision", "telemetry", "commander"]
    assert all(agent["mode"] == "replay" for agent in result["agents"])
    assert result["run_health"]["status"] == "all_replay"


def test_run_health_reports_all_live_agents() -> None:
    agents = [
        {"agent": "vision", "status": "complete", "mode": "live", "cache_hit": False, "error": None},
        {"agent": "telemetry", "status": "complete", "mode": "live", "cache_hit": False, "error": None},
        {"agent": "commander", "status": "complete", "mode": "live", "cache_hit": False, "error": None},
    ]

    health = build_run_health(agents, requested_mode="live")

    assert health["status"] == "all_live"
    assert health["label"] == "All live"
    assert health["counts"]["live"] == 3


def test_run_health_flags_partial_fallback() -> None:
    agents = [
        {"agent": "vision", "status": "fallback", "mode": "replay", "cache_hit": True, "error": "failed"},
        {"agent": "telemetry", "status": "complete", "mode": "live", "cache_hit": False, "error": None},
        {"agent": "commander", "status": "complete", "mode": "live", "cache_hit": False, "error": None},
    ]

    health = build_run_health(agents, requested_mode="live")

    assert health["status"] == "partial_fallback"
    assert health["tone"] == "warning"
    assert health["counts"]["fallback"] == 1


def test_scenario_detail_includes_frame_urls() -> None:
    detail = RunOrchestrator(simulate_latency=False).get_scenario_detail("safe_mission")

    assert detail["frame_urls"][0]["url"] == "/samples/safe/frames/frame_001.png"
    assert load_scenario("safe_mission").scenario_id == detail["scenario_id"]
