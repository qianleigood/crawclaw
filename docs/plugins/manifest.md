---
summary: "Plugin manifest + JSON schema requirements (strict config validation)"
read_when:
  - You are building an CrawClaw plugin
  - You need to ship a plugin config schema or debug plugin validation errors
title: "Plugin Manifest"
---

# Plugin manifest (crawclaw.plugin.json)

This page is for the **native CrawClaw plugin manifest** only.

For compatible bundle layouts, see [Plugin bundles](/plugins/bundles).

Compatible bundle formats use different manifest files:

- Codex bundle: `.codex-plugin/plugin.json`
- Claude bundle: `.claude-plugin/plugin.json` or the default Claude component
  layout without a manifest
- Cursor bundle: `.cursor-plugin/plugin.json`

CrawClaw auto-detects those bundle layouts too, but they are not validated
against the `crawclaw.plugin.json` schema described here.

For compatible bundles, CrawClaw currently reads bundle metadata plus declared
skill roots, Claude command roots, Claude bundle `settings.json` defaults, and
supported hook packs when the layout matches CrawClaw runtime expectations.

Every native CrawClaw plugin **must** ship a `crawclaw.plugin.json` file in the
**plugin root**. CrawClaw uses this manifest to validate configuration
**without executing plugin code**. Missing or invalid manifests are treated as
plugin errors and block config validation.

