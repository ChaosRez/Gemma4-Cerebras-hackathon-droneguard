# DroneGuard Multiverse

DroneGuard Multiverse is a hackathon MVP for multimodal drone safety decision support. It uses drone video keyframes, telemetry, and mission intent to coordinate specialized agents that compare multiple possible next actions and recommend the safest one.

The project is intentionally scoped as a simulator and operator assistant. It does not control a real drone.

## Hackathon Thesis

Fast inference changes the agent pattern for physical-world systems. Instead of asking one model for one slow answer, DroneGuard Multiverse runs a small team of agents over several possible futures:

- vision analysis over extracted video frames
- telemetry anomaly checks over flight logs
- world-state fusion across image, telemetry, and mission context
- parallel future simulation for route options
- commander selection with an evidence-backed recommendation
- incident-style reporting for judges and operators

## MVP Outcome

The demo should let a user provide:

- 5 to 10 drone frames, or a short video that is converted to keyframes
- telemetry CSV with time, position, altitude, speed, battery, and link quality
- a short mission goal, such as "inspect area and return safely"

The app should produce:

- agent timeline
- risk score
- scenario comparison table
- recommended action
- concise mission safety report
- latency metrics showing how many futures were evaluated

## Documentation

- [Project documentation index](./docs/README.md)
- [Hackathon plan](./docs/HACKATHON_PLAN.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Cerebras integration notes](./docs/CEREBRAS_INTEGRATION.md)
- [Data contracts](./docs/DATA_CONTRACTS.md)
- [Demo runbook](./docs/DEMO_RUNBOOK.md)

## Proposed Repository Structure

```text
.
|-- data/samples/                    # demo telemetry, frames, and videos
|-- docs/                            # project plan and technical docs
|-- scripts/                         # one-off demo and asset preparation scripts
|-- src/droneguard_multiverse/
|   |-- agents/                      # vision, telemetry, world-state, scenario, commander, report agents
|   |-- integrations/cerebras/       # Cerebras client, image formatting, request helpers
|   |-- orchestration/               # agent graph and parallel execution flow
|   |-- schemas/                     # typed data models and JSON schema definitions
|   |-- simulation/                  # trajectory and future-option simulator
|   `-- ui/                          # Streamlit MVP UI
`-- tests/                           # schema, parser, simulator, and orchestration tests
```

## Build Defaults

- Backend and orchestration: Python 3.12
- MVP UI: Streamlit
- API integration: Cerebras Chat Completions
- Multimodal model target: `gemma-4-31b`
- Video handling: extract keyframes, then send images
- Agent outputs: structured JSON validated by local schemas

## Current Status

This repository currently contains the planning and implementation scaffold. Start with the kickoff checklist in [Hackathon plan](./docs/HACKATHON_PLAN.md), especially the Cerebras API validation step.
