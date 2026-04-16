---
read_when:
  - 你要整理文档体系、测试体系或维护者文档
  - 你想让测试结构和架构分层对齐
summary: CrawClaw 的文档信息架构与测试体系规划
title: 文档与测试体系规划
---

# 文档与测试体系规划

本文档说明三件事：

- 项目文档应该如何按平台边界组织
- 项目测试应该如何按系统层次组织
- 项目可维护性应该如何落到代码可读性、注释策略和代码精简上

## 当前现状

### 文档

当前 `docs/` 已经覆盖很多主题：

- `concepts`
- `gateway`
- `cli`
- `channels`
- `providers`
- `plugins`
- `install`
- `reference`
- `debug`
- `help`

同时存在中英文与部分多语言内容。中文文档树 `docs/zh-CN` 已经非常大，说明“文档缺失”不是主要问题，主要问题是信息架构和维护边界。

### 测试

当前测试体系也比较成熟：

- 基础说明：`docs/help/testing.md`
- 共享基础设施：`test/`
- 多套 Vitest 配置：
  - `vitest.unit.config.ts`
  - `vitest.gateway.config.ts`
  - `vitest.channels.config.ts`
  - `vitest.extensions.config.ts`
  - `vitest.e2e.config.ts`
  - `vitest.live.config.ts`

这说明项目已经有测试分层意识，但分层维度更多是“运行方式”，还不完全是“架构归属”。

### 端到端测试

端到端测试不是缺位，而是已经有正式基础设施：

- `pnpm test:e2e`
- `vitest.e2e.config.ts`
- `pnpm test:docker:*`
- `pnpm test:install:e2e`
- `docs/help/testing.md`

所以后续方案不需要“从零建立 e2e”，而是要把现有 e2e 提升成更明确的责任矩阵和合并门禁。

## 文档体系的目标结构

建议把文档明确分成 4 类。

### 1. 产品文档

面向用户和部署者。

建议保留在：

- `docs/start`
- `docs/install`
- `docs/channels`
- `docs/providers`
- `docs/automation`
- `docs/help`

核心目标：

- 快速上手
- 配置与部署
- 渠道接入
- provider 接入
- 常见问题

### 2. 概念与参考文档

面向高级用户和集成人员。

建议保留在：

- `docs/concepts`
- `docs/reference`
- `docs/gateway`
- `docs/plugins`

核心目标：

- 解释系统模型
- 解释协议与扩展 contract
- 解释运行时行为与约束

### 3. 维护者文档

面向核心开发者。

建议新增或加强：

- `docs/maintainers`
- `docs/maintainers/architecture`
- `docs/maintainers/repo-structure`
- `docs/maintainers/testing`
- `docs/maintainers/release`

应该包含：

- 总体架构
- 目录边界
- 模块依赖方向
- special agent substrate
- plugin platform contract
- channel runtime contract
- 文档维护与测试维护策略

### 4. 调试 / 历史设计材料

建议保留在：

- `docs/debug`

原则：

- 允许保留开放问题、设计债、排查记录
- 但不应承担正式架构文档职责

## special agent 的文档位置

当前 `special agent` 主要出现在 `docs/debug/special-agent-substrate.md` 及相关 memory 设计文档中。

建议：

- 保留 debug 文档里的设计演进记录
- 额外在维护者架构文档里提供一份正式版摘要

因为 special agent 已经是正式运行机制，不应只存在于 debug 材料里。

## 推荐新增的维护者文档清单

建议后续逐步补齐以下文档：

- `项目整体架构总览`
- `目录与边界规划`
- `文档与测试体系规划`
- `project-cache-strategy`
- `special-agent-substrate`
- `channel-runtime-contract`
- `plugin-platform-contract`
- `gateway-control-plane-contract`
- `interaction-engine-contract`
- `execution-event-model`

## 测试体系的目标结构

建议把测试从“运行方式”与“架构归属”两条线同时组织。

### 运行方式维度

保留现有分法：

- `unit / integration`
- `gateway`
- `channels`
- `extensions`
- `e2e`
- `live`

其中：

