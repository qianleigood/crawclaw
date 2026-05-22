---
summary: "How to run the native Rust test gate locally"
read_when:
  - Running or fixing tests
title: "Tests"
---

# Tests

- Full testing kit: [Testing](/help/testing)

- `pnpm test`: runs the Rust workspace tests through `crawclaw-repo-tools test-workspace`.
- `cargo run -q -p crawclaw-repo-tools -- check --profile rust-core`: Rust guardrails plus workspace tests.
- `cargo run -q -p crawclaw-repo-tools -- check --profile local`: local desktop contract, TypeScript, lint, and boundary checks.
- The Rust runner sets a conservative stack size and serial Rust test threads so desktop and native runtime integration tests do not race shared local resources.
- For focused debugging, run Cargo directly, for example `cargo test -p crawclaw-runtime <filter>`.

## Local PR gate

For local PR land/gate checks, run:

- `pnpm check`
- `pnpm build`
- `pnpm test`
- `pnpm check:docs`

If `pnpm test` flakes on a loaded host, rerun once before treating it as a regression, then isolate the owning crate with `cargo test -p <crate> <filter>`.
