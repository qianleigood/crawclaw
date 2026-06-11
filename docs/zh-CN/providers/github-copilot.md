---
read_when:
  - 你想使用 GitHub Copilot 作为模型提供商
  - 你已在环境中有可用的 GitHub token
summary: 使用现有 GitHub token 在 CrawClaw 中使用 GitHub Copilot
title: GitHub Copilot
x-i18n:
  generated_at: "2026-06-05T14:43:25Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 55701297fd97b892c1ece435495ff1b7922bb85d6a6766e935abd57349d4df6f
  source_path: providers/github-copilot.md
  workflow: 15
---

# GitHub Copilot

## 什么是 GitHub Copilot？

GitHub Copilot 是 GitHub 的 AI 编程助手。它为你的 GitHub 账户和计划提供 Copilot 模型的访问。CrawClaw 可以通过两种不同方式将 Copilot 用作模型提供商。

## 在 CrawClaw 中使用 Copilot 的两种方式

### 1) 内置 GitHub Copilot 提供商（`github-copilot`）

通过 `COPILOT_GITHUB_TOKEN`、`GH_TOKEN` 或 `GITHUB_TOKEN` 提供 GitHub token。CrawClaw 运行时将该 token 交换为 Copilot API token。CrawClaw 不再附带捆绑的 JavaScript 设备登录辅助函数。

### 2) Copilot Proxy 插件（`copilot-proxy`）

使用 **Copilot Proxy** VS Code 扩展作为本地桥接。CrawClaw 与代理的 `/v1` 端点通信，并使用你在其中配置的模型列表。当你已经运行 VS Code 中的 Copilot Proxy 或需要通过它路由时选择此方式。你必须启用插件并保持 VS Code 扩展运行。

通过在启动桌面应用或 gateway 之前设置支持的 token 环境变量，使用 GitHub Copilot 作为模型提供商（`github-copilot`）。

## 设置默认模型

在 CrawClaw Desktop 中打开 **Settings → Models and replies → Add model**，
选择 GitHub Copilot，并保存 `github-copilot/<model>` profile。Desktop 可以把 token
存为本地 file SecretRef；也可以在启动 Gateway 前设置 `COPILOT_GITHUB_TOKEN`、
`GH_TOKEN` 或 `GITHUB_TOKEN`。

在 headless hosts 上，确保 token environment variable 或 SecretRef 对 Gateway
process 可用后，用 `config.patch` patch `agents.defaults.model.primary`。

### 配置片段

```json5
{
  agents: { defaults: { model: { primary: "github-copilot/gpt-4o" } } },
}
```

## 注意事项

- Copilot 模型可用性取决于你的计划；如果模型被拒绝，请尝试其他 ID（例如 `github-copilot/gpt-4.1`）。
- CrawClaw 运行时将配置的 GitHub token 交换为 Copilot API token。
