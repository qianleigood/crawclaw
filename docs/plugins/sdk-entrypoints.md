---
title: "Plugin Entry Points"
sidebarTitle: "Entry Points"
summary: "Current plugin entry boundary"
read_when:
  - You are checking whether TypeScript plugin entries are still supported
  - You want to understand how plugins are discovered
  - You are migrating an old TypeScript runtime plugin
---

# Plugin Entry Points

CrawClaw no longer loads executable TypeScript plugin entries in production.
Plugin discovery reads `crawclaw.plugin.json` and Rust native descriptors.

Old TypeScript entry files should be removed or converted to non-executing
package helpers. Runtime behavior belongs in Rust.

## Current discovery inputs

| Input                  | Purpose                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `crawclaw.plugin.json` | Plugin id, display metadata, configuration schema, and native descriptor |
| Rust native descriptor | Provider, tool, channel, service, hook, or capability runtime binding    |
| Generated SDK subpaths | Types and non-executing helpers for package integration                  |

## Runtime capabilities

Providers, tools, hooks, commands, services, channels, HTTP routes, and Gateway
methods are Rust-owned. Add or change those capabilities in the Rust crates, not
in a TypeScript entry callback.

## Related

- [SDK Overview](/plugins/sdk-overview) -- import map and SDK boundary
- [Runtime Boundary](/plugins/sdk-runtime) -- Rust-owned runtime model
- [Setup and Config](/plugins/sdk-setup) -- manifest, packaging, and config schema
- [Provider Configuration](/plugins/sdk-provider-plugins) -- Rust-owned providers and `models.providers`
