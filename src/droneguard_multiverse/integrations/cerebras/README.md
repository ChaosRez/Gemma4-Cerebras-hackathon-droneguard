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

The default runtime is the raw Cerebras Chat Completions request path. `DRONEGUARD_AGENT_RUNTIME=pydantic_ai` routes text-only live requests through `integrations/pydantic_ai/`; multimodal Vision requests still use the raw client.

See `docs/CEREBRAS_INTEGRATION.md` before implementing this layer.
