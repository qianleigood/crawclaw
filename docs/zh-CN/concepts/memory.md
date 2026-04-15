---
read_when:
  - 你想了解 CrawClaw 的记忆分层
  - 你想知道哪些信息应该进 durable memory 或 NotebookLM
  - 你想弄清哪些记录可回放，哪些只是调试日志
summary: CrawClaw 记忆系统总览（session memory / durable memory / NotebookLM / Context Archive）
title: 记忆
x-i18n:
  generated_at: "2026-04-05T12:44:00Z"
  model: gpt-5.4
  provider: codex
  source_hash: manual-update
  source_path: concepts/memory.md
  workflow: manual
---

# 记忆

CrawClaw 通过分层记忆系统跨会话保留信息：

- **Session memory**：保存单个会话内的短期任务连续性
- **Durable memory**：保存长期有效的用户事实、协作偏好和项目背景，
  scope 由 `agentId + channel + userId` 决定
- **Knowledge recall**：通过 NotebookLM 在 prompt assembly 时执行知识召回
- **Context Archive**：保存可回放/可导出的运行记录，记录某次 run 实际看到了什么、做了什么

模型只会“记住”真正写入这些层的信息，不存在隐式的长期状态。

## Durable memory

Durable memory 以 Markdown note 的形式保存在按 scope 分桶的 durable-memory 目录中。每条 durable memory 都是一份独立 note，每个 scope 还会维护自己的 `MEMORY.md` 索引。

`MEMORY.md` 现在也按 Claude 风格收口成硬约束：

- 它只是索引，不应该承载 memory 正文
- 不能带 frontmatter
- 每条索引尽量保持一行，约 150 个字符以内
- 整个文件应控制在约 200 行和 25KB 以内
- 过细的内容应回到 topic note，而不是继续塞进索引

在 recall 时，CrawClaw 不会把整个 durable-memory 目录原样塞进上下文。它会先扫描当前 scope 下 note 的 header，构造一个轻量 manifest，再只选择少量与当前 prompt 明确相关的 durable note；只有被选中的条目才会再读取完整 note 内容。

在主 agent 运行路径上，durable recall 现在采用更接近 Claude 的
`prefetch + consume` 形态：

- runner 会在 prompt assembly 之前异步启动 durable recall
- assembly 只消费已经准备好的 prefetch 结果
- 如果 prefetch 还没完成，这一轮会直接继续，不会为了 durable recall
  阻塞模型调用
- 如果这一轮根本没有 prefetch handle，durable recall 会直接跳过，不再在
  `assemble()` 里回退成同步查找
- 超过一天的 durable note 现在会附带 freshness 提醒，并明确要求模型在把
  文件/代码/repo 状态当成事实使用前先验证当前现实

durable 自动补写的触发时机现在也更接近 Claude：

- run-loop 现在会在顶层回合真正收口后发出 `stop` phase，`memory_extractor`
  作为 subscriber 消费这个 phase
- 这一轮新增消息里必须已经出现最终 assistant 回复
- 如果最新 assistant 还停在 tool call 阶段，或者以 `error` / `aborted`
  结束，这一轮就不会触发后台 durable extraction
- cursor 只会在这轮真的被处理后才前进，因此未完成的 tool-call 回合不会误消耗补写窗口

CrawClaw 现在还有第二层 durable memory 维护链：

- `memory_extractor`：每轮结束后的轻量后台补写
- `dream`（auto-dream）：低频的跨 session 整理器
- `session_summary`：单个 session 的短期连续性维护 agent
- `memory_extractor` 和 `dream` 现在都通过同一条 run-loop
  `stop` phase 订阅触发，不再直接挂在 `afterTurn`
- auto-dream 的 gate 和锁状态使用 runtime DB，而不是文件 `mtime`
- auto-dream 的主要信号源优先来自 runtime store、session summary 和
  Context Archive，而不是 transcript grep
- auto-dream 会通过 Action Feed 暴露 `orient / gather / consolidate / prune`
  这些阶段化动作
- 手动 dream 运行支持 `--session-limit` / `--signal-limit` 做范围控制，也支持
  `--dry-run` 只预览 consolidation 输入而不拿锁、不写 memory
- dream state 现在会保存最近一次 skip/gate reason，因此 status/history/
  inspect 能解释为什么某次 consolidation 没有真正启动

## Session memory

Session memory 现在已经切成 Claude 风格的单轨设计：

- 每个 session 只维护一份 `summary.md`
- 它通过 run-loop 的 post-sampling hook 后台调度 `session_summary`
  agent 维护这份文件
