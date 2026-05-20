---
title: "Plugin Runtime Boundary"
sidebarTitle: "Runtime Boundary"
summary: "Rust-owned plugin runtime model"
read_when:
  - You need to call runtime behavior from a plugin
  - You want to understand where provider, tool, hook, or channel code runs
  - You are migrating old TypeScript plugin runtime code
---

# Plugin Runtime Boundary

Production plugin runtime behavior is Rust-owned. CrawClaw does not inject a
TypeScript runtime object into plugin entries, and TypeScript plugins cannot
register tools, hooks, commands, services, providers, channels, HTTP routes, or
Gateway methods.

## Where runtime behavior lives

| Runtime area                                                        | Owner                              |
| ------------------------------------------------------------------- | ---------------------------------- |
| Agent turns and special agents                                      | Rust runtime                       |
| Cron, auto-reply, command execution, and memory jobs                | Rust runtime                       |
| Provider catalog, model list, config schema, and provider transport | Rust provider registry             |
| Tools and workflows                                                 | Rust runtime or Rust native plugin |
| Channels and outbound delivery                                      | Rust channel runtime               |
| Plugin hooks and lifecycle events                                   | Rust event bus                     |

## Plugin package boundary

A plugin package may still include package metadata and generated artifacts, but
that code is not a production execution bridge. The production contract is the
manifest plus any Rust native descriptor declared by the manifest.

## Adding a runtime capability

1. Add the capability implementation in the owning Rust crate.
2. Expose the capability through the Rust native plugin registry or a typed
   Gateway RPC.
3. Add manifest/config schema metadata in `crawclaw.plugin.json`.
4. Update generated SDK/config baselines and docs.

## Related

- [SDK Overview](/plugins/sdk-overview) -- import map and SDK boundary
- [Plugin Entry Points](/plugins/sdk-entrypoints) -- current discovery inputs
- [Plugin Internals](/plugins/architecture) -- architecture and capability model
