# Architecture

## System Overview

```text
Browser Web App
Scenario Selector + Simulator View + Observability Panels
                    |
                    v
          Lightweight Backend API
                    |
        ------------+-------------
        |                         |
 Scenario Library         Cerebras Cache/Replay
        |                         |
        +------------+------------+
                     |
                     v
              Agent Orchestrator
        ------------+-------------
        |                         |
  Vision Agent             Telemetry Agent
        |                         |
        +------------+------------+
                     |
                     v
              Decision Context
                     |
                     v
              Commander Agent
                     |
                     v
       Decision + Trace Log + Web UI Update
```

## Component Boundaries

### Web App

Responsibilities:

- provide the primary demo experience
- let the user select predefined safe or dangerous scenarios
- render the mission route, waypoints, obstacle, drone state, and return path
- show keyframes and telemetry synchronized with the mission timeline
- show Vision, Telemetry, and Commander agent panels
- show raw Gemma-4 prompts, responses, normalized outputs, cache status, and response times
- support live and replay mode without changing the visual flow

Implementation preference:

- build a real browser app, preferably React or Next.js
- use a simple custom map/canvas first if integrating an existing simulator would slow delivery
- adapt an existing web-based drone or mission simulator only if it gives a better route animation quickly

### Lightweight Backend API

Responsibilities:

- serve scenario manifests and static assets
- run the selected scenario through the three agents
- expose cached and live Cerebras execution modes
- write trace events and run summaries
- return one normalized result for the web app

MVP shortcut:

- keep the backend intentionally thin
- avoid background queues, databases, and complex workflow engines

### Scenario Library

Responsibilities:

- store the safe and dangerous scenarios
- define waypoints, start point, obstacle events, frames, telemetry, and expected demo outcome
- include precomputed paths for continue, return to start, hold position, and detour obstacle
- provide the simulator enough data to animate the mission

The dangerous scenario must make the decision legible: a detour around an obstacle plus declining battery means the drone cannot safely reach the final mission point and return, so the Commander recommends returning to start.

### Agent Orchestrator

Responsibilities:

- create a run ID
- call Vision and Telemetry first
- build a deterministic decision context
- call Commander with the allowed action set
- record timing, errors, cache hits, raw request payloads, raw responses, and normalized outputs
- produce one result object for the web app

Implementation preference:

- keep each agent as a simple function or class with one `run` method
- use cached replay by default for demo stability
- call Cerebras live only when the live-mode toggle is enabled

### Vision Agent

Input:

- up to 5 keyframes per request
- mission goal
- optional frame timestamps

Output:

- detected hazards
- visual evidence by frame ID
- estimated severity
- uncertainty notes

Notes:

- Cerebras image inputs currently accept images rather than native video, so video must be converted to frames before model calls.
- Treat image-derived text and model output as untrusted until escaped in the UI.

### Telemetry Agent

Input:

- telemetry rows
- mission waypoints and current segment
- candidate detour distance
- return-to-start distance
- mission goal

Output:

- battery risk
- final-waypoint reachability risk
- return-to-start reserve estimate
- altitude risk
- speed risk
- link quality risk
- GPS jump or movement anomaly
- timestamped evidence

MVP shortcut:

- deterministic reachability math first
- model summary second

### Decision Context

This is not a model agent. It is a backend object assembled from scenario data, simulator state, Vision output, and Telemetry output.

It should include:

- mission progress
- current waypoint
- remaining mission distance
- detour distance
- return-to-start distance
- estimated battery reserve
- visual hazards
- telemetry flags
- allowed Commander actions

### Commander Agent

Input:

- decision context
- Vision Agent output
- Telemetry Agent output
- allowed action enum

Allowed actions:

- `continue_mission`
- `return_to_start`
- `hold_position`
- `detour_obstacle`

Output:

- recommended action
- confidence
- concise rationale
- evidence references
- rejected actions with reasons
- operator-facing explanation

Decision rule for the dangerous demo:

If the estimated battery reserve cannot cover the detour, final waypoint, and return-to-start path with a safety buffer, the Commander should recommend `return_to_start`.

### Cerebras Cache And Replay

Responsibilities:

- store request payloads, response payloads, normalized outputs, response time, model ID, and timestamp
- key cache entries by scenario ID, agent name, prompt version, model ID, and input hash
- support replaying recorded response times without calling Cerebras
- allow a cache refresh mode during development

This cache is part of the demo, not an afterthought. It makes the application reliable during judging while still showing real Cerebras-generated responses.

### Observability

Responsibilities:

- log every major event in a run
- expose agent inputs and outputs in the UI
- show response time, cache hit/miss, model ID, reasoning mode, and errors
- make the Commander decision auditable

Minimum implementation:

- local JSONL trace file per run
- in-memory event stream for the current web session
- web app trace drawer or observability tab

Stretch implementation:

- OpenTelemetry-compatible event shape
- open-source trace or log viewer if it can be integrated quickly

## Runtime Flow

1. User opens the app.
2. User selects safe or dangerous scenario.
3. Web app loads mission route, waypoints, telemetry, frames, and cached traces.
4. User starts the scenario.
5. Simulator animates mission progress.
6. Vision Agent analyzes scenario keyframes through live Cerebras or cached replay.
7. Telemetry Agent analyzes battery, route, link, speed, and reachability risk.
8. Backend builds the decision context.
9. Commander Agent chooses continue mission, return to start, hold position, or detour obstacle.
10. UI displays the decision, route update, raw agent responses, normalized outputs, and timing metrics.

## Failure Handling

- If image API calls fail, use cached or precomputed frame annotations and continue the rest of the demo.
- If live Cerebras calls are unavailable, switch to cached replay and label the run as replay mode.
- If telemetry parsing fails, show the missing scenario field and expected schema.
- If Commander output is invalid, apply deterministic fallback rules and label the result as fallback.
- If simulator integration fails, fall back to a simple route canvas using the same scenario data.

## Implementation Structure

```text
src/droneguard_multiverse/
|-- agents/
|   |-- vision.py
|   |-- telemetry.py
|   `-- commander.py
|-- api/
|   `-- routes.py
|-- cache/
|   |-- keys.py
|   `-- replay.py
|-- integrations/
|   `-- cerebras/
|       |-- client.py
|       |-- image_inputs.py
|       `-- prompts.py
|-- observability/
|   |-- events.py
|   `-- trace_store.py
|-- orchestration/
|   `-- run.py
|-- schemas/
|   |-- scenario.py
|   |-- telemetry.py
|   |-- agents.py
|   `-- run_result.py
|-- simulation/
|   |-- route.py
|   `-- reachability.py
`-- ui/
    `-- README.md

web/
|-- README.md
|-- app/
|-- components/
`-- lib/
```

## Test Strategy

Prioritize tests that prevent demo-breaking failures:

- telemetry parser accepts sample CSV
- telemetry parser rejects missing required columns with useful errors
- image encoder rejects unsupported formats
- scenario loader returns safe and dangerous scenarios
- reachability estimator flags the dangerous mission as unsafe to complete
- agent JSON validation catches malformed outputs
- commander fallback returns to start when reserve is insufficient
- cache replay returns the stored response and recorded response time
