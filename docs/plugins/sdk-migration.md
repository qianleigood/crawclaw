---
title: "Plugin SDK Migration"
sidebarTitle: "Migrate to SDK"
summary: "Migrate from removed JavaScript SDK imports to the Rust plugin SDK"
read_when:
  - You see a module-not-found error for removed JavaScript plugin SDK imports
  - You see a module-not-found error for crawclaw/extension-api
  - You are updating a plugin to the native plugin architecture
  - You maintain an external CrawClaw plugin
---

# Plugin SDK Migration

CrawClaw removed the public JavaScript and TypeScript plugin SDK exports. The
supported plugin authoring surface is now the Rust crate
`crawclaw-plugin-sdk`, plus plugin manifests and native runtime descriptors.

## What changed

The npm package no longer exports JavaScript plugin SDK subpaths or compatibility
bridges. Plugins that import those removed paths will fail to load on current
CrawClaw versions.

The old helper files are no longer a runtime bridge or public SDK. Current
packages should rely on manifests plus Rust native descriptors.

## How to migrate

<Steps>
  <Step title="Find removed imports">
    Search your plugin for old JavaScript SDK and extension bridge imports:

    ```bash
    rg "crawclaw/plugin-sdk|crawclaw/extension-api" my-plugin/
    ```

  </Step>

  <Step title="Move runtime behavior to Rust">
    Define plugin metadata with `NativePluginDescriptor` and capability helpers
    from `crawclaw-plugin-sdk`.

    ```rust
    use crawclaw_plugin_sdk::{
        NativeInvocationTarget, NativePluginDescriptor, NativeToolDescriptor,
    };

    let descriptor = NativePluginDescriptor::new("my-plugin").tool(
        NativeToolDescriptor::new(
            "run",
            NativeInvocationTarget::new("my-plugin", "run"),
        ),
    );
    ```

  </Step>

  <Step title="Keep manifest metadata explicit">
    Keep install, setup, and capability metadata in `crawclaw.plugin.json` and
    package metadata. Do not depend on JavaScript module execution for discovery.
  </Step>

  <Step title="Test the native surface">
    ```bash
    cargo test -q -p crawclaw-plugin-sdk
    cargo test -q -p crawclaw-native-plugins
    cargo test -q -p crawclaw-runtime
    cargo test -q -p crawclaw-gateway
    ```
  </Step>
</Steps>

## Removal timeline

| When    | What happens                                                          |
| ------- | --------------------------------------------------------------------- |
| Current | JavaScript plugin SDK exports are removed from the npm package        |
| Current | Desktop packages reject JavaScript plugin SDK runtime artifacts       |
| Current | New public plugin-facing helpers must be added to the Rust plugin SDK |

## Related

- [Getting Started](/plugins/building-plugins) -- build a native plugin
- [SDK Overview](/plugins/sdk-overview) -- Rust SDK reference
- [Provider Configuration](/plugins/sdk-provider-plugins) -- Rust-owned provider setup
- [Plugin Internals](/plugins/architecture) -- architecture deep dive
- [Plugin Manifest](/plugins/manifest) -- manifest schema reference
