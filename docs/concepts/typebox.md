---
summary: "Gateway protocol schema pipeline and TypeScript validator surface"
read_when:
  - Updating protocol schemas or codegen
title: "Gateway protocol schemas"
---

# Gateway protocol schema pipeline

Last updated: 2026-05-18

The packaged **Gateway WebSocket protocol** artifacts are Rust-owned. The Rust
Gateway contract module owns the protocol version, advertised method list,
advertised event list, and the stable JSON Schema snapshot that is emitted for
packaging.

TypeBox remains in the repository for TypeScript client validators, typed
helpers, and tests that still run in the React/Node tooling layer. It is not the
packaged protocol artifact source of truth.

Use this distinction:

- **Rust Gateway protocol contract**: protocol metadata and packaged JSON Schema
  artifacts
- **TypeBox / ProtocolSchemas**: TypeScript validator and client type surface
  that must stay aligned with the Rust contract

If you want the higher-level protocol context, start with
[Gateway architecture](/concepts/architecture). For browser-facing contract
surfaces, inspect `src/gateway/protocol/schema.ts`, the related `schema/*.ts`
modules, and the generated Rust metadata bridge.

## Mental model (30 seconds)

Every Gateway WS message is one of three frames:

- **Request**: `{ type: "req", id, method, params }`
- **Response**: `{ type: "res", id, ok, payload | error }`
- **Event**: `{ type: "event", event, payload, seq?, stateVersion? }`

The first frame **must** be a `connect` request. After that, clients can call
methods (e.g. `health`, `send`, `chat.send`) and subscribe to events (e.g.
`presence`, `tick`, `agent`).

Connection flow (minimal):

```
Client                    Gateway
  |---- req:connect -------->|
  |<---- res:hello-ok --------|
  |<---- event:tick ----------|
  |---- req:health ---------->|
  |<---- res:health ----------|
```

Common methods + events:

| Category  | Examples                                                  | Notes                              |
| --------- | --------------------------------------------------------- | ---------------------------------- |
| Core      | `connect`, `health`, `status`                             | `connect` must be first            |
| Messaging | `send`, `poll`, `agent`, `agent.wait`                     | side-effects need `idempotencyKey` |
| Chat      | `chat.history`, `chat.send`, `chat.abort`, `chat.inject`  | Gateway-native chat methods        |
| Sessions  | `sessions.list`, `sessions.patch`, `sessions.delete`      | session admin                      |
| Events    | `tick`, `presence`, `agent`, `chat`, `health`, `shutdown` | server push                        |

Current ownership is split deliberately:

- Rust protocol metadata and JSON Schema snapshot:
  `crates/crawclaw-gateway/src/protocol_contract.rs`
- stable embedded JSON Schema:
  `crates/crawclaw-gateway/src/protocol_contract/protocol.schema.stable.json`
- generated TypeScript protocol metadata:
  `src/generated/gateway/protocol-contract.generated.ts`
- TypeScript validator/client schema surface: `src/gateway/protocol/schema/*`
- gateway dispatch/runtime behavior: `crates/crawclaw-gateway/src/lib.rs`

## Where the schemas live

- Rust contract module: `crates/crawclaw-gateway/src/protocol_contract.rs`
- Embedded JSON Schema snapshot:
  `crates/crawclaw-gateway/src/protocol_contract/protocol.schema.stable.json`
- Generated TypeScript metadata bridge:
  `src/generated/gateway/protocol-contract.generated.ts`
- TypeScript validator modules: `src/gateway/protocol/schema/*`
- Shared protocol exports: `src/gateway/protocol/schema/protocol-schemas.ts`
- Runtime validators (AJV): `src/gateway/protocol/index.ts`
- Gateway protocol schema index: `src/gateway/protocol/schema.ts`
- Server handshake and method dispatch/runtime behavior: `crates/crawclaw-gateway/src/lib.rs`
- Generated JSON Schema: `dist/protocol.schema.json`

## Current pipeline

- `pnpm protocol:gen`
  - calls the Rust Gateway emitter
  - writes JSON Schema to `dist/protocol.schema.json`
  - writes Rust-owned protocol metadata to
    `src/generated/gateway/protocol-contract.generated.ts`
- `pnpm protocol:check`
  - runs the Rust generator and verifies tracked generated outputs are committed

## How the schemas are used at runtime

- **Server side**: the Rust Gateway owns handshake, method dispatch, auth, and
  runtime behavior. It deserializes WebSocket frames, accepts `connect` first,
  and validates method payloads in the owning Rust handlers.
- **Client side**: generated and test clients validate event and response
  frames with the TypeScript AJV helpers before using them.
- **Method surface**: the Gateway advertises the supported `methods` and
  `events` in `hello-ok` from Rust protocol metadata.

## Example frames

Connect (first message):

```json
{
  "type": "req",
  "id": "c1",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "crawclaw-macos",
      "displayName": "macos",
      "version": "1.0.0",
      "platform": "macos 15.1",
      "mode": "ui",
      "instanceId": "A1B2"
    }
  }
}
```

Hello-ok response:

