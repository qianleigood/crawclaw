---
title: "Plugin Testing"
sidebarTitle: "Testing"
summary: "Testing patterns for CrawClaw native plugins"
read_when:
  - You are writing tests for a plugin
  - You need to validate Rust plugin descriptors
  - You want to understand contract tests for bundled plugins
---

# Plugin Testing

CrawClaw plugin runtime behavior is native-owned. Test the Rust SDK, native
plugin registry, and Gateway/runtime contracts instead of relying on removed
JavaScript SDK test helpers.

<Tip>
  Provider examples live in [Provider Configuration](/plugins/sdk-provider-plugins#step-6-test).
</Tip>

## Rust SDK tests

Run the SDK crate tests when changing plugin descriptor helpers:

```bash
cargo test -q -p crawclaw-plugin-sdk
```

These tests should prove that helper builders preserve the existing JSON wire
shape.

## Native plugin tests

Run native registry tests when adding or changing bundled plugin descriptors:

```bash
cargo test -q -p crawclaw-native-plugins
```

For runtime or Gateway-facing behavior, also run the owning crate tests:

```bash
cargo test -q -p crawclaw-runtime
cargo test -q -p crawclaw-gateway
```

## Repository contract tests

Bundled plugin contracts verify registration ownership and descriptor shape:

```bash
cargo test -q -p crawclaw-plugin-host
cargo test -q -p crawclaw-runtime native_plugin_registry
cargo test -q -p crawclaw-gateway plugins
```

These tests assert:

- Which plugins register which providers
- Which plugins register speech or media providers
- Registration shape correctness
- Runtime contract compliance
- Guardrails that keep the removed JavaScript plugin SDK and TypeScript test
  surfaces from returning

## Desktop packaging guard

The desktop app must not ship the removed JavaScript SDK runtime artifacts:

```bash
pnpm desktop:tauri:release-check
```

Run the release check when packaged app artifacts exist locally.

## Related

- [SDK Overview](/plugins/sdk-overview) -- Rust SDK overview
- [Provider Configuration](/plugins/sdk-provider-plugins) -- provider setup
- [Building Plugins](/plugins/building-plugins) -- getting started guide
