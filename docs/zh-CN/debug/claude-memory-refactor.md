---
read_when:
  - 想查看当前 durable-memory 自动写入架构时
  - 想了解 CrawClaw 有意采纳了哪些 Claude Code 思路时
  - 想防止重新引入旧 durable extraction 路径时
summary: 当前 durable memory agent 架构和防回归护栏
title: Durable Memory Refactor Status
---

# Durable Memory Refactor Status

这页是 CrawClaw durable-memory 自动写入的源码对齐状态记录。CrawClaw
有意对齐 Claude Code 的 durable-memory 机制，同时保留 CrawClaw 自己的
作用域内 memory tools 和 Action Feed runtime surface。

## Reference Behavior

Claude Code 是五条 durable-memory 规则的参考：

- 顶层回合结束后再运行 extraction
- 只处理上一次 extraction cursor 之后的 model-visible `user` 和
  `assistant` 消息
- 当主对话已经写入 memory 时跳过后台 extraction
- 把 `feedback` 同时当作纠错和强化指导
- 在能看到父对话上下文的 forked agent 中运行 memory maintenance，同时让
  maintenance prompt 保持窄职责

这里对齐的是机制，不是原始 tool 实现。Claude 的 fork 使用受
`canUseTool` 限制的普通文件工具写文件；CrawClaw 的 fork 通过作用域内
durable memory tools 写入，因此同样的边界由 host 强制执行。

Claude 还有更重的 consolidation 路径。在 CrawClaw 中，这个角色由
`dream` 承担，而不是由每回合 durable memory agent 承担。

## Current CrawClaw Shape

Durable auto-write 现在是回合结束后的后台维护流：

- run loop 在最终顶层回合之后发出 `stop` lifecycle phase
- `durable_memory` 订阅该 phase
- durable extraction worker 忽略 subagent sessions
- worker 通过 durable extraction cursor 从 runtime store 读取
  model-visible messages
- 这一回合中的显式 durable writes/deletes 会抑制后台 extraction
- `write_experience_note` 不会抑制 durable extraction，因为 experience
  notes 和 durable collaboration memory 是不同层
- cursor advancement 只会在该回合已处理或有意跳过后发生

Durable memory agent 作为 embedded special agent 运行：

- lifecycle metadata 可以提供捕获的 parent fork context
- `durable_memory` 声明 `parentContextPolicy: "fork_messages_only"`，因此
  embedded run 只接收 forked model-visible messages，不附加父 prompt
  envelope
- durable extraction task prompt 仍然让 cursor-based recent window 成为候选
  memories 的权威输入
- 较旧的 forked context 可以帮助解析 recent messages 中的引用，但不能作为
  重新提取旧历史的来源
- scoped durable-memory tools 把写入限制在解析出的 durable scope 内

自动 durable write 路径现在是 `durable_memory`。不要重新引入旧的
in-process structured extraction worker 作为隐藏的 prompt-time writer。

## Recall And Consolidation

Durable recall 是 prompt-time read 行为，和写入分离：

- `MEMORY.md` 是某个 scope 的第一层 durable index surface
- note header metadata 是下一层 selector
- body index cache 让 header 较弱的 notes 也能低成本进入 candidate ranking
- 只有有界 candidate slice 会读取 body excerpts 做 rerank
- selected-note diagnostics 会记录 `index`、`header`、`body_index` 和
  `body_rerank` provenance
- prompt assembly 可以根据 query classification 和 durable score strength
  给 durable memory 分配更高或更低的小预算份额

`dream` 是更慢的 consolidation 层。它默认启用，但启动仍受
minimum-session、minimum-hour、scan-throttle 和每 scope `.consolidate-lock`
文件检查约束。它可以修复、去重和增强 durable notes，但不替代每回合
extraction。

Promotion 是 governance，不是 recall。Promotion candidates 会被标记为
`surface: governance_only`，因此不能变成隐藏的 prompt-time recall 路径。

## Do Not Reintroduce

避免重新引入这些旧行为：

- 直接从通用 `afterTurn` ingestion 调度 durable extraction
- 把 extraction window 定义成新内存 turn slice 的最后 N 条消息
- 把 `write_experience_note` 当作抑制 durable extraction 的理由
- 默认让 subagent sessions 自动写 durable memory
- 给 durable memory agent 不受限制的 project 或 shell 访问
- 把完整 `MEMORY.md` 内容塞进 system prompt 作为 durable recall 策略
- 让 promotion candidates 成为第三层 prompt-time recall

## Relevant Files

- `crates/crawclaw-runtime/src/memory.rs`
- `crates/crawclaw-runtime/src/special_agents.rs`
- `crates/crawclaw-runtime/src/lib.rs`
