from __future__ import annotations

from dataclasses import asdict, dataclass
import os

from droneguard_multiverse.config import load_project_env


@dataclass(frozen=True)
class LangSmithStatus:
    enabled: bool
    project: str | None
    reason: str

    def to_dict(self) -> dict[str, str | bool | None]:
        return asdict(self)


_CONFIGURED = False


def configure_langsmith() -> LangSmithStatus:
    global _CONFIGURED
    load_project_env()
    project = os.getenv("LANGSMITH_PROJECT") or "droneguard-multiverse"
    if not _truthy(os.getenv("LANGSMITH_TRACING")):
        return LangSmithStatus(enabled=False, project=project, reason="LANGSMITH_TRACING is not enabled")
    if not os.getenv("LANGSMITH_API_KEY"):
        return LangSmithStatus(enabled=False, project=project, reason="LANGSMITH_API_KEY is not set")
    if _CONFIGURED:
        return LangSmithStatus(enabled=True, project=project, reason="already configured")

    try:
        from langsmith import configure
        from pydantic_ai import Agent
    except ImportError as exc:
        return LangSmithStatus(enabled=False, project=project, reason=f"LangSmith dependencies unavailable: {exc}")

    os.environ.setdefault("LANGSMITH_PROJECT", project)
    try:
        configure(project_name=project)
    except TypeError:
        configure()
    Agent.instrument_all()
    _CONFIGURED = True
    return LangSmithStatus(enabled=True, project=project, reason="configured")


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}
