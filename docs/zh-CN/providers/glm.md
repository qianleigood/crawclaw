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
  source_hash: 973d2a12102cbc898e1984aa59e574796757d98146792af25b18c808f86a3e0f
  source_path: providers/glm.md
  workflow: 15
---

# GLM 模型

GLM 是一个**模型系列**（不是公司），可通过 Z.AI 平台访问。在 CrawClaw 中，GLM 模型通过 `zai` 提供商和模型 ID（如 `zai/glm-5`）访问。

## Desktop 设置

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

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
