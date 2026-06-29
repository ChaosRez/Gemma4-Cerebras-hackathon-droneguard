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
|   |-- integrations/pydantic_ai/    # optional Pydantic AI Cerebras runtime bridge
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
- Optional agent runtime: Pydantic AI with the Cerebras provider for text-only live agents
- Optional external tracing: LangSmith via OpenTelemetry/Pydantic AI instrumentation
- Multimodal model target: `gemma-4-31b`
- Video handling: extract keyframes, then send images
- Agent outputs: structured JSON validated by local schemas
- Demo mode: live Cerebras calls or cached replay with recorded response times

## Integration Rationale

Pydantic AI is the first optional framework layer because this project is Python, already schema-heavy, and already built around explicit agent outputs, validation, caching, and Cerebras calls. Pydantic AI is model-agnostic, lists Cerebras as a supported provider, and adds structured outputs, tools, retries, multi-agent patterns, evals, and observability hooks without forcing a large framework rewrite.

LangSmith is second because it is observability rather than an agent framework. It maps to DroneGuard's need to inspect agent decisions, latency, cache hits, fallback behavior, and demo reliability, and its tracing docs include Pydantic AI support.

## Current Status

The repository now contains a runnable hackathon prototype:

- predefined safe and dangerous scenarios
- synthetic telemetry CSVs and PNG keyframes
- replay cache seeds for Vision, Telemetry, and Commander agents
- stdlib Python API and orchestrator
- Cerebras Chat Completions wrapper targeting `gemma-4-31b`
- optional Pydantic AI bridge for text-only live agent calls
- optional LangSmith trace configuration for Pydantic AI runs
- static browser mission-control UI
- focused tests for loaders, telemetry validation, reachability, cache replay, image encoding, and orchestration

## Run Locally

```bash
python scripts/generate_sample_assets.py
PYTHONPATH=src python -m droneguard_multiverse.api.routes --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000>. Replay mode works without credentials. Live and refresh modes require:

```bash
cp .env.example .env
# then set CEREBRAS_API_KEY in .env
```

By default, live mode uses the raw Cerebras Chat Completions wrapper. To route text-only Telemetry and Commander calls through Pydantic AI, set:

```bash
DRONEGUARD_AGENT_RUNTIME=pydantic_ai
```

Vision remains on the raw Cerebras client for multimodal image messages. To export Pydantic AI traces to LangSmith, set `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY`, and optionally `LANGSMITH_PROJECT`.

Exported shell variables take precedence over values in `.env`.

## Test

```bash
pytest
```
