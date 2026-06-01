---
read_when:
  - 你想在 CrawClaw 中使用 GLM 模型
  - 你需要了解模型命名约定和设置方法
summary: GLM 模型家族概览 + 如何在 CrawClaw 中使用
title: GLM Models
x-i18n:
  generated_at: "2026-03-16T06:25:10Z"
  model: gpt-5.4
  provider: openai
  source_hash: 061254ebeedec7285d9c0c6e88145f89184ad4ab8d8d6132f1d692c7d3ca03a2
  source_path: providers/glm.md
  workflow: 15
---

# GLM 模型

GLM 是一个**模型家族**（不是公司），可通过 Z.AI 平台使用。在 CrawClaw 中，GLM
模型通过 `zai` 提供商访问，模型 ID 形式如 `zai/glm-5`。

## CLI 设置

使用 CrawClaw Desktop 进行交互式设置；自动化场景调用本地 Gateway API。

## 配置片段

```json5
{
  env: { ZAI_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "zai/glm-5" } } },
}
```

## 说明

- GLM 版本和可用性可能会变化；请查看 Z.AI 的文档以获取最新信息。
- 示例模型 ID 包括 `glm-5`、`glm-4.7` 和 `glm-4.6`。
- 关于提供商详情，请参阅 [/providers/zai](/providers/zai)。
