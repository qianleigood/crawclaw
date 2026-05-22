---
read_when:
  - 你在调试 CrawClaw 内部机制
  - 你需要调查笔记、待处理事项或深度实现文档
summary: 内部调试笔记和调查文档的入口点
title: 调试文档
x-i18n:
  generated_at: "2026-05-22T02:58:25Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 5eb6083ef43b058f08ce7f15328338a916265afb05c87dbcf702871ef69e31c3
  source_path: debug/index.md
  workflow: 15
---

# 调试文档

`debug/` 目录包含调查笔记、架构深度解析、待处理事项和实现文档，对维护者有帮助，但不是主要产品文档。

## 运行时和生命周期

- [智能体运行时待处理事项](/debug/agent-runtime-open-items)
- [运行循环生命周期主轴](/debug/run-loop-lifecycle-spine)
- [运行时生命周期主轴](/debug/run-loop-lifecycle-spine)

## 内存和特殊智能体

- [持久记忆重构状态](/debug/claude-memory-refactor)
- [持久记忆智能体](/debug/memory-extractor-agent)
- [特殊智能体底座](/debug/special-agent-substrate)

## 架构深度解析

- [Claude Code 架构](/debug/claude-code-architecture)

## 如何使用本节

- 将这些页面视为维护者笔记，而非稳定的面向用户的参考文档。
- 当你需要稳定的说明或已记录的契约时，优先使用 `concepts/` 和 `reference/`。
