---
title: "Plugin Entry Points"
sidebarTitle: "Entry Points"
summary: "Reference for definePluginEntry and plugin registration modes"
read_when:
  - You need the exact type signature of definePluginEntry
  - You want to understand registration mode (full vs setup vs CLI metadata)
  - You are looking up entry point options
---

# Plugin Entry Points

Every TypeScript plugin exports a default entry object. The SDK provides
`definePluginEntry` for provider, tool, hook, command, service, speech, media,
and web plugins.

<Tip>
  **Looking for a walkthrough?** See [Provider Configuration](/plugins/sdk-provider-plugins)
  for model setup.
</Tip>

## `definePluginEntry`

**Import:** `crawclaw/plugin-sdk/plugin-entry`

For tool plugins, service plugins, local process backends, providers, and other
non-channel capabilities.

```typescript
import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "my-plugin",
  name: "My Plugin",
  description: "Short summary",
  register(api) {
    api.registerTool({
      /* ... */
    });
  },
});
```

| Field          | Type                                                             | Required | Default             |
| -------------- | ---------------------------------------------------------------- | -------- | ------------------- |
| `id`           | `string`                                                         | Yes      | —                   |
| `name`         | `string`                                                         | Yes      | —                   |
| `description`  | `string`                                                         | Yes      | —                   |
| `kind`         | `string`                                                         | No       | —                   |
| `configSchema` | `CrawClawPluginConfigSchema \| () => CrawClawPluginConfigSchema` | No       | Empty object schema |
| `register`     | `(api: CrawClawPluginApi) => void`                               | Yes      | —                   |

- `id` must match your `crawclaw.plugin.json` manifest.
- `kind` is for the exclusive memory slot: `"memory"`.
- `configSchema` can be a function for lazy evaluation.

## Channel Adapters

TypeScript channel entry helpers have been removed from the production SDK.
Channels are implemented as Rust-native adapters.

## Registration mode

`api.registrationMode` tells your plugin how it was loaded:

| Mode     | When                   | What to register |
| -------- | ---------------------- | ---------------- |
| `"full"` | Normal gateway startup | Everything       |

For CLI registrars specifically:

- use `descriptors` when the registrar owns one or more root commands and you
  want CrawClaw to lazy-load the real CLI module on first invocation
- make sure those descriptors cover every top-level command root exposed by the
  registrar
- use `commands` alone only for eager compatibility paths

## Plugin shapes

CrawClaw classifies loaded plugins by their registration behavior:

| Shape                 | Description                                     |
| --------------------- | ----------------------------------------------- |
| **plain-capability**  | One capability type (e.g. channel-only)         |
| **hybrid-capability** | Multiple capability types (e.g. speech + media) |
| **non-capability**    | Tools/commands/services but no capabilities     |

Use CrawClaw Desktop or the local Gateway API to see a plugin's shape.

## Related

- [SDK Overview](/plugins/sdk-overview) — registration API and subpath reference
- [Runtime Helpers](/plugins/sdk-runtime) — `api.runtime` and `createPluginRuntimeStore`
- [Setup and Config](/plugins/sdk-setup) — manifest, setup entry, deferred loading
- [Provider Configuration](/plugins/sdk-provider-plugins) — Rust-owned providers and `models.providers`
