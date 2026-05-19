---
summary: "How to run the native Rust test gate locally"
read_when:
  - Running or fixing tests
title: "Tests"
---

# Tests

- Full testing kit: [Testing](/help/testing)

- `pnpm test`: runs the Rust workspace tests through `scripts/run-rust-tests.mjs`.
- The wrapper sets a conservative stack size and serial Rust test threads so desktop and native runtime integration tests do not race shared local resources.
- For focused debugging, run Cargo directly, for example `cargo test -p crawclaw-runtime <filter>`.

## Local PR gate

For local PR land/gate checks, run:

- `pnpm check`
- `pnpm build`
- `pnpm test`
- `pnpm check:docs`

If `pnpm test` flakes on a loaded host, rerun once before treating it as a regression, then isolate the owning crate with `cargo test -p <crate> <filter>`.

## Model latency bench (local keys)

Script: [`scripts/bench-model.ts`](https://github.com/qianleigood/crawclaw/blob/main/scripts/bench-model.ts)

Usage:

- `source ~/.profile && pnpm tsx scripts/bench-model.ts --runs 10`
- Optional env: `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `MINIMAX_MODEL`, `ANTHROPIC_API_KEY`
- Default prompt: “Reply with a single word: ok. No punctuation or extra text.”

Last run (2025-12-31, 20 runs):

- minimax median 1279ms (min 1114, max 2431)
- opus median 2454ms (min 1224, max 3170)
