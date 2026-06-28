# Cerebras Integration Notes

Last reviewed: 2026-06-28

## Where Is The Cerebras Documentation?

Use these official Cerebras Inference docs for this project:

- Gemma 4 31B model page: <https://inference-docs.cerebras.ai/models/gemma-4-31b>
- Image inputs guide: <https://inference-docs.cerebras.ai/capabilities/image-inputs>
- Chat Completions API reference: <https://inference-docs.cerebras.ai/api-reference/chat-completions>
- Reasoning guide for `gemma-4-31b`: <https://inference-docs.cerebras.ai/capabilities/reasoning#gemma-4-31b-reasoning_effort>
- Tool calling guide: <https://inference-docs.cerebras.ai/capabilities/tool-use>

## Project Model Target

- Model ID: `gemma-4-31b`
- Primary use: multimodal frame analysis and visual safety evidence
- API surface: Chat Completions
- Required secret: `CEREBRAS_API_KEY`

Important planning caveat:

- The image-input guide says image support is available with `gemma-4-31b`.
- The Gemma 4 31B model page currently marks the model as "coming soon."
- The image-input guide also marks image inputs as private preview.

Treat image access as a kickoff validation item. Do not wait until late in the hackathon to test it.

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

## Tool Calling

Use tool calling only where it helps the demo:

- `simulate_future(action, world_state)` for scenario deltas
- optional `lookup_safety_rule(rule_id)` for static policy references

The simplest MVP can call local Python simulator functions directly and then pass results into scenario agents. Tool calling is useful if you want to demonstrate model-directed tool use, but it should not be allowed to slow down core delivery.

If tool calling is used:

- define strict JSON schemas
- set `additionalProperties: false`
- keep tool arguments small
- handle every tool result locally before asking the model for the final answer

## Structured Output Strategy

Prefer JSON-shaped prompts plus local validation. If native structured output is available and stable for the target model during validation, use it. Otherwise:

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
- Parallel scenario requests do not hit immediate rate limits.
- Latency is good enough to show a visible speed story.
- Failure modes return usable errors in the UI.

## Environment Variables

```bash
export CEREBRAS_API_KEY="..."
export DRONEGUARD_MODEL="gemma-4-31b"
```

Never commit `.env` files or API keys.

