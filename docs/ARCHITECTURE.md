# Architecture

## System Overview

```text
Frames or Video + Telemetry CSV + Mission Goal
                    |
                    v
              Input Processor
                    |
                    v
               Orchestrator
       ------------+-------------+-------------
       |                          |            |
 Vision Agent              Telemetry Agent  Mission Agent
       |                          |            |
       +------------+-------------+------------+
                    |
                    v
             World-State Agent
                    |
      --------------+---------------------------
      |       |       |       |       |        |
   Keep    Slow    Climb   Reroute Reroute  Land
   Route   Down            Left    Right
      |       |       |       |       |        |
      +-------+-------+-------+-------+--------+
                    |
                    v
              Commander Agent
                    |
                    v
              Report Agent + UI
```

## Component Boundaries

### Input Processor

Responsibilities:

- accept video, image frames, telemetry CSV, and mission text
- extract keyframes from video
- resize and encode frames for image-input requests
- validate telemetry required columns
- align frames and telemetry by timestamp when possible

MVP shortcut:

- support direct frame upload first
- support video extraction second

### Orchestrator

Responsibilities:

- create a run ID
- call agents in the correct order
- run independent futures concurrently
- record timing, errors, and raw model usage metadata
- produce one normalized run result for the UI

Implementation preference:

- use `asyncio.gather` for scenario fan-out
- keep each agent as a simple function or class with one `run` method
- avoid large workflow frameworks during the hackathon

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
- configured threshold rules
- mission goal

Output:

- battery risk
- altitude risk
- speed risk
- link quality risk
- GPS jump or movement anomaly
- timestamped evidence

MVP shortcut:

- deterministic Python threshold checks first
- model summary second

### Mission Agent

Input:

- mission text
- known safety rules

Output:

- mission intent
- constraints
- success criteria
- no-go conditions

MVP shortcut:

- use static defaults if the mission goal is short.

### World-State Agent

Input:

- vision findings
- telemetry findings
- mission analysis

Output:

- structured scene state
- current risk score
- primary hazards
- available safe actions

### Scenario Agents

Each scenario agent evaluates one action:

- keep route
- slow down
- climb
- reroute left
- reroute right
- emergency landing

Input:

- world state
- local simulation result
- mission constraints

Output:

- predicted risk after action
- benefits
- failure modes
- confidence
- concise rationale

### Commander Agent

Input:

- scenario outputs
- world state
- mission constraints

Output:

- recommended action
- second-best action
- rejected actions with reasons
- confidence
- operator-facing explanation

### Report Agent

Input:

- full run result

Output:

- mission summary
- detected risks
- recommendation
- supporting evidence
- confidence
- next operator steps

## Runtime Flow

1. User opens the app.
2. User chooses sample scenario or uploads assets.
3. App validates telemetry and frames.
4. Vision and telemetry analysis run.
5. World state is created.
6. Simulator generates future state deltas.
7. Scenario agents evaluate futures in parallel.
8. Commander selects a recommendation.
9. Report Agent produces the final report.
10. UI displays timeline, comparison table, recommendation, and timing metrics.

## Failure Handling

- If image API calls fail, use cached or precomputed frame annotations and continue the rest of the demo.
- If telemetry parsing fails, show the missing column and expected schema.
- If one scenario fails, mark it unavailable and continue with remaining scenarios.
- If commander output is invalid, select the lowest predicted risk scenario deterministically and label it as fallback.

## Implementation Structure

```text
src/droneguard_multiverse/
|-- agents/
|   |-- vision.py
|   |-- telemetry.py
|   |-- mission.py
|   |-- world_state.py
|   |-- scenario.py
|   |-- commander.py
|   `-- report.py
|-- integrations/
|   `-- cerebras/
|       |-- client.py
|       |-- image_inputs.py
|       `-- prompts.py
|-- orchestration/
|   |-- run.py
|   `-- timing.py
|-- schemas/
|   |-- telemetry.py
|   |-- agents.py
|   `-- run_result.py
|-- simulation/
|   |-- scenarios.py
|   `-- trajectory.py
`-- ui/
    `-- streamlit_app.py
```

## Test Strategy

Prioritize tests that prevent demo-breaking failures:

- telemetry parser accepts sample CSV
- telemetry parser rejects missing required columns with useful errors
- image encoder rejects unsupported formats
- scenario simulator returns every expected scenario
- agent JSON validation catches malformed outputs
- commander fallback chooses the lowest-risk valid scenario
