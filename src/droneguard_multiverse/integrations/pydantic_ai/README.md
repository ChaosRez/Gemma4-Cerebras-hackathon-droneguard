# Pydantic AI Integration

This folder contains the optional Pydantic AI bridge for live text-agent calls.

Current scope:

- Telemetry and Commander can use Pydantic AI's Cerebras provider when `DRONEGUARD_AGENT_RUNTIME=pydantic_ai`.
- Telemetry and Commander request native Pydantic structured output models before the normalized output is cached.
- Structured-output calls use retries so schema repair can happen inside the Pydantic AI run.
- Vision stays on the raw Cerebras Chat Completions client while it sends image content parts.
- Replay mode does not require Pydantic AI or external credentials.

The bridge returns a Chat Completions-like response shape so the existing cache, validation, and UI do not need a separate code path.
