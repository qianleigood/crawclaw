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
advertised methods, advertised events, and the stable JSON Schema snapshot.

TypeBox no longer has a product-runtime role in this repository. Keep new
protocol and runtime schema work in the Rust contract modules.

Use this split:

- **Gateway protocol**: Rust-owned contract and generated artifacts.
- **Desktop renderer TypeScript**: UI-only code that consumes the Rust-owned
  protocol surface through documented API payloads.

For the higher-level Gateway context, start with
[Gateway architecture](/concepts/architecture) and
[Gateway protocol](/gateway/protocol).

## Gateway protocol ownership

Gateway protocol files:

- Rust contract module: `crates/crawclaw-gateway/src/protocol_contract.rs`
- Embedded JSON Schema snapshot:
  `crates/crawclaw-gateway/src/protocol_contract/protocol.schema.stable.json`
- Generated JSON Schema: `dist/protocol.schema.json`

The generator runs through the Rust Gateway binary:

```bash
pnpm protocol:gen
pnpm protocol:check
```

`pnpm protocol:gen` emits the JSON Schema from the Rust contract snapshot.
`pnpm protocol:check` verifies the tracked generated artifact matches the Rust
contract.

## Runtime model

- **Server side**: the Rust Gateway owns handshake, auth, method dispatch, and
  runtime behavior.
- **Client side**: clients consume the generated JSON Schema or documented
  Gateway payloads. The full protocol schema is no longer generated as
  TypeScript.
- **Advertised surface**: `hello-ok` exposes supported methods and events from
  Rust protocol metadata.

## TypeBox helper usage

Do not add new handwritten TypeBox modules for Gateway protocol shapes. Protocol
fields and method contracts should be changed in Rust, regenerated, and then
consumed from the generated JSON Schema or documented Gateway payloads.

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
- Clients send `minProtocol` and `maxProtocol`; the server rejects mismatches.
- Swift models are generated from `dist/protocol.schema.json`.
