---
read_when:
  - 你准备正式启动 CrawClaw 的架构收口与重构
  - 你需要一份按阶段推进的详细落地计划
summary: CrawClaw 项目级重构与治理的详细实施路线图
title: 项目实施路线图
---

# 项目实施路线图

本文档把 `concepts/` 中已经整理出来的架构、边界、缓存、测试和可维护性规则，收敛成一份可执行的落地路线图。

它不是愿景文档，而是默认要拿来开工、排期、拆任务和做 PR 的实施基线。

## 适用范围

本路线图覆盖以下主题：

- 项目分层与目录边界治理
- `commands / auto-reply / gateway methods` 的入口收口
- `agents / special / memory / channels / plugins` 的职责分离
- cache substrate 治理
- execution visibility / workflow / channel projection 统一
- 文档、测试、e2e、可读性、注释、代码精简

不覆盖：

- 产品增长、商业化、运营类工作
- 全新大功能立项
- 立即物理拆成多个 workspace 包

## 总体原则

### 1. 先收口边界，再搬目录

先让“谁负责什么”稳定，再做物理迁移。  
否则只是把复杂度从 `src/` 搬到 workspace。

### 2. 先统一事件与入口，再谈体验统一

UI、channels、workflow、inspect、ACP 想统一展示，前提是：

- 入口语义统一
- 执行事件统一
- 投影器统一

### 3. 每个阶段都必须带测试与清理

每个阶段都必须同时处理：

- 相关 unit / integration
- 必要的 e2e 或 docker smoke
- 旧路径清理
- 文档更新

### 4. 后台 agent 统一走 substrate

以后如果某个域需要后台 agent，允许新增 special agent，  
但不允许再私建一套后台 agent 运行机制。

## 时间节奏建议

推荐按 15 周左右推进。

1. 第 1-2 周：Phase 0-1
2. 第 3-4 周：Phase 2
3. 第 5-7 周：Phase 3-4
4. 第 8-9 周：Phase 5
5. 第 10-12 周：Phase 6-7
6. 第 13-14 周：Phase 8-9
7. 第 15 周：Phase 10 与收口

如果团队规模较小，可以把 Phase 8-10 延后，但不建议跳过 Phase 0-7。

## Phase 0：基线冻结

### 目标

建立后续所有重构的比较基线，避免“改完之后不知道有没有变好”。

### 产出

- 当前目录 owner 清单
- 当前业务入口清单
- 当前缓存清单
- 当前 e2e / docker smoke 清单
- 当前 top 风险清单

### 详细任务

1. 跑完整工程基线：
   - `pnpm check`
   - `pnpm test`
   - `pnpm test:e2e`
2. 选取至少两条 docker / install 主链做 smoke 基线：
   - `pnpm test:docker:onboard`
   - `pnpm test:docker:gateway-network`
   - 或其他当前最核心的两条
3. 输出目录 owner 表：
   - `src/gateway`
   - `src/auto-reply`
   - `src/agents`
   - `src/channels`
   - `src/plugins`
   - `src/memory`
   - `src/workflows`
4. 输出入口面清单：
   - CLI commands
   - channel text commands
   - gateway methods
   - UI actions
5. 输出缓存清单：
   - prompt identity
   - special agent snapshot
   - runtime TTL
   - plugin / routing / control plane
   - file / UI cache
6. 输出 top 风险：
   - 重复入口
   - 过重文件
   - `infra` 沉积
   - 旧 fallback
   - 跨层 glue code

### 涉及目录

- `src/`
- `test/`
- `docs/zh-CN/concepts`
- `docs/help`

### 验收标准

- 团队能明确说出“当前系统最大的问题是什么，不是什么”
- 后续每个阶段都能对照 baseline 判断是否变好

### 必要测试

- `pnpm check`
- `pnpm test`
- `pnpm test:e2e`

## Phase 1：边界治理

### 目标

把“边界清晰”从文档主张变成工程现实。

### 当前状态

状态：`已完成（截至 2026-04-16）`

已完成：

- 已为 `src/agents`、`src/channels`、`src/plugins`、`src/memory`、`src/workflows`、`src/infra` 补顶层 maintainer 文档。
- 已把这些入口补充到 `docs/maintainers/repo-structure.md`。
- 已新增运行时边界 lint，先覆盖两条核心规则：
  - `src/agents/**` 只能通过批准的 gateway runtime seam 访问 `src/gateway/**`
  - `src/auto-reply/**` 只能通过批准的 channel interaction seam 访问 `src/channels/**`
