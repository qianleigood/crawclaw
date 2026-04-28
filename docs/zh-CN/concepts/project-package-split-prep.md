---
read_when:
  - 你准备评估 CrawClaw 未来是否适合拆成多个 package
  - 你想知道目前哪些公开 surface 可以冻结，哪些目录还不能拆
summary: CrawClaw 未来物理拆包的公开 surface 清单、目标包边界与 import graph 风险表
title: 模块公开 Surface 与拆包准备
---

# 模块公开 Surface 与拆包准备

这篇文档对应 `PR-10 / Phase 10`。目标不是现在就把仓库拆成多个 package，而是先把“**将来拆包时可以依赖什么 surface**”说清楚。

当前判断：

- `PR-01` 到 `PR-09` 已经把主要边界、共享 runtime seam、UI 信息架构、plugin entry contract 收到了一轮。
- 现在已经足够做“**拆包准备**”。
- 但还**不适合立刻物理拆仓**，因为仍有几块目录属于“边界已清晰、surface 还没完全收成单入口”的状态。

## 这轮 PR 的目标

本阶段只做三件事：

1. 冻结当前可依赖的 module public surface
2. 给出未来 package 边界草案
3. 列出拆包前仍需警惕的 import graph 风险

不做的事：

- 不新建 workspace package
- 不迁移源码目录
- 不修改 npm 发布结构
- 不把内部 helper 误包装成长期 public API

## 可冻结的公开 Surface

下面这些 surface 已经足够稳定，可以视为未来拆包时的第一批“明确入口”。

### 1. Plugin Platform Surface

这是当前最清晰、最接近真实 package surface 的一层。

主入口：

- `src/plugin-sdk/index.ts`
- `src/plugin-sdk/entrypoints.ts`
- `src/plugins/entry-contract.ts`

稳定性判断：

- `PR-08` 已把 plugin / channel / setup entry contract 统一到 shared entry contract。
- `plugin-sdk` 已有显式 subpath 列表和导出映射。
- `loader`、bundled capability runtime、bundled channel loader 已经共用 resolver。

未来拆包建议：

- `plugin-platform`
- 其中 `plugin-sdk/*` 继续作为对 extension 作者的正式 surface

拆包时的原则：

- `crawclaw/plugin-sdk/*` 继续稳定
- 不允许 extension 反向依赖核心 `src/**`

### 2. Workflow Runtime Surface

主入口：

- `src/workflows/api.ts`

稳定性判断：

- workflow registry、operations、executions、status-view 已通过 `api.ts` 暴露出一层比较清晰的 domain API。
- `PR-SR`、`PR-06`、`PR-07` 已把 workflow 的 reset / channel / visibility 等关键交叉链路收薄。

未来拆包建议：

- `workflow-runtime`

拆包时的原则：

- 优先保留 `api.ts` 作为 runtime 对外面向 control plane / interaction / UI 的入口
- `n8n` 适配层仍留在 workflow 包内，不直接散到 gateway

### 3. Memory Runtime Surface

主入口：

- `src/memory/command-api.ts`
- `src/memory/cli-api.ts`
- `src/memory/index.ts`

稳定性判断：

- `command-api.ts` 已是 memory domain 的正式命令面入口。
- `cli-api.ts` 已把诊断、dream、summary scheduler 等 CLI 相关入口聚合出来。
- `index.ts` 继续保留 runtime bootstrap / runtime resolution 层入口。

未来拆包建议：

- `memory-runtime`

拆包时的原则：

- `command-api.ts` 用作 domain API
- `cli-api.ts` 用作 CLI facade
- `index.ts` 用作 runtime bootstrap facade

### 4. Gateway Control Plane Surface

主入口：

- `src/gateway/server.ts`

稳定性判断：

- 现在已有明确的 server startup surface：
  - `startGatewayServer`
  - `GatewayServer`
  - `GatewayServerOptions`
- 但 `server-methods/**` 仍然是内部实现区，不应直接视为 future package public API。

未来拆包建议：

- `control-plane-core`

拆包时的原则：

- 只把 `server.ts` 视为 server 启动 facade
- `server-methods` 保持包内私有实现

### 5. Special Agent Substrate Surface

当前稳定入口不是单个 barrel，而是一组明确 runtime seam：

- `src/agents/special/runtime/types.ts`
- `src/agents/special/runtime/registry.ts`
- `src/agents/special/runtime/definition-presets.ts`
- `src/agents/special/runtime/action-feed.ts`
- `src/agents/special/runtime/runtime-deps.ts`
- `src/agents/special/runtime/configured-observability.ts`
- `src/agents/special/runtime/result-detail.ts`

稳定性判断：

- `PR-04` 已把 contract、preset、observability、result detail 和 action-feed wiring 收到 substrate。
- 这层已经足够作为 future package 内部主 surface。

未来拆包建议：

- `special-agent-substrate`

拆包时的原则：

- 这层先作为内部 runtime package
- 暂不对 extension 或 UI 暴露为 public API

## 仍属“边界清晰，但 surface 未完全冻结”的模块

这些模块现在已经适合继续演进，但还不适合立刻独立成 package public API。

### 1. Interaction Engine

对应目录：

- `src/auto-reply`
- `src/sessions`
- `src/commands`

现状：

- `PR-02` 已统一了一批共享 handler
- `PR-SR` 已把 session runtime 主链收走
- 但 interaction 层仍然没有一个真正单入口 facade

