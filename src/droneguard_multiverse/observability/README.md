# Observability

This folder should hold trace event and run log helpers.

Minimum output:

- local JSONL trace per run
- in-memory events for the current web session
- structured timing and cache metadata for each agent call
- optional Phoenix tracing status when `PHOENIX_TRACING=true`
- optional Phoenix/OpenTelemetry spans for cache lookup, model call, validation, cache store, and fallback steps

The web app should expose these events in an observability panel so judges can inspect Gemma-4 prompts, responses, normalized outputs, errors, and Commander decisions.

Arize Phoenix is an external trace sink, not a runtime dependency for replay mode. The local trace store remains the primary source for the UI.