- 顶层回合自然收口时仍然会触发更新；如果 token 增量阈值和 tool-call
  阈值同时满足，也可以在更早的 post-sampling 时点刷新
- runtime DB 只保存边界/进度状态，例如：
  - `lastSummarizedMessageId`
  - `lastSummaryUpdatedAt`
  - `tokensAtLastSummary`
  - `summaryInProgress`

`summary.md` 是当前唯一的持久化 session summary 源。CrawClaw 不再保留单独
的 runtime session card 作为主 session-memory 记录。

这份 summary file 使用固定结构，主要 section 包括：

- `Session Title`
- `Current State`
- `Task specification`
- `Files and Functions`
- `Workflow`
- `Errors & Corrections`
- `Codebase and System Documentation`
- `Learnings`
- `Key results`
- `Worklog`

每轮 prompt assembly 不会把整份 `summary.md` 原样注入模型。运行时只会提取
最适合当前连续性的 section，例如 `Current State`、`Task specification`、
`Key results` 和相关的 `Errors & Corrections`。

Session memory 仍然按 `sessionId` 隔离，因此父智能体和它生成的子智能体**不会**
共享同一份 summary file。每个子运行都有自己独立的 `summary.md`。

<Tip>
如果你想让智能体长期记住某件事，请明确说出来。系统会根据内容把它写进 durable memory 或知识库。
</Tip>

## Knowledge recall

Knowledge recall 由 NotebookLM 提供。CrawClaw 可以：

- 查询相关知识
- 通过 `write_knowledge_note` 直接写入结构化 knowledge note
- 通过 `crawclaw memory` 管理登录、刷新和 provider 状态
- 通过 `crawclaw memory prompt-journal-summary` 汇总 nightly memory prompt diagnostics

当前运行时没有额外的 NotebookLM 审核队列。模型如果判断某条信息应进入知识库，会直接通过工具路径写入。

Knowledge recall 发生在每轮模型调用前的上下文组装阶段。如果这一轮没有可用
的 `promptText`，运行时就不会去查询 NotebookLM。

`write_knowledge_note` 就是当前唯一的 NotebookLM 写入路径；它会先经过
schema 和 guard 校验，再直接写入。

## Context Archive

Context Archive 是面向 replay/export/debug 的运行记录层。

它会捕获：

- 模型可见上下文，包括组装后的 prompt / messages / tools
- tool admission、loop policy 动作、tool result
- post-turn 更新，例如 session summary 维护、compaction、completion 和 verifier 结果

它和旧记录层的职责不同：

- **Session transcript**：偏产品侧的会话记录，后续可能被 compaction / rewrite 改写
- **Prompt journal**：仅用于 debug，而且是有损/截断的
- **Diagnostic session state**：只是内存态 mirror/cache，不是持久真相源

如果你要导出或回放某个 task-backed run，应该使用 Context Archive。

## 作用域与共享关系

这三层记忆的边界并不相同：

- **Session memory**：按会话隔离
- **Durable memory**：只要命中相同的 `agentId + channel + userId`，不同运行之间会共享
- **Knowledge recall**：所有运行共用配置好的 NotebookLM backend，不按 sessionId 分桶

所有使用 built-in memory runtime 的智能体都会收到同一份 agent memory
routing contract，它不是只给 `main` 智能体使用的。

## Session summary 维护

在 [compaction](/concepts/compaction) 之前，CrawClaw 会先在一个有界等待窗口内
等待当前 `session_summary` 任务结束，然后使用 `summary.md` 和
`lastSummarizedMessageId` 作为压缩边界。压缩会先从这个已总结边界之后开始，
只有在需要满足最小保留尾部条件时，才向前扩展。

这样短期连续性只保留一套来源：

- 后台 agent 维护 `summary.md`
- compaction 以 summary 边界保留尾部消息，只在必要时向前扩展到可用工作集
- prompt assembly 也只从这份 summary file 提取连续性 section

## CLI

```bash
crawclaw memory status   # 查看 NotebookLM provider 状态
crawclaw memory login    # 交互式重建 NotebookLM profile
crawclaw memory refresh  # 从 cookie fallback 刷新 NotebookLM 认证
crawclaw memory dream status --json
crawclaw memory dream history --json
crawclaw memory dream run --agent main --channel telegram --user alice --force
crawclaw memory dream run --agent main --channel telegram --user alice --dry-run --session-limit 6 --signal-limit 6
crawclaw memory prompt-journal-summary --json --days 1
crawclaw agent export-context --task-id <task-id> --json
```

## 延伸阅读

- [记忆配置参考](/reference/memory-config)
- [压缩](/concepts/compaction)
