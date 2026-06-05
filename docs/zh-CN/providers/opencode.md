---
read_when:
  - 你想要 OpenCode 托管的模型访问
  - 你想要在 Zen 和 Go 目录之间选择
summary: 将 OpenCode Zen 和 Go 目录与 CrawClaw 一起使用
title: OpenCode
x-i18n:
  generated_at: "2026-06-05T14:45:01Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: c9543f001264ef344202ec4dc8ffd699f480940fcfa9de2e7bc5a6ef6f9fb22a
  source_path: providers/opencode.md
  workflow: 15
---

# OpenCode

OpenCode 在 CrawClaw 中暴露两个托管目录：

- `opencode/...` 用于 **Zen** 目录
- `opencode-go/...` 用于 **Go** 目录

两个目录使用相同的 OpenCode API 密钥。CrawClaw 保持运行时提供商 ID 分离，以便上游按模型路由保持正确，但入门和文档将它们视为一个 OpenCode 设置。

## Desktop 设置

### Zen 目录

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

### Go 目录

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

## 配置片段

```json5
{
  env: { OPENCODE_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "opencode/claude-opus-4-6" } } },
}
```

## 目录

### Zen

- 运行时提供商：`opencode`
- 示例模型：`opencode/claude-opus-4-6`、`opencode/gpt-5.2`、`opencode/gemini-3-pro`
- 当你想要精选的 OpenCode 多模型代理时最佳

### Go

- 运行时提供商：`opencode-go`
- 示例模型：`opencode-go/kimi-k2.5`、`opencode-go/glm-5`、`opencode-go/minimax-m2.5`
- 当你想要 OpenCode 托管的 Kimi/GLM/MiniMax 系列时最佳

## 注意事项

- 也支持 `OPENCODE_ZEN_API_KEY`。
- 在设置期间输入一个 OpenCode 密钥会为两个运行时提供商存储凭证。
- 你登录 OpenCode，添加账单详情，然后复制你的 API 密钥。
- 账单和目录可用性从 OpenCode 仪表板管理。
