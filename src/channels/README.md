# Channels

`src/channels/**` is the channel runtime.

It owns:

- inbound and outbound message behavior
- threading and conversation binding
- typing and status projection
- channel-facing approval and action surfaces
- channel plugin contracts and shared helpers

Top-level extension boundary notes already live in `src/channels/AGENTS.md`. This
README is the maintainer entry point for the runtime layer itself.

## Start Here

- `plugins/index.ts`
- `registry.ts`
- `thread-bindings-policy.ts`
- `thread-bindings-messages.ts`
- `typing.ts`
- `typing-lifecycle.ts`

## Public Seams

- `src/auto-reply/**` should consume declared interaction seams from this tree, not per-channel implementation details.
- Extensions should consume `crawclaw/plugin-sdk/*`, not direct imports from `src/channels/**`.
- Shared channel behavior should flow through plugin contracts, adapters, and projectors.

## Boundary Rules

- Do not move command semantics or reply orchestration into `src/channels`; that belongs in `src/auto-reply`.
- Do not let channel-specific implementation details leak into unrelated core modules.
- If `auto-reply` or another caller needs a new channel helper, expose it as an explicit seam and keep the contract generic.
- Keep per-channel behavior behind plugin/runtime abstractions instead of stringly typed special cases.

## Review Notes

- Channel changes often affect pairing, allowlists, threading, approvals, typing, and reply projection together.
- Check both generic helpers and channel-plugin contracts when changing shared behavior.
