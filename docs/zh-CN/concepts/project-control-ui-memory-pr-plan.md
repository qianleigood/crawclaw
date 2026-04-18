---
summary: 基于现有 Memory runtime 与 NotebookLM 能力，把 Memory 作为 Control UI 一级模块接入的 PR 计划
title: Control UI Memory 模块 PR 计划
---

# Control UI Memory 模块 PR 计划

这份文档对应的是一轮**把 Memory 正式接入浏览器 Control UI** 的 PR 计划。

目标不是在 `Config` 或 `Debug` 页里塞几块记忆状态，而是把 Memory 做成一个独立一级模块：

- 有自己的导航入口
- 有自己的工作台页面
- 有自己的运行状态、动作、历史与 scope

## 结论先说

当前项目里，Memory 的运行能力已经很完整，但主要暴露在：

- CLI：
  - `crawclaw memory status`
  - `crawclaw memory refresh`
  - `crawclaw memory login`
  - `crawclaw memory dream status/history/run`
  - `crawclaw memory session-summary status/refresh`
  - `crawclaw memory prompt-journal-summary`
- runtime：
  - `src/memory/**`
  - `src/memory/notebooklm/provider-state.ts`
  - `src/memory/cli-api.ts`

而当前 Control UI 还缺两件事：

1. **没有 `Memory` 一级页面**
2. **没有正式的 `memory.*` control-plane RPC**

所以这轮 PR 的本质是：

- **先补控制面接口**
- **再把 Memory 页面接进新 UI 壳**

## 这轮 PR 的定位

建议把这一轮收成：

- `PR-UI-M1`

它和之前的 UI 重写 PR 不冲突，也不属于 `Config` 页的附属优化。

它是：

- 新 UI 完成之后的**第一个新一级模块**
- 也是 Control UI 第一次把“记忆运行时”从 CLI 能力提升成正式页面

## 为什么 Memory 必须是一级模块

Memory 不适合继续塞在 `Config` 或 `Debug` 里，原因很明确：

### 1. 它不是配置页

Memory 不只是：

- 开关
- 配置项
- schema 字段

它还包含：

- provider readiness
- login / refresh 动作
- auto-dream 运行态
- session summary 状态
- prompt journal 汇总

### 2. 它也不是纯调试页

Memory 不是 raw JSON dump 或 RPC 实验台。

它需要的是：

- 运行面板
- scope filter
- status + action
- recent runs / recent events
- summary 预览

### 3. 它本身就是独立领域

项目结构上，Memory 已经是独立域：

- `src/memory`
- `src/memory/engine`
- `src/memory/notebooklm`
- `src/memory/session-summary`
- `src/memory/dreaming`

所以 UI 也应该对应成独立模块。

## 当前现实约束

这一轮设计必须尊重下面这些现实：

### 已有

- Memory runtime 已存在
- NotebookLM provider state 字段稳定
- CLI 命令面完整
- 新 UI 壳、导航、rail/main 布局已经完成

### 尚缺

- `ui/src/ui/rewrite/routes.ts` 里没有 `memory`
- `src/gateway/server-methods/` 里没有正式 `memory.*`
- 前端 controller 层里没有 memory controller

一句话：

- **Memory 页面现在不能只靠前端写壳**
- **必须同步补 control-plane API**

## 页面在导航里的位置

建议左侧导航调整为：

- Overview
- Sessions
- Channels
- Workflows
- Agents
- `Memory`
- Usage
- Config
- Debug

即：

- 放在 `Agents` 后
- 放在 `Usage` 前

这样最符合语义：

- `Agents` 看当前执行体
- `Memory` 看长期记忆与知识状态
- `Usage` 看成本和观测

## 页面结构

Memory 页面继续沿用当前新 UI 的基本骨架：

- 页头：page header + 4 个核心指标
- 左 rail：模块切换与 scope/filter
- 主区：当前模块工作台
- 右 rail：health / recommended action / recent events

## Memory 页头

页头不允许放假数据，只接真实状态。

建议固定 4 个指标：

1. `Provider`
   - `ready / degraded / expired / disabled`
2. `Dreaming`
   - `enabled / disabled`
3. `Session summaries`
   - `active / stale / none`
4. `Recommended action`
   - `memory login / memory refresh / memory status / none`

## 左 rail 模块

左 rail 固定 4 个工作区：

1. `Provider`
2. `Dreaming`
3. `Session Summaries`
4. `Prompt Journal`

默认落在：

- `Provider`

## A. Provider

这是 Memory 页的默认面板，也是第一优先级。

### 主区

#### NotebookLM provider 状态卡

字段：

- `Lifecycle`
- `Ready`
- `Reason`
- `Profile`
- `Notebook ID`
- `Auth source`
- `Last validated`
- `Last refresh`
- `Next probe`
- `Next allowed refresh`
- `Details`

### 右 rail

动作：

- `Refresh provider`
- `Run login flow`
- `Copy command`
- `Open memory config`

### 空态

- `NotebookLM memory is disabled in config.`
- `配置中未启用 NotebookLM 记忆。`

### 数据来源

直接映射 `NotebookLmProviderState`：

- `enabled`
- `ready`
- `lifecycle`
- `reason`
- `recommendedAction`
- `profile`
- `notebookId`
- `authSource`
- `lastValidatedAt`
- `lastRefreshAt`
- `nextProbeAt`
- `nextAllowedRefreshAt`
- `details`

## B. Dreaming

这是 durable memory 的运维面。

### 顶部 filter bar

- `Agent`
- `Channel`
- `User`
- `Scope key`

### 顶部摘要带