```json
{
  "type": "res",
  "id": "c1",
  "ok": true,
  "payload": {
    "type": "hello-ok",
    "protocol": 3,
    "server": { "version": "dev", "connId": "ws-1" },
    "features": { "methods": ["health"], "events": ["tick"] },
    "snapshot": {
      "presence": [],
      "health": {},
      "stateVersion": { "presence": 0, "health": 0 },
      "uptimeMs": 0
    },
    "policy": { "maxPayload": 1048576, "maxBufferedBytes": 1048576, "tickIntervalMs": 30000 }
  }
}
```

Request + response:

```json
{ "type": "req", "id": "r1", "method": "health" }
```

```json
{ "type": "res", "id": "r1", "ok": true, "payload": { "ok": true } }
```

Event:

```json
{ "type": "event", "event": "tick", "payload": { "ts": 1730000000 }, "seq": 12 }
```

## Minimal client (Node.js)

Smallest useful flow: connect + health.

```ts
import { WebSocket } from "ws";

const ws = new WebSocket("ws://127.0.0.1:18789");

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "req",
      id: "c1",
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "cli",
          displayName: "example",
          version: "dev",
          platform: "node",
          mode: "cli",
        },
      },
    }),
  );
});

ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  if (msg.type === "res" && msg.id === "c1" && msg.ok) {
    ws.send(JSON.stringify({ type: "req", id: "h1", method: "health" }));
  }
  if (msg.type === "res" && msg.id === "h1") {
    console.log("health:", msg.payload);
    ws.close();
  }
});
```

## Worked example: add a method end-to-end

Example: add a new `system.echo` request that returns `{ ok: true, text }`.

1. **Rust protocol metadata and behavior**

Add the method to `GATEWAY_PROTOCOL_METHODS` in
`crates/crawclaw-gateway/src/protocol_contract.rs`.

Add the Rust Gateway method in `crates/crawclaw-gateway/src/lib.rs`:

```rust
"system.echo" => Ok(json!({
    "ok": true,
    "text": params.get("text").and_then(Value::as_str).unwrap_or_default(),
})),
```

2. **TypeScript validator/client schema**

Add to `src/gateway/protocol/schema.ts`:

```ts
export const SystemEchoParamsSchema = Type.Object(
  { text: NonEmptyString },
  { additionalProperties: false },
);

export const SystemEchoResultSchema = Type.Object(
  { ok: Type.Boolean(), text: NonEmptyString },
  { additionalProperties: false },
);
```

Add both to `ProtocolSchemas` and export types:

```ts
  SystemEchoParams: SystemEchoParamsSchema,
  SystemEchoResult: SystemEchoResultSchema,
```

```ts
export type SystemEchoParams = Static<typeof SystemEchoParamsSchema>;
export type SystemEchoResult = Static<typeof SystemEchoResultSchema>;
```

3. **Validation**

In `src/gateway/protocol/index.ts`, export an AJV validator:

```ts
export const validateSystemEchoParams = ajv.compile<SystemEchoParams>(SystemEchoParamsSchema);
```

4. **Regenerate**

```bash
pnpm protocol:check
```

5. **Tests + docs**

Add a Rust Gateway test in `crates/crawclaw-gateway/src/lib.rs` and note the method in docs.

## Swift codegen behavior

The Swift generator emits:

- `GatewayFrame` enum with `req`, `res`, `event`, and `unknown` cases
- Strongly typed payload structs/enums
- `ErrorCode` values and `GATEWAY_PROTOCOL_VERSION`

Unknown frame types are preserved as raw payloads for forward compatibility.

## Versioning + compatibility

- `GATEWAY_PROTOCOL_VERSION` lives in
  `crates/crawclaw-gateway/src/protocol_contract.rs`.
- TypeScript exports `PROTOCOL_VERSION` from the Rust-generated metadata bridge.
- Clients send `minProtocol` + `maxProtocol`; the server rejects mismatches.
- The Swift models keep unknown frame types to avoid breaking older clients.

## Schema patterns and conventions

- Most objects use `additionalProperties: false` for strict payloads.
- `NonEmptyString` is the default for IDs and method/event names.
- The top-level `GatewayFrame` uses a **discriminator** on `type`.
- Methods with side effects usually require an `idempotencyKey` in params
  (example: `send`, `poll`, `agent`, `chat.send`).
- `agent` accepts optional `internalEvents` for runtime-generated orchestration context
  (for example subagent/cron task completion handoff); treat this as internal API surface.

## Live schema JSON

Generated JSON Schema is emitted to `dist/protocol.schema.json`. The published
raw file is typically available at:

- [https://raw.githubusercontent.com/qianleigood/crawclaw/main/dist/protocol.schema.json](https://raw.githubusercontent.com/qianleigood/crawclaw/main/dist/protocol.schema.json)

## When you change schemas

1. Update the Rust protocol contract module and stable snapshot.
2. Update the TypeScript validator/client schemas only when browser-facing
   typed clients need the shape.
3. Run `pnpm protocol:check`.
4. Commit the regenerated schema artifacts.
