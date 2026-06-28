# Cerebras Integration

This folder should contain the Cerebras API wrapper used by agents.

Responsibilities:

- initialize the client from `CEREBRAS_API_KEY`
- set the model from `DRONEGUARD_MODEL`, defaulting to `gemma-4-31b`
- encode image frames as base64 data URIs
- enforce request limits before calling the API
- normalize responses and usage metadata
- expose helpers for text, image, reasoning, and optional tool-calling requests

See `docs/CEREBRAS_INTEGRATION.md` before implementing this layer.

