---
read_when:
  - 你想要 OpenCode Go 目录
  - 你需要 Go 托管模型的运行时模型引用
summary: 将 OpenCode Go 目录与共享 OpenCode 设置一起使用
title: OpenCode Go
x-i18n:
  generated_at: "2026-06-05T14:44:43Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 4bc895ff0b90a90fe3ad70b681b2fb8fb584475394dd8c78c452e85fe870508e
  source_path: providers/opencode-go.md
  workflow: 15
---

# OpenCode Go

OpenCode Go 是 [OpenCode](/providers/opencode) 中的 Go 目录。它使用与 Zen 目录相同的 `OPENCODE_API_KEY`，但保留运行时提供商 ID `opencode-go`，以保持上游按模型路由的正确性。

## 支持的模型

- `opencode-go/kimi-k2.5`
- `opencode-go/glm-5`
- `opencode-go/minimax-m2.5`

## Desktop 设置

在 CrawClaw Desktop 中打开 **Settings → Models and replies → Add model**，
选择 OpenCode Go，粘贴 shared OpenCode API key，并保存 `opencode-go/<model>`
profile。连接 probe 通过后，Desktop 会把 key 存为本地 file SecretRef。

在 headless hosts 上，设置 `OPENCODE_API_KEY` 或 `OPENCODE_ZEN_API_KEY`，或用
`config.patch` 将 `models.providers.opencode-go.apiKey` patch 为 `env`、`file`
或 `exec` SecretRef。

## 配置片段

```json5
{
  env: { OPENCODE_API_KEY: "YOUR_API_KEY_HERE" }, // pragma: allowlist secret
  agents: { defaults: { model: { primary: "opencode-go/kimi-k2.5" } } },
}
```

## 路由行为

当模型引用使用 `opencode-go/...` 时，CrawClaw 自动处理按模型路由。

## 注意事项

- 使用 [OpenCode](/providers/opencode) 获取共享入门和目录概览。
- 运行时引用保持显式：Zen 使用 `opencode/...`，Go 使用 `opencode-go/...`。
