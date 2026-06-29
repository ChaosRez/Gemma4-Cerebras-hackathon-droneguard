from __future__ import annotations

from dataclasses import asdict, is_dataclass
import json
import time
from typing import Any


class PydanticAIIntegrationError(RuntimeError):
    pass


def run_text_agent(
    *,
    api_key: str | None,
    model_name: str,
    messages: list[dict[str, Any]],
    output_type: type[Any] | None = None,
    retries: int = 2,
    reasoning_effort: str | None = None,
    temperature: float = 0.1,
) -> dict[str, Any]:
    if not api_key:
        raise PydanticAIIntegrationError("CEREBRAS_API_KEY is not set")

    prompt = messages_to_text_prompt(messages)
    try:
        from pydantic_ai import Agent, ToolOutput
        from pydantic_ai.models.cerebras import CerebrasModel
        from pydantic_ai.providers.cerebras import CerebrasProvider
    except ImportError as exc:
        raise PydanticAIIntegrationError(
            "Pydantic AI Cerebras support is not installed; install pydantic-ai-slim and openai"
        ) from exc

    model = CerebrasModel(model_name, provider=CerebrasProvider(api_key=api_key))
    output_spec = _output_spec(output_type, retries, ToolOutput)
    try:
        agent = Agent(
            model,
            output_type=output_spec,
            instructions=_agent_instructions(output_type),
            retries=retries,
            name=_agent_name(output_type),
        )
    except TypeError:
        agent = Agent(model, result_type=output_spec, retries=retries)

    started = time.time()
    try:
        result = agent.run_sync(prompt, model_settings=model_settings(temperature, reasoning_effort))
    except TypeError:
        result = agent.run_sync(prompt)

    output = _result_output(result)
    response: dict[str, Any] = {
        "id": f"pydantic_ai_{int(started * 1000)}",
        "object": "chat.completion",
        "created": int(started),
        "model": model_name,
        "provider": "pydantic_ai:cerebras",
        "pydantic_ai_output_mode": "tool" if output_type is not None else "text",
        "pydantic_ai_output_type": getattr(output_type, "__name__", None),
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": output},
                "finish_reason": "stop",
            }
        ],
    }
    usage = _result_usage(result)
    if usage is not None:
        response["usage"] = usage
    return response


def messages_to_text_prompt(messages: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for message in messages:
        role = str(message.get("role", "user")).upper()
        text = _content_to_text(message.get("content", ""))
        if text:
            parts.append(f"{role}:\n{text}")
    if not parts:
        raise PydanticAIIntegrationError("Pydantic AI text agent requires at least one text message")
    return "\n\n".join(parts)


def model_settings(temperature: float, reasoning_effort: str | None) -> dict[str, Any]:
    settings: dict[str, Any] = {"temperature": temperature}
    if reasoning_effort:
        settings["openai_reasoning_effort"] = reasoning_effort
    return settings


def _output_spec(output_type: type[Any] | None, retries: int, tool_output_type: type[Any]) -> Any:
    if output_type is None:
        return str
    return tool_output_type(
        output_type,
        name=_output_tool_name(output_type),
        description=_output_description(output_type),
        max_retries=retries,
    )


def _agent_name(output_type: type[Any] | None) -> str:
    if output_type is None:
        return "droneguard_text_agent"
    return f"droneguard_{_snake_case(getattr(output_type, '__name__', 'structured_output'))}"


def _output_tool_name(output_type: type[Any]) -> str:
    return f"return_{_snake_case(getattr(output_type, '__name__', 'structured_output'))}"


def _output_description(output_type: type[Any]) -> str:
    name = getattr(output_type, "__name__", "structured output")
    if name == "CommanderAgentOutput":
        return (
            "Return the complete CommanderAgentOutput object. Do not return a shortcut like "
            "{\"action\":\"continue_mission\"}; use recommended_action and include confidence, "
            "operator_message, why, rejected_actions, and evidence_refs."
        )
    if name == "TelemetryAgentOutput":
        return (
            "Return the complete TelemetryAgentOutput object with agent, mission_reachability, "
            "risk_flags, and numeric summary fields."
        )
    return f"Return one complete {name} object with every required field populated."


def _agent_instructions(output_type: type[Any] | None) -> str | None:
    if output_type is None:
        return None
    return (
        "Use the configured Pydantic AI output tool for the final answer. "
        "Do not answer with plain text, Markdown fences, or a partial JSON object. "
        "Populate every required field in the output model using only the supplied mission evidence."
    )


def _snake_case(value: str) -> str:
    output: list[str] = []
    for index, char in enumerate(value):
        if char.isupper() and index:
            output.append("_")
        output.append(char.lower())
    return "".join(output)


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text_parts: list[str] = []
        for part in content:
            if not isinstance(part, dict):
                raise PydanticAIIntegrationError("Pydantic AI text agent received unsupported message part")
            if part.get("type") == "text":
                text_parts.append(str(part.get("text", "")))
                continue
            raise PydanticAIIntegrationError(
                "Pydantic AI text agent received non-text content; use the raw Cerebras client for multimodal calls"
            )
        return "\n".join(part for part in text_parts if part)
    raise PydanticAIIntegrationError("Pydantic AI text agent received unsupported message content")


def _result_output(result: Any) -> str:
    for attribute in ("output", "data"):
        if hasattr(result, attribute):
            value = getattr(result, attribute)
            if hasattr(value, "model_dump_json"):
                return str(value.model_dump_json())
            if isinstance(value, dict | list):
                return json.dumps(value)
            return str(value)
    return str(result)


def _result_usage(result: Any) -> dict[str, Any] | None:
    usage = getattr(result, "usage", None)
    if callable(usage):
        usage = usage()
    return _jsonable(usage)


def _jsonable(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        dumped = value.model_dump()
        return dumped if isinstance(dumped, dict) else {"value": dumped}
    if hasattr(value, "__dict__"):
        return dict(value.__dict__)
    return {"value": str(value)}
