---
summary: "调试工具：watch mode、原始模型流和推理泄漏追踪"
read_when:
  - 需要检查原始模型输出中的推理泄漏
  - 想在迭代时运行 Gateway
  - 需要可重复的调试工作流
title: "调试"
---

# 调试

本页介绍调试 streaming output 的辅助工具，尤其适用于 provider 把 reasoning 混进普通文本时。

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
# 使用 CrawClaw Desktop dev mode，或运行嵌入式 Gateway API target。
```

旧的独立 Node watcher 已移除。Desktop development 应该走 app-owned Gateway 路径，
这样才能覆盖与打包桌面产品相同的 runtime boundary。

## Dev profile + dev gateway (--dev)

使用 dev profile 隔离状态，并启动一个安全、可丢弃的调试环境。这里有两个 `--dev`：

- **Global `--dev` (profile):** 把状态隔离到 `~/.crawclaw-dev`，并把 gateway port
  默认设为 `19001`（派生端口一起平移）。
- **`gateway --dev`: 告诉 Gateway 在缺失时自动创建默认 config + workspace**（并跳过
  BOOTSTRAP.md）。

推荐流程（dev profile + dev bootstrap）：

```bash
pnpm gateway:dev
CRAWCLAW_PROFILE=dev CrawClaw Desktop or the local Gateway API
```

Desktop 用户不需要全局 `crawclaw` 命令。使用 CrawClaw Desktop dev mode 做本地调试。

这个流程会做：

1. **Profile isolation**（global `--dev`）
   - `CRAWCLAW_PROFILE=dev`
   - `CRAWCLAW_STATE_DIR=~/.crawclaw-dev`
   - `CRAWCLAW_CONFIG_PATH=~/.crawclaw-dev/crawclaw.json`
   - `CRAWCLAW_GATEWAY_PORT=19001`（browser/canvas 端口相应平移）

2. **Dev bootstrap**（`gateway --dev`）
   - 缺失时写入最小 config（`gateway.mode=local`，bind loopback）。
   - 把 `agent.workspace` 设为 dev workspace。
   - 设置 `agent.skipBootstrap=true`（不读取 BOOTSTRAP.md）。
   - 缺失时写入 workspace 文件：
     `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`.
   - 默认 identity: **C3-PO**（protocol droid）。
   - dev mode 下跳过 channel providers（`CRAWCLAW_SKIP_CHANNELS=1`）。

重置流程：

```bash
pnpm gateway:dev:reset
```

注意：`--dev` 是 **global** profile flag，某些 runner 会吞掉它。如果需要明确指定，
使用环境变量形式：

```bash
CRAWCLAW_PROFILE=dev CrawClaw Desktop or the local Gateway API
```

`--reset` 会清除 config、credentials、sessions 和 dev workspace（使用 `trash`，不是
`rm`），然后重建默认 dev setup。

提示：如果非 dev Gateway 已在运行（launchd/systemd），先停止它：

```bash
# 使用 CrawClaw Desktop 或 local Gateway API 执行这个操作。
```

## Raw stream logging (CrawClaw)

CrawClaw 可以在任何 filtering/formatting 之前记录 **raw assistant stream**。
这是确认 reasoning 是否以普通文本 delta 到达（或以独立 thinking block 到达）的最直接方式。

从 CrawClaw Desktop dev settings 启用，或在启动 embedded Gateway 前设置环境变量。

可选 path override：

```bash
CRAWCLAW_RAW_STREAM_PATH=~/.crawclaw/logs/raw-stream.jsonl
```

等效环境变量：

```bash
CRAWCLAW_RAW_STREAM=1
CRAWCLAW_RAW_STREAM_PATH=~/.crawclaw/logs/raw-stream.jsonl
```

默认文件：

`~/.crawclaw/logs/raw-stream.jsonl`

## Raw chunk logging (pi-mono)

要在解析为 blocks 之前捕获 **raw OpenAI-compat chunks**，pi-mono 提供独立 logger：

```bash
PI_RAW_STREAM=1
```

可选路径：

```bash
PI_RAW_STREAM_PATH=~/.pi-mono/logs/raw-openai-completions.jsonl
```

默认文件：

`~/.pi-mono/logs/raw-openai-completions.jsonl`

> Note: 只有使用 pi-mono `openai-completions` provider 的进程才会发出这个日志。

## Safety notes

- Raw stream logs 可能包含完整 prompts、tool output 和用户数据。
- 日志只保留在本地，调试后删除。
- 如果要分享日志，先清理 secrets 和 PII。
