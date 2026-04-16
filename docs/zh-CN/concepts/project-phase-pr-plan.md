---
read_when:
  - 你想把实施路线图直接映射成一组 PR
  - 你准备按阶段推进代码改造，并希望每个 phase 对应一个主 PR
summary: CrawClaw 项目级实施路线图对应的 PR 计划
title: Phase 对应 PR 计划
---

# Phase 对应 PR 计划

本文档把 [项目实施路线图](/concepts/project-implementation-roadmap) 直接映射为一组主 PR。

约束如下：

- 每个 phase 对应一个主 PR
- 每个 PR 都必须有明确 owner、范围、验收、测试门槛
- 允许在一个 PR 内有多次 commit
- 不建议一个 phase 再拆成多个并行 PR，除非出现紧急修复或阻塞

## 当前状态

以下状态以 `2026-04-16` 的代码和文档为准：

| PR      | 对应 Phase | 当前状态 | 说明                                                                                    |
| ------- | ---------- | -------- | --------------------------------------------------------------------------------------- |
| `PR-00` | Phase 0    | `未开始` | 已有路线图和规划文档，但还没有严格完成一次 baseline freeze 执行与归档。                 |
| `PR-01` | Phase 1    | `已完成` | 目录 maintainer 文档、运行时边界 lint、扩展生态 boundary 清理和主门禁接线已经全部落地。 |
| `PR-02` | Phase 2    | `未开始` | 共享 handler 收口还没有开工。                                                           |
| `PR-03` | Phase 3    | `未开始` | `src/agents` 子域拆分还没有开工。                                                       |
| `PR-04` | Phase 4    | `未开始` | special agent substrate 标准化尚未开工。                                                |
| `PR-05` | Phase 5    | `未开始` | cache 治理尚未开工。                                                                    |
| `PR-06` | Phase 6    | `未开始` | channel runtime 收口尚未开工。                                                          |
| `PR-07` | Phase 7    | `未开始` | 执行事件与可见性全链统一尚未开工。                                                      |
| `PR-08` | Phase 8    | `未开始` | plugin platform 清理尚未开工。                                                          |
| `PR-09` | Phase 9    | `未开始` | UI 信息架构重构尚未开工。                                                               |
| `PR-10` | Phase 10   | `未开始` | 物理拆分准备尚未开工。                                                                  |

## 总体规则

### PR 粒度

每个 phase 一个主 PR，但主 PR 仍应满足：

- 主题单一
- 边界清晰
- 能单独 review
- 能单独回滚

### PR 必须包含的内容

每个 phase PR 默认包含：

- 改动目标
- 影响目录
- 测试计划
- 文档更新
- 旧代码清理说明

### PR 默认模板

每个 PR 建议统一包含：

1. Why
2. Scope
3. Non-goals
4. Key changes
5. Tests
6. Risks / rollback

## PR-00：基线冻结与清单建立

### 建议标题

`chore: establish architecture and test baseline`

### 对应 phase

- Phase 0

### 目标

建立后续所有重构的比较基线。

### 范围

- 目录 owner 盘点
- 入口清单
- cache 清单
- e2e 清单
- top 风险清单

### 非目标

- 不改业务逻辑
- 不搬目录

### 主要目录

- `docs/zh-CN/concepts`
- `docs/help`
- `test/`

### 必要测试

- `pnpm check`
- `pnpm test`
- `pnpm test:e2e`

### 合并门槛

- baseline 清单可以指导后续 phase
- 风险列表已明确

## PR-01：边界治理与目录 owner 固化

### 建议标题

`refactor: codify module boundaries and ownership`

### 对应 phase

- Phase 1

### 目标

让边界治理从文档变成工程规则。

### 范围

- maintainer docs
- import / boundary lint
- `infra` 白名单原则

### 非目标

- 不做大规模搬目录
- 不做共享 handler 收口

### 主要目录

- `src/agents`
- `src/channels`
- `src/plugins`
- `src/memory`
- `src/workflows`
- `src/infra`

### 必要测试

- `pnpm check`
- 边界相关 lint
- 受影响模块 unit / integration

### Reviewer 关注点

- owner 是否清晰
- 新边界是否能被 CI 约束

### 当前完成情况

状态：`已完成（截至 2026-04-16）`

已完成：

- 已新增目录级 maintainer 文档：
  - `src/agents/README.md`
  - `src/channels/README.md`
  - `src/plugins/README.md`
  - `src/memory/README.md`
  - `src/workflows/README.md`
  - `src/infra/README.md`
