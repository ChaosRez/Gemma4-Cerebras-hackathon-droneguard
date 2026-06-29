# Cerebras Integration Notes

Last reviewed: 2026-06-29

## Where Is The Cerebras Documentation?

Use these official Cerebras Inference docs for this project:

- Gemma 4 31B model page: <https://inference-docs.cerebras.ai/models/gemma-4-31b>
- Image inputs guide: <https://inference-docs.cerebras.ai/capabilities/image-inputs>
- Chat Completions API reference: <https://inference-docs.cerebras.ai/api-reference/chat-completions>
- Reasoning guide for `gemma-4-31b`: <https://inference-docs.cerebras.ai/capabilities/reasoning#gemma-4-31b-reasoning_effort>
- Tool calling guide: <https://inference-docs.cerebras.ai/capabilities/tool-use>
- Pydantic AI overview: <https://pydantic.dev/docs/ai/overview/>
- Pydantic AI Cerebras model docs: <https://pydantic.dev/docs/ai/models/cerebras/>
- LangSmith observability docs: <https://docs.langchain.com/langsmith/observability>
- LangSmith PydanticAI tracing docs: <https://docs.langchain.com/langsmith/trace-with-pydantic-ai>

## Project Model Target

- Model ID: `gemma-4-31b`
- Primary use: multimodal frame analysis, telemetry summarization, and Commander reasoning
- API surface: Chat Completions
- Required secret: `CEREBRAS_API_KEY`

Important planning caveat:

- The image-input guide says image support is available with `gemma-4-31b`.
- The Gemma 4 31B model page currently marks the model as "coming soon."
- The image-input guide also marks image inputs as private preview.

Treat image access as a kickoff validation item. Do not wait until late in the hackathon to test it.

## Agent Calls

The MVP uses only three Cerebras-backed agents:

- Vision Agent: image frames plus scenario context
- Telemetry Agent: mission telemetry plus reachability estimates
- Commander Agent: normalized decision context plus allowed action enum

The backend should stay simple. It loads scenario data, calls or replays the three agents, validates structured outputs, and returns a result to the web app.

## Runtime Options

### Why Pydantic AI First

DroneGuard is a Python project with schema-heavy agent boundaries, local validation, cached Cerebras responses, and explicit normalized outputs. Pydantic AI fits that shape because it is model-agnostic, supports Cerebras as a provider, and adds structured outputs, tools, retries, multi-agent patterns, evals, and optional observability without forcing the project into a large agent framework.

Default runtime:

- `DRONEGUARD_AGENT_RUNTIME=pydantic_ai`
- Uses Pydantic AI's Cerebras provider for structured text agents.
- Requests Telemetry and Commander Pydantic output models through explicit Pydantic AI tool output.
- Allows multiple structured-output retries so Gemma can repair schema misses during live calls.
- Preserves the existing request/response cache shape.

Raw multimodal runtime:

- Vision uses the project-owned `CerebrasClient` because it sends image content parts.
- Raw Chat Completions calls go through the OpenAI-compatible SDK transport before falling back to direct HTTP.
- If an older `.env` sets `DRONEGUARD_AGENT_RUNTIME=cerebras_chat_completions`, structured text agents still use Pydantic AI whenever an output model is supplied.

This split is intentional for the hackathon. Pydantic AI gives us the framework path for text agents and LangSmith tracing, while the raw client keeps multimodal Vision requests predictable.

## Image Input Pattern

Cerebras image input is sent through the Chat Completions API by putting text and image content parts in a user message. Video is not sent directly. Extract keyframes first.

MVP rules:

- send PNG or JPEG frames
- base64-encode each image as a data URI
- send no more than 5 images per request
- keep total image payload under the documented shared-tier limit
- resize frames before encoding
- include frame IDs in the prompt text so the response can cite evidence

Example shape:

```python
response = client.chat.completions.create(
    model="gemma-4-31b",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Analyze these drone frames for safety hazards."},
                {
                    "type": "image_url",
                    "image_url": {"url": "data:image/jpeg;base64,<base64-frame>"},
                },
            ],
        }
    ],
)
```

## Reasoning

