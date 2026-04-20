---
summary: 按 Stitch 项目页面逐页 1:1 重写浏览器 Control UI 的单 PR 计划，明确与过渡版新壳迁移区分
title: Control UI Stitch 1:1 重写 PR 计划
---

# Control UI Stitch 1:1 重写 PR 计划

> 说明：这份文档不是 canonical screen 清单。当前唯一的页面基线以 `project-control-ui-stitch-baseline.md` 为准；本文里若提到旧 screen 名称，只能按历史分析理解，不能作为实现或评审基线。

这份文档对应的是一轮**严格按 Stitch 设计稿逐页重写**浏览器 Control UI 的 PR 计划。

它和之前的“新壳迁移”不是一回事：

- 之前那轮工作已经把 Control UI 从旧后台风格推进到了新的 control-plane 方向。
- 但那一轮本质上仍然是：
  - 旧页面逻辑
  - 旧页面编排
  - 新壳层和新视觉语言的迁移版
- 它不能满足下面这个更强的要求：
  - **完全按照 Stitch 那套页面结构重新写**

所以，这份文档的目标不是再做 polish，也不是继续在旧页面上补新的 strip，而是：

1. 以 Stitch screen 为唯一页面基线
2. 逐页重写主布局与页面编排
3. 在现有 API 与 Lit 架构上完成真正的页面级重建

## 结论先说

如果标准是：

> “完全按照 Stitch 那套重新写，而不是在旧 UI 上做增强版迁移”

那么当前代码状态**还不算完成**。

已推送的版本只能视为：

- `transitional shell rewrite`
- `stitch-inspired migration`

而不是：

- `stitch-parity rewrite`

## 这轮 PR 的定位

建议把这一轮收成：

- `PR-UI-S4`

其中：

- `PR-UI-S3`
  - 代表前一轮基于 Stitch 方向的壳层迁移和主页面新壳收口
- `PR-UI-S4`
  - 代表真正按 Stitch 稿逐页 1:1 重写

## 当前版本为什么还不达标

虽然当前代码已经完成了：

- app shell 重写
- Overview / Sessions / Chat / Config 的新壳迁移
- Channels / Workflows / Approvals / Agents / Usage / Debug 的控制台化迁移

但仍存在 4 类关键偏差：

### 1. 页面骨架比例仍不是 Stitch 那套

包括但不限于：

- 顶部状态带高度与信息层次
- 左侧 rail 的节奏和 header 编排
- stage 区域的首屏比例
- 主内容与 inspector 的宽度关系

### 2. 页面编排仍保留大量旧界面逻辑

尤其是：

- `Overview`
- `Sessions / Chat`
- `Approvals & Config`

这些页面虽然已经变成新壳，但内部信息结构还不是 Stitch 稿里的主次关系。

### 3. 组件语言仍然是“旧组件换皮 + 局部重组”

当前很多内容仍然是：

- 旧表格逻辑
- 旧 panel 逻辑
- 旧内容顺序
- 新 shell + 新样式包裹

而不是：

- Stitch 稿里的组件关系
- Stitch 稿里的空间语言
- Stitch 稿里的信息优先级

### 4. 用户一眼仍可能觉得“是老界面的增强版”

如果用户不看细节，只看整体感知：

- 还不是“全新控制面”
- 而更像“很深的一轮后台 UI 升级”

这正是 `PR-UI-S4` 要解决的问题。

## 设计基线

这轮的页面基线，不再以当前代码为准，而明确以 Stitch 项目为准：

- 项目：`CrawClaw Control Plane UI v2`
- 项目 ID：`projects/12343540501702426619`

当前优先采用的 canonical 主 screen：

- `System Overview / 系统概览`
- `Sessions & Chat / 会话控制台`
- `Channels / 渠道管理`
- `Workflows / 工作流运行`
- `Agents / 智能体自省`
- `Usage / 用量与观察`
- `Config / 审批与配置`
- `Debug / RPC 调试`

其他 canonical 页面：

- `Memory / 记忆`
- `Agent Runtime / 后台运行`
- `Channel Catalog / 渠道目录`
- `Feishu Channel Editor / 飞书编辑器 (Final)`

## 技术边界

这轮仍然遵守下面这些边界：

### 保留

- 现有 WebSocket RPC / control-plane API
- 现有 controller 层
- Lit 技术栈
- 现有路由结构
- `config.get / schema / patch / set / apply`
- capability gating
- preferred names / legacy alias 的调用规则

### 不做

- 不改 transport
- 不新做 `settings.*`
- 不重写 controller 层数据模型
- 不迁移框架
- 不在这一轮扩业务能力

一句话：

- **重写页面**
- **不重写前端栈和后端接口**