- 已把稳定边界检查纳入 `pnpm check` 主链。
- 已为扩展生态补齐公开 plugin-sdk runtime surface，并清理既有 boundary debt。
- 已把扩展生态 boundary 检查并回 `lint:boundaries` 主门禁。

后续增强项：

- 继续收窄既有批准 seam，而不是长期依赖 allowlist。
- 把更多“文档规则”收成真正可执行的 boundary checks。

### 产出

- 模块级 maintainer 文档
- import / boundary 规则补强
- `infra` 白名单原则

### 详细任务

1. 为以下目录补维护者入口文档：
   - `src/agents`
   - `src/channels`
   - `src/plugins`
   - `src/memory`
   - `src/workflows`
2. 梳理跨层依赖方向：
   - `auto-reply -> agent kernel`
   - `channels -> interaction contract`
   - `plugins -> stable runtime contract`
   - `memory/workflows -> domain service contract`
3. 增加或强化边界 lint：
   - 禁止 `extensions` 直接钻核心内部实现
   - 禁止 `agents` 依赖 gateway method 细节
   - 禁止 `auto-reply` 依赖 channel 内部细节
4. 明确 `src/infra` 只允许：
   - 通用 I/O
   - 通用 JSON / path / fs 原语
   - 真正无领域语义的工具
5. 建立边界评审规则：
   - 新文件必须能说明 owner
   - 新模块必须能说明所在层

### 涉及目录

- `src/agents`
- `src/channels`
- `src/plugins`
- `src/memory`
- `src/workflows`
- `src/infra`

### 验收标准

- 新增逻辑无法轻易绕过 owner 乱放
- review 已能按“层”和“owner”而不是按直觉判断是否合理

### 必要测试

- `pnpm check`
- 边界相关 lint
- 受影响域的 unit / integration

## Phase 2：统一业务入口

### 目标

把重复业务语义从 transport 层拉回共享 domain handler。

### 当前状态

状态：`进行中（截至 2026-04-16，第一刀已开始）`

已完成：

- 已开始从 `workflow controls` 下手。
- 已新增 `src/workflows/control-runtime.ts` 作为 command 与 gateway 共享的 workflow control 执行层。
- 已把 `workflow status / cancel / resume` 的 command 与 gateway 调度接到同一套共享执行路径。
- 已把 `session controls` 的第一批命令 `/send`、`/usage`、`/fast` 接到共享 session patch 语义，不再直接手改 `sessionEntry`。
- 已把 inline directive 持久化里的 `verbose / reasoning / elevated / exec` 也接到同一套 shared session patch runtime。

后续紧接着做：

- 继续把 workflow control 的参数校验、domain 结果映射、transport 输出边界再往共享 handler 收。
- 继续推进 `session controls` 剩余的 `reset / abort / lifecycle`。
- 然后推进 `model selection`、`memory command API`。

### 产出

- 第一批共享 handler
- 第一批 transport adapter 收口
- 删除一批重复旧路径

### 优先范围

- workflow controls
- session controls
- model selection
- memory command API

### 详细任务

1. 盘点三套入口的重叠逻辑：
   - `commands`
   - `auto-reply`
   - `gateway methods`
2. 为每条重叠主链抽共享 handler：
   - 参数类型
   - 权限与上下文
   - 返回结果结构
3. transport 层只保留：
   - 参数解析
   - 鉴权
   - 返回格式适配
4. 把 workflow status/cancel/resume 先统一成一条共享链
5. 再处理 session / model / memory
6. 删除或缩减旧重复逻辑

### 涉及目录

- `src/commands`
- `src/auto-reply`
- `src/gateway`
- `src/memory`
- `src/workflows`

### 验收标准

- 至少 1-2 条真实业务链由三套入口共享同一实现
- 旧路径不是保留兼容堆着，而是被明显缩减

### 必要测试

- 共享 handler unit / integration
- 相关 gateway test
- 至少一条入口相关 e2e

## Phase 3：Agent Kernel 子域化

### 目标

降低 `src/agents` 的理解成本，把执行内核从“巨型热点区”收成多个稳定子域。

### 产出

- `agents` 内部清晰子域
- 大文件拆分
- query-context / streaming / tool substrate 更显式

### 详细任务

