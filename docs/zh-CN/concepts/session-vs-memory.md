---
title: "Session vs Memory"
summary: "raw session history 与 retained memory 之间的边界"
read_when:
  - 你在处理 sessions、transcript storage 或 durable memory agent
  - 你需要解释 session 被评估后会留下什么
x-i18n:
  generated_at: "2026-06-10T10:45:58Z"
  model: codex
  provider: openai
  source_hash: 253513924b87f93717e11ca233565da692a9846607c244867edc9998ca9faeef
  source_path: concepts/session-vs-memory.md
  workflow: 15
---

# Session vs Memory

本文定义 CrawClaw 中 sessions 和 memory 的边界。

## 简短版本

- `session` 是发生过什么的记录。
- `memory` 是系统评估发生过的事情之后仍然有价值的内容。

Sessions 是原始历史。Memory 是保留下来的信息和经验。

## Session

Session 是某个运行上下文中的执行和对话轨迹。

Session 应该保留：

- chronology
- message order
- tool usage
- execution context
- recent local state
- operator-visible history

典型用途：

- replaying a conversation
- debugging or auditing behavior
- showing recent chat history
- loading the current working context
- resolving recent run state

Sessions 可以是嘈杂的。它们存在的目的，是让系统不丢失细节。

## Memory

Memory 是原始 session 之外仍然留存的一部分信息，因为它很可能再次重要。

Memory 应该保留：

- stable facts
- durable preferences
- user or project context
- recurring constraints
- retained experience worth future recall

典型用途：

- future retrieval
- personalization
- durable context assembly
- cross-session reasoning
- experience recall

Memory 应该是选择性的。它存在的目的，是让系统不必永远携带所有历史。

## 边界规则

如果系统需要忠实记录，把它留在 session。

如果系统需要可复用的 retained signal，把它提升到 memory。

这意味着：

- 所有 memory 都可以源自 sessions
- 并非所有 session data 都应该变成 memory

## 什么只留在 Session

当信息具备以下特征时，只保留在 session history：

- transient
- procedural noise
- specific to one run
- useful mainly for audit or replay
- unlikely to matter later

示例：

- intermediate tool traces
- failed attempts that carry no durable lesson
- message ordering details
- temporary run state
- ad hoc execution chatter

## 什么应该进入 Memory

当 session 内容具备以下特征时，提升到 memory：

- likely to matter again
- independent of one exact transcript position
- useful across future turns or sessions
- helpful for personalization or continuity

示例：

- user preferences
- project conventions
- recurring environment facts
- durable task context
- summaries of important outcomes

## 反模式

### 把 session history 当作 memory

这会造成臃肿 recall 和低质量信号。

症状：

- retrieval 返回 transcript noise
- memory 增长过快
- prompts 包含 procedural junk，而不是有用上下文

### 把 memory 当作 transcript archive

这会让 memory 过于昂贵且含混。

症状：

- long, low-value retained records
- poor ranking
- 重复存储等价的 raw interactions

## Product Framing

保持下面的表达一致：

- Session 回答：“发生了什么？”
- Memory 回答：“之后什么应该重要？”

## Architectural Mapping

当前 session-heavy areas 包括：

- Rust session、chat、Gateway 和 context archive runtime surfaces

当前 memory-heavy areas 包括：

- Rust durable memory、experience、recall 和 search runtime surfaces

## Promotion Rule

预期流程是：

1. 工作在 session 中发生。
2. 系统记录完整轨迹。
3. Evaluation 判断什么重要。
4. 只有重要子集被提升到 memory。

Memory 应该从 session history 派生，而不是被当作它的第二份副本。
