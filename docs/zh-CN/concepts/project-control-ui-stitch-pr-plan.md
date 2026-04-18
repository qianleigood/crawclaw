---
summary: 按 Stitch 新界面方案重写浏览器 Control UI 的单 PR 计划，覆盖新壳层、核心页面骨架迁移、组件语言统一与回归验证
title: Control UI Stitch 重写 PR 计划
---

# Control UI Stitch 重写 PR 计划

这份文档对应的是一轮**真正按 Stitch 新界面方案重写浏览器 Control UI** 的 PR 计划，而不是在现有 UI 外壳上继续做增量美化。

它解决的是一个已经确认的问题：

- 当前代码里的 Control UI 已经完成了一轮较深的控制台化收口。
- 但这轮落地本质上仍然是**旧页面骨架上的增强版**。
- 它并没有达到“用户一眼就能看出是 Stitch 那套全新控制面”的程度。

所以，这份 PR 计划的目标不是再做一次视觉 polish，而是把 UI 明确推进到：

1. 新的 app shell
2. 新的页面骨架
3. 新的控制台组件语言
4. 与现有 control-plane API 完整对接

## 适用场景

这份文档适用于下面这种情况：

- 你已经确认当前 UI 虽然是最新构建，但仍然“看起来像老界面”
- 你希望把 Stitch 项目中的新壳层、布局和界面语言真正搬进代码
- 你接受这是一轮**前端壳层重写**，而不是简单的 CSS 调整

## 这轮 PR 的定位

建议把这轮重写收成：

- `PR-UI-S3`

这里的 `S3` 表示第三阶段 UI 工作：

- `S1`：控制台第一轮骨架收口
- `S2`：剩余页面的控制台化增强
- `S3`：按 Stitch 新界面方案做真正的 UI 壳层重写

## 目标

这轮 PR 必须达到下面四个目标：

### 1. 用户一眼可识别为“新界面”

不再只是：

- 旧页面 + 新状态条
- 旧布局 + 新配色
- 旧容器 + 新模块样式

而是要完成：

- 新导航壳
- 新页面框架
- 新主内容布局
- 新的页面节奏

### 2. 严格基于现有 API

这轮仍然必须遵守当前 control-plane API：

- 不发明 REST 层
- 不发明 `settings.*`
- 不改变 `config.*` / `sessions.*` / `workflow.*` / `agents.*` / `usage.*` 的调用模型
- 继续遵守 capability gating 和 preferred names

### 3. 用 Stitch 的页面语言，而不是只借鉴配色

需要真正迁移的是：

- app shell 的布局逻辑
- page hero / status strip / context strip 的组织方式
- 表格、inspect pane、diff、RPC 面板的空间语言
- 运行态、配置态、审批态的“控制面可读性”

### 4. 保留代码架构，不重写整个前端技术栈

这轮必须保留现有前端基础架构：

- `ui/src/ui/app-render.ts`
- `ui/src/ui/views/*`
- `ui/src/ui/controllers/*`
- Lit 组件体系
- 现有路由和 gateway client

换句话说：

- **重写 UI 壳层**
- **不重写技术栈**

## 非目标

这轮 PR 不做下面这些事情：

- 不改 WebSocket RPC 协议
- 不新做 `settings.*` API
- 不重写 controller 层逻辑
- 不把整个前端迁移到别的框架
- 不做第二套设计系统并与现有 UI 并存
- 不在这一轮里继续扩业务能力

## Stitch 设计基线

这轮 UI 重写必须明确对齐 Stitch 里的这些方向：

### 1. 整体气质

- 工程控制台
- 高密度
- 稳定、克制、专业
- 更像 control plane，而不是聊天产品后台

### 2. 布局特征

- 左侧 rail 明确主导航
- 顶部 status band 固定整体运行上下文
- 页面主区由：
  - hero / summary strip
  - primary panel
  - side panel / inspector
  - data table / logs / diff
    组成

### 3. 组件语言

- `operations-panel`
- `control-context-strip`
- `sessions-runtime-strip`
- `debug-surface-strip`
- `config runtime band`
- 更重的 table / chip / modal / inspector / logs well

### 4. 页面方向

Stitch 中已确认的核心页面方向：

- `System Overview`
- `Sessions & Chat`
- `Channels`
- `Workflows`
- `Agents & Introspection`
- `Usage & Observability`
- `Approvals & Config`
- `Debug & RPC`

## 当前代码状态与问题

当前代码已经完成了：

- 全局 shell / 顶部状态带的第一轮增强
- Config 页的运行带和控制台收口
- Sessions / Channels / Workflows / Agents / Usage / Approvals / Debug 的上下文条与摘要条
- 浏览器 smoke coverage 与基础回归

但还存在这些问题：

### 1. 页面骨架仍然大体延续旧界面

即使页面内部模块更控制台化了，用户整体感知仍然像：

- “旧 dashboard 的增强版”

而不是：

- “按新设计重做后的 control plane”

### 2. Stitch 的版式关系没有真正落进代码

尤其是：

- Sessions 主区
- Overview 主区
- Config / Approvals 的双层结构
- Debug / RPC 的操作与观察分区

### 3. 页面间虽然统一了一些视觉部件，但产品节奏仍不够一致

