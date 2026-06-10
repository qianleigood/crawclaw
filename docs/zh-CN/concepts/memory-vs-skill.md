---
title: "Memory vs Skill"
summary: "CrawClaw 中 retained memory 与 reusable skills 的边界"
read_when:
  - 你在判断知识应该进入 memory 还是 skill
  - 你在评审 skill promotion 或 memory retention behavior
x-i18n:
  generated_at: "2026-06-10T10:45:58Z"
  model: codex
  provider: openai
  source_hash: 363ba1c09cf4efd89fc6cd85de16a2e8703234993e94b522781d846c8febecbf
  source_path: concepts/memory-vs-skill.md
  workflow: 15
---

# Memory vs Skill

本文定义 CrawClaw 中 memory 和 skills 的边界。

## 简短版本

- `memory` 存储系统应该记住什么
- `skill` 存储系统应该如何做某件事

Memory 是保留下来的信息和经验。Skill 是可复用方法。

## Memory

Memory 用来保存 retained information。

它捕获：

- facts
- preferences
- context
- summaries
- durable experience

Memory 主要是 descriptive。

它帮助 agent 回答：

- 我知道什么？
- 我应该记住什么？
- 对这个 user、project 或 environment 来说，什么重要？

## Skill

Skill 用来保存可复用 execution method。

它捕获：

- 解决一类问题的结构化方法
- 应该复用的 instructions
- 稳定的问题解决模式
- domain-specific methods

Skill 主要是 procedural。

它帮助 agent 回答：

- 我应该怎么做？
- 这里应该复用哪种方法？

## 边界规则

如果某个内容是关于世界的 experience，把它保存在 memory。

如果某个内容是可复用工作方式，把它做成 skill。

示例：

- “用户偏好简洁回答” -> memory
- “审查 migration diffs 时，先检查 generated imports” -> skill
- “Project X 默认使用 provider Y” -> memory
- “Provider Y onboarding 时，按 env、aliases、subpath exports 的顺序验证” -> skill

## 什么属于 Memory

在以下场景使用 memory：

- user preferences
- project facts
- retained decisions
- constraints
- historical conclusions
- durable context summaries

Memory 应告诉系统什么是真的或重要的。

## 什么属于 Skill

在以下场景使用 skill：

- repeatable procedures
- domain methods
- instruction level 的 specialized workflows
- reusable problem-solving sequences
- task-specific heuristics

Skill 应告诉系统如何继续。

## 反模式

### 把执行指令放进 memory

这会让 recall 变得嘈杂，并削弱复用。

症状：

- prompt assembly 包含散落的 procedural notes
- 同一技巧被反复重新发现
- 跨 session 行为不一致

### 把事实状态放进 skills

这会让 skills 过期且过度依赖上下文。

症状：

- skills 充满 project-specific facts
- skill reuse 下降
- 更新时需要修改很多 skills，而不是更新 memory

## Promotion Rule

预期流程是：

1. 反复出现成功工作。
2. 系统把 durable facts 保留到 memory。
3. 当方法本身变得稳定且可复用时，将其提升为 skill。

这意味着：

- memory 可以影响 skills
- memory 不应替代 skills
- skills 不应用作事实存储

## Product Framing

保持下面的表达一致：

- Memory 回答：“应该记住什么？”
- Skill 回答：“应该应用什么可复用方法？”

## Architectural Mapping

当前 memory-heavy areas 包括：

- Rust memory runtime、durable recall、experience 和 compaction surfaces

当前 skill-heavy areas 包括：

- Rust runtime skill discovery/config surfaces
- `skills/`

## Decision Test

问两个问题：

1. 这主要是 fact、preference 或 retained context 吗？
2. 还是主要是解决问题的可复用方式？

如果第一项成立，它属于 memory。

如果第二项成立，它属于 skill。
