---
summary: 浏览器 Control UI 剩余重构范围的单 PR 计划，覆盖 Sessions/Chat、Channels、Workflows、Agents、Usage、Approvals、Debug 与移动端收口
title: Control UI 剩余重构 PR 计划
---

# Control UI 剩余重构 PR 计划

这份文档把当前 **Stitch 重设计结果** 与 **现有代码已落地的第一轮改造** 收成一个明确的“剩余单 PR 范围”。

目标不是再开一轮新的信息架构讨论，而是把剩余的前端 UI 重构收成一个可以直接执行的 PR：

1. 保留现有浏览器 Control UI 的路由、控制器和 RPC 模型。
2. 继续沿用现有控制面 API，不发明新的 `settings.*` 或 REST 层。
3. 把 Stitch 定下来的视觉方向和页面结构继续落实到剩余高价值页面。
4. 在同一 PR 内完成主要页面的视觉、层级、交互和验证收口。

## 当前状态

### 已完成的第一轮 UI 落地

当前工作区里，已经落下了第一轮控制台重构：

- 全局 shell / 左侧导航 / 顶部状态带
- `Overview` 的控制台化收口
- `Config` 的运行带与操作层级
- `Chat` 里的 action feed / sidebar inspector 视觉统一

主要改动文件：

- `ui/src/ui/app-render.ts`
- `ui/src/ui/views/config.ts`
- `ui/src/styles/layout.css`
- `ui/src/styles/config.css`
- `ui/src/styles/components.css`
- `ui/src/styles/chat/sidebar.css`

### 仍未完成的页面

这次剩余 PR 需要继续覆盖：

- `Sessions / Chat`
- `Channels`
- `Workflows`
- `Agents`
- `Usage`
- `Approvals`
- `Debug / RPC`
- 移动端与浏览器侧 UI 回归收口

## 单 PR 范围

建议把剩余工作统一收成：

- `PR-UI-R2`

这不是“再做一半视觉稿”，而是**把剩余核心页面都推进到同一套 Control Plane 语言下**。

## 设计基线

这一轮必须继续遵守下面这些前提：

### 1. 保留现有架构

- 前端继续使用现有浏览器应用结构：
  - `ui/src/ui/app-render.ts`
  - `ui/src/ui/views/*`
  - `ui/src/ui/controllers/*`
- 不重做路由系统
- 不引入第二套页面框架
- 不把现有视图重写成另一套产品

### 2. 保留现有 API 对接模型

- 继续围绕现有 control-plane RPC 方法设计页面
- 配置页继续走：
  - `config.get`
  - `config.schema`
  - `config.patch`
  - `config.set`
  - `config.apply`
- 前端 capability 继续尊重：
  - `channels.login.*`
  - `exec.approvals.node.*`

### 3. 视觉方向保持一致

沿用已经确定的控制台语言：

- 高信息密度
- 工程控制台气质
- 左 rail + 顶部状态带
- 单色系 + 数据型 mono 信息
- 更明确的状态块、工具面板、inspect pane、timeline / log / diff 感

## 页面级实施范围

### A. Sessions / Chat

#### 目标

把当前聊天页从“功能完整但视觉层级分散”的状态，推进到更接近 Stitch 的三层 operator console：

- 会话上下文
- 主聊天流
- 右侧 inspect / markdown / tool output pane

#### 范围

- `ui/src/ui/views/chat.ts`
- `ui/src/styles/chat/*.css`
- `ui/src/styles/components.css`

#### 重点

- 强化会话切换与当前运行态的结构层级
- 统一消息流、工具输出、action feed 的操作面板语言
- 强化右侧 sidebar 的 inspect / markdown / raw details 感
- 收紧 compose 区与长会话区域的空间关系

#### API 对接

- `sessions.*`
- `sessions.messages.subscribe`
- `sessions.messages.unsubscribe`
- `sessions.send`
- `sessions.abort`
- `sessions.compact`
- `sessions.usage*`

#### 验收

- 聊天主区、工具执行、inspect side pane 视觉上属于同一控制台语言
- 长会话与高密度信息下仍可读
- 不破坏现有发送、停止、切会话、附件、slash command 主链

### B. Channels

#### 目标

把渠道页收成“运维化的渠道状态中心”，而不是泛化配置页。

#### 范围

- `ui/src/ui/views/channels.ts`
- `ui/src/ui/controllers/channels.ts`
- 相关样式文件

#### 重点

- 渠道状态总览统一成同构卡片/表格
- 明确区分：
  - configured
  - connected
  - degraded
  - unavailable
  - capability-missing
- 对 `channels.login.*` 做更清楚的 gated interaction

#### API 对接

- `channels.status`
- `channels.login.start`
- `channels.login.wait`

#### 验收

- 用户一眼能看出哪些渠道是可用、待登录、不可用、当前实例不支持
- 登录流程按钮只在 capability 存在时出现

### C. Workflows

#### 目标

把 workflow 页从“列表 + 操作”进一步推成“定义 + 运行态”的双层控制台。

#### 范围

- `ui/src/ui/views/workflows.ts`
- `ui/src/ui/controllers/workflows.ts`
- 相关 workflow 组件

#### 重点

- 统一 workflow list / detail / runs / versions / diff 的层级
- 更清楚地呈现：
  - definition
  - deployment state
  - run state
  - rollback / republish / deploy
- 把 diff、version、run timeline 的信息密度收齐

#### API 对接

- `workflow.list`
- `workflow.get`
- `workflow.match`
- `workflow.versions`
- `workflow.diff`
- `workflow.runs`
- `workflow.status`
- `workflow.enable`
- `workflow.disable`
- `workflow.archive`
- `workflow.unarchive`
- `workflow.delete`
- `workflow.update`
- `workflow.deploy`
- `workflow.republish`
- `workflow.rollback`
- `workflow.run`
- `workflow.cancel`
- `workflow.resume`

