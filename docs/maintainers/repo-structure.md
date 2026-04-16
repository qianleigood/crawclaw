# Repository Structure

This document explains how to read the CrawClaw monorepo before making
large-scale moves.

The short version:

- `src/` is the product runtime
- `ui/` is the web interface layer
- `extensions/` is the capability ecosystem
- `packages/` contains support packages that do not fit the main runtime tree
- `docs/` contains both product docs and maintainer-facing design material
- `scripts/` and `.github/` are the delivery layer
- `test/` is shared test infrastructure
- `dist/` is build output, not source
- `skills-optional/` is an optional skill catalog, not runtime core code
- `Swabble/` is a separate sidecar app/codebase, not part of the main runtime

## Main Runtime

The main product lives under `src/`.

Primary domains:

- `src/gateway`: control plane, auth, protocol, server methods, control UI integration
- `src/agents`: agent runtime, tool registration, providers, subagents, sandbox execution
- `src/memory`: memory ingest, storage, retrieval, orchestration, compaction
- `src/workflows`: workflow registry, compilation, n8n bridge, execution sync
- `src/cron`: scheduled execution and delivery
- `src/channels`: routing and session-level messaging behavior
- `src/cli`, `src/daemon`, `src/config`, `src/infra`, `src/shared`: support layers around the runtime

When people say “the product code”, they usually mean `src/`.

Top-level maintainer entry points inside `src/`:

- `src/agents/README.md`
- `src/channels/README.md`
- `src/plugins/README.md`
- `src/memory/README.md`
- `src/workflows/README.md`
- `src/infra/README.md`

## Interface Layer

`ui/` is the browser-based Control UI.

- It is its own workspace package.
- It talks to the gateway through a single client abstraction.
- It should be treated as the interface layer, not as a random subfolder under the repo root.

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

`packages/` is for packages that do not belong in the main runtime tree but are
still part of the monorepo.

Current examples include package-contract and companion packages. New packages
should not be added here by default without first deciding whether they are:

- runtime core
- extension ecosystem
- app-sidecar
- internal support package

## Documentation Layer

`docs/` serves more than one purpose today:

- product docs
- install docs
- reference docs
- maintainer design notes
- debugging and audit material

That means `docs/` is not purely user-facing. Until the docs tree is split more
aggressively, maintainers should treat it as a mixed knowledge layer.

This file lives under `docs/maintainers/` specifically to make that split more explicit.

## Delivery Layer

These paths form the build/release/delivery system:

- `scripts/`
- `.github/`
- `Dockerfile`
- release metadata in `package.json`

This layer is operationally critical, but it is not the same thing as the
runtime architecture.

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
- If you are trying to understand how the system works, start from `src/`, `ui/`,
  `extensions/`, and `docs/`, not `dist/`.

## Current Cleanup Direction

The current recommended cleanup order is:

1. Make structure explicit with docs and directory READMEs.
2. Reduce root-directory ambiguity by reclassifying sidecar and catalog directories.
3. Split maintainer docs from user-facing docs more cleanly.
4. Only then consider deeper source-tree moves inside `src/`.

This keeps release/build risk low while still improving maintainability.
