---
read_when:
  - 开发智能体运行时代码或测试
  - 运行运行时 lint、类型检查和实时测试流程
summary: Rust 智能体运行时构建、测试和实时验证的开发者工作流程
title: 智能体运行时开发工作流程
x-i18n:
  generated_at: "2026-06-05T14:46:25Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 61cca92ee5d5f21c4dcb142b11a663e977507237d0b0b79d1f424fa086f8ef5d
  source_path: reference/agent-runtime-development.md
  workflow: 15
---

# 智能体运行时开发工作流程

本指南总结了开发 CrawClaw Rust 所有智能体运行时的合理工作流程。

## 类型检查和 Linting

- 类型检查和构建：`pnpm build`
- Lint：`pnpm lint`
- 格式检查：`pnpm format`
- 推送前完整门控：`pnpm lint && pnpm build && pnpm test`

## 运行智能体运行时测试

运行执行行为的 Rust 运行时测试：

```bash
cargo test -p crawclaw-runtime agent_runtime
cargo test -p crawclaw-runtime memory
cargo test -p crawclaw-gateway agent_run_turn
```

移交前运行更广泛的原生门控：

```bash
pnpm test
```

不要为运行时行为添加新的 TypeScript 测试套件。改为覆盖拥有的 Rust crate 或公共原生边界。

## 手动测试

推荐流程：

- 在隔离状态目录中运行本地 gateway：
  - `CRAWCLAW_STATE_DIR="$HOME/.crawclaw-dev" cargo run -q -p crawclaw-gateway -- --bind loopback --port 19001`
- 通过 CrawClaw Desktop 或本地 Gateway API 触发智能体。

对于工具调用行为，提示 `read` 或 `exec` 操作，这样你可以看到工具流式传输和负载处理。

## 干净状态重置

状态位于 CrawClaw 状态目录下。默认为 `~/.crawclaw`。如果设置了 `CRAWCLAW_STATE_DIR`，则使用该目录。

要重置所有内容：

- `crawclaw.json` 用于配置
- `credentials/` 用于认证配置文件和令牌
- `agents/<agentId>/sessions/` 用于智能体会话历史
- `agents/<agentId>/sessions.json` 用于会话索引
- `sessions/` 如果存在遗留路径
- `workspace/` 如果你想要空白工作区

如果你只想重置会话，删除该智能体的 `agents/<agentId>/sessions/` 和 `agents/<agentId>/sessions.json`。如果你不想重新认证，请保留 `credentials/`。

## 参考

- [测试](/help/testing)
- [入门指南](/start/getting-started)