- `e2e` 负责跨进程、跨 surface、跨 transport 的真实链路
- `docker e2e` 负责安装、onboard、network、plugins、Open WebUI、MCP bridge 等更接近交付面的链路
- `live` 负责真实 provider / model 当日可用性，不替代普通 e2e

### 架构归属维度

建议在命名、目录说明和测试策略里明确映射到以下域：

- `control-plane`
- `interaction`
- `agent-kernel`
- `special-agent`
- `channel-runtime`
- `plugin-platform`
- `memory`
- `workflow`
- `protocol`
- `ui`

## 各域建议覆盖重点

### Control Plane

重点：

- auth
- config reload
- device/node lifecycle
- event fan-out
- gateway protocol compatibility

### Interaction Plane

重点：

- session init/reset
- command routing
- directive parsing
- reply assembly
- queue/typing/origin routing

### Agent Kernel

重点：

- tool invocation
- sandbox / exec / browser
- provider failover
- usage accounting
- action feed / execution visibility
- query layer cache identity
- provider prompt cache hint 行为

### Special Agent Substrate

重点：

- contract validation
- `embedded_fork` vs `spawned_session`
- tool allowlist 与 runtime deny
- cache policy
- prompt inheritance
- cache-safe snapshot 与 fork drift
- timeout / maxTurns
- observability

### Channel Runtime

重点：

- inbound normalization
- outbound payload projection
- typing/threading/binding
- approvals / interactive actions
- per-channel stream behavior

### Plugin Platform

重点：

- plugin discovery / load / manifest validation
- runtime injection
- plugin-sdk public surface compatibility
- provider/channel plugin contract tests

### Memory

重点：

- extraction
- durable store
- session summary
- dream
- recall / ranking
- context assembly
- file read cache / bootstrap cache / runtime cache 行为

同时要把 memory 相关的 special agent 路径单独列为稳定测试对象。

### Workflows

重点：

- registry/versioning
- n8n compile
- execution sync
- channel forwarding
- interactive resume/cancel/status

### Protocol / ACP

重点：

- ACP session mapping
- translator behavior
- reconnect semantics
- control-plane integration

### UI

重点：

- gateway client contract
- chat/action feed/session/workflow views
- execution visibility projection
- channel-specific config forms
- session cache LRU 行为

## 端到端测试必须覆盖的主链

建议明确把以下链路视为正式 e2e 对象，而不是“有空再手测”。

### 1. Gateway / Control Plane 主链

- connect / auth / health / state snapshot
- WebSocket request-response
- pairing / node lifecycle
- reconnect / runtime reuse

### 2. Channel Runtime 主链

- 渠道入站消息
- route / session / command gating
- auto-reply 编排
- 出站消息投递

### 3. Agent 执行主链

- reply orchestration -> agent run -> tool call -> final reply
- tool / workflow / execution visibility 在真实 surface 上的投影
- 关键 approval / interactive path

### 4. Special Agent / Memory 主链

- top-level run 收口后触发 special agent
- memory-extraction / session-summary / dream 的真实触发与状态落盘
- prompt cache / snapshot / drift 相关链路至少要有 integration + 一条真实主链覆盖

### 5. 交付与安装主链

- install script
- onboard / wizard
- plugin install / load
- docker / remote / bridge 关键入口

## PR 的最低端到端门槛

不是每个 PR 都需要跑全部 e2e，但以下改动类型不应只停留在 unit/integration。

### 必须补 `pnpm test:e2e` 或等价链路的改动

- Gateway WS 协议、pairing、auth、node runtime
- channel ingress / routing / outbound projection
- workflow channel forwarding / interactive resume / cancel / status
- execution visibility 的跨 UI / channel / ACP 投影链路

### 必须补 docker e2e / install smoke 的改动

- install script
- onboard / bootstrap / daemon
- plugin install / plugin runtime startup
- container / network / bridge 相关变更

### 可以只用 integration + UI test 的改动

- 纯 UI 视图渲染
- 纯文案投影
- 纯 cache key / normalization helper

前提是它们没有改坏真实跨进程链路；一旦跨到 transport、runtime、workflow、channel，就应该上升到 e2e。

## 代码可维护性是正式治理项

后续架构治理不只看“功能能不能跑”，还要看代码是否能持续维护。