See the full plugin system guide: [Plugins](/tools/plugin).
For the native capability model and current external-compatibility guidance:
[Capability model](/plugins/architecture#public-capability-model).

## What this file does

`crawclaw.plugin.json` is the metadata CrawClaw reads before it loads your
plugin code.

Use it for:

- plugin identity
- config validation
- auth and onboarding metadata that should be available without booting plugin
  runtime
- static capability ownership snapshots used for bundled compat wiring and
  contract coverage
- config UI hints

Do not use it for:

- registering runtime behavior
- declaring code entrypoints
- npm install metadata

Those belong in your plugin code and `package.json`.

## Minimal example

```json
{
  "id": "my-plugin",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

## Rich example

```json
{
  "id": "openrouter",
  "name": "OpenRouter",
  "description": "OpenRouter provider plugin",
  "version": "1.0.0",
  "providers": ["openrouter"],
  "providerAuthEnvVars": {
    "openrouter": ["OPENROUTER_API_KEY"]
  },
  "providerAuthChoices": [
    {
      "provider": "openrouter",
      "method": "api-key",
      "choiceId": "openrouter-api-key",
      "choiceLabel": "OpenRouter API key",
      "groupId": "openrouter",
      "groupLabel": "OpenRouter",
      "optionKey": "openrouterApiKey",
      "cliFlag": "--openrouter-api-key",
      "cliOption": "--openrouter-api-key <key>",
      "cliDescription": "OpenRouter API key",
      "onboardingScopes": ["text-inference"]
    }
  ],
  "uiHints": {
    "apiKey": {
      "label": "API key",
      "placeholder": "sk-or-v1-...",
      "sensitive": true
    }
  },
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "apiKey": {
        "type": "string"
      }
    }
  }
}
```

## Top-level field reference

| Field                 | Required | Type                       | What it means                                                                                                                |
| --------------------- | -------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | Yes      | `string`                   | Canonical plugin id. This is the id used in `plugins.entries.<id>`.                                                          |
| `configSchema`        | Yes      | `object`                   | Inline JSON Schema for this plugin's config.                                                                                 |
| `native`              | No       | `object`                   | Native sidecar discovery metadata. Capability authority still comes from the Rust native descriptor.                         |
| `enabledByDefault`    | No       | `true`                     | Marks a bundled plugin as enabled by default. Omit it, or set any non-`true` value, to leave the plugin disabled by default. |
| `kind`                | No       | `"memory"`                 | Declares the exclusive memory plugin kind used by `plugins.slots.memory`.                                                    |
| `channels`            | No       | `string[]`                 | Channel ids owned by this plugin. Used for discovery and config validation.                                                  |
| `providers`           | No       | `string[]`                 | Provider ids owned by this plugin.                                                                                           |
| `providerAuthEnvVars` | No       | `Record<string, string[]>` | Cheap provider-auth env metadata that CrawClaw can inspect without loading plugin code.                                      |
| `providerAuthChoices` | No       | `object[]`                 | Cheap auth-choice metadata for onboarding pickers, preferred-provider resolution, and simple CLI flag wiring.                |
| `contracts`           | No       | `object`                   | Static bundled capability snapshot for speech, web search, and tool ownership.                                               |
| `skills`              | No       | `string[]`                 | Skill directories to load, relative to the plugin root.                                                                      |
| `name`                | No       | `string`                   | Human-readable plugin name.                                                                                                  |
| `description`         | No       | `string`                   | Short summary shown in plugin surfaces.                                                                                      |
| `version`             | No       | `string`                   | Informational plugin version.                                                                                                |
| `uiHints`             | No       | `Record<string, object>`   | UI labels, placeholders, and sensitivity hints for config fields.                                                            |

## providerAuthChoices reference

Each `providerAuthChoices` entry describes one onboarding or auth choice.
CrawClaw reads this before provider runtime loads.

| Field              | Required | Type                      | What it means                                                                                            |
| ------------------ | -------- | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `provider`         | Yes      | `string`                  | Provider id this choice belongs to.                                                                      |
| `method`           | Yes      | `string`                  | Auth method id to dispatch to.                                                                           |
| `choiceId`         | Yes      | `string`                  | Stable auth-choice id used by onboarding and CLI flows.                                                  |
| `choiceLabel`      | No       | `string`                  | User-facing label. If omitted, CrawClaw falls back to `choiceId`.                                        |
| `choiceHint`       | No       | `string`                  | Short helper text for the picker.                                                                        |
| `groupId`          | No       | `string`                  | Optional group id for grouping related choices.                                                          |
| `groupLabel`       | No       | `string`                  | User-facing label for that group.                                                                        |
| `groupHint`        | No       | `string`                  | Short helper text for the group.                                                                         |
| `optionKey`        | No       | `string`                  | Internal option key for simple one-flag auth flows.                                                      |
| `cliFlag`          | No       | `string`                  | CLI flag name, such as `--openrouter-api-key`.                                                           |
| `cliOption`        | No       | `string`                  | Full CLI option shape, such as `--openrouter-api-key <key>`.                                             |
| `cliDescription`   | No       | `string`                  | Description used in CLI help.                                                                            |
| `onboardingScopes` | No       | `Array<"text-inference">` | Which onboarding surfaces this choice should appear in. If omitted, it defaults to `["text-inference"]`. |

## uiHints reference

`uiHints` is a map from config field names to small rendering hints.

```json
{
  "uiHints": {
    "apiKey": {
      "label": "API key",
      "help": "Used for OpenRouter requests",
      "placeholder": "sk-or-v1-...",
      "sensitive": true
    }
  }
}
```

Each field hint can include:

| Field         | Type       | What it means                           |
| ------------- | ---------- | --------------------------------------- |
| `label`       | `string`   | User-facing field label.                |
| `help`        | `string`   | Short helper text.                      |
| `tags`        | `string[]` | Optional UI tags.                       |
| `advanced`    | `boolean`  | Marks the field as advanced.            |
| `sensitive`   | `boolean`  | Marks the field as secret or sensitive. |
| `placeholder` | `string`   | Placeholder text for form inputs.       |

## contracts reference

Use `contracts` only for static capability ownership metadata that CrawClaw can
read without importing the plugin runtime.

```json
{
  "contracts": {
    "speechProviders": ["openai"],
    "webSearchProviders": ["gemini"],
    "tools": []
  }
}
```

Each list is optional:

| Field                | Type       | What it means                                                  |
| -------------------- | ---------- | -------------------------------------------------------------- |
| `speechProviders`    | `string[]` | Speech provider ids this plugin owns.                          |
| `webSearchProviders` | `string[]` | Web-search provider ids this plugin owns.                      |
| `tools`              | `string[]` | Agent tool names this plugin owns for bundled contract checks. |

Legacy top-level `speechProviders` is deprecated. Use CrawClaw Desktop or the local
Gateway API to move it under `contracts`; normal manifest loading no longer treats
top-level legacy fields as capability ownership. Legacy `mediaUnderstandingProviders`
is removed and no longer has a `contracts` replacement.

## Native sidecar discovery

Native plugins use the manifest only to discover the native process. The native
descriptor returned by the Rust SDK is the authority for tools, services,
providers, and host callbacks.

```json
{
  "id": "acme-native",
  "native": {
    "protocol": "crawclaw-native-plugin-jsonrpc",
    "schemaVersion": 1,
    "bin": "acme-native-plugin"
  },
  "contracts": {
    "tools": ["acme_tool"]
  },
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

`native` supports these fields:

| Field           | Required | Type       | What it means                                           |
| --------------- | -------- | ---------- | ------------------------------------------------------- |
| `protocol`      | Yes      | `string`   | Must be `crawclaw-native-plugin-jsonrpc`.               |
| `schemaVersion` | Yes      | `1`        | Descriptor schema version understood by this host.      |
| `bin`           | No       | `string`   | Binary name resolved from the native runtime directory. |
| `command`       | No       | `string[]` | Explicit command argv for third-party sidecars.         |

Set either `bin` or `command`. `package.json` executable entries are no longer
loaded; keep runtime capability ownership in the native descriptor. Keep
`contracts` as a cheap static snapshot for compatibility checks; do not treat it
as the runtime capability authority.

## Manifest versus package.json

The two files serve different jobs:

| File                   | Use it for                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `crawclaw.plugin.json` | Discovery, config validation, auth-choice metadata, and UI hints that must exist before plugin code runs           |
| `package.json`         | npm metadata, dependency installation, and the `crawclaw` block used for entrypoints and setup or catalog metadata |

If you are unsure where a piece of metadata belongs, use this rule:

- if CrawClaw must know it before loading plugin code, put it in `crawclaw.plugin.json`
- if it is about packaging, entry files, or npm install behavior, put it in `package.json`

Channel package metadata can also point to tiny public state probes under
`crawclaw.channel`:

```json
{
  "crawclaw": {
    "channel": {
      "id": "acme-chat",
      "configuredState": {
        "specifier": "./configured-state",
        "exportName": "hasAcmeChatConfiguredState"
      },
      "persistedAuthState": {
        "specifier": "./auth-presence",
        "exportName": "hasAnyAcmeChatAuth"
      }
    }
  }
}
```

Use `configuredState` for cheap env/config presence and `persistedAuthState`
for local login artifacts such as QR or OAuth state. These artifacts must stay
lightweight and must not import the full channel runtime.

## JSON Schema requirements

- **Every plugin must ship a JSON Schema**, even if it accepts no config.
- An empty schema is acceptable (for example, `{ "type": "object", "additionalProperties": false }`).
- Schemas are validated at config read/write time, not at runtime.

## Validation behavior

- Unknown `channels.*` keys are **errors**, unless the channel id is declared by
  a plugin manifest.
- `plugins.entries.<id>`, `plugins.allow`, `plugins.deny`, and `plugins.slots.*`
  must reference **discoverable** plugin ids. Unknown ids are **errors**.
- If a plugin is installed but has a broken or missing manifest or schema,
  validation fails and Doctor reports the plugin error.
- If plugin config exists but the plugin is **disabled**, the config is kept and
  a **warning** is surfaced in Doctor + logs.

See [Configuration reference](/gateway/configuration) for the full `plugins.*` schema.

## Notes

- The manifest is **required for native CrawClaw plugins**, including local filesystem loads.
- Runtime still loads the plugin module separately; the manifest is only for
  discovery + validation.
- Only documented manifest fields are read by the manifest loader. Avoid adding
  custom top-level keys here.
- `providerAuthEnvVars` is the cheap metadata path for auth probes, env-marker
  validation, and similar provider-auth surfaces that should not boot plugin
  runtime just to inspect env names.
- `providerAuthChoices` is the cheap metadata path for auth-choice pickers,
  `--auth-choice` resolution, preferred-provider mapping, and simple onboarding
  CLI flag registration without loading plugin runtime. Model provider runtime
  hooks have been removed; provider config and catalog metadata are owned by the
  Rust provider registry.
- Exclusive plugin kinds are selected through `plugins.slots.*`.
  - `kind: "memory"` is the only supported exclusive plugin kind.
  - Legacy `kind: "context-engine"` manifests are rejected by the loader.
- `channels`, `providers`, and `skills` can be omitted when a plugin does not
  need them.
- If your plugin depends on native modules, document the build steps and any
  package-manager allowlist requirements (for example, pnpm `allow-build-scripts`
  - `pnpm rebuild <package>`).

## Related

- [Building Plugins](/plugins/building-plugins) — getting started with plugins
- [Plugin Architecture](/plugins/architecture) — internal architecture
- [SDK Overview](/plugins/sdk-overview) — Rust SDK reference
