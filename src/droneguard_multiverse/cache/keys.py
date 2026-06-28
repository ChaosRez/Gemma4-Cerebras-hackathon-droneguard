from __future__ import annotations

import hashlib
import json
from typing import Any


def stable_json(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def input_hash(payload: Any) -> str:
    return hashlib.sha256(stable_json(payload).encode("utf-8")).hexdigest()[:16]


def build_cache_key(
    *,
    scenario_id: str,
    agent: str,
    prompt_version: str,
    model: str,
    reasoning: str,
    input_payload: Any,
) -> str:
    digest = input_hash(input_payload)
    reasoning_key = reasoning or "none"
    return f"{scenario_id}:{agent}:{prompt_version}:{model}:{reasoning_key}:{digest}"


def cache_filename(cache_key: str) -> str:
    return hashlib.sha256(cache_key.encode("utf-8")).hexdigest() + ".json"
