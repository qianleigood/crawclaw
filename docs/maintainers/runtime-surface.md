---
summary: "Maintainer boundary for Rust-owned runtime surfaces and allowed TypeScript or JavaScript surfaces"
read_when:
  - You are auditing Rustification progress
  - You need to decide whether a TypeScript or JavaScript file belongs in the product runtime
  - You are reviewing desktop packaging or plugin runtime changes
title: "Runtime Surface"
---

# Runtime Surface

This page defines the current runtime boundary for CrawClaw maintainers. Use it
when deciding whether remaining TypeScript or JavaScript source is product
runtime, ecosystem contract, build tooling, or removable legacy surface.

The goal is not to remove every TypeScript or JavaScript file. The goal is that
the product runtime path is Rust/native-owned, while TypeScript and JavaScript
remain only where they are intentional and bounded.

## Rust owned product path

These surfaces are product runtime surfaces and should stay Rust/native-owned:

- Desktop shell backend and local API under `apps/crawclaw-desktop/src-tauri`.
- Gateway runtime under `crates/crawclaw-gateway`.
- Agent, session, memory, automation, tool, and native plugin execution under `crates/crawclaw-runtime`.
- Bundled native plugin descriptors and dispatch under `crates/crawclaw-native-plugins`.
- Provider metadata and native transport descriptors under `crates/crawclaw-providers`.
- Native channel contracts under `crates/crawclaw-channels`.

Production desktop packages must embed the Rust runtime binaries under
`runtime/crawclaw/bin/` and must not stage a public `crawclaw` CLI binary, a
default JavaScript plugin runtime, or a QuickJS fallback. The release check in
`crates/crawclaw-repo-tools` is the guardrail for that bundle shape and is exposed
through `pnpm desktop:tauri:stage-runtime` and
`pnpm desktop:tauri:release-check`.

Managed browser automation is also platform-scoped at staging time. The desktop
runtime copies only the host `agent-browser` binary into
`runtime/crawclaw/runtimes/browser/bin/` and records that selected platform,
architecture, and binary name in the runtime manifest. Do not copy the full npm
package bin directory or stage other platform binaries into the desktop bundle.

## Allowed TypeScript and JavaScript surfaces

The following TypeScript and JavaScript surfaces are allowed by design:

- `apps/crawclaw-desktop/src`: the React and Vite desktop renderer.
- `apps/crawclaw-desktop/vite.config.ts`: desktop renderer build configuration.

These surfaces should stay bounded. Do not use an allowed surface as a backdoor
to add a new production Gateway handler, desktop bridge, or default plugin
runtime in TypeScript.

## Migration candidates

Treat TypeScript or JavaScript as a migration candidate when it is on one of
these paths:

- It starts or handles production Gateway runtime behavior instead of delegating to `crates/crawclaw-gateway`.
- It executes default desktop tools instead of using `crates/crawclaw-runtime` or `crates/crawclaw-native-plugins`.
- It loads bundled plugin behavior through a Node runner for the default desktop product path.
- It registers model, speech, web, or media provider behavior outside the Rust provider/native plugin boundary.
- It exists only to preserve a legacy Electron desktop, public CLI, JavaScript plugin runtime, or QuickJS fallback surface.

When migrating one of these surfaces, prove the Rust path is live first. Then
delete the obsolete TypeScript or JavaScript implementation and its tests
together, instead of leaving a compatibility copy behind.

## Preferred cleanup order

1. Keep `cargo test -p crawclaw-runtime`, `cargo test -p crawclaw-providers`,
   and the desktop runtime release-check green.
2. Remove TypeScript or JavaScript only after a Rust/native path owns the same
   runtime behavior.
3. Keep the Rust plugin SDK and native plugin descriptors aligned when adding
   author-facing capability.
4. Move build and generation scripts to Rust only when it reduces release risk,
   package size, or maintenance cost. Script language alone is not a product
   runtime concern.

## How to answer Rustification audits

Do not answer Rustification progress by counting file extensions alone.

Use this split instead:

- Product runtime entrypoints: Rust/native.
- Desktop renderer: TypeScript/React by design.
- Plugin SDK: Rust crate `crawclaw-plugin-sdk`; JavaScript package exports are removed.
- Bundled plugin packages: mostly metadata shells with native manifests.
- Build and release tooling: Rust, shell, Go, or Python. Do not add new
  TypeScript/JavaScript repo automation.

This keeps the desktop product target separate from a full repository language
rewrite.