- 已在 `docs/maintainers/repo-structure.md` 增加这些入口文档的索引。
- 已新增运行时边界检查：
  - `scripts/check-runtime-module-boundaries.mjs`
  - `test/runtime-module-boundaries.test.ts`
- 已把以下稳定边界检查接入 `check`：
  - `lint:agent:ingress-owner`
  - `lint:runtime:module-boundaries`
  - `lint:tmp:channel-agnostic-boundaries`
  - `lint:web-search-provider-boundaries`
- 已补齐并公开插件/扩展边界所需的窄 plugin-sdk surface：
  - `plugin-sdk/process-runtime`
  - `plugin-sdk/diagnostic-runtime`
  - `plugin-sdk/open-websearch-runtime`
- 已清理扩展生态既存 boundary debt：
  - extensions 不再直接依赖核心 `src/**` 实现
  - `src/plugins` 不再反向依赖 `extensions/open-websearch/**`
  - 扩展测试已切回 `test/helpers/plugins/*` 或公开 surface
- 已把 `lint:boundaries:ecosystem` 并回 `lint:boundaries`，并随 `pnpm check` 一起执行。

已验证：

- `pnpm lint:boundaries`
- `pnpm lint:boundaries:ecosystem`
- `vitest run test/runtime-module-boundaries.test.ts test/extension-plugin-sdk-boundary.test.ts test/plugin-extension-import-boundary.test.ts test/web-search-provider-boundary.test.ts extensions/feishu-cli/src/lark-cli.test.ts extensions/open-websearch/index.test.ts extensions/open-websearch/src/open-websearch-client.test.ts extensions/open-websearch/src/open-websearch-provider.test.ts extensions/line/src/bot-message-context.test.ts`
- `pnpm check`

后续增强项：

- `agents -> gateway` 的批准 seam 还可以继续收窄成更明确的 contract / barrel。
- `auto-reply -> channels` 目前仍以 allowlist + seam 方式约束，后续可继续抽成更显式的 interaction contract。

本 PR 收口结论：

1. Phase 1 的目标已经完成，可以关闭 `PR-01`。
2. 进一步的 seam 收窄和 contract 抽象，转入 `PR-02` 及后续 phase 处理。

## PR-02：统一业务入口第一阶段

### 建议标题

`refactor: unify shared domain handlers across transports`

### 对应 phase

- Phase 2

### 目标

把重复业务逻辑从 transport 层拉回共享 handler。

### 优先主链

- workflow controls
- session controls
- model selection
- memory command API

### 非目标

- 不做 `agents` 内部大拆分

### 主要目录

- `src/commands`
- `src/auto-reply`
- `src/gateway`
- `src/workflows`
- `src/memory`

### 必要测试

- 共享 handler tests
- gateway integration
- 至少一条入口相关 e2e

### Reviewer 关注点

- 是否真正删掉重复路径
- transport 是否只剩适配职责

## PR-03：Agent Kernel 子域化

### 建议标题

`refactor: split agent kernel into clearer runtime subdomains`

### 对应 phase

- Phase 3

### 目标

降低 `src/agents` 理解成本。

### 范围

- 最重文件拆分
- 子域边界显式化
- query-context / streaming / tools 收口

### 非目标

- 不物理拆包

### 主要目录

- `src/agents`

### 必要测试

- `pnpm check`
- `agents` 相关 unit / integration
- 关键 tool / runtime smoke

### Reviewer 关注点

- 是否按 owner 拆，而不是纯机械搬文件
- 是否减少而不是增加胶水代码

## PR-04：Special Agent 正式化

### 建议标题

`refactor: standardize special agent substrate contracts`

### 对应 phase

- Phase 4

### 目标

统一后台 agent 机制。

### 范围

- 统一 special agent contract
- 对齐 verification / memory-extraction / session-summary / dream
- 统一 observability / cache policy / tool policy

### 非目标

- 不引入新的 special agent 类型

### 主要目录

- `src/agents/special`
- `src/agents`
- `src/memory`

### 必要测试

- special-agent tests
- memory runner integration
- 至少一条 special-agent 主链 end-to-end

### Reviewer 关注点

- 有没有清掉私建机制
- contract 是否足够稳定

## PR-05：Memory 与 Cache 治理

### 建议标题

`refactor: govern memory and cache ownership explicitly`

### 对应 phase

- Phase 5

### 目标

让 memory 与 cache 的 owner、失效语义和测试责任显式化。

### 范围

- cache 分类
- invalidation 规则
- memory 主链边界
- ad-hoc cache 清理

### 非目标

- 不做 UI 信息架构调整

### 主要目录

