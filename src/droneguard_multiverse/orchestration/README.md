# Orchestration

This folder should coordinate a full DroneGuard run.

The orchestrator owns:

- run IDs
- scenario validation
- agent ordering
- live vs replay mode selection
- timing metrics
- error capture
- Cerebras response cache reads and writes
- final normalized result assembly

For the hackathon MVP, keep orchestration straightforward. The sequence is Vision, Telemetry, decision context assembly, then Commander.