## 重写标准

这轮必须满足的标准只有一个：

> 如果把 Stitch 页面和浏览器里的实际页面并排看，结构、层级和气质必须属于同一套产品，而不是“像”。

也就是说，不接受：

- 只对齐配色
- 只对齐 spacing
- 只对齐卡片样式
- 只对齐顶部壳层

必须对齐：

1. 页面首屏结构
2. 信息优先级
3. 主副栏关系
4. 操作区与观察区的分离方式
5. 表格、日志、inspect、配置、diff 的空间编排

## 单 PR 范围

建议这一轮仍然收成一个 PR，但内部按 4 个大块推进。

### A. Overview + Sessions + Approvals & Config

这是第一优先级，也是落差最大的 3 组页面。

#### 要求

- `Overview`
  - 改成 Stitch 的运行总览页，不再沿用旧 dashboard 的内容堆叠逻辑
- `Sessions / Chat`
  - 改成 Stitch 那套真正的 operator console 分栏
- `Approvals & Config`
  - 改成 Stitch 的双域控制页，而不是两个旧页面拼在同一设计语言里

#### 验收

- 用户第一眼就能看出这 3 页不再是旧页面进化版
- 这 3 页应成为全站新的视觉和结构模板

### B. Channels + Workflows

这两组是运维意味最强的页面，必须和 Stitch 的控制台语义完全一致。

#### 要求

- `Channels`
  - 更像渠道基础设施控制台，而不是渠道卡片列表页
- `Workflows`
  - 更像部署与运行控制面，而不是 registry 详情页 + diff panel 的组合

#### 验收

- 页面编排优先体现“操作面”
- 不是“信息面”套上操作按钮

### C. Agents + Usage + Debug

这三组页面是观察与诊断面。

#### 要求

- `Agents`
  - 更像 introspection console
- `Usage`
  - 更像 observability console
- `Debug`
  - 更像 protocol / surface / raw RPC console

#### 验收

- 这三页必须在结构上和前两批页面属于同一产品
- 不能还停留在旧“功能页”思路

### D. 最终 parity 收口

这一块不做新功能，只做 Stitch 对齐收尾：

- spacing parity
- typography parity
- panel layering parity
- mobile / browser polish
- screenshot / browser smoke

## 页面级实施顺序

建议固定按这个顺序推进：

1. `Overview`
2. `Sessions / Chat`
3. `Approvals & Config`
4. `Channels`
5. `Workflows`
6. `Agents`
7. `Usage`
8. `Debug / RPC`

原因：

- 前 3 组最能决定“是不是全新界面”
- 后 5 组在新模板稳定后更容易一致化

## API 对接原则

这轮 UI 重写时，仍然必须严格对齐现有 API：

### Overview

- `system.health`
- `system.status`
- `system-presence`
- `system.heartbeat.last`
- `channels.status`

### Sessions / Chat

- `sessions.*`

### Channels

- `channels.status`
- `channels.login.*`（capability-gated）

### Workflows

- `workflow.*`

### Agents

- `agents.list`
- `agent.inspect`

### Usage

- `usage.*`
- `sessions.usage*`

### Approvals

- `exec.approvals.*`
- `exec.approvals.node.*`（capability-gated）

### Config

- `config.get`
- `config.schema`
- `config.patch`
- `config.set`
- `config.apply`

### Debug

- hello/method surface
- preferred names
- alias surface
- raw RPC call panel

## 测试与验收

这轮必须至少满足下面这些门禁：

### Focused tests

- `overview`
- `sessions`
- `chat`
- `channels`
- `workflows`
- `agents`
- `usage`
- `debug`
- `config`
- `approvals`

### Browser / smoke

至少需要重新确认：

- navigation browser smoke
- shell route smoke
- 关键页面的首屏结构断言

### 全局门禁

- `pnpm check`

## 完成标准

这轮 PR 完成后，必须能回答“是”的问题：

1. 用户打开 dashboard，一眼会觉得这是新产品吗？
2. 页面结构是否能和 Stitch 页面一一对应？
3. 是否已经摆脱“旧界面增强版”的感觉？
4. 是否已经不是“看起来接近”，而是“页面逻辑和布局都换了”？

只要其中任何一个答案还是“不是”，这轮就不算完成。

## 当前建议

后续执行时，不建议再以当前代码页面为主进行 incremental patch。

更合适的方式是：

1. 先把当前 Stitch 对应 screen 当作页面规格
2. 逐页重排 DOM 结构
3. 再把现有 controller / data source 接进去

顺序必须是：

- **先对齐页面结构**
- **再接已有数据**

而不是：

- 先保留旧页面结构
- 再一点点“改得像”

这两条路线的结果完全不同。
