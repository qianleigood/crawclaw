---
read_when:
  - 你已经完成 Control UI 的数据接线，但觉得整体仍然过于工程化、不够产品化
  - 你准备把控制台从“工程面板集合”重构成“小白也能理解和操作”的产品界面
summary: Control UI 产品化重构的单 PR 计划，覆盖信息架构、页面改写、文案、空态与组件收口
title: Control UI 产品化重构 PR 计划
---

# Control UI 产品化重构 PR 计划

## 目标

这次 PR 不再解决“有没有数据”或“页面是不是新壳”。

这次要解决的是：

- 页面虽然已经接入真实数据，但整体仍然像工程控制台
- 小白用户第一次打开时，不知道当前页面在干什么
- 主要操作路径不清晰，状态信息多于任务信息
- 大量原始 snapshot/fallback 文案降低了可读性和信任感

一句话：

**把 Control UI 从“真实数据的工程面板”重构成“真实数据的产品界面”。**

## 当前问题

基于当前实现，核心问题集中在 5 类：

1. 信息架构和命名太工程化  
   例如 `Sessions & chat console`、`Workflow deployment console`、`Agents & introspection`、`Method surface`、`Manifest workbench`。

2. 页头信息密度过高，但缺少主任务引导  
   用户先看到一排指标和工程术语，却不知道当前页“应该做什么”。

3. 页面主体仍以状态/快照展示为主，不以任务流为主  
   例如 Workflow、Agents、Debug、Config 里大量区域还是“读快照”，不是“完成操作”。

4. 空态和 fallback 过多  
   `pending / not loaded / n/a / none / selectPrompt` 这类文案对工程用户可接受，但对普通用户像半成品。

5. 组件语言不统一  
   虽然已经统一进新壳，但很多区块仍然是通用 `meta list` / `raw snapshot` 形式，没有形成稳定的产品组件语义。

## PR 定位

这是一个**产品化重构 PR**，不是：

- 再次做 Stitch 壳层迁移
- 再次补数据接线
- 再次单点修样式

这次要做的是：

- 重组页面信息优先级
- 重写导航、页头、按钮、空态文案
- 收口核心页面为“主任务 + 次状态”
- 把 raw/generic 数据展示改成更可理解的业务面板

## 非目标

这次 PR 不做：

- 新增全新的后端能力或全新 RPC
- 重做控制面 API contract
- 引入新的设计系统工具链
- 大规模增加动画或营销式视觉
- 把 Debug 页改成普通用户页面

## PR 范围

### 1. 全局信息架构与导航

调整目标：

- 保留一级导航数量不爆炸
- 命名从工程术语转成用户任务语言
- 让“去哪做什么”一眼可见

目标导航：

- Overview
- Sessions
- Channels
- Workflows
- Agents
- Memory
- Usage
- Config
- Debug

重构要求：

- 导航 label、eyebrow、headline、subheadline 全量重写
- 去掉不必要的 `console / workbench / method surface / introspection` 风格表达
- 顶栏和页头优先表达“页面目标”，再表达工程细节

### 2. Overview

目标：

- 成为真正的“起始页”
- 第一屏直接回答：
  - 系统是否正常
  - 最近有没有异常
  - 我下一步应该去哪

重构点：

- 顶部只保留 3-4 个最高价值指标
- 主区改成：
  - 系统状态卡
  - 最近活跃会话
  - 快速入口
  - Memory health
- 右 rail 只保留：
  - Presence
  - 错误提示
  - 重连/网关状态

### 3. Sessions

目标：

- 成为“会话操作页”，而不是“会话数据页”

重构点：

- 左 rail：会话清单 + 搜索 + 筛选
- 中间：对话线程 + 发送区 + 当前运行提示
- 右 rail：路由、模型、usage、最近活动、session memory summary

需要做的产品化收口：

- 消息分组更明显
- assistant/user/tool 的视觉层级清晰
- 输入区工具栏更自然
- 当前运行状态提示不再过于工程化

### 4. Channels

目标：

- 让用户把这里理解成“连接和排障页面”

重构点：

- 页头直接说明：
  - 已启用几个渠道
  - 连接是否正常
  - 是否需要登录
- 主区优先：
  - 账号状态表
  - 最近探测结果
- 次区：
  - WhatsApp login
  - Feishu CLI 状态

不再使用的表达方式：

- 纯工程化状态带堆叠
- “optional” 这类没有用户语义的标题

### 5. Workflows

目标：

- 让用户理解这是“工作流管理与执行页”

重构点：

- 左 rail：工作流列表
- 主区顶部：
  - 基本信息
  - 当前部署状态
  - 当前执行状态