1. 在目录层先建立子域认知：
   - `runtime`
   - `tools`
   - `skills`
   - `providers`
   - `subagents`
   - `special`
   - `streaming`
   - `query-context`
2. 拆 2-3 个最重文件：
   - 只按 owner 拆，不做大搬家
3. 把 prompt identity、tool substrate、streaming projector 从散点 helper 中拉成显式核心
4. 清理旧 fallback 和重复辅助函数
5. 给子域补最小入口说明

### 涉及目录

- `src/agents`

### 验收标准

- `src/agents` 前几大热点文件明显缩小
- 新人能更快判断某段执行逻辑应该放到哪里

### 必要测试

- `agents` 相关 unit / integration
- tool / provider / runtime smoke

## Phase 4：Special Agent 正式化

### 目标

让后台 agent 变成统一 substrate，而不是各域自己的私有机制。

### 产出

- 统一 special agent contract
- 各 special agent 接入统一 observability / cache policy / tool policy
- special-agent 测试标签与文档

### 详细任务

1. 统一 special agent 定义模型：
   - `id`
   - `spawnSource`
   - `executionMode`
   - `transcriptPolicy`
   - `toolPolicy`
   - `cachePolicy`
   - `timeout`
   - `maxTurns`
   - `cleanup`
2. 对齐：
   - `verification`
   - `memory-extraction`
   - `session-summary`
   - `dream`
3. 清理各域自带的后台运行细节
4. 统一 action feed / observability 发射路径
5. 明确“后台 deterministic job”与“special agent”边界

### 涉及目录

- `src/agents/special`
- `src/agents`
- `src/memory`

### 验收标准

- 以后新增后台 agent 只需注册定义，不再复制运行机制

### 必要测试

- special-agent contract tests
- memory runner integration
- 至少一条 special-agent 主链 e2e 或真实 end-to-end integration

## Phase 5：Memory 与 Cache 治理

### 目标

把 memory 和 cache 从“能跑的一堆实现”升级成有 owner、有失效规则、有测试归属的正式子系统。

### 产出

- cache owner / invalidation / TTL 盘点
- memory 主链责任边界
- cache 测试责任矩阵

### 详细任务

1. 将 cache 正式分为 5 类：
   - query / prompt identity
   - special-agent snapshot
   - runtime TTL cache
   - plugin / routing / control-plane cache
   - file / UI cache
2. 为每类 cache 写清：
   - owner
   - key
   - 生命周期
   - 失效条件
   - 观测方式
3. 收口 `memory`：
   - extraction
   - session-summary
   - dream
   - context assembly
4. 明确 memory special agent 与 cache 的互动关系
5. 清理未声明 owner 的 ad-hoc cache

### 涉及目录

- `src/memory`
- `src/agents/query-context`
- `src/agents/special/runtime`
- `src/plugins`
- `src/routing`
- `ui/src/ui`

### 验收标准

- 新 cache 必须声明 owner 和失效语义
- memory 主链不再靠隐式知识维持

### 必要测试

- cache identity tests
- cache invalidation tests
- memory integration tests
- 至少一条 memory / summary / dream end-to-end 主链

## Phase 6：Channel Runtime 收口

### 目标

把真实渠道行为从散落逻辑收回 `src/channels`。

### 产出

- 更干净的 channel runtime contract
- 更统一的 outbound / interactive / threading 路径
- workflow / tool / process 渠道投影基线

### 详细任务

1. 收口 inbound normalization
2. 收口 threading / binding / pairing / typing
3. 收口 interactive controls
4. 收口 outbound projection
5. 统一 workflow/tool/process 在渠道层的投影 adapter
6. 删除散落在 `auto-reply` / `gateway methods` / `extensions` 的渠道特化逻辑

### 涉及目录

- `src/channels`
- `src/auto-reply`
- `src/workflows`
- `extensions/*`

### 验收标准

- 渠道相关改动主要落在 `channels` 或 channel plugin 中
- 代表性渠道拥有更清晰的 contract test

### 必要测试

- channels config / contract tests
- outbound adapter tests
- 至少一条 channel ingress/outbound e2e

## Phase 7：Execution Event / Visibility 全链统一

### 目标

让 tool、workflow、skill、system、artifact 的执行过程通过统一事件模型展示到 UI、channels、ACP。

### 产出

- 统一执行事件模型
- 统一投影器
- UI / channels / ACP 一致语义

### 详细任务

