---
summary: "Run one agent turn through Gateway RPC or the local gateway call helper"
read_when:
  - You want to trigger an agent turn from scripts
  - You need the `chat.send` request and response shape
title: "Agent Send"
---

# Agent Send

`chat.send` runs a single agent turn without needing an inbound chat message. Use it for scripted workflows, tests, and local automation that should use the same Rust-native Gateway agent runtime as Desktop.

## Quick start

<Steps>
  <Step title="Run a simple agent turn">
    Call Gateway RPC `chat.send` with a `sessionKey` and `message`.

    ```bash
    curl -sS http://127.0.0.1:18789/rpc \
      -H "Authorization: Bearer $CRAWCLAW_GATEWAY_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{
        "method": "chat.send",
        "id": "example-1",
        "params": {
          "sessionKey": "agent:main:main",
          "message": "Summarize the current project state"
        }
      }'
    ```

  </Step>

  <Step title="Run from a local checkout">
    The gateway binary also has a local `call` helper for development shells.

    ```bash
    cargo run -q -p crawclaw-gateway -- call \
      --method chat.send \
      --params-json '{"sessionKey":"agent:main:main","message":"hello gateway"}'
    ```

  </Step>

  <Step title="Target a session or agent">
    Set `sessionKey` to choose the transcript and `agentId` when you want a configured agent other than `main`.

  </Step>
</Steps>

## Request

`chat.send` accepts these common params:

| Param            | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| `sessionKey`     | Required transcript/session key. Alias: `key`.                  |
| `message`        | User text. Aliases: `text`, `prompt`.                           |
| `agentId`        | Configured agent id. Defaults to `main`.                        |
| `idempotencyKey` | Stable run id for retries. Alias: `runId`.                      |
| `channel`        | Synthetic inbound channel label. Defaults to `gateway`.         |
| `from`           | Synthetic sender id. Defaults to `user`.                        |
| `to`             | Synthetic receiver id. Defaults to `agent:main`.                |
| `profile`        | Optional agent run profile object.                              |
| `provider`       | Optional provider override when the agent runtime permits it.   |
| `model`          | Optional model override when the agent runtime permits it.      |
| `reasoningLevel` | Optional reasoning level passed into the agent model selection. |

You can also pass a full `inbound` envelope instead of `message`; when `inbound.threadId` is missing, the Gateway fills it from `sessionKey`.

## Response

Successful calls return a structured Gateway RPC response. The useful fields are:

- `result.status`: `completed` when the turn finishes.
- `result.runId`: the run id.
- `result.sessionKey`: the session that was written.
- `result.message.content`: assistant reply text.
- `result.contextSummary`: context projection metadata.
- `result.events`: the emitted agent runtime events.

`chat.send` returns the assistant message and event stream. It does not deliver the reply to an external channel by itself; channel delivery uses channel outbound RPCs such as `channel.outbound.send`.

## Related

- [Gateway Protocol](/gateway/protocol)
- [OpenAI-compatible Chat Completions](/gateway/openai-http-api)
- [Sub-agents](/tools/subagents) — background sub-agent spawning
- [Sessions](/concepts/session) — how session keys work
