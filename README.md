# DroneGuard Multiverse

DroneGuard Multiverse is a hackathon MVP for multimodal drone safety decision support. It uses predefined drone mission scenarios, video keyframes, telemetry, and mission state to help an operator decide whether the drone should continue, return to start, hold position, or detour around an obstacle.

The project is intentionally scoped as a simulator and operator assistant. It does not control a real drone.

## Hackathon Thesis

Fast inference changes the agent pattern for physical-world systems. Instead of asking one model for one slow answer, DroneGuard Multiverse runs a focused set of agents over a simulated mission state:

- vision analysis over extracted video frames
- telemetry anomaly checks over flight logs
- commander reasoning over mission progress, battery reserve, obstacles, and return-to-start feasibility
- visible logs, cached responses, and replayable response times so the demo can run live or offline

## MVP Outcome

The demo should let a user select one of two predefined scenarios:

- safe mission: the drone can complete its multi-point mission and return with sufficient reserve
- dangerous mission: an obstacle detour and battery drain make the final mission point unsafe, so the Commander recommends returning to start

The app should produce:

- interactive web mission view
- agent timeline with raw Gemma-4 responses
- risk score
- commander action: continue mission, return to start, hold position, or detour obstacle
- concise decision report
- latency metrics from live Cerebras calls or cached replay

## Documentation

- [Project documentation index](./docs/README.md)
- [Hackathon plan](./docs/HACKATHON_PLAN.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Cerebras integration notes](./docs/CEREBRAS_INTEGRATION.md)
- [Data contracts](./docs/DATA_CONTRACTS.md)
- [Web app and observability](./docs/WEB_APP_AND_OBSERVABILITY.md)
- [Demo runbook](./docs/DEMO_RUNBOOK.md)

## Proposed Repository Structure

```text
.
|-- data/samples/                    # demo telemetry, frames, and videos
|-- docs/                            # project plan and technical docs
|-- scripts/                         # one-off demo and asset preparation scripts
|-- src/droneguard_multiverse/
|   |-- agents/                      # vision, telemetry, and commander agents
|   |-- api/                         # lightweight backend endpoints for the web app
|   |-- cache/                       # Cerebras response cache and replay helpers
|   |-- integrations/cerebras/       # Cerebras client, image formatting, request helpers
|   |-- observability/               # trace events, run logs, and response timing
|   |-- orchestration/               # demo run coordination
|   |-- schemas/                     # typed data models and JSON schema definitions
|   |-- simulation/                  # trajectory and future-option simulator
|   `-- ui/                          # backend-facing UI helpers, if needed
|-- web/                             # proper browser-based demo application
`-- tests/                           # schema, parser, simulator, and orchestration tests
```

## Build Defaults

- Backend and orchestration: lightweight Python 3.12 API
- MVP UI: proper browser-based app, preferably React or Next.js
- API integration: Cerebras Chat Completions
- Multimodal model target: `gemma-4-31b`
- Video handling: extract keyframes, then send images
- Agent outputs: structured JSON validated by local schemas
- Demo mode: live Cerebras calls or cached replay with recorded response times

## Current Status

The repository now contains a runnable hackathon prototype:

- predefined safe and dangerous scenarios
- synthetic telemetry CSVs and PNG keyframes
- replay cache seeds for Vision, Telemetry, and Commander agents
- stdlib Python API and orchestrator
- Cerebras Chat Completions wrapper targeting `gemma-4-31b`
- static browser mission-control UI
- focused tests for loaders, telemetry validation, reachability, cache replay, image encoding, and orchestration

## Run Locally

```bash
python scripts/generate_sample_assets.py
PYTHONPATH=src python -m droneguard_multiverse.api.routes --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000>. Replay mode works without credentials. Live and refresh modes require:

```bash
export CEREBRAS_API_KEY="..."
export DRONEGUARD_MODEL="gemma-4-31b"
```

## Test

```bash
pytest
```
