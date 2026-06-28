# Source Layout

This package will hold the DroneGuard Multiverse MVP implementation.

Expected modules:

- `agents/` for model-backed agent steps
- `integrations/cerebras/` for API client and image-input formatting
- `orchestration/` for run coordination and parallel scenario evaluation
- `schemas/` for typed contracts and validation
- `simulation/` for local trajectory and future-action tools
- `ui/` for the Streamlit demo app

Keep the first implementation simple. Prefer small functions with explicit inputs and validated outputs over a heavy agent framework.

