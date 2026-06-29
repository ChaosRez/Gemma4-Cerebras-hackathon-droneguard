from __future__ import annotations

from dataclasses import asdict, dataclass
import os
from typing import Any, Callable, TypeVar

from droneguard_multiverse.config import load_project_env


@dataclass(frozen=True)
class LangSmithStatus:
    enabled: bool
    project: str | None
    endpoint: str | None
    reason: str

    def to_dict(self) -> dict[str, str | bool | None]:
        return asdict(self)


_CONFIGURED = False
T = TypeVar("T")


def configure_langsmith() -> LangSmithStatus:
    global _CONFIGURED
    load_project_env()
    project = os.getenv("LANGSMITH_PROJECT") or "droneguard-multiverse"
    endpoint = os.getenv("LANGSMITH_ENDPOINT")
    if not _truthy(os.getenv("LANGSMITH_TRACING")):
        return LangSmithStatus(
            enabled=False,
            project=project,
            endpoint=endpoint,
            reason="LANGSMITH_TRACING is not enabled",
        )
    if not os.getenv("LANGSMITH_API_KEY"):
        return LangSmithStatus(
            enabled=False,
            project=project,
            endpoint=endpoint,
            reason="LANGSMITH_API_KEY is not set",
        )
    if _CONFIGURED:
        return LangSmithStatus(enabled=True, project=project, endpoint=endpoint, reason="already configured")

    try:
        from langsmith.integrations.otel import configure
        from pydantic_ai import Agent
    except ImportError as exc:
        return LangSmithStatus(
            enabled=False,
            project=project,
            endpoint=endpoint,
            reason=f"LangSmith dependencies unavailable: {exc}",
        )

    os.environ.setdefault("LANGSMITH_PROJECT", project)
    if endpoint:
        os.environ.setdefault("LANGSMITH_ENDPOINT", endpoint)
    try:
        try:
            configure(project_name=project)
        except TypeError:
            configure()
        Agent.instrument_all()
    except Exception as exc:
        return LangSmithStatus(enabled=False, project=project, endpoint=endpoint, reason=f"configure failed: {exc}")
    _CONFIGURED = True
    return LangSmithStatus(enabled=True, project=project, endpoint=endpoint, reason="configured")


def trace_step(
    name: str,
    action: Callable[[], T],
    *,
    run_type: str = "chain",
    metadata: dict[str, Any] | None = None,
) -> T:
    if not _truthy(os.getenv("LANGSMITH_TRACING")):
        return action()
    try:
        from langsmith import traceable
    except ImportError:
        return action()
    wrapped = traceable(name=name, run_type=run_type, metadata=_safe_metadata(metadata or {}))(action)
    return wrapped()


def _safe_metadata(metadata: dict[str, Any]) -> dict[str, str | int | float | bool | None]:
    safe: dict[str, str | int | float | bool | None] = {}
    for key, value in metadata.items():
        if isinstance(value, str | int | float | bool) or value is None:
            safe[key] = value
        else:
            safe[key] = str(value)
    return safe


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}