- `src/memory`
- `src/agents/query-context`
- `src/agents/special/runtime`
- `src/plugins`
- `src/routing`
- `ui/src/ui`

### 必要测试

- cache identity tests
- invalidation tests
- memory integration tests
- 至少一条 memory 主链 e2e

### Reviewer 关注点

- 每种 cache 是否有清晰 owner
- memory 和 cache 是否还在互相隐式耦合

## PR-06：Channel Runtime 收口

### 建议标题

`refactor: consolidate channel runtime responsibilities`

### 对应 phase

- Phase 6

### 目标

把真实渠道行为收回 `src/channels`。

### 范围

- inbound normalization
- threading / binding / pairing / typing
- interactive controls
- outbound projection

### 非目标

- 不做全量 UI 改版

### 主要目录

- `src/channels`
- `src/auto-reply`
- `src/workflows`
- `extensions/*`

### 必要测试

- channel contract tests
- outbound adapter tests
- 至少一条 channel e2e

### Reviewer 关注点

- 渠道逻辑有没有继续散落在别处
- contract 是否比之前更清晰

## PR-07：Execution Event / Visibility 全链统一

### 建议标题

`refactor: unify execution events and visibility projection`

### 对应 phase

- Phase 7

### 目标

统一 tool / workflow / skill / system / artifact 的执行展示语义。

### 范围

- Action Feed
- inspect
- channel forwarder
- ACP projector
- workflow visibility

### 非目标

- 不做 plugin platform 清理

### 主要目录

- `src/agents/action-feed`
- `src/auto-reply`
- `src/workflows`
- `src/acp`
- `ui/src/ui`

### 必要测试

- execution visibility tests
- UI projection tests
- ACP / channel / UI 一致性集成测试
- workflow channel e2e

### Reviewer 关注点

- 是否真统一成一套投影语义
- 旧 fallback 是否被清掉

## PR-08：Plugin Platform 清理

### 建议标题

`refactor: harden plugin platform boundaries and lifecycle`

### 对应 phase

- Phase 8

### 目标

让扩展只通过稳定平台能力接入。

### 范围

- manifest / runtime / setup / interactive 生命周期
- plugin-sdk surface
- extension boundary lint

### 非目标

- 不调整 UI 信息架构

### 主要目录

- `src/plugins`
- `src/plugin-sdk`
- `extensions/*`

### 必要测试

- plugin contract tests
- extension tests
- plugin install/startup docker smoke

### Reviewer 关注点

- 是否减少扩展对核心内部实现的耦合

## PR-09：UI 信息架构重构

### 建议标题

`refactor: reorganize control ui around platform information architecture`

### 对应 phase

- Phase 9

### 目标

把 UI 重组为按平台分层理解的界面。

### 范围

- Chat
- Agents
- Channels
- Workflows
- Memory
- Nodes
- Logs / Inspect

### 非目标

- 不拆包

### 主要目录

- `ui/src/ui`
- `src/gateway`

### 必要测试

- UI view tests
- projection tests
- 关键交互 smoke

### Reviewer 关注点

- UI 是否在消费稳定 contract
- 信息架构是否比之前更接近系统模型

## PR-10：物理拆分准备

### 建议标题

`chore: prepare stable module surfaces for future package split`

### 对应 phase

- Phase 10

### 目标

为未来拆包做准备，但不真正拆包。

### 范围

- public surface 清单
- future package boundary draft
- import graph 风险表

### 非目标

- 不真的把仓库拆成多个 package

### 主要目录

- `src/`
- `docs/zh-CN/concepts`

### 必要测试

- 以前 9 个 PR 的全部门禁继续稳定

### Reviewer 关注点

- 是否真的准备好了，而不是只写了一个理想图

## PR 依赖顺序

1. PR-00
2. PR-01
3. PR-02
4. PR-03
5. PR-04
6. PR-05
7. PR-06
8. PR-07
9. PR-08
10. PR-09
11. PR-10

不建议跳顺序。  
其中 PR-02、PR-03、PR-04、PR-06、PR-07 是整个计划的关键主链。

## 每个 PR 的默认结束动作

每个 phase PR 合并前都应确认：

1. 相关文档已同步
2. 旧路径已清理，不只是保留兼容
3. 该 phase 对应的测试门槛已经补齐
4. 下一 phase 的前置条件已经满足

## 延伸阅读

- [项目实施路线图](/concepts/project-implementation-roadmap)
- [项目整体架构总览](/concepts/project-architecture-overview)
- [目录与边界规划](/concepts/project-directory-boundaries)
- [文档与测试体系规划](/concepts/project-docs-and-test-strategy)
