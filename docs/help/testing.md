---
summary: "Testing kit: native Rust workspace checks and local gate commands"
read_when:
  - Running tests locally or in CI
  - Adding regressions for native runtime or desktop behavior
  - Debugging gateway + agent behavior
title: "Testing"
---

# Testing

CrawClaw is converging on the desktop app and native runtime as the product boundary. The default test gate is now the Rust workspace test suite.

## Quick start

Most days:

- Full local gate: `pnpm build && pnpm check && pnpm test`
- Test-only gate: `pnpm test`
- Focused crate debugging: `cargo test -p crawclaw-runtime <filter>`

`pnpm test` runs `crawclaw-runtime test-workspace`, which delegates to `cargo test --workspace -- --test-threads=1` with a larger default Rust stack. The serial default is intentional because several desktop and native runtime tests use shared local resources.

## Current test commands

- `pnpm test`: Rust workspace tests.
- `pnpm test:all`: `pnpm lint && pnpm build && pnpm test`.

The previous TypeScript test runner and Vitest planner scripts were removed. Do not add new TypeScript test suites unless the project explicitly reopens that surface.

## What the Rust suite covers

- Native gateway guardrails and protocol boundaries.
- Runtime packaging and package-build cleanup checks.
- Desktop/native runtime integration tests owned by the Rust crates.
- Repo-level guardrails that keep removed TypeScript test and Node gateway surfaces from returning.

## Local PR gate

For local PR land/gate checks, run:

- `pnpm check`
- `pnpm build`
- `pnpm test`
- `pnpm check:docs`

If `pnpm test` flakes on a loaded host, rerun once before treating it as a regression. If it still fails, isolate the owning crate with Cargo:

```bash
cargo test -p crawclaw-runtime <filter>
```

Keep focused tests close to the Rust crate that owns the behavior. For desktop
renderer flows, cover the public native boundary instead of adding standalone
TS test harnesses.
