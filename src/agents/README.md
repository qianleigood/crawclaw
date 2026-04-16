# Agents

`src/agents/**` is the agent kernel.

It owns:

- model/provider execution
- tool registration and tool runtime
- subagent orchestration
- special-agent substrate
- sandboxed process and filesystem execution
- execution-event emission and streaming glue

## Start Here

- `crawclaw-tools.ts`
- `pi-embedded-runner.ts`
- `pi-embedded-subscribe.ts`
- `special/runtime/*`
- `tools/*`

## Allowed Dependencies

- `src/config/**`
- `src/infra/**`
- `src/shared/**`
- explicit plugin/provider runtime seams in `src/plugins/**`
- a small approved gateway runtime seam such as `src/gateway/call.ts`
- explicit domain contracts from `src/memory/**` and `src/workflows/**`

## Boundary Rules

- Do not import `src/gateway/server-methods/**`, `server.impl.ts`, or other control-plane internals from here.
- If agent code needs new gateway behavior, add or extend a narrow runtime seam first.
- Do not create a private background-agent mechanism. Use `src/agents/special/runtime/**` for maintenance or verification agents.
- Keep execution visibility, tool lifecycle output, and workflow projection on the shared event path instead of ad hoc strings.
- Prefer an existing subdomain such as `tools`, `runtime`, `special`, `skills`, `sandbox`, or `query-context` before adding another top-level catch-all file.

## Review Notes

- The largest files in this tree are usually real architecture hotspots, not harmless utilities.
- When a change touches `pi-*` runtime files, verify whether it belongs in a narrower subdomain instead.
- Add or update focused tests when changing tool wiring, streaming, or subagent behavior.