#### 验收

- workflow 页可作为独立的部署与运行控制台使用
- 关键动作有明确主次和确认感

### D. Agents

#### 目标

把 agent 列表和 inspect 页收成“可观察的运行实体面板”。

#### 范围

- `ui/src/ui/views/agents.ts`
- `ui/src/ui/controllers/agents.ts`
- `agent.inspect` 相关展示组件

#### 重点

- 强化 agent identity、runtime state、capability、linked session/workflow/tool 的关系
- `agent.inspect` 页面要更像工程 introspection，而不是资料卡片

#### API 对接

- `agents.list`
- `agent.inspect`
- `tools.effective`

#### 验收

- inspect 页结构清晰
- 能快速读出 agent 当前角色、能力、依赖和运行态

### E. Usage

#### 目标

把 usage 页从“统计展示”推进到“可追溯成本与 usage 控制台”。

#### 范围

- `ui/src/ui/views/usage.ts`
- `ui/src/ui/controllers/usage.ts`
- `ui/src/styles/usage.css`

#### 重点

- 统一总览、趋势、会话 usage、usage logs 的层级
- 图表、表格、日志三种密度要统一语言
- 不要只留图表，应保留细节表与 drill-down

#### API 对接

- `usage.status`
- `usage.cost`
- `sessions.usage`
- `sessions.usage.timeseries`
- `sessions.usage.logs`

#### 验收

- 使用量页同时适合总览和排查
- session 级 usage 与全局 usage 有清晰关系

### F. Approvals

#### 目标

把审批页从“能改设置”推进成“策略 + 作用域 + 当前状态”统一面。

#### 范围

- `ui/src/ui/views/exec-approvals.ts`
- `ui/src/ui/controllers/exec-approvals.ts`

#### 重点

- 统一 gateway approvals 与 node approvals 的信息结构
- capability 缺失时明确显示 unavailable 语义
- 强化策略编辑器、作用域说明和当前 effective state

#### API 对接

- `exec.approvals.get`
- `exec.approvals.set`
- `exec.approvals.node.get`
- `exec.approvals.node.set`

#### 验收

- gateway / node 审批模型在视觉和交互上保持同一产品语言
- capability 不存在时不误导用户操作

### G. Debug / RPC

#### 目标

把 debug 页收成“方法、能力、hello/bootstrap、raw RPC 调试”的正式技术面板。

#### 范围

- `ui/src/ui/views/debug.ts`
- `ui/src/ui/controllers/debug.ts`

#### 重点

- 更清楚展示：
  - method catalog
  - capability list
  - hello/bootstrap
  - raw request / response
  - preferred name / alias
- 保持技术感，但不要只是 JSON dump

#### API 对接

- 现有 debug/raw methods
- `hello` / bootstrap / control-plane contract metadata

#### 验收

- 高级用户可以直接用这页排查 capability、scope、method alias

## 跨页面收口项

### 1. 统一状态语言

所有页面继续统一：

- online / offline
- active / idle / waiting / blocked
- configured / connected / unavailable
- dirty / saved / applied
- capability present / missing

### 2. 统一面板语言

所有高密度信息继续统一：

- detail side pane
- toolbar / action row
- table / dense list
- code / rpc / diff / timeline well
- status pill / badge / chip

### 3. 移动端与缩窄宽度

这一 PR 不能只改桌面。

至少要收这些场景：

- shell 在窄宽度下不破版
- chat split pane 可退化
- config runtime strip 可折叠成单列
- channels / workflow / usage 的高密度卡片和表格可下沉

## 实施顺序

建议在同一个 PR 里，按下面顺序推进：

1. `Sessions / Chat`
2. `Approvals`
3. `Channels`
4. `Workflows`
5. `Agents`
6. `Usage`
7. `Debug / RPC`
8. 移动端与视觉统一回归

原因：

- `Chat` 和 `Approvals` 离当前已完成的 shell / config 最近，收益最大
- `Channels` / `Workflows` 最能体现 control plane 价值
- `Agents` / `Usage` / `Debug` 更适合在视觉语言稳定后统一收口

## 测试与验证

这一 PR 的最小验证要求：

### Focused tests

- `ui/src/ui/controllers/channels.test.ts`
- `ui/src/ui/controllers/workflows.test.ts`
- `ui/src/ui/controllers/agents.test.ts`
- `ui/src/ui/controllers/usage.test.ts`
- `ui/src/ui/controllers/exec-approvals.test.ts`
- `ui/src/ui/controllers/debug.test.ts`（如果已有）
- 新增或补齐需要的 browser / view focused tests

### 门禁

- `pnpm lint`
- `pnpm check`

### 环境限制说明

如果浏览器型测试依赖 Playwright，可接受当前环境因 browser binary 缺失而单独说明，但不能把真实断言失败混成环境问题。

## 完成定义

这个“剩余 UI 单 PR”完成后，应达到：

1. 浏览器 Control UI 的主要一级页面都进入同一套控制台视觉与交互语言。
2. 页面不再呈现“shell 已重做，但核心视图还停留在旧风格”的割裂感。
3. 主要控制面页面都已与当前 control-plane RPC contract 对齐。
4. 用户可以把 UI 当作真实 control plane 使用，而不是 demo / dashboard。

## 非目标

这次 PR 不做这些事：

- 不重写前端技术栈
- 不新增新的设置 API
- 不重做后端 RPC 设计
- 不把每个页面都拆成全新的路由架构
- 不顺手清理所有前端历史实现

一句话：

**这次剩余 PR 的目标，是把现有浏览器 Control UI 收成统一、可用、可继续维护的工程控制台。**