- 主区下半：
  - 执行记录
  - 版本与部署
  - 定义摘要

产品化要求：

- `spec` 不再只显示 generic field summary
- 执行面板优先讲：
  - 当前有没有运行
  - 最近一次运行结果
  - 是否需要审批

### 6. Agents

目标：

- 让用户理解“代理是谁、在做什么、能用什么”

重构点：

- 左 rail：代理列表
- 主区：
  - 代理身份
  - 当前模型/默认模型
  - 当前运行检查
  - 工具目录
  - 有效工具

产品化要求：

- `inspection snapshot` 从“快照”变成“运行检查摘要”
- 工具区要区分：
  - 已注册
  - 当前可用

### 7. Memory

目标：

- 让 Memory 成为独立的产品模块，而不是工程附属页

范围保留当前四块：

- Provider
- Dreaming
- Session Summaries
- Prompt Journal

产品化要求：

- Provider 页优先说明是否可用、下一步动作是什么
- Dreaming 页强调最近运行与 scope
- Session Summary 页强调 session 关联和摘要状态
- Prompt Journal 页减少“分析面板味”，提升可读性

### 8. Usage

目标：

- 让 Usage 更像“成本与用量分析页”，而不是数据导出页

重构点：

- 顶部：成本、时间范围、会话数
- 主区：
  - 总览
  - 会话维度
  - 时间序列
  - 日志

产品化要求：

- totals 不再只是 generic `meta list`
- time series/logs 至少做到：
  - 一眼知道看什么
  - 一眼知道最近有没有异常

### 9. Config

目标：

- 让 Config 成为“配置编辑与应用页”，不是“两个大 textarea”

重构点：

- 左 rail：manifest / approvals 摘要
- 主区：
  - 配置编辑
  - 审批编辑
  - issues
  - apply/save 主路径

产品化要求：

- “保存”和“应用”的差异表达清楚
- `issues` 不只是 path/message 列表，要加等级和建议动作

### 10. Debug

目标：

- 保留工程性，但结构更清晰

重构点：

- 左 rail：方法清单
- 主区：
  - status
  - health
  - heartbeat
  - 手动 RPC

产品化要求：

- 依然允许 raw
- 但默认优先展示“当前系统发生了什么”

## 统一收口项

### 1. 文案

整轮需要统一做：

- 导航 label
- 页头 eyebrow/headline/subheadline
- 按钮文案
- 空态文案
- 错误文案
- fallback 文案

原则：

- 先说明用户任务
- 再说明工程状态
- 不滥用 `console / workbench / surface / snapshot / introspection`

### 2. 空态

统一规范：

- `none`
- `not loaded`
- `pending`
- `n/a`
- `selectPrompt`

都改成更具体的用户语义。

例如：

- `还没有可显示的会话`
- `尚未加载工作流数据`
- `选择一个代理查看运行状态`
- `当前没有待执行请求`

### 3. 通用组件

需要收口的组件语言：

- page header
- summary stats
- action cards
- status cards
- inventory rail
- detail panel
- issue list
- empty state
- loading state
- snapshot panel

要求：

- 少用泛型 `meta list`
- 多用有语义的 panel 组件

## API 与实现边界

这轮仍然严格基于现有 controller/gateway 能力，不新增新的产品 API 依赖。

允许继续使用当前真实数据来源：

- `sessions.*`
- `channels.status`
- `workflow.*`
- `agents.*`
- `memory.*`
- `usage.*`
- `config.*`
- `system.*`

但前端应当减少：

- 直接展示原始 snapshot 的默认路径
- 原始 fallback string 直接暴露给用户

## 文件范围

核心会改这些：

- `ui/src/ui/rewrite/routes.ts`
- `ui/src/ui/rewrite/app-root.ts`
- `ui/src/styles/rewrite.css`

如果需要，还会补：

- `ui/src/ui/controllers/*` 的少量 view model 整理
- 个别 `ui/src/ui/views/*` 子组件
- 相关 `*.test.ts`

## 验收标准

这次完成后，应满足：

1. 小白第一次打开能理解 9 个一级页面分别做什么
2. 每个页面都有明确主任务，不再只是状态墙
3. 主页面不再充满工程术语
4. 空态和错误态不再像半成品
5. Workflow / Agents / Usage / Config / Debug 的主面板不再只是 raw/generic summary
6. 继续保持真实数据接线，不回退为假数据

## 验证

最低门禁：

- `pnpm lint`
- `pnpm ui:build`
- `pnpm check`

focused UI tests 至少覆盖：

- sessions
- channels
- workflows
- agents
- memory
- usage
- config
- debug

## 提交建议

建议提交信息：

`feat: productize control ui information architecture`
