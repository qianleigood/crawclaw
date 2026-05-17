---
summary: "Gateway WebSocket protocol: handshake, frames, versioning"
read_when:
  - Implementing or updating gateway WS clients
  - Debugging protocol mismatches or connect failures
  - Regenerating protocol schema/models
title: "Gateway Protocol"
---

# Gateway protocol (WebSocket)

The Gateway WS protocol is the **single control plane** for CrawClaw. Clients
(CLI, browser-authenticated clients, and automation) connect over WebSocket and declare their **role** + **scope**
at handshake time.

## Transport

- WebSocket, text frames with JSON payloads.
- First frame **must** be a `connect` request.

## Handshake (connect)

Client → Gateway:

```json
{
  "type": "req",
  "id": "…",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "cli",
      "version": "1.2.3",
      "platform": "macos",
      "mode": "operator"
    },
    "role": "operator",
    "scopes": ["operator.read", "operator.write"],
    "caps": [],
    "commands": [],
    "permissions": {},
    "auth": { "token": "…" },
    "locale": "en-US",
    "userAgent": "crawclaw-desktop/2026.5.3",
    "device": {
      "id": "device_fingerprint",
      "publicKey": "…",
      "signature": "…",
      "signedAt": 1737264000000,
      "nonce": "…"
    }
  }
}
```

Gateway → Client:

```json
{
  "type": "res",
  "id": "…",
  "ok": true,
  "payload": { "type": "hello-ok", "protocol": 3, "policy": { "tickIntervalMs": 15000 } }
}
```

### Node example

```json
{
  "type": "req",
  "id": "…",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "macos-node",
      "version": "1.2.3",
      "platform": "macos",
      "mode": "node"
    },
    "role": "node",
    "scopes": [],
    "caps": ["camera", "canvas", "screen", "location", "voice"],
    "commands": ["camera.snap", "canvas.navigate", "screen.record", "location.get"],
    "permissions": { "camera.capture": true, "screen.record": false },
    "auth": { "token": "…" },
    "locale": "en-US",
    "userAgent": "crawclaw-macos/1.2.3",
    "device": {
      "id": "device_fingerprint",
      "publicKey": "…",
      "signature": "…",
      "signedAt": 1737264000000,
      "nonce": "…"
    }
  }
}
```

## Framing

- **Request**: `{type:"req", id, method, params}`
- **Response**: `{type:"res", id, ok, payload|error}`
- **Event**: `{type:"event", event, payload, seq?, stateVersion?}`

Side-effecting methods require **idempotency keys** (see schema).

## Roles + scopes

### Roles

- `operator` = control plane client (CLI/UI/automation).
- `node` = capability host (camera/screen/canvas/system.run).

### Scopes (operator)

Common scopes:

- `operator.read`
- `operator.write`
- `operator.admin`
- `operator.approvals`
- `operator.pairing`

Method scope is only the first gate. Some slash commands reached through
`chat.send` apply stricter command-level checks on top. For example, persistent
`/config set` and `/config unset` writes require `operator.admin`.

## Presence

- `system-presence` returns entries keyed by client instance when available.
- Presence entries include `deviceId` for compatibility, plus `roles` and `scopes` so UIs can show a single row per client instance.

### Operator helper methods

- Operators may call `tools.catalog` (`operator.read`) to fetch the runtime tool catalog for an
  agent. The response includes grouped tools and provenance metadata:
  - `source`: `core` or `plugin`
  - `pluginId`: plugin owner when `source="plugin"`
  - `optional`: whether a plugin tool is optional
- Operators may call `tools.effective` (`operator.read`) to fetch the runtime-effective tool
  inventory for a session.
  - `sessionKey` is required.
  - The gateway derives trusted runtime context from the session server-side instead of accepting
    caller-supplied auth or delivery context.
  - The response is session-scoped and reflects what the active conversation can use right now,
    including core, plugin, and channel tools.
- Operators may call `agent.observations.list` (`operator.read`) to fetch historical
  ObservationContext run summaries.
  - Filters: `query`, `status`, `source`, `from`, `to`, `limit`, and `cursor`.
  - `query` matches `runId`, `taskId`, `traceId`, `sessionKey`, and `agentId`.
  - `from` and `to` are inclusive epoch-millisecond time bounds.
  - The result is metadata-only and excludes prompt, transcript, and tool result bodies.
- Operators may call `agent.inspect` (`operator.read`) with `runId`, `taskId`, or
  `traceId` to fetch the unified observation timeline for a selected run.

## Exec approvals

- When an exec request needs approval, the gateway broadcasts `exec.approval.requested`.
- Operator clients resolve by calling `exec.approval.resolve` (requires `operator.approvals` scope).

## Agent delivery fallback

- `agent` requests can include `deliver=true` to request outbound delivery.
- `bestEffortDeliver=false` keeps strict behavior: unresolved or internal-only delivery targets return `INVALID_REQUEST`.
- `bestEffortDeliver=true` allows fallback to session-only execution when no external deliverable route can be resolved (for example internal sessions or ambiguous multi-channel configs).

## Versioning

- `PROTOCOL_VERSION` lives in `src/gateway/protocol/schema.ts`.
- Clients send `minProtocol` + `maxProtocol`; the server rejects mismatches.
- TypeScript schemas still back Gateway AJV validators and typed clients.
- The packaged JSON Schema artifact is emitted by the Rust Gateway contract snapshot:
  - `pnpm protocol:gen`
  - `pnpm protocol:check`

## Auth

- If `CRAWCLAW_GATEWAY_TOKEN` (or `--token`) is set, `connect.params.auth.token`
  must match or the socket is closed.
- Auth failures include `error.details.code` plus `error.details.recommendedNextStep`
  (`update_auth_configuration`, `update_auth_credentials`, `wait_then_retry`, `review_auth_configuration`).
  - If that retry fails, clients should stop automatic reconnect loops and surface operator action guidance.

## Device authorization

Gateway device authorization has been removed. WebSocket clients authenticate with the configured
Gateway auth mode (`token`, `password`, `trusted-proxy`, or explicit `none`) and no longer send
a legacy device payload or wait for a preliminary challenge frame.
in addition to device/client/role/scopes/token/nonce fields.

- Legacy `v2` signatures remain accepted for compatibility, but paired-device
  metadata pinning still controls command policy on reconnect.

## TLS + pinning

- TLS is supported for WS connections.
- Clients may optionally pin the gateway cert fingerprint (see `gateway.tls`
  config plus `gateway.remote.tlsFingerprint` or CLI `--tls-fingerprint`).

## Scope

This protocol exposes the **full gateway API** (status, channels, models, chat,
agent, sessions, approvals, etc.). The runtime validator surface is still
implemented by the TypeBox schemas in `src/gateway/protocol/schema.ts`; the
generated JSON Schema artifact is emitted from the Rust Gateway contract
snapshot.
