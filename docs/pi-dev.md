---
title: "Agent Runtime Development Workflow"
summary: "Developer workflow for Rust agent runtime build, test, and live validation"
read_when:
  - Working on agent runtime code or tests
  - Running runtime lint, typecheck, and live test flows
---

# Agent Runtime Development Workflow

This guide summarizes a sane workflow for working on CrawClaw's Rust-owned
agent runtime.

## Type Checking and Linting

- Type check and build: `pnpm build`
- Lint: `pnpm lint`
- Format check: `pnpm format`
- Full gate before pushing: `pnpm lint && pnpm build && pnpm test`

## Running Agent Runtime Tests

Run the Rust runtime tests for execution behavior:

```bash
cargo test -p crawclaw-runtime agent_runtime
cargo test -p crawclaw-runtime memory
cargo test -p crawclaw-gateway agent_run_turn
```

Run the broader native gate before handoff:

```bash
pnpm test
```

Do not add new TypeScript test suites for runtime behavior. Cover the owning
Rust crate or the public native boundary instead.

## Manual Testing

Recommended flow:

- Run the gateway in dev mode:
  - `pnpm gateway:dev`
- Trigger the agent through CrawClaw Desktop or the local Gateway API.

For tool call behavior, prompt for a `read` or `exec` action so you can see tool streaming and payload handling.

## Clean Slate Reset

State lives under the CrawClaw state directory. Default is `~/.crawclaw`. If `CRAWCLAW_STATE_DIR` is set, use that directory instead.

To reset everything:

- `crawclaw.json` for config
- `credentials/` for auth profiles and tokens
- `agents/<agentId>/sessions/` for agent session history
- `agents/<agentId>/sessions.json` for the session index
- `sessions/` if legacy paths exist
- `workspace/` if you want a blank workspace

If you only want to reset sessions, delete `agents/<agentId>/sessions/` and `agents/<agentId>/sessions.json` for that agent. Keep `credentials/` if you do not want to reauthenticate.

## References

- [Testing](/help/testing)
- [Getting Started](/start/getting-started)
