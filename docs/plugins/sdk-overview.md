---
title: "Plugin SDK Overview"
sidebarTitle: "SDK Overview"
summary: "Import map and SDK architecture"
read_when:
  - You need to know which SDK subpath to import from
  - You are looking up a specific SDK export
  - You are checking the Rust native plugin boundary
---

# Plugin SDK Overview

The public TypeScript plugin SDK is no longer a production execution surface.
Plugins declare metadata in `crawclaw.plugin.json`; providers, tools, services,
hooks, channels, and other runtime behavior are implemented in Rust and exposed
through native descriptors or Gateway methods.

<Tip>
  **Looking for a how-to guide?**
  - First plugin? Start with [Getting Started](/plugins/building-plugins)
  - Model provider config? See [Provider Configuration](/plugins/sdk-provider-plugins)
</Tip>

## Import convention

Only import focused helper subpaths when a package needs generated types or
non-executing utilities:

```typescript
import type { CrawClawConfig } from "crawclaw/plugin-sdk/testing";
```

Do not import the removed monolithic root package from plugin production code.

## Subpath reference

The full list of public subpaths is generated from
`scripts/lib/plugin-sdk-entrypoints.json`. The important boundary is:

| Area                                          | Current owner                      |
| --------------------------------------------- | ---------------------------------- |
| Manifest metadata                             | `crawclaw.plugin.json`             |
| Provider catalog and transport                | Rust provider registry             |
| Tools, hooks, commands, services, HTTP routes | Rust native runtime                |
| Channels and outbound delivery                | Rust native runtime                |
| TypeScript SDK helpers                        | Non-executing types/utilities only |

## Runtime capabilities

TypeScript plugins cannot register production runtime callbacks. Add new runtime
capabilities in Rust, then expose configuration through the manifest, Rust
native plugin registry, or typed Gateway RPCs.

## Internal module convention

Within a plugin package, use local files for package-private helpers. Do not
import your own package through `crawclaw/plugin-sdk/<your-plugin>`; SDK subpaths
are external contracts only.

## Related

- [Getting Started](/plugins/building-plugins) -- manifest and native runtime setup
- [Runtime Boundary](/plugins/sdk-runtime) -- Rust-owned runtime model
- [Setup and Config](/plugins/sdk-setup) -- packaging, manifests, config schemas
- [Testing](/plugins/sdk-testing) -- test utilities and lint rules
- [SDK Migration](/plugins/sdk-migration) -- migrating from deprecated surfaces
- [Plugin Internals](/plugins/architecture) -- deep architecture and capability model
