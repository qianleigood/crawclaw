---
title: "Plugin SDK Overview"
sidebarTitle: "SDK Overview"
summary: "Rust native plugin SDK architecture"
read_when:
  - You need to author a native CrawClaw plugin
  - You are looking up the Rust plugin descriptor surface
  - You are checking the native plugin runtime boundary
---

# Plugin SDK Overview

CrawClaw's public plugin SDK is the Rust crate `crawclaw-plugin-sdk`.
The old JavaScript and TypeScript SDK package exports were removed. New plugins
should expose native descriptors and handle runtime calls through Rust-owned
JSON-RPC or Gateway methods.

<Warning>
  The npm package no longer exports JavaScript plugin SDK subpaths. Do not build
  new plugins around JavaScript SDK imports.
</Warning>

## Authoring surface

Use `crates/crawclaw-plugin-sdk` for the author-facing native types and helper
builders:

```rust
use crawclaw_plugin_sdk::{
    NativeInvocationTarget, NativePluginDescriptor, NativeToolDescriptor,
    NativeToolResultEnvelope,
};

let descriptor = NativePluginDescriptor::new("example")
    .name("Example")
    .description("Example native plugin")
    .tool(
        NativeToolDescriptor::new("lookup", NativeInvocationTarget::new("example", "lookup"))
            .label("Lookup")
            .description("Look up an item")
            .read_only(true),
    );

let result = NativeToolResultEnvelope::text("done");
```

These helpers wrap the existing native wire types. They do not change JSON
field names or the Gateway protocol shape.

## Runtime ownership

| Area                                          | Current owner                    |
| --------------------------------------------- | -------------------------------- |
| Manifest metadata                             | `crawclaw.plugin.json`           |
| Plugin descriptors                            | `crates/crawclaw-plugin-sdk`     |
| Bundled native plugin registry                | `crates/crawclaw-native-plugins` |
| Tools, services, providers, and Gateway calls | Rust runtime and Gateway crates  |
| Desktop packaged runtime                      | Native runtime binaries          |

TypeScript and JavaScript can still exist for build scripts, docs tooling,
tests, and the desktop renderer. They are not a public plugin authoring SDK.

## Descriptor helpers

The Rust SDK includes helpers for:

- Plugin descriptors
- Tool descriptors
- Invocation targets
- Tool result envelopes
- Approval policy metadata
- JSON-RPC success and error responses

If a new plugin-facing capability is needed, add an additive Rust SDK helper and
keep the serialized shape compatible with the current native protocol.

## Related

- [Getting Started](/plugins/building-plugins) -- manifest and native runtime setup
- [Runtime Boundary](/plugins/sdk-runtime) -- Rust-owned runtime model
- [Testing](/plugins/sdk-testing) -- Rust and contract test guidance
- [SDK Migration](/plugins/sdk-migration) -- migrating from removed JS SDK imports
- [Plugin Internals](/plugins/architecture) -- architecture and capability model
