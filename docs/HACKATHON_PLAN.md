# Hackathon Plan

## Goal

Build a polished web-based decision-support simulator that shows how fast inference helps an operator reason over a real-world drone safety workflow.

The strongest demo is not a generic chatbot or a sophisticated backend. It is a concrete browser-based mission control experience where the user selects a predefined scenario, sees a drone mission unfold, and watches the agents explain why the Commander recommends the next action.

## MVP Scope

Build:

- predefined safe and dangerous scenarios
- multi-point drone missions with waypoints and mission progress
- scenario selector in the web app
- web-based simulator view, either custom-built or adapted from an existing browser simulator
- lightweight backend API for scenario data, agent runs, cached replay, and logs
- specialized agent prompts and structured outputs
- Vision, Telemetry, and Commander agents only
- commander actions: continue mission, return to start, hold position, detour obstacle
- response cache for Cerebras payloads, outputs, and observed latency
- observability panel showing model prompts, model responses, decisions, timings, and cache/live mode
- concise decision report

Do not build:

- real drone control
- model fine-tuning
- custom embedding training
- a large agent framework
- a vector database
- Kubernetes or complex deployment
- fully autonomous safety-critical decisions
- a complex backend simulator if a simpler web simulation communicates the story

## System Narrative

The operator selects a predefined mission scenario. DroneGuard Multiverse loads the scenario's route, frames, telemetry, obstacle events, and cached or live Cerebras traces. Three agents reason over the evidence:

- Vision Agent: identifies visual hazards in keyframes
- Telemetry Agent: detects battery, link, speed, route, and reachability risks
- Commander Agent: chooses one of four operator actions

The dangerous scenario should show the drone following a multi-point mission, encountering an obstacle detour, and losing enough battery reserve that it should not attempt the final mission point. The Commander should recommend returning to the start.

The key differentiators are user experience and transparency. Judges should see the simulated mission, the agent responses, the Commander decision, and the recorded response times in one coherent web app.

## 24-Hour Timeline

### Hour 0-1: API Validation

- Confirm `CEREBRAS_API_KEY` works.
- Run one text completion.
- Run one image input request using `gemma-4-31b`.
- Test whether `reasoning_effort` is accepted for `gemma-4-31b`.
- Test structured JSON response reliability.
- Test tool calling only if it is needed for the simulator flow.

Stop and adjust scope if image access is unavailable.

### Hour 1-3: Demo Assets

- Prepare one safe flight scenario.
- Prepare one dangerous flight scenario where an obstacle detour and battery level make the final mission point unsafe.
- Define mission waypoints, start location, obstacle location, and return path.
- Extract or collect 5 to 10 representative frames per scenario.
- Create synthetic telemetry CSVs with obvious but realistic signals.
- Write scenario metadata and expected Commander action.

### Hour 3-7: Lightweight Backend And Cache

- Implement scenario loader.
- Implement telemetry parser and reachability estimator.
- Implement frame preparation helper.
- Implement Cerebras client wrapper.
- Implement response cache with live and replay modes.
- Implement run log event capture.
- Implement Vision and Telemetry agents.

### Hour 7-11: Commander Flow

- Build decision context from scenario state, Vision output, and Telemetry output.
- Add Commander action candidates:
  - continue mission
  - return to start
  - hold position
  - detour obstacle
- Add Commander Agent prompt and structured JSON output.
- Add deterministic fallback that returns to start when battery reserve cannot cover final waypoint plus return.
- Store every request, response, and response time.

### Hour 11-15: Web App

- Build proper browser UI.
- Add scenario selector.
- Show mission map or simulator canvas.
- Show drone position, waypoints, obstacle, and return path.
- Show keyframes.
- Show telemetry preview.
- Show agent cards with raw Gemma-4 responses.
- Show Commander action and rationale.
- Show observability drawer with trace events, cache hits, and response times.

### Hour 15-18: Reliability and Polish

- Make demo deterministic enough for judges.
- Make cached replay the default demo-safe path.
- Add a live-mode toggle for Cerebras calls.
- Add graceful fallback if image calls fail.
- Tighten prompts for compact JSON.
- Add clear labels for safe vs dangerous scenario outcomes.
- Add UI polish for route, battery reserve, decision state, and agent logs.

### Hour 18-21: Pitch Prep

- Prepare the 90-second story.
- Prepare architecture slide or README view.
- Prepare one successful dangerous scenario walkthrough.
- Prepare one safe scenario walkthrough.
- Record backup demo video.

### Hour 21-24: Rehearsal and Submission

- Rehearse end-to-end three times.
- Confirm no secrets are committed.
- Confirm fresh clone setup works.
- Capture final screenshots.
- Submit repo, demo video, and pitch.

## MVP Acceptance Criteria

- A user can run the app locally.
- The user selects from predefined safe and dangerous scenarios.
- The UI looks and behaves like a real web app, not a notebook or basic script.
- The UI clearly shows Vision, Telemetry, and Commander agent collaboration.
- The dangerous scenario ends with `return_to_start` because battery plus detour makes mission completion unsafe.
- The Commander can choose from continue mission, return to start, hold position, and detour obstacle.
- The final recommendation cites both frame and telemetry evidence.
- The demo shows live or cached Cerebras response times.
- Raw prompts, raw model responses, normalized outputs, and decisions are visible in the app.

## Stretch Goals

- Integrate and modify an existing web-based drone or mission simulator.
- Add richer map visualization.
- Add time-aligned frame and telemetry scrubber.
- Add JSON export for the final report.
- Add incident severity labels.
- Add OpenTelemetry-compatible traces or an open-source observability dashboard.
- Add a second model fallback for non-vision text-only flows.

## Main Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `gemma-4-31b` image access is not available | Vision demo fails | Use precomputed frame annotations and still run telemetry/scenario agents live |
| Image payloads exceed limits | Requests fail | Resize frames and cap at 5 images per request |
| Model returns invalid JSON | UI breaks | Validate and repair once, then fall back to a safe local default |
| Demo assets are weak | Judges see a generic app | Use obvious unsafe telemetry and visually clear frames |
| Web simulator integration takes too long | UI misses deadline | Build a simple custom route canvas first, integrate open-source simulator only if it is faster |
| Live API is unavailable during judging | Demo stalls | Run from cached Cerebras responses and replay recorded response times |
| Too much backend complexity | MVP misses deadline | Keep the backend as scenario loader, agent runner, cache, and logs |

## Judging Message

Fast inference lets a physical-world system expose agent reasoning inside an operator workflow. DroneGuard Multiverse turns predefined drone mission scenarios, video frames, telemetry, and mission progress into a transparent Commander decision: continue, return to start, hold, or detour.
