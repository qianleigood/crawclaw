---
title: "Plugin Setup and Config"
sidebarTitle: "Setup and Config"
summary: "Setup metadata、config schemas 和 package.json metadata"
read_when:
  - 你正在向 plugin 添加 setup metadata
  - 你正在定义 plugin config schemas 或 package.json crawclaw metadata
x-i18n:
  generated_at: "2026-06-10T11:33:25Z"
  model: codex
  provider: openai
  source_hash: 58ac14a826cfb06c7218689891a4a25c746a057b573e4b2bcf77a7d01378c1b7
  source_path: plugins/sdk-setup.md
  workflow: 15
---

# Plugin Setup and Config

这是 plugin packaging（`package.json` metadata）、manifests（`crawclaw.plugin.json`）和 config schemas 的参考。

<Tip>
  **想找 walkthrough？** 参见 [Provider Configuration](/plugins/sdk-provider-plugins)。
</Tip>

## Package metadata

你的 `package.json` 可以包含 `crawclaw` field，用于 install 和 publish metadata。Runtime capabilities 在 `crawclaw.plugin.json` 和 native Rust descriptors 中声明，不在 executable package entries 中声明。

**Provider plugin / ClawHub publish baseline：**

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

如果你在 ClawHub 外部发布 plugin，这些 `compat` 和 `build` fields 是必需的。Canonical publish snippets 位于 `docs/snippets/plugin-publish/`。

### `crawclaw` fields

| Field     | Type     | Description                                            |
| --------- | -------- | ------------------------------------------------------ |
| `compat`  | `object` | Publish compatibility metadata                         |
| `build`   | `object` | Publish build metadata                                 |
| `install` | `object` | Install hints: `npmSpec`, `localPath`, `defaultChoice` |

### Removed executable entries

<Warning>
  旧 `crawclaw.extensions`、`crawclaw.setupEntry` 和 deferred full-load
  channel paths 已随 TypeScript plugin runtime 移除。Native plugin setup、status
  和 capability surfaces 现在由 Rust runtime 拥有。
</Warning>

## Plugin manifest

每个 native plugin 都必须在 package root 中包含 `crawclaw.plugin.json`。CrawClaw 使用它在不执行 plugin code 的情况下验证 config。

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

即使 plugin 没有 config，也必须提供 schema。空 schema 是有效的：

```json
{
  "id": "my-plugin",
  "configSchema": {
    "type": "object",
    "additionalProperties": false
  }
}
```

完整 schema reference 参见 [Plugin Manifest](/plugins/manifest)。

## ClawHub publishing

对于 plugin packages，使用 package-specific ClawHub command：

```bash
clawhub package publish your-org/your-plugin --dry-run
clawhub package publish your-org/your-plugin
```

legacy skill-only publish alias 用于 skills。Plugin packages 应始终使用 `clawhub package publish`。

## Config schema

Plugin config 会根据 manifest 中的 JSON Schema 验证。Users 通过以下方式配置 plugins：

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

你的 plugin 会在 registration 期间以 `api.pluginConfig` 接收此 config。

Channel-specific TypeScript setup helpers 已移除。未来的 channel plugins 应使用 Rust-native channel plugin contract。

## Publishing and installing

**External plugins:** 发布到 [ClawHub](/tools/clawhub) 或 npm，然后安装：

打开 CrawClaw Desktop -> Plugins -> Install plugin，粘贴 ClawHub 或 npm package spec。自动化应调用 Gateway RPC `plugins.install`，将 `raw` 设为同一个 spec，然后用 `plugins.list`、`plugins.update` 或 `plugins.uninstall` 做 inventory 和 lifecycle 管理。

CrawClaw 会先尝试 ClawHub，然后自动 fallback 到 npm。你也可以强制指定 source：

使用 `clawhub:<pkg>` 指定 ClawHub package，使用 `clawhubSpec` 做 ClawHub-only 自动化，使用 `spec`/`npmSpec` 做 npm resolution，或在 `raw` 中传入本地目录/archive path 作为 local source。npm install 需要记录 resolved version 时，添加 `pin: true`。

**In-repo plugins:** 放在 bundled plugin workspace tree 下，build 时会自动发现。

**Users can browse and install:**

CrawClaw Desktop 会在 Plugins view 中展示 installed、bundled 和 marketplace-backed plugins。Headless clients 应调用 `plugins.list` 展示 inventory，并用 `plugins.install` 执行安装；chat-native environments 可以启用 `commands.plugins` 并使用 `/plugin install <spec>`。

<Info>
  对于 npm-sourced installs，CrawClaw Desktop 或本地 Gateway API 会运行
  `npm install --ignore-scripts`（无 lifecycle scripts）。保持 plugin dependency
  trees 为 pure JS/TS，避免依赖需要 `postinstall` builds 的 packages。
</Info>

## Related

- [SDK Entry Points](/plugins/sdk-entrypoints) -- 当前 manifest 和 Rust native boundary
- [Plugin Manifest](/plugins/manifest) -- 完整 manifest schema reference
- [Building Plugins](/plugins/building-plugins) -- step-by-step getting started guide
