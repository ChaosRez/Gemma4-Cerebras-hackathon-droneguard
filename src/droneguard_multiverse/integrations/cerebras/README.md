# Cerebras Integration

This folder should contain the Cerebras API wrapper used by agents.

Responsibilities:

- initialize the client from `CEREBRAS_API_KEY`
- set the model from `DRONEGUARD_MODEL`, defaulting to `gemma-4-31b`
- select the runtime from `DRONEGUARD_AGENT_RUNTIME`
- load local development values from the project `.env` file without overriding exported variables
- encode image frames as base64 data URIs
- enforce request limits before calling the API
- normalize responses and usage metadata
- expose helpers for Vision, Telemetry, and Commander requests
- pass raw request and response objects to the cache and observability layers

The default structured text runtime is Pydantic AI's Cerebras provider. Multimodal Vision requests still use the raw Cerebras Chat Completions client because they send image content parts.

See `docs/CEREBRAS_INTEGRATION.md` before implementing this layer.
