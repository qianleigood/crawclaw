---
summary: 为 Control UI 增加“后台运行 / Agent Runtime”模块的 PR 计划，用统一视图观察 special agent、subagent、ACP 和后台任务运行情况
title: Control UI Agent Runtime 模块 PR 计划
---

# Control UI Agent Runtime 模块 PR 计划

这份文档对应的是一轮**把后台 agent 运行情况正式接进浏览器 Control UI** 的 PR 计划。

目标不是把 `special agent` 当成一个抽象名词直接搬进导航，而是把用户真正关心的内容做成一个可用的运行面板：

- 哪些后台任务在跑
- 哪些失败了
- memory / verification / subagent 分别在做什么
- 哪条运行需要处理
- 当前还能执行哪些动作

一句话：

**做一个“后台运行 / Agent Runtime”模块，而不是做一个“Special Agent 概念页”。**

## 结论先说

当前 CrawClaw 里已经有一套完整的后台 agent 运行底座，但它主要暴露在：

- `tasks` 账本
- `special-agent substrate`
- `agent inspect`
- memory / dream / session-summary / verification 等专项文档

见：

- [后台任务](/automation/tasks)
- [Special Agent Substrate](/debug/special-agent-substrate)
- [Memory 模块 PR 计划](/concepts/project-control-ui-memory-pr-plan)

这些能力已经足够支持 UI，但目前还缺一个**统一的控制面视图**：

- 现在用户只能零散地在 `Memory`、`Debug`、`Tasks CLI`、日志里分别看
- 前端没有一个“后台运行到底发生了什么”的入口

所以这轮 PR 的目标是：

- 把后台运行变成一个单独的产品模块
- 统一看 task、special agent、subagent、ACP 的运行情况
- 让普通用户不用理解 substrate，也能理解“现在系统在后台做什么”

## 为什么不直接做一个 `Special Agent` 页面

因为 `special agent` 是**运行机制**，不是用户心智对象。

用户关心的是：

- 记忆有没有更新
- 会话摘要有没有跑完
- verification 为什么失败
- 哪些后台任务堵住了

而不是：

- 这是不是 `embedded_fork`
- 这是不是 `special-agent substrate`
- 这个 definition 的 transcript policy 是什么

所以直接做 `Special Agents` 页，会继续把 UI 做成工程术语页。

更合适的做法是：

- 对外叫：
  - `Background work`
  - `Agent runtime`
  - 中文建议：`后台运行`
- 对内再按：
  - task runtime
  - spawnSource
  - special-agent definition
  - session / run
    去组织数据

## 这轮 PR 的定位

建议把这轮收成：

- `PR-UI-R1`

它和已经完成的：

- `Control UI Stitch 重写`
- `Control UI 产品化重构`
- `Memory 模块`

不是重复关系，而是下一层补全：

- 让用户看得到后台维护型 agent 和 detached work 在干什么

## 当前代码现实

### 已有能力

#### 1. Special-agent substrate

当前已接入 substrate 的后台 agent：

- `session summary`
- `memory extraction`
- `dream`
- `verification`

见：

- [registry.ts](src/agents/special/runtime/registry.ts)
- [special-agent-substrate.md](docs/zh-CN/debug/special-agent-substrate.md)

#### 2. 共享可观测性

special-agent runtime 已经会记录：

- event
- history
- usage
- completion
- run state

见：

- [observability.ts](src/agents/special/runtime/observability.ts)

#### 3. 统一任务账本

当前 detached work 已统一收进 tasks ledger：

- ACP
- subagent
- cron
- CLI

见：

- [tasks.md](docs/automation/tasks.md)

### 当前还缺

#### 1. Control UI 没有统一的后台运行页面

现在用户要分散地去看：

- `Memory`
- `Debug`
- `agent inspect`
- CLI 的 `tasks list / tasks show`

#### 2. 没有为前端准备的 `agent-runtime.*` control-plane API

现在虽然有：

- `tasks` 相关 CLI
- runtime observability
- archive/run capture

但没有一套专门面向前端的：

- 列表
- 详情
- 过滤
- 状态汇总
- 动作接口

## 模块命名建议

不要叫：

- `Special Agents`
- `Maintenance Agents`
- `Substrate`

建议叫：

- `Agent Runtime`
- 中文：`后台运行`

原因：

- 对普通用户更直观
- 能覆盖 special agent、subagent、ACP、task-backed runs
- 后续扩到更多 runtime 类型也不需要改名

## 导航位置

建议一级导航调整为：

- Overview
- Sessions
- Channels
- Workflows
- Agents
- Memory
- `Agent Runtime`
- Usage
- Config
- Debug

也就是：

- 放在 `Memory` 后
- 放在 `Usage` 前

这样语义最清楚：

- `Agents` 看谁在工作
- `Memory` 看长期记忆
- `Agent Runtime` 看后台运行
- `Usage` 看成本和用量

## 页面目标

这个页面要回答 4 个问题：

1. 当前有没有后台运行中的 agent / task
2. 最近哪些运行失败了
3. 这些运行属于哪个领域
   - memory
   - verification
   - subagent
   - acp
4. 如果失败或卡住，我下一步该做什么

## 页面骨架

延续当前新 UI 壳：

- 页头：核心指标
- 左 rail：过滤与分类
- 主区：运行列表
- 右 rail：详情与动作

