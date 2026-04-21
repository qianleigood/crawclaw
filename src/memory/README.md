# Memory

`src/memory/**` is a domain runtime, not a helper bag.

It owns:

- context assembly and compaction
- durable memory extraction and recall
- experience recall planning and provider orchestration
- session summaries
- dreaming and maintenance flows
- memory runtime storage and orchestration

## Start Here

- `index.ts`
- `command-api.ts`
- `cli-api.ts`
- `engine/*`
- `durable/*`
- `experience/*`
- `experience/*`
- `session-summary/*`
- `dreaming/*`

## Boundary Rules

- Keep memory as a domain service with explicit APIs and runtime seams.
- Do not hide memory orchestration inside unrelated agent or auto-reply glue when it belongs here.
- If memory needs background agent work, register it through the special-agent substrate instead of creating a private runner model.
- Keep recall, extraction, summary, and dream policies explicit; do not bury them in generic caches or transport code.
- Keep provider adapters behind `experience/*`; context assembly should consume query plans and provider results, not provider-specific CLI calls.

## Review Notes

- Memory changes often have cache, replay, and prompt-shape consequences. Check those three together.
- Update integration tests when touching extraction, summary, context assembly, or storage contracts.
