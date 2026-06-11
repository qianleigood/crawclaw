---
read_when:
  - 你想在 CrawClaw 中使用 GLM 模型
  - 你需要模型命名约定和设置
summary: GLM 模型系列概述 + 如何在 CrawClaw 中使用
title: GLM 模型
x-i18n:
  generated_at: "2026-06-05T14:43:26Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: b29d5552a7ad5564071e8f3d8c70d0e43fb246ee0b572ce35aa0714ca1fd8143
  source_path: providers/glm.md
  workflow: 15
---

# GLM 模型

GLM 是一个**模型系列**（不是公司），可通过 Z.AI 平台访问。在 CrawClaw 中，GLM 模型通过 `zai` 提供商和模型 ID（如 `zai/glm-5`）访问。

## Desktop 设置

在 CrawClaw Desktop 中使用 Z.AI provider setup：打开 **Settings → Models and
replies → Add model**，选择 Z.AI，粘贴 API key，并保存需要的 `zai/glm-*` model
profile。连接 probe 通过后，Desktop 会把 key 存为本地 file SecretRef。

在 headless hosts 上，将 `ZAI_API_KEY` 设到 Gateway environment，或用
`config.patch` 将 `models.providers.zai.apiKey` patch 为 `env`、`file` 或
`exec` SecretRef。

## 配置片段

```json5
{
  env: { ZAI_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "zai/glm-5" } } },
}
```

## 注意事项

- GLM 版本和可用性可能会发生变化；请查看 Z.AI 文档了解最新信息。
- 示例模型 ID 包括 `glm-5.1`、`glm-5`、`glm-5v-turbo`、`glm-4.7` 和 `glm-4.6`。
- 有关提供商详情，请参阅 [/providers/zai](/providers/zai)。
