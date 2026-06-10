---
title: "Prompt Caching"
summary: "Prompt caching knobs、merge order、provider behavior 和 tuning patterns"
read_when:
  - 你想通过 cache retention 降低 prompt token costs
  - 你需要 multi-agent setup 中的 per-agent cache behavior
  - 你正在同时调优 cache-ttl pruning 和 scheduled work
x-i18n:
  generated_at: "2026-06-10T12:10:03Z"
  model: codex
  provider: openai
  source_hash: 215eb33682e1e93994bf1c4cc54a15b42f80dd6d29e13fa0b1ea413460009d52
  source_path: reference/prompt-caching.md
  workflow: 15
---

# Prompt caching

Prompt caching 表示 model provider 可以跨 turns 复用未变化的 prompt prefixes（通常是 system/developer instructions 和其他 stable context），而不是每次都重新处理它们。第一个匹配 request 会写入 cache tokens（`cacheWrite`），后续匹配 requests 可以读取它们（`cacheRead`）。

为什么重要：降低 token cost、加快响应，并让 long-running sessions 的性能更可预测。如果没有 caching，即使大部分 input 没有变化，重复 prompts 每一轮也要支付完整 prompt cost。

本页覆盖影响 prompt reuse 和 token cost 的所有 cache-related knobs。

Anthropic pricing details 参见：
[https://docs.anthropic.com/docs/build-with-claude/prompt-caching](https://docs.anthropic.com/docs/build-with-claude/prompt-caching)

## Primary knobs

### `cacheRetention`（global default、model 和 per-agent）

为所有 models 设置 global default cache retention：

```yaml
agents:
  defaults:
    params:
      cacheRetention: "long" # none | short | long
```

按 model override：

```yaml
agents:
  defaults:
    models:
      "anthropic/claude-opus-4-6":
        params:
          cacheRetention: "short" # none | short | long
```

Per-agent override：

```yaml
agents:
  list:
    - id: "alerts"
      params:
        cacheRetention: "none"
```

Config merge order：

1. `agents.defaults.params`（global default，应用到所有 models）
2. `agents.defaults.models["provider/model"].params`（per-model override）
3. `agents.list[].params`（匹配 agent id；按 key override）

### Legacy `cacheControlTtl`

Legacy values 仍被接受并映射：

- `5m` -> `short`
- `1h` -> `long`

新 config 优先使用 `cacheRetention`。

### `contextPruning.mode: "cache-ttl"`

在 cache TTL windows 之后 prune 旧 tool-result context，这样 post-idle requests 不会重新 cache oversized history。

```yaml
agents:
  defaults:
    contextPruning:
      mode: "cache-ttl"
      ttl: "1h"
```

完整行为参见 [Session Pruning](/concepts/session-pruning)。

### 避免 synthetic keep-warm turns

Legacy periodic heartbeat 不再是 idle gaps 后保持 cache windows warm 的推荐方式。只有当 scheduled work 有真实 operational purpose 时才使用 cron job；不要为了 cache retention 添加 synthetic model turns。

## Provider behavior

### Anthropic（direct API）

- 支持 `cacheRetention`。
- 使用 Anthropic API-key auth profiles 时，如果未设置，CrawClaw 会为 Anthropic model refs seed `cacheRetention: "short"`。

### Amazon Bedrock

- Anthropic Claude model refs（`amazon-bedrock/*anthropic.claude*`）支持显式 `cacheRetention` pass-through。
- Non-Anthropic Bedrock models 会在 runtime 强制 `cacheRetention: "none"`。

### OpenRouter Anthropic models

对于 `openrouter/anthropic/*` model refs，CrawClaw 会在 system/developer prompt blocks 上注入 Anthropic `cache_control`，以提升 prompt-cache reuse。

### Other providers

如果 provider 不支持这种 cache mode，`cacheRetention` 不会生效。

## Tuning patterns

### Mixed traffic（推荐默认）

在 main agent 上保留 long-lived baseline，在 bursty notifier agents 上禁用 caching：

```yaml
agents:
  defaults:
    model:
      primary: "anthropic/claude-opus-4-6"
    models:
      "anthropic/claude-opus-4-6":
        params:
          cacheRetention: "long"
  list:
    - id: "research"
      default: true
      params:
        cacheRetention: "long"
    - id: "alerts"
      params:
        cacheRetention: "none"
```

### Cost-first baseline

- 设置 baseline `cacheRetention: "short"`。
- 启用 `contextPruning.mode: "cache-ttl"`。
- 只为有真实 operational value 的 scheduled work 使用 cron。不要为了保持 cache windows warm 而添加 synthetic legacy heartbeat turns。

## Cache diagnostics

CrawClaw 为 embedded agent runs 暴露专门的 cache-trace diagnostics。

### `diagnostics.cacheTrace` config

```yaml
diagnostics:
  cacheTrace:
    enabled: true
    filePath: "~/.crawclaw/logs/cache-trace.jsonl" # optional
    includeMessages: false # default true
    includePrompt: false # default true
    includeSystem: false # default true
```

Defaults：

- `filePath`: `$CRAWCLAW_STATE_DIR/logs/cache-trace.jsonl`
- `includeMessages`: `true`
- `includePrompt`: `true`
- `includeSystem`: `true`

### Env toggles（one-off debugging）

- `CRAWCLAW_CACHE_TRACE=1` 启用 cache tracing。
- `CRAWCLAW_CACHE_TRACE_FILE=/path/to/cache-trace.jsonl` override output path。
- `CRAWCLAW_CACHE_TRACE_MESSAGES=0|1` 切换 full message payload capture。
- `CRAWCLAW_CACHE_TRACE_PROMPT=0|1` 切换 prompt text capture。
- `CRAWCLAW_CACHE_TRACE_SYSTEM=0|1` 切换 system prompt capture。

### What to inspect

- Cache trace events 是 JSONL，包含 `session:loaded`、`prompt:before`、`stream:context` 和 `session:after` 等 staged snapshots。
- Per-turn cache token impact 可通过普通 usage surfaces 中的 `cacheRead` 和 `cacheWrite` 查看，例如 `/usage full` 和 session usage summaries。

## Quick troubleshooting

- 大多数 turns 上 `cacheWrite` 很高：检查 volatile system-prompt inputs，并确认 model/provider 支持你的 cache settings。
- `cacheRetention` 无效：确认 model key 匹配 `agents.defaults.models["provider/model"]`。
- Bedrock Nova/Mistral requests 带有 cache settings：runtime 强制为 `none` 是预期行为。

Related docs：

- [Anthropic](/providers/anthropic)
- [Token Use and Costs](/reference/token-use)
- [Session Pruning](/concepts/session-pruning)
- [Gateway Configuration Reference](/gateway/configuration-reference)
