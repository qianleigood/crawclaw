---
read_when:
  - 你在设计记忆、Skill、工作流或改进循环行为
  - 你需要了解行动、保留、召回和自动化之间的边界
summary: CrawClaw 如何将操作历史转化为保留的记忆、Skills 和工作流
title: CrawClaw 学习循环
x-i18n:
  generated_at: "2026-05-02T05:30:50Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: a0508ac80d8bb8505105746c8388a8b48292ef95ce9815d6fb99992501d9ec4e
  source_path: concepts/learning-loop.md
  workflow: 15
---

# CrawClaw 学习循环

本文档解释了 CrawClaw 应如何被理解为一个学习系统，而非一个工具、记忆和自动化功能的简单集合。

核心循环是：

`action -> record -> evaluate -> retain -> recall -> automate -> action`

每个阶段都有不同的职责。保持这些边界清晰有助于避免会话、记忆、Skills 和工作流之间的重叠。

## 循环

### 1. 行动

智能体在当前回合中执行工作：

- 调用工具
- 使用插件
- 通过 Gateway 网关界面交互
- 读取或写入文件
- 发送或接收消息

这是系统的执行层面。

相关领域：

- `src/agents/tools`
- `src/gateway`
- `src/plugin-sdk`
- `src/plugins`

已解决的问题：

- “系统现在应该做什么？”

### 2. 记录

系统记录发生的事情，暂不决定哪些值得长期保留。

示例：

- 聊天历史
- 转录文本
- Gateway 网关执行记录
- 工具追踪记录
- 运行事件
- Context Archive 捕获

这是原始操作历史。

相关领域：

- `src/sessions`
- `src/chat`
- `src/agents/context-archive`
- `src/gateway/server-methods`

已解决的问题：

- “发生了什么？”

### 3. 评估

系统决定历史中的哪些部分足够重要，值得保留、总结或晋升。

示例：

- 持久记忆智能体
- 会话摘要生成
- 持久记忆晋升
- 压缩
- 诊断和审计信号

此阶段将噪音与信号分离。

相关领域：

- `src/memory/extraction`
- `src/memory/session-summary`
- `src/memory/durable`
- `src/memory/promotion`
- `src/memory/diagnostics`

已解决的问题：

- 什么值得保留？

### 4. 保留

选定的体验被存储在更持久的记忆结构中。

示例：

- 持久记忆记录
- 体验笔记
- 召回索引
- 向量或图谱支持的记忆
- NotebookLM 支持的体验集成

这不是原始历史。这是保留的体验。

相关领域：

- `src/memory/durable`
- `src/memory/experience`
- `src/memory/notebooklm`
- `src/memory/search`
- `src/memory/recall`
- `src/memory/vector`
- `src/memory/graph`

已解决的问题：

- 长期体验存放在哪里？

### 5. 召回

当新任务开始时，系统将最相关的保留体验拉回到工作上下文中。

示例：

- 相关记忆检索
- Skill 发现
- 最近转录文本连续性
- 压缩摘要消费
- 上下文组装
- 同步持久化召回

这就是智能体如何避免从零开始。

相关领域：

- `src/memory/engine`
- `src/memory/recall`
- `src/memory/search`
- `src/agents/query-context`
- `src/agents/skills`

已解决的问题：

- 过去有哪些内容应该影响这个任务？

### 6. 自动化

当一个模式足够稳定时，它应该不再只是一个被召回的想法，而成为一个明确的可复用能力。

这发生在多个层面：

- 可复用的指令或方法成为 `skill`
- 可重复的多步骤过程成为 `workflow`
- 重复或事件驱动的工作流成为 `cron` 或 `hook` 自动化

改进扫描使用 NotebookLM 返回的结构化候选作为晋升信号。本地待处理发件箱仅作为写回重试队列，而非自动化候选来源。

相关领域：

- `src/agents/skills`
- `src/workflows`
- `src/cron`
- `src/hooks`

已解决的问题：

- 什么应该从临时性的变为可复用的？

## 规范边界

### 会话

会话是一段对话或运行上下文的记录。

它是：

- 按时间顺序的
- 追踪导向的
- 用于重放、审计和最近上下文

它不是：

- 持久体验存储
- 可复用行为定义

使用会话的场景：

- 历史
- 转录文本搜索
- 最近执行状态

### 记忆

记忆是从之前工作中提取的保留信息和体验。

