# Agents

Planned agents:

- Vision Agent: analyzes up to 5 keyframes for hazards, obstacles, and route clues.
- Telemetry Agent: summarizes telemetry anomalies, battery reserve, route progress, and reachability.
- Commander Agent: chooses continue mission, return to start, hold position, or detour obstacle.

Each agent should return structured data that matches `docs/DATA_CONTRACTS.md`.

Do not add extra agents for the MVP. Mission context, route state, and reachability estimates should be deterministic backend data passed into these three agents.