结论：

- 可以视为未来 `interaction-engine`
- 但当前仍以目录边界为主，不应承诺 public API

### 2. Agent Kernel

对应目录：

- `src/agents`

现状：

- `PR-03` 已做 `command / subagents` 子域化
- `PR-04` 把 special-agent substrate 收走
- 但 `agents` 仍然更像内部内核，不像一个 ready-to-export 的 package facade

结论：

- 可以视为未来 `agent-kernel`
- 暂不冻结单一 public barrel

### 3. Channel Runtime

对应目录：

- `src/channels`

现状：

- `PR-06` 已把 workflow projection、typing、threading、binding、Telegram/Matrix/Slack/LINE 等 seam 收回 `src/channels`
- 但这里仍有大量 internal runtime helper
- 其对 extension 的正式 surface 目前主要还是通过 `plugin-sdk`

结论：

- 未来可拆成 `channel-runtime`
- 当前不应把整个 `src/channels/**` 当成可随意 import 的 public API

## 未来 Package 边界草案

建议的未来 package 列表：

1. `control-plane-core`
2. `interaction-engine`
3. `agent-kernel`
4. `special-agent-substrate`
5. `channel-runtime`
6. `plugin-platform`
7. `memory-runtime`
8. `workflow-runtime`

### 建议依赖方向

建议只允许下面这个方向：

- `plugin-platform` 依赖 `channel-runtime`、`control-plane-core` 提供的已冻结 surface
- `interaction-engine` 依赖 `agent-kernel`、`workflow-runtime`、`memory-runtime`、`channel-runtime`
- `control-plane-core` 依赖 `workflow-runtime`、`memory-runtime`、`channel-runtime` 的稳定 facade
- `special-agent-substrate` 依赖 `agent-kernel`，被 `memory-runtime` 等领域服务使用

应尽量避免：

- `plugin-platform -> src/** deep import`
- `ui -> runtime internals`
- `workflow-runtime -> auto-reply`
- `memory-runtime -> gateway methods`

## Import Graph 风险表

下面这些不是当前 bug，而是未来拆包时最容易重新爆出来的风险。

### 风险 1：Interaction 与 Gateway 重新缠绕

风险源：

- `commands`
- `auto-reply`
- `gateway server-methods`

虽然 `PR-02` 和 `PR-SR` 已经收了一轮，但这三层天然容易重新长回重复入口。

拆包风险：

- `interaction-engine` 和 `control-plane-core` 会因为共享状态机或 handler 再次互相 deep import

建议：

- 继续坚持“gateway 只做 transport / control plane，session/runtime 归 interaction”

### 风险 2：Channel Runtime 被 UI 或 Workflow 反向侵入

风险源：

- `src/channels`
- `src/workflows/channel-forwarder.ts`

`PR-06` 已让渠道形态回到 `src/channels`，但后续如果 UI 或 workflow 再直接拼 transport payload，边界会再次软化。

拆包风险：

- `channel-runtime` 很快退化成“被 everyone 深度引用的公共工具箱”

建议：

- 坚持通过 channel projection / control seam 访问渠道能力

### 风险 3：Plugin SDK 表面稳定，内部依赖过深

风险源：

- `src/plugin-sdk/*` 当前虽然是最清晰的 public surface
- 但部分 subpath 仍透传核心目录的内部实现

拆包风险：

- `plugin-platform` 名义上独立，实际上仍被大量 core internals 绑死

建议：

- 拆包前再做一次 plugin-sdk subpath 审核，优先标出“稳定 facade”与“暂时兼容 facade”

### 风险 4：Agent Kernel 没有真正的 top-level facade

风险源：

- `src/agents` 规模大
- 子域已经拆了，但 public API 还没冻结

拆包风险：

- 一旦真拆 `agent-kernel`，其他包会直接 import 很多内部文件路径

建议：

- 如果将来真的要拆 `agent-kernel`，应先单独做一轮 facade freeze，而不是直接迁目录

### 风险 5：UI 继续消费非稳定 contract

风险源：

- UI 虽然已经完成一轮 IA 重构
- 但如果后面为了赶功能再直接读 runtime 内部结构，`presentation plane` 会重新失真

拆包风险：

- `ui` 不能被独立构建或替换

建议：

- 坚持 UI 只消费 gateway / projection contract

## Phase 10 收口结论

现在可以认为：

- future package 边界已经足够清楚
- 第一批可冻结的 public surface 已明确
- 真正还需要补的是少数“边界已经清楚，但没有 top-level facade”的内核层

因此这轮结论不是“现在马上拆包”，而是：

**如果未来要拆包，已经不需要再先做一轮大规模边界排雷。**

下一次真正进入物理拆包前，只需要再判断：

1. 是否真的有发布/构建/团队协作上的收益
2. `interaction-engine` 与 `agent-kernel` 是否需要先补 facade freeze
3. `plugin-sdk` 中哪些 subpath 需要正式标注稳定级别

## 延伸阅读

- [项目整体架构总览](/concepts/project-architecture-overview)
- [目录与边界规划](/concepts/project-directory-boundaries)
- [文档与测试体系规划](/concepts/project-docs-and-test-strategy)
- [项目实施路线图](/concepts/project-implementation-roadmap)
- [Phase 对应 PR 计划](/concepts/project-phase-pr-plan)
