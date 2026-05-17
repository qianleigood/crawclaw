---
summary: "Expose a Rust-native OpenResponses-compatible /v1/responses HTTP endpoint from the Gateway"
read_when:
  - Integrating clients that speak the OpenResponses API
title: "OpenResponses API"
---

# OpenResponses API (HTTP)

CrawClaw Gateway can serve a small Rust-native OpenResponses-compatible `POST /v1/responses` endpoint.

This endpoint is **disabled by default**. Enable it in config first.

- `POST /v1/responses`
- Same port as the Gateway (WS + HTTP multiplex): `http://<gateway-host>:<port>/v1/responses`

Requests run through the same Rust-native Gateway agent runtime used by CrawClaw Desktop.

## Authentication, Security, And Routing

Operational behavior matches [OpenAI Chat Completions](/gateway/openai-http-api):

- use `Authorization: Bearer <token-or-password>` with the normal Gateway auth config
- treat the endpoint as full operator access for the gateway instance
- select agents with `model: "crawclaw"`, `model: "crawclaw/default"`, `model: "crawclaw/<agentId>"`, or `x-crawclaw-agent-id`
- use `x-crawclaw-session-key` for explicit session routing
- use `x-crawclaw-message-channel` for the synthetic ingress channel context

Enable or disable this endpoint with `gateway.http.endpoints.responses.enabled`.

The same compatibility surface also includes:

- `GET /v1/models`
- `GET /v1/models/{id}`
- `POST /v1/chat/completions`

For the canonical explanation of agent-target models, see [OpenAI Chat Completions](/gateway/openai-http-api#agent-first-model-contract).

## Session Behavior

By default the endpoint generates a new session key per request.

If the request includes a `user` string, the Gateway derives a stable session key from it, so repeated calls can share an agent session.

If the request includes `x-crawclaw-session-key`, that explicit key wins.

## Request Support

Current Rust-native support is intentionally small:

- `input` as a string
- `input` as an array of `message` items
- `instructions` folded into system instructions
- text content parts with `text` or `input_text`
- `function_call_output` items folded into the prompt as text
- non-streaming JSON responses

Accepted but currently ignored:

- `tools`
- `tool_choice`
- `max_output_tokens`
- `metadata`
- `store`
- `truncation`
- `reasoning`

Currently unsupported:

- `stream: true` SSE
- `previous_response_id` continuity
- `input_image`
- `input_file`
- client-side function call output items as structured tool-call continuations
- per-request backend model override headers

Use CrawClaw Desktop or the local Gateway API for richer native agent operations.

## Response Shape

Successful responses use an OpenResponses-style envelope:

```json
{
  "id": "resp_...",
  "object": "response",
  "status": "completed",
  "output_text": "...",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [{ "type": "output_text", "text": "...", "annotations": [] }]
    }
  ]
}
```

`usage` is currently present with zero counts when provider token accounting is unavailable through this compatibility path.

## Errors

Errors use a JSON object like:

```json
{ "error": { "message": "...", "type": "invalid_request_error" } }
```

Common cases:

- `401` missing or invalid auth
- `400` invalid request body
- `404` endpoint disabled or model not found

## Examples

Basic response:

```bash
curl -sS http://127.0.0.1:18789/v1/responses \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "crawclaw/default",
    "input": "hi"
  }'
```

Message item input:

```bash
curl -sS http://127.0.0.1:18789/v1/responses \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'x-crawclaw-agent-id: research' \
  -H 'x-crawclaw-session-key: agent:research:responses-demo' \
  -d '{
    "model": "crawclaw",
    "instructions": "Be concise.",
    "input": [
      {
        "type": "message",
        "role": "user",
        "content": [{ "type": "input_text", "text": "Summarize the current project." }]
      }
    ]
  }'
```
