---
read_when:
  - 你正在接入提供商用量/配额界面
  - 你需要解释用量追踪行为或认证要求
summary: 用量追踪界面和凭证要求
title: 用量追踪
x-i18n:
  generated_at: "2026-06-05T14:15:16Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 095e7a28af185af0943754d0ecd4d1c871dadc3a6beda76c96e98c67ed76bceb
  source_path: concepts/usage-tracking.md
  workflow: 15
---

# 用量追踪

## 是什么

- 直接从提供商的用量端点拉取提供商用量/配额。
- 无预估成本；仅使用提供商报告的窗口。

## 显示位置

- 聊天中的 `/status`：带有丰富 emoji 的状态卡片，显示会话令牌 + 预估成本（仅限 API 密钥）。提供商用量在可用时显示**当前模型提供商**的用量。
- 聊天中的 `/usage off|tokens|full`：每个响应的用量页脚（OAuth 仅显示令牌）。
- 聊天中的 `/usage cost`：从 CrawClaw 会话日志聚合的本地成本摘要。
- CrawClaw Desktop 和本地 Gateway API 提供完整的每个提供商用量明细。
- 模型/提供商状态界面在可用时包含与提供商配置相同的用量快照。
- macOS 菜单栏：Context 下的"用量"部分（仅在可用时显示）。

## 提供商 + 凭证

- **Anthropic (Claude)**：auth 配置中的 OAuth 令牌。
- **GitHub Copilot**：auth 配置中的 OAuth 令牌。
- **Antigravity**：auth 配置中的 OAuth 令牌。
- **OpenAI Codex**：auth 配置中的 OAuth 令牌（存在时使用 accountId）。
- **MiniMax**：API 密钥（编程计划密钥；`MINIMAX_CODE_PLAN_KEY` 或 `MINIMAX_API_KEY`）；使用 5 小时编程计划窗口。
- **z.ai**：通过 env/config/auth store 的 API 密钥。

如果没有匹配的 OAuth/API 凭证，用量将隐藏。
