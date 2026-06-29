from __future__ import annotations

from dataclasses import asdict, dataclass
import os
from typing import Any, Callable, TypeVar

from droneguard_multiverse.config import load_project_env


@dataclass(frozen=True)
class PhoenixStatus:
    enabled: bool
    project: str | None
    endpoint: str | None
    reason: str

    def to_dict(self) -> dict[str, str | bool | None]:
        return asdict(self)


_CONFIGURED = False
T = TypeVar("T")


def configure_phoenix() -> PhoenixStatus:
    global _CONFIGURED
    load_project_env()
    
    project = os.getenv("PHOENIX_PROJECT_NAME") or "droneguard-multiverse"
    endpoint = os.getenv("PHOENIX_COLLECTOR_ENDPOINT") or "http://127.0.0.1:6006"
    
    if not _truthy(os.getenv("PHOENIX_TRACING")):
        return PhoenixStatus(
            enabled=False,
            project=project,
            endpoint=endpoint,
            reason="PHOENIX_TRACING is not enabled",
        )
        
    if _CONFIGURED:
        return PhoenixStatus(
            enabled=True,
            project=project,
            endpoint=endpoint,
            reason="already configured",
        )

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from openinference.instrumentation.pydantic_ai import OpenInferenceSpanProcessor
        from pydantic_ai import Agent
    except ImportError as exc:
        return PhoenixStatus(
            enabled=False,
            project=project,
            endpoint=endpoint,
            reason=f"Phoenix/OTel dependencies unavailable: {exc}",
        )

    try:
        # Set up OpenTelemetry Tracer Provider
        try:
            tracer_provider = trace.get_tracer_provider()
            if not hasattr(tracer_provider, "add_span_processor"):
                tracer_provider = TracerProvider()
                trace.set_tracer_provider(tracer_provider)
        except Exception:
            tracer_provider = TracerProvider()
            trace.set_tracer_provider(tracer_provider)

        # Set up Exporter (Phoenix endpoint expects /v1/traces for HTTP OTLP)
        traces_endpoint = f"{endpoint.rstrip('/')}/v1/traces"
        exporter = OTLPSpanExporter(endpoint=traces_endpoint)
        tracer_provider.add_span_processor(BatchSpanProcessor(exporter))

        # Add OpenInference processor to reshape Pydantic AI spans
        openinference_processor = OpenInferenceSpanProcessor()
        tracer_provider.add_span_processor(openinference_processor)

        # Instrument Pydantic AI Agents globally
        Agent.instrument_all()
        
    except Exception as exc:
        return PhoenixStatus(
            enabled=False,
            project=project,
            endpoint=endpoint,
            reason=f"configure failed: {exc}",
        )

    _CONFIGURED = True
    return PhoenixStatus(
        enabled=True,
        project=project,
        endpoint=endpoint,
        reason="configured",
    )


def trace_step(
    name: str,
    action: Callable[[], T],
    *,
    run_type: str = "chain",
    metadata: dict[str, Any] | None = None,
) -> T:
    if not _truthy(os.getenv("PHOENIX_TRACING")):
        return action()
    try:
        from opentelemetry import trace
    except ImportError:
        return action()

    tracer = trace.get_tracer("droneguard-multiverse")
    with tracer.start_as_current_span(name) as span:
        if metadata:
            for k, v in _safe_metadata(metadata).items():
                if v is not None:
                    span.set_attribute(k, v)
        return action()


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