- `Enabled`
- `Scope`
- `Last success`
- `Last failure`
- `Last skip reason`
- `Lock owner`

### 主区

#### Auto dream state

字段：

- `minHours`
- `minSessions`
- `scanThrottleMs`
- `Last attempt`
- `Last success`
- `Last failure`
- `Last skip reason`
- `Lock owner`

#### Recent dream runs

表格字段：

- `Status`
- `Scope`
- `Trigger`
- `Run ID`
- `Summary / Reason`
- `Created at`

### 右 rail

动作：

- `Run now`
- `Dry run`
- `Force run`

### 空态

- `No dream runs found for the current scope.`
- `当前 scope 没有 dream 运行记录。`

## C. Session Summaries

这是最适合和 Sessions 页面联动的一块。

### 左 rail

- session 搜索
- session 列表
- 每项显示：
  - session display name
  - session id
  - updatedAt
  - summary 状态

### 主区

#### Summary file state

字段：

- `Agent`
- `Session ID`
- `Summary path`
- `Exists`
- `Updated`
- `Last summarized message`
- `Last summary update`
- `Tokens at last summary`
- `In progress`

#### Summary 正文区块

- `Current State`
- `Task Specification`
- `Key Results`
- `Errors & Corrections`

### 右 rail

动作：

- `Refresh summary`
- `Force refresh`
- `Open session`
- `Open file path`

### 空态

- `Select a session to inspect summary state.`
- `选择一个会话以查看摘要状态。`

## D. Prompt Journal

这是记忆调优/审计页，不是普通用户的首要入口。

### 顶部过滤

- `Date`
- `Days`
- `File`
- `Directory`

### 顶部摘要

- `Prompt assemblies`
- `After-turn decisions`
- `Durable extractions`
- `Knowledge writes`

### 主区

- `Top extraction reasons`
- `Save rate`
- `Write outcomes`
- `Daily trend`

### 右 rail

- `Summarize today`
- `Summarize last N days`
- `Open raw JSONL`

### 空态

- `Prompt journal is disabled or no files were found.`
- `Prompt journal 未启用，或没有找到文件。`

## 页面间联动

除了独立的 `Memory` 页，还建议补 3 个轻量入口：

### 1. Overview

新增一张 `Memory health` 卡：

- provider lifecycle
- recommended action
- dream enabled
- summary freshness

### 2. Sessions

右 rail 增一块：

- `Session memory summary`
- 显示当前 session 的 summary state
- 提供：
  - `Open in Memory`
  - `Refresh summary`

### 3. Agents

增加一块：

- 当前 agent 的 memory scope 状态
- dream scope quick link
- session summary coverage quick link

## 必须补的 control-plane API

这轮 UI 真要落地，建议新增下面这组 gateway methods：

- `memory.status`
- `memory.refresh`
- `memory.login`
- `memory.dream.status`
- `memory.dream.history`
- `memory.dream.run`
- `memory.sessionSummary.status`
- `memory.sessionSummary.refresh`
- `memory.promptJournal.summary`

### 可选 capability

- `memory.provider`
- `memory.dream`
- `memory.sessionSummary`
- `memory.promptJournal`

这样 UI 就能像现在 `channels.login.*` 一样按 capability gating，而不是靠页面硬猜。

## 建议的 params / result 范围

这轮文档不把每个字段展开到最终 TypeBox 层，但先冻结控制面范围：

### `memory.status`

返回 NotebookLM provider state：

- `enabled`
- `ready`
- `lifecycle`
- `reason`
- `recommendedAction`
- `profile`
- `notebookId`
- `authSource`
- `lastValidatedAt`
- `lastRefreshAt`
- `nextProbeAt`
- `nextAllowedRefreshAt`
- `details`

### `memory.dream.status`

返回：

- dream 是否启用
- 当前 scopeKey
- dreaming config 摘要
- durable scope state
- recent runs

### `memory.sessionSummary.status`

返回：

- summary path
- exists
- updatedAt
- runtime state
- 4 个 summary section 文本

### `memory.promptJournal.summary`

返回：

- files
- aggregate totals
- top extraction reasons
- save rate
- knowledge write outcomes

## 实施顺序

这一轮建议按 3 个子阶段推进，但仍可收成一个 PR：

### Phase A

先补控制面接口：

- `memory.status`
- `memory.refresh`
- `memory.dream.status`
- `memory.dream.history`
- `memory.dream.run`

同时接：

- memory capability descriptors

### Phase B

新增 `Memory` 页第一版，只做：

- `Provider`
- `Dreaming`

目标：

- 页面可读
- 状态可操作
- 真实数据接通

### Phase C

补：

- `Session Summaries`
- `Prompt Journal`
- `Overview / Sessions / Agents` 的轻量联动入口

## 非目标

这轮明确不做：

- 不改 transport
- 不改成 REST / GraphQL
- 不重写 memory runtime
- 不重写 CLI 语义
- 不做 notebook/note-taking 风格 UI
- 不在这轮把所有 memory 详情变成复杂图谱产品

一句话：

- **这是 Control Plane 的 Memory Console**
- **不是知识库应用**

## 验收标准

这轮完成后，应满足：

1. 左侧导航出现独立 `Memory`
2. `Memory` 页只显示真实状态与真实动作
3. NotebookLM provider、dream、session summary、prompt journal 都有明确工作区
4. 页面不再依赖 CLI 文案作为主交互，而是依赖正式 `memory.*` control-plane RPC
5. `Overview / Sessions / Agents` 至少能轻量联动到 Memory

## 这轮 PR 的一句话定义

> 把当前只存在于 CLI/runtime 里的 Memory 能力，提升成 Control UI 里的一个正式一级控制台模块。
