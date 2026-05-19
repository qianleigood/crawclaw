---
summary: "TypeBox helper schemas and Gateway protocol generation boundaries"
read_when:
  - Updating TypeBox helpers or Gateway protocol codegen
title: "TypeBox helper schemas"
---

# TypeBox helper schemas

Last updated: 2026-05-18

TypeBox is no longer the source of truth for the packaged **Gateway WebSocket
protocol**. The Rust Gateway contract module owns the protocol version,
advertised methods, advertised events, the stable JSON Schema snapshot, and the
generated TypeScript schema read model.

TypeBox still exists in the repository for narrower TypeScript helper surfaces
that run in React/Node tooling, especially agent and tool schema compatibility
types. Keep those helpers scoped to the TypeScript code that consumes them.

Use this split:

- **Gateway protocol**: Rust-owned contract and generated artifacts.
- **TypeBox helpers**: local TypeScript helper schemas that are not packaged
  protocol truth sources.

For the higher-level Gateway context, start with
[Gateway architecture](/concepts/architecture) and
[Gateway protocol](/gateway/protocol).

## Gateway protocol ownership

Gateway protocol files:

- Rust contract module: `crates/crawclaw-gateway/src/protocol_contract.rs`
- Embedded JSON Schema snapshot:
  `crates/crawclaw-gateway/src/protocol_contract/protocol.schema.stable.json`
- Generated TypeScript metadata bridge:
  `src/generated/gateway/protocol-contract.generated.ts`
- Generated TypeScript schema read model:
  `src/generated/gateway/protocol-schema.generated.ts`
- TypeScript compatibility re-export: `src/gateway/protocol/schema.ts`
- Runtime validators and client helpers: `src/gateway/protocol/index.ts`
- Generated JSON Schema: `dist/protocol.schema.json`

The generator runs through the Rust Gateway binary:

```bash
pnpm protocol:gen
pnpm protocol:check
```

`pnpm protocol:gen` emits the JSON Schema, TypeScript metadata bridge, and
TypeScript schema read model from the Rust contract snapshot. `pnpm
protocol:check` verifies the tracked generated artifacts match the Rust
contract.

## Runtime model

- **Server side**: the Rust Gateway owns handshake, auth, method dispatch, and
  runtime behavior.
- **Client side**: TypeScript clients import the generated read model through
  `src/gateway/protocol/schema.ts` and compile AJV validators in
  `src/gateway/protocol/index.ts`.
- **Advertised surface**: `hello-ok` exposes supported methods and events from
  Rust protocol metadata.

## TypeBox helper usage

Use TypeBox only when a TypeScript-owned helper genuinely needs a local runtime
schema or a compatibility type for still-existing TypeScript callers. Current
examples include agent/tool schema surfaces such as:

- `src/agents/session-client/schema-types.ts`

Do not add new handwritten TypeBox modules for Gateway protocol shapes. Protocol
fields and method contracts should be changed in Rust, regenerated, and then
consumed through the generated TypeScript read model.

## Add a Gateway method

1. Add the method metadata and schema contract in
   `crates/crawclaw-gateway/src/protocol_contract.rs`.
2. Add the Rust Gateway behavior in the owning Gateway handler.
3. Regenerate artifacts:

   ```bash
   pnpm protocol:gen
   ```

4. Run the protocol check:

   ```bash
   pnpm protocol:check
   ```

5. Add Rust Gateway tests for behavior and contract coverage.

## Versioning

- `GATEWAY_PROTOCOL_VERSION` lives in
  `crates/crawclaw-gateway/src/protocol_contract.rs`.
- TypeScript exports `PROTOCOL_VERSION` from the generated schema read model.
- Clients send `minProtocol` and `maxProtocol`; the server rejects mismatches.
- Swift models are generated from `dist/protocol.schema.json`.
