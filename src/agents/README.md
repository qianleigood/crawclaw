# Agents

`src/agents/**` is the TypeScript agent support surface around the Rust runtime.

It owns:

- TypeScript Gateway client projections and compatibility helpers
- prompt, transcript, session, and config read models consumed by TypeScript clients
- test harnesses and fixtures for TypeScript projection surfaces
- narrow Rust runtime client seams where TypeScript still needs typed helpers

## Start Here

- `command/*`
- Rust runtime client seams
- `runtime/*`
- `query-context/*`
- `subagents/*`
- `special/runtime/*`
- `tools/*`

## Allowed Dependencies

- `src/config/**`
- `src/infra/**`
- `src/shared/**`
- explicit plugin/provider runtime seams in `src/plugins/**`
- a small approved gateway runtime seam such as `src/gateway/call.ts`
- explicit Rust-backed domain contracts and `src/workflows/**`

## Boundary Rules

- Do not add new model/provider execution, tool runtime, subagent orchestration,
  or special-agent runtime ownership here. Those paths belong in
  `crates/crawclaw-runtime`, `crates/crawclaw-gateway`, or
  `crates/crawclaw-native-plugins`.
- Do not import gateway method implementation files, `server.impl.ts`, or other control-plane internals from here.
- If agent code needs new gateway behavior, add or extend a narrow runtime seam first.
- Do not create a private background-agent mechanism. Use `src/agents/special/runtime/**` for maintenance or review agents.
- Keep execution visibility, tool lifecycle output, and workflow projection on the shared event path instead of ad hoc strings.
- Prefer an existing subdomain such as `tools`, `runtime`, `special`, `skills`, or `query-context` before adding another top-level catch-all file.

## Review Notes

- The largest files in this tree are usually real architecture hotspots, not harmless utilities.
- When a change touches `pi-*` runtime files, verify whether it belongs in a narrower subdomain instead.
- Add or update focused tests when changing tool wiring, streaming, or subagent behavior.
