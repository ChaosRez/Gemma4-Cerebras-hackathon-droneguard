# Source Layout

This package will hold the DroneGuard Multiverse MVP implementation.

Expected modules:

- `agents/` for model-backed agent steps
- `api/` for lightweight endpoints used by the web app
- `cache/` for Cerebras response caching and replay
- `integrations/cerebras/` for API client and image-input formatting
- `integrations/pydantic_ai/` for optional Pydantic AI live text-agent calls
- `observability/` for trace events, logs, timings, and decision visibility
- `orchestration/` for run coordination
- `schemas/` for typed contracts and validation
- `simulation/` for route, detour, and reachability helpers
- `ui/` for backend-facing UI helpers, if needed

Keep the backend implementation simple. Prefer small functions with explicit inputs and validated outputs over a heavy agent framework. The browser app should carry the user experience.
