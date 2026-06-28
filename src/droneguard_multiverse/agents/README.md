# Agents

Planned agents:

- Vision Agent: analyzes up to 5 keyframes for hazards and landing-zone clues.
- Telemetry Agent: summarizes telemetry anomalies and threshold breaches.
- Mission Agent: extracts mission intent, constraints, and no-go conditions.
- World-State Agent: merges vision, telemetry, and mission context.
- Scenario Agent: evaluates one possible action and predicts residual risk.
- Commander Agent: chooses the safest action from scenario outputs.
- Report Agent: writes the final operator-facing mission report.

Each agent should return structured data that matches `docs/DATA_CONTRACTS.md`.

