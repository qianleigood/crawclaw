---
summary: "Frontend-facing control-plane RPC contract for the browser Control UI"
read_when:
  - You are extending the browser Control UI
  - You need the stable Gateway methods that UI code can rely on
  - You want the config patch/set/apply write model and capability rules in one place
title: "Control-Plane RPC"
---

# Control-plane RPC

This page documents the **frontend-facing RPC contract** used by the browser
Control UI.

It is intentionally narrower than the full Gateway protocol:

- The full WebSocket frame model still lives in TypeBox / protocol schema docs.
- This page focuses on the **stable method surface**, **capability gating**, and
  **config write semantics** that frontend code should treat as contract.

## Contract sources

Today the effective control-plane contract comes from four places:

1. Shared method contract:
   - `src/gateway/protocol/control-ui-methods.ts`
2. Protocol schemas:
   - `src/gateway/protocol/schema/*`
   - `src/gateway/protocol/schema/protocol-schemas.ts`
3. Gateway method dispatch:
   - `src/gateway/server-methods.ts`
4. Runtime capability advertisement:
   - `hello-ok.features.methods`

Use them together like this:

- `control-ui-methods.ts` defines the stable UI method map:
  - method
  - params schema
  - result schema
  - required scopes
  - capability
  - stability
  - side effects
- TypeBox provides the reusable protocol schema objects behind those methods.
- `hello-ok.features.methods` tells the UI which optional surfaces are actually
  available on the connected gateway.

## Stable method surface

The current first-batch stable surface includes:

- `config.*`
- `sessions.*`
- `channels.status`
- `exec.approvals.get`
- `exec.approvals.set`
- `agents.list`
- `agent.inspect`
- `tools.catalog`
- `tools.effective`
- `usage.status`
- `usage.cost`
- `sessions.usage*`
- `workflow.*`
- `system.health`
- `system.status`
- `system-presence`
- `system.heartbeat.last`

Optional capability-gated methods currently include:

- `channels.login.start`
- `channels.login.wait`
- `exec.approvals.node.get`
- `exec.approvals.node.set`

Legacy aliases are still accepted for compatibility:

| Preferred name          | Legacy alias      |
| ----------------------- | ----------------- |
| `channels.login.start`  | `web.login.start` |
| `channels.login.wait`   | `web.login.wait`  |
| `system.health`         | `health`          |
| `system.status`         | `status`          |
| `system.heartbeat.last` | `last-heartbeat`  |

For the canonical list, see:

- `src/gateway/protocol/control-ui-methods.ts`

## Capability semantics

The browser Control UI should not probe optional features by calling a method
and then treating `unknown method` as capability detection.

Use the negotiated hello payload instead:

- `hello-ok.features.methods` is the runtime truth
- `client.hasMethod("<method>")` answers direct method presence
- `client.hasCapability("<capability>")` answers grouped optional surfaces

Current grouped capability keys:

| Capability            | Methods                                              |
| --------------------- | ---------------------------------------------------- |
| `channels.login`      | `channels.login.start`, `channels.login.wait`        |
| `exec.approvals.node` | `exec.approvals.node.get`, `exec.approvals.node.set` |

UI behavior should be:

- If a stable method is missing unexpectedly, treat it as a gateway/version
  mismatch.
- If an optional capability is missing, hide or disable that surface before
  issuing the request.

## Config write model

The Control UI stays config-file centric. There is no separate `settings.*`
surface.

Preferred write paths:

| Editing mode | Method         | Meaning                                |
| ------------ | -------------- | -------------------------------------- |
| Form mode    | `config.patch` | Preferred path for object-field edits  |
| Raw mode     | `config.set`   | Whole-snapshot write                   |
| Apply        | `config.apply` | Validate + apply/reload running config |

Current UI behavior:

- Form mode prefers `config.patch`
- Raw mode uses `config.set`
- Array diffs in form mode currently fall back to `config.set`

This is intentional: the UI remains centered on editing the config file, while
using `patch` where it is safer and simpler.

## Error detail codes

First-batch structured request detail codes now exist in:

- `src/gateway/protocol/request-error-details.ts`

Currently emitted by the gateway main RPC path:

| Code                 | Meaning                                               |
| -------------------- | ----------------------------------------------------- |
| `SCOPE_MISSING`      | Request failed due to missing operator scope          |
| `METHOD_UNAVAILABLE` | The requested method is not available on this gateway |

Current detail payloads also include helpful fields:

- `missingScope`
- `method`

The UI should prefer detail codes over parsing message text.

Message matching is now compatibility fallback only.

Reserved/shared codes exist for later rollout, including:

- `CAPABILITY_MISSING`
- `PATCH_CONFLICT`
- `CONFIG_RELOAD_REQUIRED`
- `CONFIG_RESTART_REQUIRED`

## Bootstrap vs hello

Two payloads matter to the frontend:

### Bootstrap

Current bootstrap payload remains intentionally small:

- `basePath`
- `assistantName`
- `assistantAvatar`

See:

- `src/gateway/control-ui-contract.ts`

### Hello

The WebSocket hello is the source for:

- supported methods
- supported events
- capability gating inputs
- initial runtime snapshot

For frontend capability decisions, **hello matters more than bootstrap** today.

## When to use TypeBox directly

Use TypeBox / `ProtocolSchemas` when you need:

- reusable protocol object shapes
- runtime validation / JSON Schema generation
- shared typed schema references

Use `control-ui-methods.ts` when you need:

- the UI-facing method list
- params/result mapping by method
- required scopes
- capability grouping
- stability/effects metadata

In practice, frontend work usually needs both.

## Related

- [Control UI](/web/control-ui)
- [TypeBox](/concepts/typebox)
- [Gateway protocol](/gateway/protocol)