1. 标准化执行事件结构
2. 对齐：
   - Action Feed
   - inspect
   - channel forwarder
   - ACP projector
3. workflow waiting/resume/cancel/status 统一展示
4. 清理旧 summary fallback 和分叉投影
5. 补一致性测试矩阵

### 涉及目录

- `src/agents/action-feed`
- `src/auto-reply`
- `src/workflows`
- `src/acp`
- `ui/src/ui`

### 验收标准

- 同一事件在 UI、ACP、主渠道展示语义一致
- 旧的多套文案和 fallback 明显减少

### 必要测试

- execution visibility tests
- UI projection tests
- channel workflow e2e
- ACP / channel / UI 一致性集成测试

## Phase 8：Plugin Platform 清理

### 目标

让扩展只通过稳定平台 surface 接入，而不是反向依赖核心内部实现。

### 产出

- plugin lifecycle 收口
- plugin-sdk surface 稳定化
- extension boundary 更严格

### 详细任务

1. 统一 manifest / runtime / setup / interactive 生命周期
2. 清理 `extensions` 直接依赖核心内部实现的路径
3. 强化 plugin-sdk baseline 与 boundary lint
4. 给常见扩展类型补 contract 样板

### 涉及目录

- `src/plugins`
- `src/plugin-sdk`
- `extensions/*`

### 验收标准

- 扩展更像“接平台”，不是“钻主仓”

### 必要测试

- plugin contract tests
- extension surface tests
- plugin install / startup docker smoke

## Phase 9：UI 信息架构重构

### 目标

把 UI 从控制台拼页升级成按平台分层组织的信息架构。

### 产出

- 新的视图结构
- 更统一的 projection consumption
- workflow / memory / action feed / inspect 更自然联动

### 详细任务

1. 视图按层重组：
   - Chat
   - Agents
   - Channels
   - Workflows
   - Memory
   - Nodes
   - Logs / Inspect
2. UI 只消费 gateway / projection contract
3. 对齐 action feed、workflow timeline、memory surfaces
4. 清理本地 ad-hoc 视图状态

### 涉及目录

- `ui/src/ui`
- `src/gateway`

### 验收标准

- 用户能按系统模型理解 UI，不再只是“页面堆功能”

### 必要测试

- UI view tests
- projection contract tests
- 关键交互 smoke

## Phase 10：物理拆分准备

### 目标

为未来拆包做好边界准备，但当前不真正拆包。

### 产出

- public surface 清单
- 未来包边界建议
- import graph 风险表

### 详细任务

1. 冻结模块间公开 surface
2. 定义未来可拆模块：
   - `control-plane-core`
   - `interaction-engine`
   - `agent-kernel`
   - `special-agent-substrate`
   - `channel-runtime`
   - `plugin-platform`
   - `memory-runtime`
   - `workflow-runtime`
3. 输出不宜拆分的部分和前置条件

### 验收标准

- 将来要拆包时，不需要再先大规模清理边界

### 必要测试

- 不新增测试面，但要确保前 9 个 phase 的门禁全部稳定

## 横向硬约束

### 可读性

- 一个文件尽量只有一个主要变化原因
- 一个目录能回答“这里负责什么，不负责什么”
- transport、编排、执行、领域逻辑不要混写

### 注释

- 只写高信号注释
- 优先解释 invariant、兼容原因、状态机边界、cache invalidation
- 不用低信号注释掩盖边界混乱

### 代码精简

- 优先删重复入口
- 优先删死 fallback
- 优先删错层 glue code
- 再考虑大文件拆分和 helper 合并

### e2e

- Gateway / channel / workflow / execution visibility / install / plugin startup 的关键链路不能只靠 unit test
- 改 transport / runtime / workflow / channel projection 时必须上升到 e2e

## 第一批最先开工的具体任务

1. 建 5 个目录级 maintainer 文档。
2. 先统一 workflow controls 的共享 handler。
3. 给 execution visibility、workflow channel forwarding、special-agent cache drift 建 e2e 责任矩阵。
4. 拆 `src/agents` 最重的 2-3 个文件。
5. 给 `src/infra` 加“禁止新增领域逻辑”的规则。

## 延伸阅读

- [项目整体架构总览](/concepts/project-architecture-overview)
- [目录与边界规划](/concepts/project-directory-boundaries)
- [项目缓存机制总览](/concepts/project-cache-strategy)
- [文档与测试体系规划](/concepts/project-docs-and-test-strategy)
