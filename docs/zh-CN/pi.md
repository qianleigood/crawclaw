---
title: "Rust Agent Runtime Architecture"
summary: "CrawClaw Rust-owned agent runtime and session lifecycle architecture"
read_when:
  - Understanding agent runtime ownership in CrawClaw
  - Modifying agent session lifecycle, tooling, cron, auto-reply, command, special-agent, or memory flows
x-i18n:
  generated_at: "2026-04-21T13:26:16Z"
  model: MiniMax-M2.7
  provider: minimax
  source_hash: 989feea2e7b77969a0d127298b8e333533ec47330116b5b98adfdf4efc6cb5f6
  source_path: pi.md
  workflow: 15
---

# Rust Agent Runtime Architecture

CrawClaw 的 agent 执行由 Rust runtime 拥有。旧的 TypeScript TypeScript agent runner 不再是生产执行路径。

本页说明当前 agent turn、session state、provider transport、special agents、cron jobs、auto-reply、commands 和 memory lifecycle 的 runtime 边界。

## Ownership

Rust runtime 拥有：

- 通过 `AgentRuntime` 执行 agent turn。
- Provider metadata、model defaults、auth choices、transport capabilities 和 runtime provider calls。
- Session binding、transcript writes、run ids、event projection、usage metadata，以及 abort 或 timeout handling。
- Cron `agentTurn` jobs、auto-reply turns、command turns、special-agent runs 和 memory jobs。
- Durable memory extraction、experience extraction、dream jobs、session summaries、assembly、compaction 和 after-turn ingest。

TypeScript 只保留 UI、CLI、channel adapters、Gateway client calls 和小型 payload projection helpers。TypeScript 不应重新进入 agent execution bridge 或 fallback runner。

## Gateway Entry Points

公开 runtime entry points 是由 Rust 支撑的 Gateway RPC methods：

- `agent.runTurn`
- `agent.command.run`
- `autoReply.run`
- cron `agentTurn` payload execution
- memory RPCs，例如 `memory.bootstrap`、`memory.ingestBatch`、`memory.assemble`、`memory.compact`、`memory.dream.*`、`memory.session_summary.*` 和 `memory.experience.*`
- Rust gateway 暴露的 special-agent runtime methods

这些方法会规范化 request metadata，并调用相同的 Rust runtime core，确保 session、transcript、tools、model selection、cancellation 和 memory handling 在不同入口之间保持一致。

## Runtime Flow

1. Gateway 接收 typed request，并验证 session、trigger、channel、message、model、provider、reasoning 和 run metadata。
2. Rust 从 Rust provider registry 解析 provider 和 model 配置。
3. Rust 组装有效 session context、transcript、memory inputs、system prompt 和 tool inventory。
4. Rust 执行 model turn，stream events，记录 usage，并处理 tool payloads。
5. Rust 写入 transcript entries，并发出可交付的 reply payloads。
6. 对 persistent session turn，Rust 触发 after-turn memory ingest。

诸如 `/btw` 的 ephemeral command modes 可以选择不写 transcript、不触发 after-turn ingest，但仍使用 Rust command runtime。

## Sessions And Queues

Runs 按 session key 序列化。runtime 使用 session key 作为 lane identity，因此一个用户 session 不会有重叠的 active turns。

更高层入口也可以使用全局并发上限。Cron、auto-reply、command 和 special-agent runs 都绑定到同一套 runtime identity model，因此 run metadata、cancellation 和 status reporting 不会因 trigger type 分叉。

## Tools

每个 Rust turn 之前都会解析 tool inventory。TypeScript 仍可承载 channel adapters 和 tool payload projection，但它不是 agent loop。

Rust 返回的 tool payloads 会被投影为 Gateway 和 channel-specific delivery formats。Channel plugins 应调用文档化 SDK 或 Gateway client surfaces，而不是导入 agent internals。

## Memory

Memory work 是 Rust-native：

- after-turn ingest
- durable extraction
- experience extraction
- dream jobs
- session summaries
- memory assembly
- memory compaction

Memory jobs 使用 Rust special-agent 或 Rust agent runtime definitions。Production memory paths 不应调用 legacy TypeScript memory jobs。

## Special Agents

Special agents 由 Rust runtime 定义和执行。Definitions 包含 tool allowlists、parent context policy、timeout、maximum turns、result detail 和 action-feed behavior。

`runtime_fork` semantic 是内部 Rust runtime fork。它不会调用 TypeScript TypeScript special-agent runner。

## Cron And Auto Reply

Cron scheduling、store access、due-run handling、manual runs、run logs、webhook delivery 和 `agentTurn` execution 都由 Rust 拥有。

Auto-reply trigger handling 通过 `autoReply.run` 路由到 Rust runtime。Reply routing、dedupe、typing/status events、follow-up behavior、transcript projection、sendable parts 和 memory triggers 由 Rust runtime 或 thin Gateway/channel projection code 处理。

## Compatibility Boundary

已移除的 TypeScript execution surfaces 包括：

- legacy TypeScript agent runners
- typed plugin hook runners
- TypeScript provider runtime registration
- TypeScript special-agent Rust runtimes
- TypeScript cron isolated-agent runners
- TypeScript auto-reply agent runners
- legacy TypeScript memory jobs

如果调用方需要 agent turn，必须使用 Rust-backed Gateway/runtime method。不存在 TypeScript fallback bridge。

## Tests

执行行为使用 Rust runtime gates：

```bash
cargo test -p crawclaw-runtime agent_runtime
cargo test -p crawclaw-runtime cron
cargo test -p crawclaw-runtime memory
cargo test -p crawclaw-runtime special_agents
cargo test -p crawclaw-gateway agent_run_turn
```

TypeScript gates 只用于 Gateway clients、channel projection、SDK surface 和 stale-reference cleanup：

```bash
pnpm tsgo
pnpm check
pnpm build
```
