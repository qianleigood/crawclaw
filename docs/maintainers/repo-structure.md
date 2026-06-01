---
title: "Repository Structure"
summary: "Maintainer map for the CrawClaw monorepo layout and source boundaries"
read_when:
  - You are orienting before broad repo cleanup or file moves
  - You need to explain which top-level directories are product, docs, tests, or sidecars
---

# Repository Structure

This document explains how to read the CrawClaw monorepo before making
large-scale moves.

The short version:

- `crates/` is the Rust product runtime and public native contract layer
- `apps/crawclaw-desktop/` is the desktop application
- `src/` is retained non-runtime metadata, generated JSON, and local boundary notes
- `extensions/` is the bundled plugin metadata ecosystem
- `packages/` is a reserved workspace support package slot, not runtime core
- `docs/` contains both product docs and maintainer-facing design material
- `scripts/` and `.github/` are the delivery layer
- `test/` is shared test infrastructure
- `dist/` is build output, not source
- `skills-optional/` is an optional skill catalog, not runtime core code
- `Swabble/` is a separate sidecar app/codebase, not part of the main runtime

## Main Runtime

The main product runtime lives under Rust crates.

Primary domains:

- `crates/crawclaw-gateway`: control plane, auth, protocol, and Gateway services
- `crates/crawclaw-runtime`: agent loop, memory, cron, runtime tools, native plugin registry wiring, runtime layout, and runtime status
- `crates/crawclaw-repo-tools`: build, release, docs checks, generated baselines, repo guardrails, GitHub helpers, and Node/npm tooling adapters
- `crates/crawclaw-native-plugins`: native plugin descriptors and operations
- `crates/crawclaw-providers`: provider catalog, auth/setup metadata, model normalization, request building, and response/stream parsing
- `crates/crawclaw-plugin-sdk`: public Rust plugin SDK
- `crates/crawclaw-channels`: native channel contracts, capability descriptors, and desktop channel configuration catalog

When people say “the product code”, they usually mean `crates/` plus the
desktop shell under `apps/crawclaw-desktop/`.

Retained maintainer entry points inside `src/`:

- `src/agents/README.md`
- `src/gateway/protocol/AGENTS.md`
- `src/plugins/README.md`
- `src/generated/`

## Capability Ecosystem

`extensions/` is the official extension/plugin ecosystem layer.

It includes multiple kinds of packages:

- channel adapters
- model/provider adapters
- browser/runtime helpers
- tool-oriented extensions
- shared support packages under `extensions/shared`

Not every extension is equal in role, but they all belong to the capability layer,
not the main runtime layer.

`skills-optional/` also belongs to the ecosystem side of the repo. It is a catalog
of optional skills and recipes, not a core runtime tree.

## Support Packages

`packages/` is intentionally reserved but currently should stay empty except
for its boundary note. New support packages should not be added by default.
First decide whether the code belongs under:

- `crates/` for runtime core or Rust repo tooling
- `extensions/` for the plugin ecosystem
- `apps/` for app or sidecar product code
- `scripts/` for shell, Go, or Python delivery helpers

## Documentation Layer

`docs/` serves more than one purpose today:

- product docs
- install docs
- reference docs
- maintainer design notes
- debugging and audit material

That means `docs/` is not purely user-facing. Until the docs tree is split more
aggressively, maintainers should treat it as a mixed reference layer.

This file lives under `docs/maintainers/` specifically to make that split more explicit.

## Delivery Layer

These paths form the build/release/delivery system:

- `scripts/`
- `.github/`
- release metadata in `package.json`

This layer is operationally critical, but it is not the same thing as the
runtime architecture.

The Rust entrypoint for this layer is `crates/crawclaw-repo-tools`. Product
runtime crates may expose catalogs or staging helpers that maintainer tooling
reads, but build, release, docs, and guardrail command implementations should
not live in `crates/crawclaw-runtime`.

`package.json` keeps pnpm compatibility aliases for contributors and CI, but the
canonical implementation now lives behind repo-tools profiles:

- `check --profile local|ci|rust-core|desktop-renderer|docs-core|docs-hosted`
- `build --profile package|strict-smoke|desktop-renderer`
- `release-check`
- `desktop-renderer dev|build|tauri-dev|tauri-build`

Node/npm still exist for the desktop renderer, docs hosted tooling, and npm
pack/publish boundaries. They should be called through the repo-tools adapter
when a Rust orchestration path exists.

## Test Infrastructure

`test/` is shared test infrastructure.

Use it for:

- shared fixtures
- mocks
- helper utilities
- cross-domain test support

Keep small, domain-local tests near source when possible. Use `test/` when the
support asset is shared across multiple domains.

## Non-Core / Sidecar Code

`Swabble/` is not part of the main CrawClaw runtime tree.

It is a separate sidecar app/codebase living in the same repository. Treat it as
an adjacent project. If the repo is reorganized later, this directory should move
under an explicit umbrella such as `apps/` or `experiments/`.

## Build Output

`dist/` is build output.

- It exists because the published npm package and some release paths require it.
- It should not be used to explain the source architecture.
- If you are trying to understand how the system works, start from `crates/`,
  `apps/crawclaw-desktop/`, `extensions/`, and `src/generated/`, not `dist/`.

## Current Cleanup Direction

The current recommended cleanup order is:

1. Keep product runtime code and repository automation in separate crates.
2. Make structure explicit with docs and directory READMEs.
3. Reduce root-directory ambiguity by reclassifying sidecar and catalog directories.
4. Split maintainer docs from user-facing docs more cleanly.
5. Only then consider deeper moves for generated metadata or retained boundary
   notes inside `src/`.

This keeps release/build risk low while still improving maintainability.
