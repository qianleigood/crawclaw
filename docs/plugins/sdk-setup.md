---
title: "Plugin Setup and Config"
sidebarTitle: "Setup and Config"
summary: "Setup wizards, config schemas, and package.json metadata"
read_when:
  - You are adding a setup wizard to a plugin
  - You are defining plugin config schemas or package.json crawclaw metadata
---

# Plugin Setup and Config

Reference for plugin packaging (`package.json` metadata), manifests
(`crawclaw.plugin.json`) and config schemas.

<Tip>
  **Looking for a walkthrough?** See [Provider Configuration](/plugins/sdk-provider-plugins).
</Tip>

## Package metadata

Your `package.json` may include a `crawclaw` field for install and publish
metadata. Runtime capabilities are declared in `crawclaw.plugin.json` and native
Rust descriptors, not executable package entries.

**Provider plugin / ClawHub publish baseline:**

```json crawclaw-clawhub-package.json
{
  "name": "@myorg/crawclaw-my-plugin",
  "version": "1.0.0",
  "type": "module",
  "crawclaw": {
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

| Field     | Type     | Description                                            |
| --------- | -------- | ------------------------------------------------------ |
| `compat`  | `object` | Publish compatibility metadata                         |
| `build`   | `object` | Publish build metadata                                 |
| `install` | `object` | Install hints: `npmSpec`, `localPath`, `defaultChoice` |

### Removed executable entries

<Warning>
  The old `crawclaw.extensions`, `crawclaw.setupEntry`, and deferred full-load
  channel paths were removed with the TypeScript plugin runtime. Native plugin
  setup, status, and capability surfaces are now owned by the Rust runtime.
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

- [SDK Entry Points](/plugins/sdk-entrypoints) -- current manifest and Rust native boundary
- [Plugin Manifest](/plugins/manifest) -- full manifest schema reference
- [Building Plugins](/plugins/building-plugins) -- step-by-step getting started guide