现在更多是：

- 各页都补了新的 strip

但还没有到：

- 所有页面共享同一套壳层节奏

## 单 PR 范围

这轮建议仍然收成**一个 PR**，但内部按 5 个子块推进。

### A. App Shell 重写

#### 范围

- `ui/src/ui/app-render.ts`
- `ui/src/styles/layout.css`
- 与顶层壳层直接相关的共享样式

#### 目标

把整个浏览器 UI 的壳层切换到更接近 Stitch 的结构：

- 左 rail
- 顶部状态带
- 页面头部
- 页面滚动容器
- 主内容与 side panel 的统一关系

#### 验收

- 用户进入任意页面时，第一眼就能看出整体壳层变了
- Overview / Sessions / Config / Debug 等页面共享一致的顶层结构

### B. Overview + Sessions + Config 先行重写

#### 范围

- `ui/src/ui/views/overview.ts`
- `ui/src/ui/views/chat.ts`
- `ui/src/ui/views/sessions.ts`
- `ui/src/ui/views/config.ts`
- 对应样式文件

#### 目标

先重做用户最常见、最能体现新界面的三组页面：

- Overview
- Sessions / Chat
- Config

这是最能拉开“新旧界面感知差距”的第一批页面。

#### 验收

- Overview 不再像旧 dashboard 改良版，而是新的运行总览页
- Sessions / Chat 成为真正的三层 operator console
- Config 成为带 runtime/apply 语义的新配置控制台

### C. Channels + Workflows + Approvals

#### 范围

- `ui/src/ui/views/channels.ts`
- `ui/src/ui/views/workflows.ts`
- `ui/src/ui/views/nodes-exec-approvals.ts`
- 相关组件和样式

#### 目标

把最强运维属性的页面迁到 Stitch 语言：

- 渠道状态中心
- workflow 部署与运行控制面
- approvals / policy 控制面

#### 验收

- capability gating 和 unavailable 状态清晰
- workflow 的 definition / runs / diff / deploy 有更明确的主次
- approvals 页面能明显体现 gateway/node scope 与安全策略差异

### D. Agents + Usage + Debug / RPC

#### 范围

- `ui/src/ui/views/agents.ts`
- `ui/src/ui/views/usage.ts`
- `ui/src/ui/views/debug.ts`
- 对应样式和面板组件

#### 目标

把“观察面”和“调试面”真正拉齐到 Stitch 方案：

- Agents & Introspection
- Usage & Observability
- Debug & RPC

#### 验收

- `agent.inspect` 区域更像 introspection console
- usage 页面不只是图表/数字，而是明确的可追溯控制台
- debug 页面能明显区分 snapshot / method surface / manual RPC

### E. 浏览器与移动端回归收口

#### 范围

- 所有受影响视图的响应式样式
- `navigation.browser.test.ts`
- 视图 smoke / focused tests

#### 目标

保证这轮重写不会只在桌面截图里成立，而在真实浏览器和窄屏下崩掉。

#### 验收

- 关键摘要条、操作区、表格和 side panel 都有窄屏收口
- 真实浏览器 smoke 仍通过
- 不出现因为壳层重写导致的路由回退或页面不可达

## API 对接原则

这轮 PR 必须继续沿用当前已收口的 control-plane API 设计：

- `config.*`
- `sessions.*`
- `channels.status`
- `channels.login.*`
- `workflow.*`
- `agents.list`
- `agent.inspect`
- `tools.*`
- `usage.*`
- `exec.approvals.*`
- `system.health`
- `system.status`
- `system.heartbeat.last`
- `system-presence`

同时继续遵守：

- preferred names 优先
- legacy alias 只做兼容，不作为新 UI 主路径
- capability-gated surface 在渲染前判断，不靠调用失败试探

## 文档与验证要求

这轮 PR 完成时，至少要同步更新：

- `docs/zh-CN/web/control-ui.md`
- `docs/web/control-ui.md`
- 如果页面结构变化明显，再补：
  - `docs/zh-CN/web/dashboard.md`
  - `docs/web/dashboard.md`

必须通过：

- 受影响视图的 focused tests
- `ui/src/ui/navigation.browser.test.ts`
- `pnpm check`

## 实施顺序

建议按下面顺序推进：

1. App shell 重写
2. Overview + Sessions + Config
3. Channels + Workflows + Approvals
4. Agents + Usage + Debug
5. 浏览器 / 响应式回归

不要反过来先做细枝末节，否则又会回到“旧壳上打补丁”的路径。

## 完成定义

这轮 PR 完成的标志不是：

- 又补了一批 strip
- 又统一了一批颜色和圆角

而是下面四点同时成立：

1. 用户进入页面时，一眼能看出这是新的 Control UI
2. Stitch 确定的壳层、节奏和页面主关系已经进入代码
3. 关键页面已经迁入新骨架，而不是继续依附旧页面结构
4. 浏览器 smoke 和 `pnpm check` 通过

## 一句话结论

如果当前目标是“真正把 Stitch 新界面落进产品里”，那下一步不应该继续做增量 polish，而应该直接按这份文档推进：

- **`PR-UI-S3`: Control UI Stitch 重写 PR**
