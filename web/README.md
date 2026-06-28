# Web App

The demo UI should be a proper browser-based application.

Core screens:

- scenario selector
- mission simulator view
- keyframes and telemetry
- Vision, Telemetry, and Commander agent timeline
- Commander decision panel
- observability drawer with raw Gemma-4 responses and response times

The backend can be intentionally simple. The web app should make the system feel complete and inspectable.

Run from the repository root:

```bash
PYTHONPATH=src python -m droneguard_multiverse.api.routes --host 127.0.0.1 --port 8000
```

Then open <http://127.0.0.1:8000>.