Reasoning is off by default for `gemma-4-31b`. Enable it when asking the Commander Agent to make a safety recommendation:

```python
response = client.chat.completions.create(
    model="gemma-4-31b",
    messages=[{"role": "user", "content": "Choose the safest action from these scenarios."}],
    reasoning_effort="medium",
)
```

The current docs say `low`, `medium`, and `high` all enable reasoning for Gemma 4 31B, without graduated effort control. Use `medium` as the project default for decision-heavy steps and `none` or omitted reasoning for simple extraction steps.

## Live, Cache, And Replay Modes

Every Cerebras call should be stored so the demo can be replayed without calling the API again.

Modes:

- `live`: call Cerebras, store request, response, normalized output, and response time
- `replay`: load the stored response and replay the recorded response time
- `refresh`: force a new Cerebras call and overwrite or version the cached entry

Cache key inputs:

- scenario ID
- agent name
- prompt version
- model ID
- reasoning setting
- agent runtime and structured output type
- image or telemetry input hash

Cached payload:

```json
{
  "cache_key": "dangerous:commander:v1:gemma-4-31b:abc123",
  "scenario_id": "dangerous",
  "agent": "commander",
  "model": "gemma-4-31b",
  "mode": "live",
  "request": {},
  "response": {},
  "normalized_output": {},
  "response_time_ms": 842,
  "created_at": "2026-06-28T10:00:03Z"
}
```

The web app should show whether each agent response came from live mode or replay mode.

## LangSmith Tracing

LangSmith is the second integration because it is observability, tracing, debugging, monitoring, and evaluation rather than an agent framework. That maps directly to DroneGuard's need to inspect agent decisions, latency, cache hits, fallback behavior, and demo reliability. LangSmith tracing is optional and should not be required for replay mode.

Enable it with:

```bash
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com
LANGSMITH_API_KEY=<key>
LANGSMITH_PROJECT="DroneGuard Multiverse"
```

At orchestrator startup, DroneGuard calls `configure_langsmith()`. When tracing is enabled and dependencies are installed, it configures LangSmith/OpenTelemetry and calls `pydantic_ai.Agent.instrument_all()`. The local trace event `scenario_loaded` records whether LangSmith was enabled, disabled, or unavailable.

In addition to Pydantic AI's own instrumentation, DroneGuard creates custom LangSmith spans for:

- cache lookup and fallback cache lookup
- model calls
- output validation
- cache writes
- deterministic fallback output

## Tool Calling

Tool calling is not required for the MVP. Prefer deterministic backend functions for reachability, route distance, and battery reserve. Use tool calling only if it clearly improves the Cerebras story without increasing implementation risk.

Possible tool if used:

- `estimate_reachability(current_state, route_options)`

If tool calling is used:

- define strict JSON schemas
- set `additionalProperties: false`
- keep tool arguments small
- handle every tool result locally before asking the model for the final answer

## Structured Output Strategy

Prefer native Pydantic structured outputs for text agents and JSON-shaped prompts plus local validation for multimodal Vision. If native structured output is available and stable for the target model during validation, use it. Otherwise:

1. Ask for compact JSON only.
2. Parse and validate with local schemas.
3. Retry once with a repair prompt if parsing fails.
4. Fall back to deterministic defaults for the UI.

## API Validation Checklist

Run these checks before building the full app:

- Text request succeeds.
- Image request with one frame succeeds.
- Image request with 3 to 5 frames succeeds.
- `reasoning_effort="medium"` is accepted for `gemma-4-31b`.
- A compact JSON response can be parsed.
- Response cache stores raw request, raw response, normalized output, and response time.
- Replay mode can run the safe and dangerous scenarios without a Cerebras API call.
- Latency is good enough to show a visible speed story when live mode is enabled.
- Failure modes return usable errors in the UI.

## Environment Variables

```bash
cp .env.example .env
# then set CEREBRAS_API_KEY in .env
```

Optional runtime and tracing variables:

```bash
DRONEGUARD_AGENT_RUNTIME=pydantic_ai

LANGSMITH_TRACING=false
LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com
LANGSMITH_API_KEY=
LANGSMITH_PROJECT="DroneGuard Multiverse"
```

Never commit `.env` files or API keys.
