# Demo Runbook

## Demo Objective

Show judges that DroneGuard Multiverse coordinates multimodal agents over a physical-world safety problem and uses fast inference to evaluate multiple futures.

## Demo Assets

Prepare two scenarios:

1. Safe flight
   - clear frames
   - stable telemetry
   - normal battery and link quality
   - expected output: continue or slow monitoring

2. Risky flight
   - visible hazard or constrained environment
   - battery decline, high speed, GPS jump, or weak link quality
   - expected output: slow down, reroute, or land

Required files per scenario:

```text
data/samples/<scenario>/
|-- frames/
|   |-- frame_001.jpg
|   |-- frame_002.jpg
|   `-- frame_003.jpg
|-- telemetry.csv
`-- mission.txt
```

## Five-Minute Demo Flow

1. Open the app with the risky scenario selected.
2. Show the mission goal and keyframes.
3. Show the telemetry preview.
4. Run analysis.
5. Narrate the agent timeline:
   - Vision Agent finds visual risks.
   - Telemetry Agent flags flight anomalies.
   - World-State Agent fuses the situation.
   - Scenario Agents evaluate several futures in parallel.
   - Commander Agent chooses the safest action.
6. Show the scenario comparison table.
7. Show the recommendation and final report.
8. Point to timing metrics: number of agent calls, number of futures, total elapsed time.
9. Switch briefly to the safe scenario to show the system is not hardcoded.

## 90-Second Pitch Script

"DroneGuard Multiverse is a multimodal safety simulator for drone operations. It takes drone frames, telemetry, and a mission goal, then coordinates specialized agents to understand the current state and compare possible futures.

The important idea is that fast inference changes the design pattern. Instead of one chatbot answer, we can run a vision agent, a telemetry agent, a world-state agent, and multiple scenario agents in parallel. The commander agent then recommends the safest next action with evidence from both the frames and the flight log.

This is scoped as operator decision support, not real drone control. The demo shows how a physical AI workflow can use Cerebras speed to reason over several possible futures quickly enough to stay inside the operational loop."

## Backup Demo Plan

If live image input is unavailable:

- use precomputed Vision Agent JSON for frame findings
- run telemetry analysis live
- run world-state, scenario, commander, and report agents live
- state clearly that image access is a preview dependency and the rest of the multimodal pipeline is ready

If the API is slow or rate-limited:

- run one live scenario
- load cached outputs for the rest
- still show the expected parallel architecture and timing fields

If the UI breaks:

- run the orchestration script from the terminal
- show generated JSON and final Markdown report

## Judge-Facing Differentiators

- Concrete real-world workflow, not a generic assistant.
- Multimodal input: frames, telemetry, mission text.
- Agent collaboration is visible.
- Fast inference has a purpose: more futures inside the same decision window.
- The MVP stays credible by avoiding real autonomous drone control.

## Final Submission Checklist

- README explains the project in one minute.
- Docs include architecture and Cerebras integration notes.
- Sample scenario runs locally.
- No API keys are committed.
- Demo video is recorded.
- Screenshots are captured.
- Fallback data is checked into `data/samples/`.
