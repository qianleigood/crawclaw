---
read_when:
  - 你正在构建 CrawClaw 插件
  - 你需要发布插件配置 schema 或调试插件验证错误
summary: 插件清单 + JSON Schema 要求（严格的配置验证）
title: 插件清单
x-i18n:
  generated_at: "2026-06-05T14:42:26Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 59cac679ae25323497d5d3d32eafc08c99b1d94bc1e329f8c7f2b4b695d53b1a
  source_path: plugins/manifest.md
  workflow: 15
---

# 插件清单（crawclaw.plugin.json）

本页仅适用于**原生 CrawClaw 插件清单**。

每个原生 CrawClaw 插件**必须**在**插件根目录**中包含一个 `crawclaw.plugin.json` 文件。CrawClaw 使用此清单在**不执行插件代码**的情况下验证配置。缺少或无效的清单被视为插件错误，并阻止配置验证。

参见完整插件系统指南：[Plugins](/tools/plugin)。
有关原生能力模型和当前外部兼容性指导：[能力模型](/plugins/architecture#public-capability-model)。

## 此文件的作用

`crawclaw.plugin.json` 是 CrawClaw 在加载插件代码之前读取的元数据。

用于：

- 插件身份
- 配置验证
- 认证和入门元数据，应在引导插件运行时之前可用
- 用于捆绑兼容性接线和合约覆盖的静态能力所有权快照
- 配置 UI 提示

不用于：

- 注册运行时行为
- 声明代码入口点
- npm 安装元数据

这些属于你的插件代码和 `package.json`。

## 最小示例

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

## 丰富示例

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

## 顶层字段参考

| 字段                  | 必填 | 类型                       | 含义                                                                     |
| --------------------- | ---- | -------------------------- | ------------------------------------------------------------------------ |
| `id`                  | 是   | `string`                   | 规范插件 ID。这是在 `plugins.entries.<id>` 中使用的 ID。                 |
| `configSchema`        | 是   | `object`                   | 此插件配置的內联 JSON Schema。                                           |
| `native`              | 否   | `object`                   | 原生 sidecar 发现元数据。能力权威仍来自 Rust 原生描述符。                |
| `enabledByDefault`    | 否   | `true`                     | 将捆绑插件标记为默认启用。省略或设置为任何非 `true` 值，使插件默认禁用。 |
| `kind`                | 否   | `"memory"`                 | 声明 `plugins.slots.memory` 使用的独占内存插件类型。                     |
| `channels`            | 否   | `string[]`                 | 此插件拥有的渠道 ID。用于发现和配置验证。                                |
| `providers`           | 否   | `string[]`                 | 此插件拥有的提供商 ID。                                                  |
| `providerAuthEnvVars` | 否   | `Record<string, string[]>` | 便宜的提供商认证 env 元数据，CrawClaw 无需加载插件代码即可检查。         |
| `providerAuthChoices` | 否   | `object[]`                 | 用于入门和 UI 设置界面的便宜的提供商设置元数据。                         |
| `contracts`           | 否   | `object`                   | 用于语音、Web 搜索和工具所有权的静态捆绑能力快照。                       |
| `skills`              | 否   | `string[]`                 | 要加载的 Skill 目录，相对于插件根目录。                                  |
| `name`                | 否   | `string`                   | 人类可读的插件名称。                                                     |
| `description`         | 否   | `string`                   | 在插件界面显示的简短摘要。                                               |
| `version`             | 否   | `string`                   | 信息性插件版本。                                                         |
| `uiHints`             | 否   | `Record<string, object>`   | 配置字段的 UI 标签、占位符和敏感性提示。                                 |

## providerAuthChoices 参考

每个 `providerAuthChoices` 条目描述一个提供商设置选项。
CrawClaw 在提供商运行时加载之前读取此内容。

| 字段               | 必填 | 类型                      | 含义                                                                    |
| ------------------ | ---- | ------------------------- | ----------------------------------------------------------------------- |
| `provider`         | 是   | `string`                  | 此选项所属的提供商 ID。                                                 |
| `method`           | 是   | `string`                  | 要分发的认证方法 ID。                                                   |
| `choiceId`         | 是   | `string`                  | 入门和 UI 设置流程使用的稳定设置选项 ID。                               |
| `choiceLabel`      | 否   | `string`                  | 用户面向的标签。如果省略，CrawClaw 回退到 `choiceId`。                  |
| `choiceHint`       | 否   | `string`                  | 选择器的简短辅助文本。                                                  |
| `groupId`          | 否   | `string`                  | 用于对相关选项进行分组的可选组 ID。                                     |
| `groupLabel`       | 否   | `string`                  | 该组的用户面向标签。                                                    |
| `groupHint`        | 否   | `string`                  | 该组的简短辅助文本。                                                    |
| `onboardingScopes` | 否   | `Array<"text-inference">` | 此选项应出现在哪些入门界面中。如果省略，默认值为 `["text-inference"]`。 |

## uiHints 参考

`uiHints` 是从配置字段名到小渲染提示的映射。

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

每个字段提示可以包含：

| 字段          | 类型       | 含义                     |
| ------------- | ---------- | ------------------------ |
| `label`       | `string`   | 用户面向的字段标签。     |
| `help`        | `string`   | 简短辅助文本。           |
| `tags`        | `string[]` | 可选的 UI 标签。         |
| `advanced`    | `boolean`  | 将字段标记为高级。       |
| `sensitive`   | `boolean`  | 将字段标记为机密或敏感。 |
| `placeholder` | `string`   | 表单输入的占位符文本。   |

## contracts 参考

仅将 `contracts` 用于 CrawClaw 无需导入插件运行时即可读取的静态能力所有权元数据。

```json
{
  "contracts": {
    "webSearchProviders": ["gemini"],
    "tools": []
  }
}
```

每个列表都是可选的：

| 字段                 | 类型       | 含义                                           |
| -------------------- | ---------- | ---------------------------------------------- |
| `webSearchProviders` | `string[]` | 此插件拥有的 Web 搜索提供商 ID。               |
| `tools`              | `string[]` | 此插件拥有的智能体工具名称，用于捆绑合约检查。 |

## 原生 sidecar 发现

原生插件使用清单仅用于发现原生进程。Rust SDK 返回的原生描述符是工具、服务、提供商和主机回调的权威。

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

`native` 支持以下字段：

| 字段            | 必填 | 类型       | 含义                                      |
| --------------- | ---- | ---------- | ----------------------------------------- |
| `protocol`      | 是   | `string`   | 必须是 `crawclaw-native-plugin-jsonrpc`。 |
| `schemaVersion` | 是   | `1`        | 此主机理解的描述符 schema 版本。          |
| `bin`           | 否   | `string`   | 从原生运行时目录解析的二进制名称。        |
| `command`       | 否   | `string[]` | 用于第三方 sidecar 的显式命令 argv。      |

设置 `bin` 或 `command` 之一。`package.json` 可执行条目不再加载；将运行时能力所有权保留在原生描述符中。将 `contracts` 保留为兼容性检查的廉价静态快照；不要将其视为运行时能力权威。

## 清单与 package.json

两个文件服务于不同的工作：

| 文件                   | 用于                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| `crawclaw.plugin.json` | 发现、配置验证、提供商设置元数据和在插件代码运行之前必须存在的 UI 提示 |
| `package.json`         | npm 元数据、依赖安装和用于入口点和设置或目录元数据的 `crawclaw` 块     |

如果你不确定某条元数据应放在哪里，请使用此规则：

- 如果 CrawClaw 必须在加载插件代码之前知道它，请将其放在 `crawclaw.plugin.json` 中
- 如果它是关于打包、入口文件或 npm install 行为的，请将其放在 `package.json` 中

渠道包元数据也可以指向 `crawclaw.channel` 下的微小公共状态探测：

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

使用 `configuredState` 进行廉价的 env/配置存在检查，使用 `persistedAuthState` 进行本地登录工件（如 QR 或 OAuth 状态）。这些工件必须保持轻量级，且不得导入完整的渠道运行时。

## JSON Schema 要求

- **每个插件必须发布一个 JSON Schema**，即使它不接受任何配置。
- 可以接受空 schema（例如，`{ "type": "object", "additionalProperties": false }`）。
- Schema 在配置读取/写入时验证，而非在运行时。

## 验证行为

- 未知的 `channels.*` 键是**错误**，除非该渠道 ID 由插件清单声明。
- `plugins.entries.<id>`、`plugins.allow`、`plugins.deny` 和 `plugins.slots.*` 必须引用**可发现的**插件 ID。未知的 ID 是**错误**。
- 如果插件已安装但清单或 schema 损坏或缺失，验证失败，Doctor 报告插件错误。
- 如果插件配置存在但插件**被禁用**，配置被保留，Doctor + 日志中显示**警告**。

有关完整的 `plugins.*` schema，请参阅[配置参考](/gateway/configuration)。

## 注意事项

- 清单**对原生 CrawClaw 插件是必需的**，包括本地文件系统加载。
- 运行时仍单独加载插件模块；清单仅用于发现 + 验证。
- 清单加载器只读取文档化的清单字段。避免在此处添加自定义顶层键。
- `providerAuthEnvVars` 是用于认证探测、env 标记验证以及类似提供商认证界面的廉价元数据路径，这些界面不应仅仅为了检查 env 名称而引导插件运行时。
- `providerAuthChoices` 是不加载插件运行时的情况下用于提供商设置选择器的廉价元数据路径。模型提供商运行时钩子已被移除；提供商配置和目录元数据由 Rust 提供商注册表拥有。
- 独占插件类型通过 `plugins.slots.*` 选择。
  - `kind: "memory"` 是唯一支持的独占插件类型。
  - 旧的 `kind: "context-engine"` 清单被加载器拒绝。
- 当插件不需要 `channels`、`providers` 和 `skills` 时可以省略。
- 如果你的插件依赖原生模块，请记录构建步骤和任何包管理器允许列表要求（例如，pnpm `allow-build-scripts` - `pnpm rebuild <package>`）。

## 相关

- [构建插件](/plugins/building-plugins) — 插件入门
- [插件架构](/plugins/architecture) — 内部架构
- [SDK 概览](/plugins/sdk-overview) — Rust SDK 参考
