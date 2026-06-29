from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from droneguard_multiverse.config import load_project_env


DEFAULT_MODEL = "gemma-4-31b"
DEFAULT_AGENT_RUNTIME = "pydantic_ai"
DEFAULT_CHAT_COMPLETIONS_URL = "https://api.cerebras.ai/v1/chat/completions"


class CerebrasClientError(RuntimeError):
    pass


class CerebrasClient:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        chat_url: str | None = None,
        timeout_s: float = 45.0,
    ) -> None:
        load_project_env()
        self.api_key = api_key if api_key is not None else os.getenv("CEREBRAS_API_KEY")
        self.model = model or os.getenv("DRONEGUARD_MODEL", DEFAULT_MODEL)
        self.chat_url = chat_url or os.getenv("CEREBRAS_CHAT_COMPLETIONS_URL", DEFAULT_CHAT_COMPLETIONS_URL)
        self.timeout_s = timeout_s
        self.agent_runtime = os.getenv("DRONEGUARD_AGENT_RUNTIME", DEFAULT_AGENT_RUNTIME).strip().lower()

    def chat_completion(
        self,
        messages: list[dict[str, Any]],
        *,
        output_type: type[Any] | None = None,
        reasoning_effort: str | None = None,
        temperature: float = 0.1,
    ) -> dict[str, Any]:
        if not self.api_key:
            raise CerebrasClientError("CEREBRAS_API_KEY is not set")
        if self.effective_agent_runtime(messages, output_type) == "pydantic_ai":
            try:
                from droneguard_multiverse.integrations.pydantic_ai.runner import run_text_agent

                return run_text_agent(
                    api_key=self.api_key,
                    model_name=self.model,
                    messages=messages,
                    output_type=output_type,
                    reasoning_effort=reasoning_effort,
                    temperature=temperature,
                )
            except Exception as exc:
                if _contains_non_text_content(messages):
                    pass
                else:
                    raise CerebrasClientError(f"Pydantic AI Cerebras request failed: {exc}") from exc
        sdk_response = self._chat_completion_openai_sdk(
            messages=messages,
            reasoning_effort=reasoning_effort,
            temperature=temperature,
        )
        if sdk_response is not None:
            return sdk_response
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if reasoning_effort:
            payload["reasoning_effort"] = reasoning_effort
        request = Request(
            self.chat_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout_s) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise CerebrasClientError(f"Cerebras HTTP {exc.code}: {detail}") from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise CerebrasClientError(f"Cerebras request failed: {exc}") from exc

    def _chat_completion_openai_sdk(
        self,
        *,
        messages: list[dict[str, Any]],
        reasoning_effort: str | None,
        temperature: float,
    ) -> dict[str, Any] | None:
        try:
            from openai import OpenAI
        except ImportError:
            return None

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if reasoning_effort:
            payload["reasoning_effort"] = reasoning_effort
        try:
            client = OpenAI(
                api_key=self.api_key,
                base_url=self.chat_url.removesuffix("/chat/completions"),
                timeout=self.timeout_s,
            )
            response = client.chat.completions.create(**payload)
        except Exception as exc:
            raise CerebrasClientError(f"Cerebras OpenAI-compatible request failed: {exc}") from exc
        if hasattr(response, "model_dump"):
            return response.model_dump(mode="json")
        if isinstance(response, dict):
            return response
        raise CerebrasClientError("Cerebras OpenAI-compatible response was not JSON serializable")

    def effective_agent_runtime(self, messages: list[dict[str, Any]], output_type: type[Any] | None = None) -> str:
        if _contains_non_text_content(messages):
            return "cerebras_chat_completions"
        if output_type is not None:
            return "pydantic_ai"
        return "pydantic_ai" if self.agent_runtime == "pydantic_ai" else "cerebras_chat_completions"


def assistant_text(response: dict[str, Any]) -> str:
    try:
        content = response["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise CerebrasClientError("Cerebras response did not include assistant content") from exc
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text_parts = [part.get("text", "") for part in content if isinstance(part, dict)]
        return "\n".join(part for part in text_parts if part)
    raise CerebrasClientError("Cerebras assistant content is not text")


def _contains_non_text_content(messages: list[dict[str, Any]]) -> bool:
    for message in messages:
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict) or part.get("type") != "text":
                return True
    return False
