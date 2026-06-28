# Documentation Index
**DroneGuard Multiverse**

This folder captures the hackathon project plan, implementation structure, and integration notes for DroneGuard Multiverse.

## Start Here

1. [Hackathon plan](./HACKATHON_PLAN.md) - 24-hour build plan, MVP boundary, milestones, risks, and judging narrative.
2. [Architecture](./ARCHITECTURE.md) - agents, data flow, component boundaries, and repo structure.
3. [Cerebras integration notes](./CEREBRAS_INTEGRATION.md) - model ID, linked docs, request patterns, reasoning, image inputs, and validation caveats.
4. [Data contracts](./DATA_CONTRACTS.md) - telemetry CSV fields and structured JSON outputs expected from agents.
5. [Web app and observability](./WEB_APP_AND_OBSERVABILITY.md) - browser UI requirements, simulator integration, traces, logs, and cached replay.
6. [Demo runbook](./DEMO_RUNBOOK.md) - demo script, asset checklist, fallback path, and pitch talking points.

## One-Sentence Pitch

DroneGuard Multiverse uses fast multimodal agents to inspect drone frames and telemetry from predefined missions, then recommends whether the drone should continue, return to start, hold position, or detour around an obstacle.
