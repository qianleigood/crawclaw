---
title: "Plugin Setup and Config"
sidebarTitle: "Setup and Config"
summary: "Setup wizards, setup-entry.ts, config schemas, and package.json metadata"
read_when:
  - You are adding a setup wizard to a plugin
  - You need to understand setup-entry.ts vs index.ts
  - You are defining plugin config schemas or package.json crawclaw metadata
---

# Plugin Setup and Config

Reference for plugin packaging (`package.json` metadata), manifests
(`crawclaw.plugin.json`), setup entries, and config schemas.

<Tip>
  **Looking for a walkthrough?** The how-to guides cover packaging in context:
  [Channel Plugins](/plugins/sdk-channel-plugins#step-1-package-and-manifest) and
  [Provider Plugins](/plugins/sdk-provider-plugins#step-1-package-and-manifest).
</Tip>

## Package metadata

Your `package.json` needs an `crawclaw` field that tells the plugin system what
your plugin provides:

**Channel plugin:**

```json
{
  "name": "@myorg/crawclaw-my-channel",
  "version": "1.0.0",
  "type": "module",
  "crawclaw": {
    "extensions": ["./index.ts"],
    "setupEntry": "./setup-entry.ts",
    "channel": {
      "id": "my-channel",
      "label": "My Channel",
      "blurb": "Short description of the channel."
    }
  }
}
```

**Provider plugin / ClawHub publish baseline:**

```json crawclaw-clawhub-package.json
{
  "name": "@myorg/crawclaw-my-plugin",
  "version": "1.0.0",
  "type": "module",
  "crawclaw": {
    "extensions": ["./index.ts"],
    "compat": {
      "pluginApi": ">=2026.3.24-beta.2",
      "minGatewayVersion": "2026.3.24-beta.2"
    },
    "build": {
      "crawclawVersion": "2026.3.24-beta.2",
      "pluginSdkVersion": "2026.3.24-beta.2"
    }
  }
}
```

If you publish the plugin externally on ClawHub, those `compat` and `build`
fields are required. The canonical publish snippets live in
`docs/snippets/plugin-publish/`.

### `crawclaw` fields

| Field        | Type       | Description                                                                                |
| ------------ | ---------- | ------------------------------------------------------------------------------------------ |
| `extensions` | `string[]` | Entry point files (relative to package root)                                               |
| `setupEntry` | `string`   | Lightweight setup-only entry (optional)                                                    |
| `channel`    | `object`   | Channel metadata: `id`, `label`, `blurb`, `selectionLabel`, `docsPath`, `order`, `aliases` |
| `providers`  | `string[]` | Provider ids registered by this plugin                                                     |
| `install`    | `object`   | Install hints: `npmSpec`, `localPath`, `defaultChoice`                                     |
| `startup`    | `object`   | Startup behavior flags                                                                     |

### Deferred full load

Channel plugins can opt into deferred loading with:

```json
{
  "crawclaw": {
    "extensions": ["./index.ts"],
    "setupEntry": "./setup-entry.ts",
    "startup": {
      "deferConfiguredChannelFullLoadUntilAfterListen": true
    }
  }
}
```

When enabled, CrawClaw loads only `setupEntry` during the pre-listen startup
phase, even for already-configured channels. The full entry loads after the
gateway starts listening.

<Warning>
  Only enable deferred loading when your `setupEntry` registers everything the
  gateway needs before it starts listening (channel registration, HTTP routes,
  gateway methods). If the full entry owns required startup capabilities, keep
  the default behavior.
</Warning>

## Plugin manifest

Every native plugin must ship an `crawclaw.plugin.json` in the package root.
CrawClaw uses this to validate config without executing plugin code.

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "Adds My Plugin capabilities to CrawClaw",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "webhookSecret": {
        "type": "string",
        "description": "Webhook verification secret"
      }
    }
  }
}
```

For channel plugins, add `kind` and `channels`:

```json
{
  "id": "my-channel",
  "kind": "channel",
  "channels": ["my-channel"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

Even plugins with no config must ship a schema. An empty schema is valid:

```json
{
  "id": "my-plugin",
  "configSchema": {
    "type": "object",
    "additionalProperties": false
  }
}
```

See [Plugin Manifest](/plugins/manifest) for the full schema reference.

## ClawHub publishing

For plugin packages, use the package-specific ClawHub command:

```bash
clawhub package publish your-org/your-plugin --dry-run
clawhub package publish your-org/your-plugin
```

The legacy skill-only publish alias is for skills. Plugin packages should
always use `clawhub package publish`.

## Setup entry

The `setup-entry.ts` file is a lightweight alternative to `index.ts` that
CrawClaw loads when it only needs setup surfaces (onboarding, config repair,
disabled channel inspection).

```typescript
// setup-entry.ts
import { defineSetupPluginEntry } from "crawclaw/plugin-sdk/core";
import { myChannelPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(myChannelPlugin);
```

This avoids loading heavy runtime code (crypto libraries, CLI registrations,
background services) during setup flows.

**When CrawClaw uses `setupEntry` instead of the full entry:**

- The channel is disabled but needs setup/onboarding surfaces
- The channel is enabled but unconfigured
- Deferred loading is enabled (`deferConfiguredChannelFullLoadUntilAfterListen`)

**What `setupEntry` must register:**

- The channel plugin object (via `defineSetupPluginEntry`)
- Any HTTP routes required before gateway listen
- Any gateway methods needed during startup

**What `setupEntry` should NOT include:**

- CLI registrations
- Background services
- Heavy runtime imports (crypto, SDKs)
- Gateway methods only needed after startup

## Config schema

Plugin config is validated against the JSON Schema in your manifest. Users
configure plugins via:

```json5
{
  plugins: {
    entries: {
      "my-plugin": {
        config: {
          webhookSecret: "abc123",
        },
      },
    },
  },
}
```

Your plugin receives this config as `api.pluginConfig` during registration.

Channel-specific TypeScript setup helpers have been removed. Future channel
plugins should use the Rust-native channel plugin contract.

## Publishing and installing

**External plugins:** publish to [ClawHub](/tools/clawhub) or npm, then install:

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

CrawClaw tries ClawHub first and falls back to npm automatically. You can also
force a specific source:

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

**In-repo plugins:** place under the bundled plugin workspace tree and they are automatically
discovered during build.

**Users can browse and install:**

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

<Info>
  For npm-sourced installs, CrawClaw Desktop or the local Gateway API runs
  `npm install --ignore-scripts` (no lifecycle scripts). Keep plugin dependency
  trees pure JS/TS and avoid packages that require `postinstall` builds.
</Info>

## Related

- [SDK Entry Points](/plugins/sdk-entrypoints) -- `definePluginEntry` and `defineChannelPluginEntry`
- [Plugin Manifest](/plugins/manifest) -- full manifest schema reference
- [Building Plugins](/plugins/building-plugins) -- step-by-step getting started guide
