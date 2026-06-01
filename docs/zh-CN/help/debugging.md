---
summary: "调试工具：runtime overrides、dev mode 和本地日志工作流"
read_when:
  - 想在迭代时运行 Gateway
  - 需要可重复的调试工作流
title: "调试"
---

# 调试

本页介绍 Rust-owned Gateway 路径的 runtime overrides、dev-mode 启动和本地调试工作流。

## Runtime debug overrides

在聊天中使用 `/debug` 设置 **runtime-only** 配置覆盖（只在内存中，不写磁盘）。
`/debug` 默认禁用；通过 `commands.debug: true` 启用。
当你需要切换不常用设置、但不想编辑 `crawclaw.json` 时很方便。

示例：

```
/debug show
/debug set messages.responsePrefix="[crawclaw]"
/debug unset messages.responsePrefix
/debug reset
```

`/debug reset` 会清空所有覆盖，并回到磁盘配置。

## Gateway watch mode

快速迭代时，使用 CrawClaw Desktop dev mode 或嵌入式 Gateway API target：

```bash
CRAWCLAW_STATE_DIR="$HOME/.crawclaw-dev" cargo run -q -p crawclaw-gateway -- --bind loopback --port 19001
```

旧的独立 Node watcher 已移除。Desktop development 应该走 app-owned Gateway 路径，
这样才能覆盖与打包桌面产品相同的 runtime boundary。

## Dev 状态目录 + 本地 gateway

使用单独的状态目录和端口，把本地 gateway 调试与正常 CrawClaw Desktop 状态隔离。

推荐流程：

```bash
CRAWCLAW_STATE_DIR="$HOME/.crawclaw-dev" \
  cargo run -q -p crawclaw-gateway -- --bind loopback --port 19001
```

Desktop 用户不需要全局 `crawclaw` 命令。使用 CrawClaw Desktop dev mode 做本地调试。

这个流程会做：

1. **状态隔离**
   - `CRAWCLAW_STATE_DIR=~/.crawclaw-dev`
   - Runtime root 默认是 `~/.crawclaw-dev/runtime/crawclaw`
   - Gateway 端口显式设为 `19001`，避免与默认 `18789` 冲突

重置流程：

```bash
mv "$HOME/.crawclaw-dev" "$HOME/.crawclaw-dev.$(date +%Y%m%d%H%M%S).bak"
```

提示：如果非 dev Gateway 已在运行（launchd/systemd），先停止它：

通过 CrawClaw Desktop 停止 app 管理的 gateway，或停止正在占用目标端口的进程。

## Safety notes

- Gateway 和 provider 日志可能包含 prompts、tool output 或用户数据。
- 日志只保留在本地，调试后删除临时日志。
- 如果要分享日志，先清理 secrets 和 PII。
