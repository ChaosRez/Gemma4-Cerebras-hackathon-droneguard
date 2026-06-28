# Orchestration

This folder should coordinate a full DroneGuard run.

The orchestrator owns:

- run IDs
- input validation
- agent ordering
- parallel scenario fan-out
- timing metrics
- error capture
- final normalized result assembly

For the hackathon MVP, use straightforward Python async orchestration instead of introducing a large workflow framework.

