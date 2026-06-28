from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import time
from typing import Any, Callable

from droneguard_multiverse.cache.keys import build_cache_key
from droneguard_multiverse.cache.replay import CacheMissError, ResponseCache
from droneguard_multiverse.integrations.cerebras.client import (
    CerebrasClient,
    CerebrasClientError,
    assistant_text,
)


@dataclass(frozen=True)
class AgentExecution:
    agent: str
    status: str
    mode: str
    cache_hit: bool
    cache_key: str
    model: str
    prompt_version: str
    reasoning_effort: str | None
    response_time_ms: int
    request: dict[str, Any]
    response: dict[str, Any]
    normalized_output: dict[str, Any]
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent": self.agent,
            "status": self.status,
            "mode": self.mode,
            "cache_hit": self.cache_hit,
            "cache_key": self.cache_key,
            "model": self.model,
            "prompt_version": self.prompt_version,
            "reasoning_effort": self.reasoning_effort,
            "response_time_ms": self.response_time_ms,
            "request": self.request,
            "response": self.response,
            "normalized_output": self.normalized_output,
            "error": self.error,
        }


def execute_agent(
    *,
    scenario_id: str,
    agent: str,
    prompt_version: str,
    model: str,
    reasoning_effort: str | None,
    input_payload: dict[str, Any],
    messages: list[dict[str, Any]],
    fallback_output: dict[str, Any],
    validator: Callable[[dict[str, Any]], dict[str, Any]],
    cache: ResponseCache,
    client: CerebrasClient,
    mode: str,
    simulate_latency: bool = True,
) -> AgentExecution:
    reasoning_key = reasoning_effort or "none"
    cache_key = build_cache_key(
        scenario_id=scenario_id,
        agent=agent,
        prompt_version=prompt_version,
        model=model,
        reasoning=reasoning_key,
        input_payload=input_payload,
    )
    request_payload: dict[str, Any] = {"model": model, "messages": messages}
    if reasoning_effort:
        request_payload["reasoning_effort"] = reasoning_effort

    if mode == "replay":
        try:
            entry = cache.load(cache_key, scenario_id, agent)
            if simulate_latency:
                time.sleep(max(0, int(entry.get("response_time_ms", 0))) / 1000.0)
            normalized = validator(entry["normalized_output"])
            return _execution_from_entry(
                entry=entry,
                agent=agent,
                status="complete",
                request_fallback=request_payload,
                normalized=normalized,
                error=None,
            )
        except (CacheMissError, KeyError, ValueError) as exc:
            return _fallback_execution(
                agent=agent,
                cache_key=cache_key,
                model=model,
                prompt_version=prompt_version,
                reasoning_effort=reasoning_effort,
                request=request_payload,
                fallback_output=validator(fallback_output),
                error=f"Replay cache unavailable: {exc}",
            )

    try:
        started = time.perf_counter()
        response = client.chat_completion(messages, reasoning_effort=reasoning_effort)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        normalized = validator(parse_json_object(assistant_text(response)))
        entry = {
            "cache_key": cache_key,
            "scenario_id": scenario_id,
            "agent": agent,
            "model": model,
            "prompt_version": prompt_version,
            "mode": "live",
            "cache_hit": False,
            "request": request_payload,
            "response": response,
            "normalized_output": normalized,
            "response_time_ms": elapsed_ms,
            "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        cache.store(entry)
        return _execution_from_entry(
            entry=entry,
            agent=agent,
            status="complete",
            request_fallback=request_payload,
            normalized=normalized,
            error=None,
        )
    except (CerebrasClientError, ValueError, KeyError, json.JSONDecodeError) as exc:
        try:
            entry = cache.load(cache_key, scenario_id, agent)
            normalized = validator(entry["normalized_output"])
            return _execution_from_entry(
                entry=entry,
                agent=agent,
                status="fallback",
                request_fallback=request_payload,
                normalized=normalized,
                error=f"Live Cerebras call failed, replay cache used: {exc}",
            )
        except (CacheMissError, KeyError, ValueError) as cache_exc:
            return _fallback_execution(
                agent=agent,
                cache_key=cache_key,
                model=model,
                prompt_version=prompt_version,
                reasoning_effort=reasoning_effort,
                request=request_payload,
                fallback_output=validator(fallback_output),
                error=f"Live Cerebras call failed and cache was unavailable: {exc}; {cache_exc}",
            )


def parse_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.startswith("json"):
            stripped = stripped[4:].strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("assistant response did not contain a JSON object")
    payload = json.loads(stripped[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError("assistant JSON response must be an object")
    return payload


def _execution_from_entry(
    *,
    entry: dict[str, Any],
    agent: str,
    status: str,
    request_fallback: dict[str, Any],
    normalized: dict[str, Any],
    error: str | None,
) -> AgentExecution:
    return AgentExecution(
        agent=agent,
        status=status,
        mode=str(entry.get("mode", "replay")),
        cache_hit=bool(entry.get("cache_hit", False)),
        cache_key=str(entry.get("cache_key")),
        model=str(entry.get("model", request_fallback.get("model", ""))),
        prompt_version=str(entry.get("prompt_version", "v1")),
        reasoning_effort=entry.get("reasoning_effort"),
        response_time_ms=int(entry.get("response_time_ms", 0)),
        request=entry.get("request") or request_fallback,
        response=entry.get("response") or {},
        normalized_output=normalized,
        error=error,
    )


def _fallback_execution(
    *,
    agent: str,
    cache_key: str,
    model: str,
    prompt_version: str,
    reasoning_effort: str | None,
    request: dict[str, Any],
    fallback_output: dict[str, Any],
    error: str,
) -> AgentExecution:
    return AgentExecution(
        agent=agent,
        status="fallback",
        mode="fallback",
        cache_hit=False,
        cache_key=cache_key,
        model=model,
        prompt_version=prompt_version,
        reasoning_effort=reasoning_effort,
        response_time_ms=0,
        request=request,
        response={"error": error},
        normalized_output=fallback_output,
        error=error,
    )
