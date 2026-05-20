---
title: "CrawClaw Learning Loop"
summary: "CrawClaw 如何把 action history 转化为 retained memory、skills 和 workflows"
read_when:
  - 设计 memory、skill、workflow 或 automation behavior
  - 需要理解 action、retention、recall 和 automation 的边界
---

# CrawClaw Learning Loop

本文解释 CrawClaw 应如何被理解为一个学习系统，而不是 tools、memory 和
automation features 的扁平集合。

核心循环是：

`action -> record -> evaluate -> retain -> recall -> automate -> action`

每个阶段都有不同职责。保持这些边界清晰，可以避免 sessions、memory、skills 和
workflows 之间重叠。

## The Loop

### 1. Action

Agent 在当前 turn 中执行工作：

- 调用 tools
- 使用 plugins
- 通过 gateway surfaces 交互
- 读写文件
- 发送或接收消息

这是系统的 execution surface。

相关区域：

- Rust tool catalog and runtime
- `crates/crawclaw-plugin-sdk`
- Rust Gateway and native plugin surfaces

回答的问题：

- “系统现在应该做什么？”

### 2. Record

系统记录发生了什么，但还不决定什么值得长期保留。

示例：

- chat history
- transcripts
- gateway execution records
- tool traces
- run events
- context archive captures

这是原始 operational history。

相关区域：

- `crates/crawclaw-gateway/src/lib.rs`
- Rust session、chat 和 context archive runtime surfaces

回答的问题：

- “发生了什么？”

### 3. Evaluate

系统判断哪些历史足够重要，值得保留、总结或提升。

示例：

- durable memory agent
- session summary generation
- durable memory promotion
- compaction
- diagnostics and audit signals

这一阶段把噪声和信号分开。

相关区域：

- Rust memory extraction、session-summary、durable memory、promotion 和
  diagnostics surfaces

回答的问题：

- “什么值得保留？”

### 4. Retain

选中的经验会存入更长期的 memory structures。

示例：

- durable memory records
- experience notes
- recall indexes
- vector or graph-backed memory
- NotebookLM-backed experience integration

这不是 raw history，而是 retained experience。

相关区域：

- Rust durable memory、experience、search、recall、vector 和 graph surfaces

回答的问题：

- “长期经验存在哪里？”

### 5. Recall

新任务开始时，系统把最相关的 retained experience 拉回 working context。

示例：

- relevant memory retrieval
- skill discovery
- recent transcript continuity
- compaction summary consumption
- context assembly
- synchronous durable recall

这是 agent 避免从零开始的方式。

相关区域：

- Rust memory、query-context 和 skill discovery surfaces

回答的问题：

- “过去哪些内容应该影响这个任务？”

### 6. Automate

当某个模式足够稳定时，它不应只停留在 recalled idea，而应成为显式可复用能力。

这发生在多个层级：

- reusable instruction or method 变成 `skill`
- repeatable multi-step procedure 变成 `workflow`
- recurring or event-driven workflow 变成 `cron` 或 `hook` automation

CrawClaw 不在这里运行自动 self-evolution loop。Experience recall 可以暴露重复
模式，但把它变成 skill、workflow、cron job 或 hook 仍是显式 authoring step。

相关区域：

- `skills/`
- Rust workflow、cron 和 hook runtime surfaces

回答的问题：

- “什么应该从临时行为变成可复用能力？”

## Canonical Boundaries

### Session

Session 是 conversation 或 run context 的记录。

它是：

- chronological
- trace-oriented
- useful for replay、audit 和 recent context

它不是：

- durable experience store
- reusable behavior definition

### Memory

Memory 是从先前工作中提取的 retained information 和 experience。

它是：

- curated
- 比 session 更长期
- 用于未来 retrieval

它不是：

- raw transcript 本身
- executable automation plan

### Experience

Experience 是 memory 的结构化子集，用来捕获 reusable context、trigger、
action、result、lesson、applicability boundaries 和 evidence。

当 NotebookLM writeback 不可用时，它可以暂存在本地 pending outbox；同步后再从
NotebookLM 查询。未来 promoted forms 也可以进入 graph、vector 或 note stores，
但本地 outbox 本身不是 prompt recall provider。

### Skill

Skill 是可复用的方法。

它是：

- method-oriented
- reusable across tasks
- narrower than a workflow

它不是：

- 只是 remembered fact
- 带部署状态的完整 operational process

### Workflow

Workflow 是带 state、topology 和 operational behavior 的多步骤执行路径。

它是：

- process-oriented
- executable
- 适合 deployment、rerun、rollback 或 automation

它不是：

- merely a hint or suggestion
- just a skill description