### 代码可读性

推荐把可读性理解成 4 件事：

- 目录边界清晰，读目录就能知道职责
- 命名反映领域语义，而不是技术动作
- 一个文件尽量只有一个主要变化原因
- transport 层、编排层、执行层、领域层不要混写

可读性不应主要靠“阅读者足够熟”来维持。

### 注释策略

注释应主要写在这些地方：

- 不直观的不变量
- 协议兼容性约束
- cache invalidation / prompt identity / drift 规则
- workflow / special-agent / streaming 这类状态机边界
- 为什么这样做，而不是代码字面上在做什么

不建议：

- 给显而易见的赋值和分支加解释性注释
- 用大量行内注释掩盖过重函数或混乱边界
- 把本该写进模块 README / maintainer doc 的说明塞进实现细节里

### 代码精简

代码精简不是单纯删行数，而是减少系统理解成本。

真正应优先做的精简包括：

- 删除死代码、过期 fallback、双轨实现
- 收口重复业务入口
- 把跨层 glue code 拉回正式 owner
- 拆分多职责大文件
- 消除复制粘贴的近重复逻辑

现有工程工具已经能为这件事服务：

- `check:loc`
- `dup:check`
- `deadcode:*`
- `lint` 与边界检查脚本

后续应把这些工具从“辅助检查”提升为重构治理基线。

## 当前最值得补强的测试方向

1. `special agent substrate` 的域级测试标签与说明。
2. execution visibility 在 `tool / workflow / channel / UI / ACP` 之间的一致性测试。
3. `commands / auto-reply / gateway method` 共用业务 handler 后的共享回归测试。
4. channel runtime 的结构化 contract 测试，而不仅是插件单点测试。
5. 缓存相关测试的域级归属，例如 prompt cache、routing cache、memory file cache、UI cache 各自由谁负责。
6. 文档与测试的映射检查，例如一级域是否同时存在维护文档和测试入口。
7. workflow / memory / special-agent / execution-visibility 的最小 e2e 责任矩阵。

## 推荐的测试治理策略

### 1. 保留现有多套 Vitest 配置

现有配置已经足够成熟，不需要推倒重来。

### 2. 增加“架构域标签”

建议在测试命名、测试说明或 future manifest 中增加域标签，例如：

- `kernel`
- `special-agent`
- `channels`
- `gateway`
- `memory`
- `workflow`

### 3. 增加一级域测试责任表

建议建立维护者文档，明确每个一级域：

- 哪些是 unit 套件
- 哪些是 integration 套件
- 哪些是 e2e 套件
- 哪些必须有人值守

### 4. 让文档和测试一一对照

每个一级域至少应有：

- 一份维护者文档
- 一套 contract/integration 测试入口

## 可维护性治理建议

### 1. 把“可读性”变成显式 review 标准

每次改动都应该能回答：

- 新逻辑属于哪一层
- 为什么放在这个目录
- 是否引入了新的重复入口
- 是否让原本已经过重的文件继续膨胀

### 2. 把“注释”变成高信号工具

要求：

- 复杂状态机与兼容层必须解释约束
- cache / prompt / protocol 相关逻辑必须解释失效或兼容原因
- 重要注释尽量写在模块入口和关键边界，而不是散成噪音

### 3. 把“代码精简”纳入持续治理

要求：

- 新增 fallback 要有后续删除计划
- 重构优先合并重复路径，而不是新增第三条路径
- 大文件在继续增长前，先判断能否按 owner 拆分

## 实施顺序

1. 先补维护者架构文档，尤其是 special agent、channels、plugin platform。
2. 再给测试体系补域级说明、e2e 责任矩阵与 PR 门槛。
3. 同时把可读性、注释、代码精简写进维护者规则和 review 标准。
4. 最后再考虑更细的测试目录迁移或命名调整。

## 最终目标

理想状态下，文档和测试都应服务于同一套平台边界：

- 文档告诉开发者“系统分成哪些层”
- 测试保证这些层的 contract 不被破坏

一旦文档结构和测试结构都开始映射同一套平台模型，后续做目录调整、UI 重构、special agent 扩展、workflow 演进都会稳定得多。
