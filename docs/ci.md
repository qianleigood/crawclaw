---
title: CI Pipeline
summary: "CI job graph, scope gates, and local command equivalents"
read_when:
  - You need to understand why a CI job did or did not run
  - You are debugging failing GitHub Actions checks
---

# CI Pipeline

The CI runs on every push to `main` and every pull request. It uses smart scoping to skip expensive jobs when only unrelated areas changed.

## Job Overview

| Job               | Purpose                                                                   | When it runs                                     |
| ----------------- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| `preflight`       | Docs scope, change scope, key scan, workflow audit, prod dependency audit | Always; Node-based audit only on non-doc changes |
| `docs-scope`      | Detect docs-only changes                                                  | Always                                           |
| `changed-scope`   | Detect which areas changed (node/macos/android/windows)                   | Non-doc changes                                  |
| `check`           | Repo-tools local profile: desktop contract, TypeScript, lint, boundaries  | Non-docs, Node changes                           |
| `check-docs`      | Repo-tools docs-core profile: glossary, links, generated docs baselines   | Docs changed                                     |
| `secrets`         | Detect leaked secrets                                                     | Always                                           |
| `build-artifacts` | Build dist once, share with `release-check`                               | Pushes to `main`, node changes                   |
| `release-check`   | Validate npm pack contents                                                | Pushes to `main` after build                     |
| `checks`          | Rust core profile on PRs; package build profile on push                   | Non-docs, Node/package changes                   |
| `checks-windows`  | Windows Rust core and package build profiles                              | Non-docs, windows-relevant changes               |
| `macos`           | Swift lint/build/test                                                     | PRs with macos changes                           |
| `android`         | Gradle build + tests                                                      | Non-docs, android changes                        |

## Fail-Fast Order

Jobs are ordered so cheap checks fail before expensive ones run:

1. `docs-scope` + `changed-scope` + `check` + `secrets` (parallel, cheap gates first)
2. PRs: `checks` (Rust workspace test), `checks-windows`, `macos`, `android`
3. Pushes to `main`: `build-artifacts` + `release-check` + package build compatibility

Scope logic lives in the `preflight` job in `.github/workflows/ci.yml`; keep it
validated through the workflow audit plus affected CI lanes when changing scope
behavior.

Node setup is scoped to lanes that need the Node/npm adapter, such as desktop
renderer checks, package/release validation, and hosted docs tooling. Rust core
and docs-core lanes use `crawclaw-repo-tools` directly.

## Runners

| Runner                           | Jobs                                       |
| -------------------------------- | ------------------------------------------ |
| `blacksmith-16vcpu-ubuntu-2404`  | Most Linux jobs, including scope detection |
| `blacksmith-32vcpu-windows-2025` | `checks-windows`                           |
| `macos-latest`                   | `macos`, `ios`                             |

## Local Equivalents

```bash
cargo run -q -p crawclaw-repo-tools -- check --profile local
cargo run -q -p crawclaw-repo-tools -- check --profile rust-core
cargo run -q -p crawclaw-repo-tools -- check --profile docs-core
cargo run --quiet -p crawclaw-repo-tools -- release-check
```

The matching pnpm aliases remain available: `pnpm check`, `pnpm test`,
`pnpm check:docs`, and `pnpm release:check`.
