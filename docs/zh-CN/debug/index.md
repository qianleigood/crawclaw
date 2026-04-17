---
summary: 调试笔记、调查记录和实现深潜的入口页
read_when:
  - 你在排查 CrawClaw 内部问题
  - 你要找运行时调查记录、open items 或实现深潜文档
title: 调试文档
---

# 调试文档

`debug/` 存放调查记录、架构深潜、open items 和实现笔记。  
它们更偏维护者内部资料，不是稳定的产品说明文档。

## 运行时与生命周期

- [智能体运行时开放问题](/debug/agent-runtime-open-items)
- [运行循环生命周期主链](/debug/run-loop-lifecycle-spine)
- [Node 问题记录](/debug/node-issue)

## 记忆与 Special Agent

- [Claude 记忆重构](/debug/claude-memory-refactor)
- [Memory Extractor Agent](/debug/memory-extractor-agent)
- [Special Agent Substrate](/debug/special-agent-substrate)

## 架构深潜

- [Claude Code 架构](/debug/claude-code-architecture)

## 使用方式

- 这组文档适合排查和维护，不适合作为稳定用户参考。
- 需要稳定解释时，优先看 `concepts/` 和 `reference/`。
