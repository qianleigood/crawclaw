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
  source_hash: 4d59b224ca93795970f6d1adc666efcbc867a6ed9a5c92980bd969c6d6d76492
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

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

### 配置片段

```json5
{
  agents: { defaults: { model: { primary: "github-copilot/gpt-4o" } } },
}
```

## 注意事项

- Copilot 模型可用性取决于你的计划；如果模型被拒绝，请尝试其他 ID（例如 `github-copilot/gpt-4.1`）。
- CrawClaw 运行时将配置的 GitHub token 交换为 Copilot API token。
