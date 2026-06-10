---
title: "Skill vs Workflow"
summary: "可复用 skill guidance 与可执行 workflow process 之间的边界"
read_when:
  - 你在判断复用应该落在 skill 还是 workflow
  - 你在设计 skill promotion 或 workflow automation
x-i18n:
  generated_at: "2026-06-10T10:43:13Z"
  model: codex
  provider: openai
  source_hash: 24cfdd2df6da3c0486b4edfac5728a53ced6943015948c4c244199d93f321fb7
  source_path: concepts/skill-vs-workflow.md
  workflow: 15
---

# Skill vs Workflow

本文定义 CrawClaw 中 skills 和 workflows 的边界。

## 简短版本

- `skill` 是可复用方法
- `workflow` 是可复用执行过程

Skill 帮助 agent 更好地思考和行动。
Workflow 定义一个可以运行、跟踪、更新和自动化的过程。

## Skill

Skill 是可复用的指令或方法。

它最适合：

- techniques
- domain guidance
- structured heuristics
- repeatable task approaches
- instruction-level reuse

Skills 通常轻量且灵活。

它们改进 agent 执行工作的方式。

## Workflow

Workflow 是带有显式结构和生命周期的可复用过程。

它最适合：

- multi-step orchestration
- deployable or rerunnable procedures
- processes with topology or step state
- long-running or resumable execution
- auditable automation paths

Workflows 是 operational objects，而不只是 instructions。

它们改进系统执行可重复过程的方式。

## 边界规则

如果主要是指导如何解决一类问题，把它保留为 skill。

如果主要是一个应作为 first-class object 运行的已定义多步骤过程，把它做成 workflow。

示例：

- “如何审查 Rust plugin SDK descriptor regressions” -> skill
- “跨已配置 runtimes 的 nightly provider health validation” -> workflow
- “如何把 session summaries 提升为 durable memory” -> skill
- “带 execution state 和 rollback 的 scheduled memory hygiene pipeline” -> workflow

## 什么属于 Skill

在以下场景使用 skill：

- flexibility 比 orchestration 更重要
- agent 仍需要推理任务
- steps 是 guidance，而不是严格 process state
- 复用通过 prompting 和 method selection 发生

## 什么属于 Workflow

在以下场景使用 workflow：

- steps 应该显式
- state transitions 很重要
- process 应该可部署、可重跑或可回滚
- execution history 应作为 process 跟踪
- work 后续应该自动化或排程

## 反模式

### 把 workflows 编码成巨大 skills

症状：

- skill 变长、僵硬并且 operational
- 系统无法很好地跟踪 run state
- approvals、rollback 或 execution history 变成临时拼接

### 把 skills 编码成细小 workflows

症状：

- workflow sprawl
- 对简单可复用方法引入过多 process overhead
- users 和 operators 无法判断哪些 workflows 才是真正的 operational assets

## Promotion Rule

预期流程是：

1. 一个有用方法出现。
2. 该方法被捕获为 skill。
3. 当该方法变得稳定、重复且过程化时，提升为 workflow。
4. 当 workflow 变成 recurring 或 externally triggered 时，可以进入 cron 或 hooks。

Skills 通常应先于 workflows。

## Product Framing

保持下面的表达一致：

- Skill 回答：“agent 应该如何处理这个问题？”
- Workflow 回答：“系统应该运行什么过程？”

## Architectural Mapping

当前 skill-heavy areas 包括：

- Rust runtime skill discovery/config surfaces
- `skills/`

当前 workflow-heavy areas 包括：

- Rust core `workflow` 和 `workflowize` tools
- Rust Gateway workflow RPC handlers
- Rust cron 和 hook runtime surfaces

## Decision Test

问两个问题：

1. 这主要是可复用 guidance 吗？
2. 还是主要是带生命周期和状态的可执行 process？

如果是 guidance，它属于 skill。

如果是 managed process，它属于 workflow。
