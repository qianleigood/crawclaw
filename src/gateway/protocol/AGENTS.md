# Gateway Protocol Boundary

This directory defines the Gateway wire contract for operator clients.

## Public Contracts

- Docs:
  - `docs/gateway/protocol.md`
  - `docs/concepts/architecture.md`
- Definition files:
  - `crates/crawclaw-gateway/src/protocol_contract.rs`
  - `crates/crawclaw-gateway/src/protocol_contract/protocol.schema.stable.json`
  - `src/generated/gateway/protocol-schema.generated.ts`
  - `src/gateway/protocol/schema.ts`
  - `src/gateway/protocol/index.ts`

## Boundary Rules

- Treat schema changes as protocol changes, not local refactors.
- Prefer additive evolution. If a change is incompatible, handle versioning
  explicitly and update all affected clients.
- Rust owns protocol metadata, the packaged JSON Schema, and the generated
  TypeScript schema read model. `src/gateway/protocol/client-info.ts` keeps the
  small TypeScript client-id constants consumed by local clients, and
  `src/gateway/protocol/schema.ts` is a thin compatibility re-export for
  TypeScript clients and AJV helpers.
- New Gateway methods, events, or payload fields should land through the typed
  protocol definitions here and the Rust protocol contract rather than ad hoc
  JSON shapes elsewhere.