它是：

- 精选的
- 比会话更持久
- 旨在供将来检索

它不是：

- 原始转录文本本身
- 可执行自动化计划

使用记忆的场景：

- 事实
- 偏好
- 持久上下文
- 召回的体验片段

### 体验

体验是记忆的结构化子集，捕获可复用上下文、触发器、行动、结果、经验教训、适用边界和证据。

当 NotebookLM 写回不可用时，它可能会被暂存在本地待处理发件箱中，然后在同步后从 NotebookLM 查询。将来晋升的形式也可能存在于图、向量或笔记存储中，但本地发件箱本身不是提示召回提供者。

使用体验的场景：

- 经过验证的流程和操作手册
- 应指导类似未来工作的决策和权衡
- 通过已完成任务发现的运行时或故障模式
- 协作工作流模式
- 跨会话召回

### Skill

Skill 是一种做某事的可复用方式。

它是：

- 方法导向的
- 跨任务可复用
- 比工作流范围更窄

它不是：

- 仅仅是一个被记住的事实
- 具有部署状态的完整操作流程

使用 Skills 的场景：

- 可复用的技术
- 指令
- 结构化问题解决模式
- 可复用任务习惯

### 工作流

工作流是具有状态、拓扑和操作行为的已定义多步骤执行路径。

它是：

- 流程导向的
- 可执行的
- 适合部署、重新运行、回滚或自动化

它不是：

- 仅仅是一个提示或建议
- 仅仅是一个 Skill 描述

使用工作流的场景：

- 可重复的流程
- 编排任务
- 多步骤自动化
- 长期运行或支持审批的流程执行

## 晋升路径

预期的晋升路径是：

1. 任务发生在会话内部。
2. 系统记录完整的交互内容。
3. 评估决定哪些部分重要。
4. 重要信息被保留为记忆或体验。
5. 重复成功的方案会被转化为 Skills。
6. 稳定的多步骤 Skills 成为工作流。
7. recurrent 工作流成为定时或事件驱动的自动化。

这个晋升阶梯应保持方向性：

- 并非每个会话产物都会成为记忆
- 并非每个记忆项目都会成为 Skill
- 并非每个 Skill 都会成为工作流
- 并非每个工作流都应该被自动化

## 决策规则

使用这些规则来决定某物的归属。

### 将其放入会话历史，当

- 它主要用于审计追踪
- 它绑定到单个对话或运行
- 它可能以后有用，但尚未被评估

### 将其放入记忆，当

- 它可能会再次重要
- 它超越当前运行而存在
- 它有助于将来的召回或个性化

### 将其放入 Skill，当

- 它描述了一种可靠的方法
- 该方法可跨多个任务复用
- 它改进了智能体处理工作的方式

### 将其放入工作流，当

- 该流程有明确的步骤
- 状态转换很重要
- 它受益于明确的运行管理、部署或回滚

### 将其放在 cron/hooks 之后，当

- 该工作流可按计划重复执行
- 该工作流由外部事件触发
- 运维人员希望自动执行，而非手动调用

## 产品框架

CrawClaw 应该被解释为一个成长系统：

- 它行动
- 它记录
- 它学习
- 它记住
- 它复用
- 它自动化

这种框架比单独列出会话、记忆、Skills 和工作流等功能更有说服力。

## 当前架构映射

今天，项目已经包含了这个循环的主要部分：

- 行动： `agents/tools`、 `gateway`、 `plugin-sdk`、 `plugins`
- 记录： `sessions`、 `chat`、 `context-archive`、Gateway 网关执行界面
- 评估： `memory/extraction`、 `memory/session-summary`、 `memory/promotion`
- 保留： `memory/durable`、 `memory/experience`、 `memory/notebooklm`、 `memory/vector`、 `memory/graph`
- 召回： `memory/engine`、 `memory/search`、 `memory/recall`、 `agents/query-context`、 `agents/skills`
- 自动化： `agents/skills`、 `workflows`、 `cron`、 `hooks`

主要的设计挑战不再是功能缺失。而是保持这些层之间清晰的边界，并将它们呈现为一个连贯的系统。

## 后续文档

后续文档应该用以下内容扩展这个模型：

- 会话与记忆参考
- 记忆与 Skill 的区别参考
- Skill 与工作流参考
- 工作流晋升和自动化策略
- 面向运维人员的何时保留、晋升或自动化的指导
