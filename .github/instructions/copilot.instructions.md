# CrawClaw Codebase Patterns

**Always reuse existing code - no redundancy!**

## Tech Stack

- **Runtime**: Rust Gateway/runtime with Node available for desktop renderer tooling
- **Language**: Rust for product/runtime code; TypeScript is scoped to the desktop renderer
- **Package Manager**: pnpm (keep `pnpm-lock.yaml` in sync)
- **Lint/Format**: Oxlint, Oxfmt (`pnpm check`)
- **Tests**: Rust workspace tests via `pnpm test`; do not add TypeScript test suites
- **Terminal Utilities**: clack/prompts helpers for retained internal flows
- **Build**: Rust package postbuild plus native binary staging outputs to `dist/`

## Anti-Redundancy Rules

- Avoid files that just re-export from another file. Import directly from the original source.
- If a function already exists, import it - do NOT create a duplicate in another file.
- Before creating any formatter, utility, or helper, search for existing implementations first.

## Source of Truth Locations

### Desktop/Gateway Patterns

- Desktop UI/BFF: `apps/crawclaw-desktop/`
- Gateway methods and protocol: `crates/crawclaw-gateway/`
- Runtime, config, secrets, providers, tools, hooks, and release checks: `crates/crawclaw-runtime/`
- Native plugin descriptors and operations: `crates/crawclaw-native-plugins/`

## Import Conventions

- Keep product/runtime contracts in Rust crates.
- Keep desktop renderer imports local to `apps/crawclaw-desktop`.
- Do not add public JavaScript SDK exports.

## Code Quality

- Rust for product/runtime behavior. For desktop renderer TypeScript, use strict typing and avoid `any`.
- Keep files under ~700 LOC - extract helpers when larger
- Add Rust tests under the owning crate or crate integration tests; do not add TypeScript test suites
- Run `pnpm check` before commits (lint + format)
- Run `pnpm tsgo` for type checking

## Stack & Commands

- **Package manager**: pnpm (`pnpm install`)
- **Desktop dev**: `pnpm desktop:tauri:dev`
- **Type-check**: `pnpm tsgo`
- **Lint/format**: `pnpm check`
- **Tests**: `pnpm test`
- **Build**: `pnpm build`

For commits in this repository, use `scripts/committer "<msg>" <file...>` with an explicit file list so staging stays scoped. Run the relevant commands above before committing unless the human explicitly asks for a narrower check.