## 页头指标

建议固定 4 个：

1. `Running`
   - 当前运行中的后台任务数
2. `Failed`
   - 最近失败数
3. `Waiting`
   - queued / pending 数
4. `Last completed`
   - 最近完成时间

这些值应该来自统一 runtime/task 聚合结果，而不是页面自己拼。

## 左 rail

左 rail 不是页面导航，而是运行分类和过滤器。

### 分类

- `All`
- `Memory`
- `Verification`
- `Subagents`
- `ACP`
- `Cron`
- `CLI`

### 细过滤

- `Running`
- `Failed`
- `Waiting`
- `Completed`
- `Needs attention`

### 作用域过滤

- `Agent`
- `Session`
- `Task ID`
- `Run ID`

## 主区

主区优先做成“运行列表”，不是纯详情页。

### 列表字段

- Type
- Status
- Started
- Updated
- Parent session
- Parent run
- Task ID
- Summary

### 状态颜色

- running: 蓝
- queued/waiting: 黄
- succeeded: 绿
- failed/timed_out/lost: 红
- cancelled: 灰

### 行级提示

每一条运行记录都要尽量用产品语言展示：

- `Memory summary refresh for session ...`
- `Verification run for workflow ...`
- `Background subagent for session ...`

不要默认只展示：

- `spawnSource`
- `definitionId`
- `task kind`

这些应该放在详情里。

## 右 rail

右 rail 打开一条记录后显示：

### 基本信息

- Label
- Type
- Status
- Started
- Updated
- Parent session
- Parent run
- Child session
- Task ID

### 运行契约

只在高级区显示：

- `spawnSource`
- `definitionId`
- `executionMode`
- `transcriptPolicy`
- `toolPolicy`
- `cachePolicy`

### 可观测性

- usage
- history message count
- recent lifecycle events
- completion summary

### 动作

- `Open session`
- `Open task`
- `Copy run ID`
- `Retry`
- `Cancel`

如果没有能力支持，就只显示可执行的动作，不要空放 disabled 墙。

## 与现有页面的关系

这个模块不替代现有页面，只做统一视图。

### `Memory`

仍然保留 memory 领域页：

- Provider
- Dreaming
- Session Summaries
- Prompt Journal

但 `Memory` 页应该出现跳转：

- `Open in Agent Runtime`

用于看更细的后台运行。

### `Sessions`

如果当前会话有关联后台任务，右 rail 应增加：

- `Background work`
- 最近一次 special-agent / subagent / memory job

### `Agents`

可以加一个摘要卡：

- `Background work for this agent`

### `Debug`

Debug 仍保留 raw 能力，但后台运行不应再靠 Debug 来承担主入口。

## API 设计建议

这页不建议直接前端拼：

- `tasks`
- `special-agent registry`
- `context archive`
- `agent inspect`

更合理的是补一组专用接口：

- `agentRuntime.summary`
- `agentRuntime.list`
- `agentRuntime.get`
- `agentRuntime.cancel`
- `agentRuntime.retry`

如果第一版不想起全新命名，也可以先走：

- `tasks.list`
- `tasks.get`
- `tasks.cancel`

再加一层：

- `specialAgent.runtime.get`
- `specialAgent.runtime.events`

但从 UI 视角，我更建议一开始就用统一的：

- `agentRuntime.*`

这样页面层不用关心“这个是 task 还是 special-agent”。

## 最小数据模型

### `agentRuntime.summary`

返回：

- running
- queued
- failed
- completed
- lastCompletedAt
- byKind
- bySource

### `agentRuntime.list`

返回列表项：

- `id`
- `kind`
- `status`
- `label`
- `summary`
- `spawnSource`
- `taskId`
- `runId`
- `parentRunId`
- `parentSessionKey`
- `childSessionKey`
- `startedAt`
- `updatedAt`
- `endedAt`

### `agentRuntime.get`

返回详情：

- 列表项全部字段
- usage
- historyMessageCount
- completion summary
- recent events
- runtime metadata
- contract metadata

## 第一版范围

建议只做：

### 页面

- 新增一级页：`Agent Runtime`

### 数据

- 列表
- 详情
- 基本过滤
- 失败/运行/等待摘要

### 动作

- `Open session`
- `Cancel`

### 不做

- 复杂图表
- e2e timeline 可视化
- advanced diff
- 过多 raw JSON 区

## 第二版范围

后面再补：

- event timeline
- retry
- by-source breakdown
- per-agent / per-session linking
- runtime/archive drilldown

## 验收标准

完成后应满足：

1. 普通用户能看懂后台有没有任务在跑
2. 失败项可以一眼定位，并知道下一步去哪里
3. memory / verification / subagent 不再散落在多个页面里排查
4. 不暴露 substrate 术语作为主 UI 语言
5. 继续复用真实 runtime 数据，不引入假数据

## 文件范围

第一版预计会改：

- `ui/src/ui/rewrite/routes.ts`
- `ui/src/ui/rewrite/app-root.ts`
- `ui/src/styles/rewrite.css`
- `ui/src/ui/controllers/agent-runtime.ts`

并新增：

- `src/gateway/server-methods/agent-runtime.ts`
- `src/gateway/protocol/schema/agent-runtime.ts`

## 建议提交信息

建议提交信息：

`feat: add control ui agent runtime module`
