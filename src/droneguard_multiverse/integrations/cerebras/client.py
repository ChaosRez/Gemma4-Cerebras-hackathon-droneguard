from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_MODEL = "gemma-4-31b"
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
        self.api_key = api_key if api_key is not None else os.getenv("CEREBRAS_API_KEY")
        self.model = model or os.getenv("DRONEGUARD_MODEL", DEFAULT_MODEL)
        self.chat_url = chat_url or os.getenv("CEREBRAS_CHAT_COMPLETIONS_URL", DEFAULT_CHAT_COMPLETIONS_URL)
        self.timeout_s = timeout_s

    def chat_completion(
        self,
        messages: list[dict[str, Any]],
        *,
        reasoning_effort: str | None = None,
        temperature: float = 0.1,
    ) -> dict[str, Any]:
        if not self.api_key:
            raise CerebrasClientError("CEREBRAS_API_KEY is not set")
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
