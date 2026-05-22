---
summary: "Testing kit: native Rust workspace checks and local gate commands"
read_when:
  - Running tests locally or in CI
  - Adding regressions for native runtime or desktop behavior
  - Debugging gateway + agent behavior
title: "Testing"
---

# Testing

CrawClaw is converging on the desktop app and native runtime as the product boundary. The default test gate is now the Rust workspace test suite. Node/npm remain available as tooling adapters for the desktop renderer, hosted docs checks, and npm packaging.

## Quick start

Most days:

- Full local gate: `pnpm build && pnpm check && pnpm test`
- Test-only gate: `pnpm test`
- Focused crate debugging: `cargo test -p crawclaw-runtime <filter>`

`pnpm check` and `pnpm build` are compatibility aliases over `crawclaw-repo-tools check --profile local` and `crawclaw-repo-tools build --profile package`. `pnpm test` runs `crawclaw-repo-tools test-workspace`, which delegates to `cargo test --workspace -- --test-threads=1` with a larger default Rust stack. The serial default is intentional because several desktop and native runtime tests use shared local resources.

## Current test commands

- `pnpm test`: Rust workspace tests.
- `pnpm test:all`: `pnpm check && pnpm build && pnpm test`.
- `cargo run -q -p crawclaw-repo-tools -- check --profile rust-core`: Rust guardrails plus workspace tests, used by the Rust CI lane.
- `cargo run -q -p crawclaw-repo-tools -- check --profile desktop-renderer`: desktop renderer build through the Node/npm adapter.
- `cargo run -q -p crawclaw-repo-tools -- check --profile docs-core`: docs glossary, internal links, generated baselines, and docs list.
- `cargo run -q -p crawclaw-repo-tools -- check --profile docs-hosted`: hosted/Mintlify-specific docs anchor checks.

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
