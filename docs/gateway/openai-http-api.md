---
summary: "Expose a Rust-native OpenAI-compatible /v1/chat/completions HTTP endpoint from the Gateway"
read_when:
  - Integrating tools that expect OpenAI Chat Completions
title: "OpenAI Chat Completions"
---

# OpenAI Chat Completions (HTTP)

CrawClaw Gateway can serve a small Rust-native OpenAI-compatible Chat Completions endpoint.

This endpoint is **disabled by default**. Enable it in config first.

- `POST /v1/chat/completions`
- Same port as the Gateway (WS + HTTP multiplex): `http://<gateway-host>:<port>/v1/chat/completions`

When either OpenAI-compatible HTTP endpoint is enabled, the Gateway also serves:

- `GET /v1/models`
- `GET /v1/models/{id}`
- `POST /v1/responses`

Requests run through the same Rust-native Gateway agent runtime used by CrawClaw Desktop.

## Authentication

Use the Gateway auth configuration. Send the configured token or password as a bearer secret:

- `Authorization: Bearer <token-or-password>`

Notes:

- When `gateway.auth.mode="token"`, use `gateway.auth.token` or `CRAWCLAW_GATEWAY_TOKEN`.
- When `gateway.auth.mode="password"`, use `gateway.auth.password` or `CRAWCLAW_GATEWAY_PASSWORD`.
- Keep this endpoint on loopback, a tailnet, or private ingress. Do not expose it directly to the public internet.

## Security Boundary

Treat this endpoint as a full operator-access surface for the gateway instance.

- HTTP bearer auth here is not a narrow per-user scope model.
- Requests run through the same trusted operator path as the local Gateway API.
- If the target agent policy allows sensitive tools, this endpoint can use them.

See [Security](/gateway/security) and [Remote access](/gateway/remote).

## Agent-First Model Contract

CrawClaw treats the OpenAI `model` field as an agent target, not as a raw provider model id.

- `model: "crawclaw"` routes to the `main` agent.
- `model: "crawclaw/default"` routes to the `main` agent.
- `model: "crawclaw/<agentId>"` routes to a specific agent.

Compatibility aliases are also accepted:

- `model: "crawclaw:<agentId>"`
- `model: "agent:<agentId>"`

Supported request headers:

- `x-crawclaw-agent-id: <agentId>` overrides the target agent when `model` is `crawclaw` or `crawclaw/default`.
- `x-crawclaw-session-key: <sessionKey>` sets explicit session routing.
- `x-crawclaw-message-channel: <channel>` sets the synthetic ingress channel context.

Backend provider/model overrides are configured on the selected agent/provider. The old JS compatibility header `x-crawclaw-model` is no longer part of the Rust-native HTTP surface.

## Enabling The Endpoint

Set `gateway.http.endpoints.chatCompletions.enabled` to `true`:

```json5
{
  gateway: {
    http: {
      endpoints: {
        chatCompletions: { enabled: true },
      },
    },
  },
}
```

## Request Support

Current Rust-native support is intentionally small:

- non-streaming JSON responses
- text `messages` content
- array content parts with `text` or `input_text`
- `system` and `developer` messages folded into system instructions
- `user` used to derive a stable session key when `x-crawclaw-session-key` is not provided

Currently unsupported:

- `stream: true` SSE
- image content parts
- client-side tool calls through the OpenAI HTTP compatibility endpoint
- per-request backend model override headers

Use CrawClaw Desktop or the local Gateway API for richer native agent operations.

## Model List

`GET /v1/models` returns CrawClaw agent-target ids:

- `crawclaw`
- `crawclaw/default`
- `crawclaw/main`

These ids are compatibility targets for agent routing. They are not raw provider model catalogs.

## Open WebUI Quick Setup

For a basic Open WebUI connection:

- Base URL: `http://127.0.0.1:18789/v1`
- API key: your Gateway bearer token or password
- Model: `crawclaw/default`

Quick smoke:

```bash
curl -sS http://127.0.0.1:18789/v1/models \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

## Examples

Chat completion:

```bash
curl -sS http://127.0.0.1:18789/v1/chat/completions \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "crawclaw/default",
    "messages": [{"role":"user","content":"hi"}]
  }'
```

Explicit agent and session:

```bash
curl -sS http://127.0.0.1:18789/v1/chat/completions \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'x-crawclaw-agent-id: research' \
  -H 'x-crawclaw-session-key: agent:research:openai-demo' \
  -d '{
    "model": "crawclaw",
    "messages": [{"role":"user","content":"summarize the current project"}]
  }'
```

List models:

```bash
curl -sS http://127.0.0.1:18789/v1/models \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Fetch one model:

```bash
curl -sS http://127.0.0.1:18789/v1/models/crawclaw%2Fdefault \
  -H 'Authorization: Bearer YOUR_TOKEN'
```
