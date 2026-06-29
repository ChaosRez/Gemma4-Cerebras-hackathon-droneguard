# Demo Runbook

## Demo Objective

Show judges that DroneGuard Multiverse is a proper web-based mission control demo with transparent multimodal agents, cached Cerebras responses, and an auditable Commander decision.

## Demo Assets

Prepare two scenarios:

1. Safe flight
   - clear frames
   - stable telemetry
   - normal battery and link quality
   - multi-point route can be completed with return reserve
   - expected output: continue mission

2. Risky flight
   - visible hazard or constrained environment
   - restricted area forces a detour
   - battery level and detour mean the drone cannot safely reach the final mission point and return
   - expected output: return to start

Required files per scenario:

```text
data/samples/<scenario>/
|-- frames/
|   |-- frame_001.jpg
|   |-- frame_002.jpg
|   `-- frame_003.jpg
|-- cache/
|   |-- vision.json
|   |-- telemetry.json
|   `-- commander.json
|-- scenario.json
|-- telemetry.csv
`-- mission.txt
```

## Five-Minute Demo Flow

1. Open the app with the dangerous scenario selected.
2. Show the mission route, waypoints, restricted area, drone position, and battery reserve.
3. Show the keyframes and telemetry preview.
4. Run analysis.
5. Narrate the agent timeline:
   - Vision Agent finds visual risks.
   - Telemetry Agent flags the battery and reachability risk.
   - Commander Agent chooses `return_to_start`.
6. Open the observability panel and show:
   - raw Gemma-4 response
   - normalized JSON
   - cache/live status
   - response time
   - decision trace
7. Show the recommendation and final decision report.
8. Switch briefly to the safe scenario to show `continue_mission`.

## 90-Second Pitch Script

"DroneGuard Multiverse is a web-based safety simulator for drone operations. The operator selects a predefined multi-point mission, watches the simulated drone progress through the route, and sees Vision, Telemetry, and Commander agents reason over frames and flight data.

In the dangerous scenario, a restricted area forces a detour and the battery reserve is no longer enough to reach the final waypoint and return. The Commander agent chooses return to start, and the UI shows the raw Gemma-4 responses, normalized outputs, timing, and decision evidence.

This is scoped as operator decision support, not real drone control. The demo can run live against Cerebras or replay cached Cerebras responses with recorded response times, so judges can inspect both the agent reasoning and the system behavior reliably."

## Backup Demo Plan

If live image input is unavailable:

- use precomputed Vision Agent JSON for frame findings
- run Telemetry and Commander from cached Cerebras responses
- state clearly that image access is a preview dependency and the rest of the multimodal pipeline is ready

If the API is slow or rate-limited:

- switch the app to replay mode
- use stored responses and stored response times
- show the cache/live badge in the observability panel
- keep the same Pydantic AI/Phoenix configuration, but avoid live calls during judging by using replay mode

If the UI breaks:

- run the orchestration script from the terminal
- show generated JSON, cached responses, trace log, and final decision report

## Judge-Facing Differentiators

- Concrete real-world workflow, not a generic assistant.
- Proper web app with a mission simulator experience.
- Multimodal input: frames, telemetry, route, restricted area, mission state.
- Agent collaboration and raw model responses are visible.
- Pydantic AI structured text agents and Phoenix tracing show a path beyond the local replay MVP.
- Fast inference is still visible through response timing, while caching makes the demo stable.
- The MVP stays credible by avoiding real autonomous drone control.

## Final Submission Checklist

- README explains the project in one minute.
- Docs include architecture and Cerebras integration notes.
- Safe and dangerous scenarios run locally.
- Web app shows simulator, agents, logs, and decision trace.
- Cached replay works without Cerebras API access.
- Pydantic AI runtime, Phoenix env vars, and replay fallback are documented.
- No API keys are committed.
- Demo video is recorded.
- Screenshots are captured.
- Fallback data is checked into `data/samples/`.
