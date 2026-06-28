# Hackathon Plan

## Goal

Build a polished decision-support simulator that shows how fast inference enables many agent calls for a real-world safety workflow.

The strongest demo is not a generic chatbot. It is a concrete operator workflow where the system sees drone frames, reads telemetry, compares futures, and recommends the next action.

## MVP Scope

Build:

- video-to-keyframe extraction, or direct frame upload
- telemetry CSV upload and validation
- mission goal input
- specialized agent prompts and structured outputs
- local trajectory simulator tool
- parallel scenario evaluation
- commander decision
- incident-style report
- Streamlit UI showing agent steps and latency

Do not build:

- real drone control
- model fine-tuning
- custom embedding training
- a large agent framework
- a vector database
- Kubernetes or complex deployment
- fully autonomous safety-critical decisions

## System Narrative

The operator uploads recent drone evidence. DroneGuard Multiverse asks several specialized agents to reason over the evidence:

- Vision Agent: identifies visual hazards in keyframes
- Telemetry Agent: detects flight anomalies and threshold breaches
- World-State Agent: fuses visual, telemetry, and mission context
- Scenario Agents: evaluate possible next actions in parallel
- Commander Agent: selects the safest action
- Report Agent: creates a judge-ready mission safety report

The key differentiator is speed. The demo should make it visible that fast inference enables multiple futures to be evaluated within the interaction loop.

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
- Prepare one risky flight scenario.
- Extract or collect 5 to 10 representative frames per scenario.
- Create synthetic telemetry CSVs with obvious but realistic signals.
- Write one mission goal per scenario.

### Hour 3-7: Backend MVP

- Implement telemetry parser and validator.
- Implement frame preparation helper.
- Implement Cerebras client wrapper.
- Implement Vision Agent.
- Implement Telemetry Agent.
- Implement World-State Agent.
- Implement local `simulate_future` tool.

### Hour 7-11: Scenario and Commander Flow

- Add scenario definitions:
  - keep route
  - slow down
  - climb
  - reroute left
  - reroute right
  - emergency landing
- Run independent scenario agents concurrently.
- Normalize scenario outputs into one comparison table.
- Add Commander Agent decision logic.
- Add Report Agent output.

### Hour 11-15: UI

- Build Streamlit page.
- Add file upload controls.
- Show keyframes.
- Show telemetry preview.
- Show agent cards and status.
- Show scenario comparison table.
- Show final recommendation and report.
- Show elapsed time and number of model calls.

### Hour 15-18: Reliability and Polish

- Make demo deterministic enough for judges.
- Add sample data defaults if upload is skipped.
- Add graceful fallback if image calls fail.
- Tighten prompts for compact JSON.
- Add validation errors that explain how to fix bad telemetry.

### Hour 18-21: Pitch Prep

- Prepare the 90-second story.
- Prepare architecture slide or README view.
- Prepare one successful risky scenario walkthrough.
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
- A sample scenario works without external assets.
- The UI clearly shows agent collaboration.
- At least four future scenarios are evaluated.
- The final recommendation cites both frame and telemetry evidence.
- The demo shows latency or throughput metrics.
- The final report is understandable without reading code.

## Stretch Goals

- Add simple map visualization.
- Add time-aligned frame and telemetry scrubber.
- Add JSON export for the final report.
- Add incident severity labels.
- Add prompt caching for repeated frames.
- Add a second model fallback for non-vision text-only flows.

## Main Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `gemma-4-31b` image access is not available | Vision demo fails | Use precomputed frame annotations and still run telemetry/scenario agents live |
| Image payloads exceed limits | Requests fail | Resize frames and cap at 5 images per request |
| Model returns invalid JSON | UI breaks | Validate and repair once, then fall back to a safe local default |
| Demo assets are weak | Judges see a generic app | Use obvious unsafe telemetry and visually clear frames |
| Too much orchestration complexity | MVP misses deadline | Use simple async task fan-out instead of a large framework |

## Judging Message

Fast inference lets a physical-world system evaluate multiple futures in real time. DroneGuard Multiverse turns drone video frames, telemetry, and mission goals into an agentic safety workflow that compares possible next actions before recommending one to the operator.

