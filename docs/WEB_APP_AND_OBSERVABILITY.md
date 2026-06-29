# Web App And Observability

## Product Direction

The demo should feel like a real browser-based mission control application. The backend can stay simple, but the UI should carry the experience: route visualization, drone state, agent reasoning, and decision trace.

The user does not upload data in the core demo. The user selects a predefined scenario.

## Required Screens

### Scenario Selection

Show two scenario cards:

- Safe mission: the drone can complete all waypoints and return with reserve.
- Dangerous mission: an obstacle detour and battery level make the final waypoint unsafe.

Each card should show expected mission risk, number of waypoints, starting battery, and expected Commander action.

### Mission Simulator

Show:

- start point
- current drone position
- mission waypoints
- nominal route
- obstacle location
- detour path
- return-to-start path
- battery reserve indicator
- mission progress timeline

Implementation options:

- Simple custom map or canvas using scenario coordinates.
- Existing web-based simulator adapted into the app if it saves time and improves the visual demo.

The fallback must be a custom route canvas so the project is not blocked by simulator integration.

### Agent Timeline

Show three agent cards:

- Vision
- Telemetry
- Commander

Each card should show:

- status: pending, running, complete, fallback, error
- live or replay mode
- response time
- compact normalized output
- link or drawer for raw prompt and raw Gemma-4 response

### Decision Panel

Show:

- recommended Commander action
- confidence
- operator message
- evidence references
- rejected actions with reasons
- route update caused by the decision

Commander action enum:

- `continue_mission`
- `return_to_start`
- `hold_position`
- `detour_obstacle`

### Observability Panel

Show:

- run ID
- scenario ID
- run health: all live, replay, partial fallback, mixed, or error
- agent runtime: raw Cerebras Chat Completions or Pydantic AI
- Phoenix tracing status
- trace event list
- request and response payloads
- response time per agent
- total run time
- cache hit or miss
- model ID
- reasoning setting
- parsing or validation errors

Minimum implementation can be a drawer or tab in the web app. A separate observability product is optional.

Arize Phoenix is an optional external trace sink for live Pydantic AI runs. The web app should not depend on Phoenix availability; it should continue to render local JSONL events, agent payloads, and timings.

## Cached Replay

The demo must support two execution modes:

- Live mode: call Cerebras and store the result.
- Replay mode: load stored responses and replay recorded response times.

Replay mode should preserve the same UI sequence as live mode. If the cached Vision response took 720 ms, the replay should wait about 720 ms before marking Vision complete. This makes the demo feel realistic while avoiding API dependency during judging.

## Trace Events

Every run should produce structured events:

- `scenario_loaded`
- `agent_request_started`
- `agent_response_received`
- `agent_response_replayed`
- `agent_output_validated`
- `commander_decision_selected`
- `fallback_used`
- `run_completed`

Store events locally as JSONL first. Keep the schema compatible with a future OpenTelemetry-style integration.

The `scenario_loaded` event includes observability metadata:

- selected run mode
- selected agent runtime
- expected Commander action
- Phoenix project, endpoint, and enablement status

When Phoenix tracing is enabled, backend spans also cover cache lookup, model call, output validation, cache write, and deterministic fallback steps. Pydantic AI additionally instruments the Telemetry and Commander structured-output calls. Local JSONL events remain available even when Phoenix is disabled.

The backend response also includes a `run_health` summary derived from each agent execution. The UI should use it as the plain-language answer to whether a selected `Live Cerebras` run actually completed with live Gemma calls or fell back to replay.

## UI Quality Bar

- The first screen should be the mission control app, not a marketing landing page.
- The route, drone state, battery reserve, and Commander action should be visible without scrolling on desktop.
- Agent responses should be inspectable but not dominate the main mission view.
- The dangerous scenario should make the return-to-start decision obvious from visual and telemetry evidence.
- The UI should label replay mode clearly so cached responses are transparent rather than hidden.
