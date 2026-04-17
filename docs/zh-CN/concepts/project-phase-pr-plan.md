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
- 对于跨多个 phase 边界、但又不适合强行塞进现有 phase 的复合状态机问题，允许插入一个专题 PR 单独收口

## 当前状态

以下状态以 `2026-04-16` 的代码和文档为准：

| PR      | 对应 Phase | 当前状态 | 说明                                                                                                                                                                                                                                                                                                                                |
| ------- | ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PR-00` | Phase 0    | `已完成` | baseline freeze 已完成：owner 清单、业务入口、缓存、e2e / docker smoke 基线与 top 风险已归档到专项文档，后续各 phase 已有统一比较基线。                                                                                                                                                                                             |
| `PR-01` | Phase 1    | `已完成` | 目录 maintainer 文档、运行时边界 lint、扩展生态 boundary 清理和主门禁接线已经全部落地。                                                                                                                                                                                                                                             |
| `PR-02` | Phase 2    | `已完成` | workflow controls、session patch 与 model selection 的共享 runtime 已收口；更深的 session runtime 重构转入后续 phase。                                                                                                                                                                                                              |
| `PR-03` | Phase 3    | `已完成` | `command` / `subagents` 子域已显式化，两个热点文件已拆薄，并补了子域入口文档与 focused tests。                                                                                                                                                                                                                                      |
| `PR-SR` | 专题       | `已完成` | session runtime 的 reset / abort / lifecycle 主链已完成收口：行为冻结测试、shared runtime seam、ACP reset adapter、shared abort executor、shared reset internal hook、gateway reset entry/helper 与 transcript header 统一接线都已落地，主状态机不再散落在 `session.ts`、`abort.ts`、`commands-core.ts` 与 gateway reset 主流程里。 |
| `PR-04` | Phase 4    | `已完成` | special agent substrate 标准化已完成：registry contract 校验、shared presets、shared action/observability/result wiring、verification 与 memory 主链对齐，以及 special-agent focused/integration tests 都已落地。                                                                                                                   |
| `PR-05` | Phase 5    | `已完成` | cache 治理已完成：已新增 cache governance substrate、显式 cache descriptor、失效/观测 helper、memory/cache focused tests，以及至少一条 memory 主链 e2e；cache owner、key、lifecycle、invalidation 与 observability 不再只留在隐式约定里。                                                                                           |
| `PR-06` | Phase 6    | `已完成` | channel runtime 收口已完成：workflow/outbound projection、interactive controls、inbound normalization、threading/binding/typing、Telegram/Matrix/LINE/Slack channel transform 已统一收进 `src/channels`，`auto-reply` / `workflows` 只保留语义层。                                                                                  |
| `PR-07` | Phase 7    | `已完成` | 执行事件与可见性全链统一已完成：workflow / approval / completion / memory 的 projectedTitle / projectedSummary 已收成 shared visibility seam，并已接回 action feed、commands、execution-visibility、ACP projector、inspect、gateway approval handlers 与 UI focused surfaces。                                                      |
| `PR-08` | Phase 8    | `已完成` | plugin platform 清理已完成：plugin entry / channel entry / setup entry 的导出 contract 已统一到 shared entry-contract seam，loader、bundled capability runtime、channels bundled loader 已共用同一套 resolver，plugin-sdk entry helpers 已带显式 lifecycle marker，plugin contract focused tests 也已补齐。                         |
| `PR-09` | Phase 9    | `已完成` | UI 信息架构重构已完成第一轮收口：导航分组与简单模式主入口已按平台信息架构重组，`overview / channels / debug` 的页面语义已更新为 `Overview / Channels / Inspect`，命令面与侧边栏不再继续沿用旧控制台分组命名，相关 UI focused tests 与 `pnpm check` 已通过。                                                                         |
| `PR-10` | Phase 10   | `已完成` | 物理拆分准备已完成：future package 边界草案、public surface 清单、import graph 风险表已落到专项文档，当前已明确哪些 facade 可冻结、哪些模块只适合保持目录边界而不应立即拆包。                                                                                                                                                       |

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

### 当前完成情况

状态：`已完成（截至 2026-04-17）`

已完成：

- 已新增 baseline 专项文档：
  - `docs/zh-CN/concepts/project-baseline-freeze.md`
- 已冻结目录 owner 清单：
  - `src/gateway`
  - `src/auto-reply`
  - `src/agents`
  - `src/channels`
  - `src/plugins`
  - `src/memory`
  - `src/workflows`
- 已冻结当前业务入口基线：
  - CLI commands
  - channel text commands
  - gateway methods
  - UI actions
- 已冻结当前缓存基线：
  - prompt/query identity
  - bootstrap/runtime snapshot
  - memory/session summary/built-in runtime
  - routing/control-plane cache
  - cache governance registry
- 已冻结当前 e2e / smoke 基线：
  - `pnpm check`
  - `pnpm test`
  - `pnpm test:e2e`
  - `pnpm test:docker:onboard`
  - `pnpm test:docker:gateway-network`
- 已归档当前 top 风险：
  - interaction-engine 缺单一 facade
  - agent-kernel 缺 top-level facade
  - plugin-sdk 稳定级别分层仍需继续补
  - browser e2e 在受限环境下存在运行限制
  - docker smoke 依赖宿主环境
- 已把概念导航补上 baseline 入口：
  - `docs/zh-CN/concepts/index.md`

已验证：

- `pnpm check`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:docker:onboard`
- `pnpm test:docker:gateway-network`

补充说明：

- baseline 文档已经更新为真实通过状态：
  - `pnpm check` 通过
  - `pnpm test` 通过
  - `pnpm test:e2e` 通过
  - `pnpm test:docker:onboard` 通过
  - `pnpm test:docker:gateway-network` 通过
- 这意味着后续任何 baseline 回归都应视为新回归，不再以“历史既有红项”处理。

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

### 当前完成情况

状态：`已完成（截至 2026-04-16）`

已完成：

- 已新增共享 workflow control runtime：
  - `src/workflows/control-runtime.ts`
- 已把 `commands-workflow` 接到共享执行层，不再各自拼装 workflow status/cancel/resume 的底层 runtime 调用。
- 已把 gateway `workflow.status / workflow.cancel / workflow.resume` 接到同一套共享执行层。
- 已补共享层单测：
  - `src/workflows/control-runtime.test.ts`
- 已新增 command session patch 共享入口：
  - `src/auto-reply/reply/commands-session-store.ts`
- 已把 `/send`、`/usage`、`/fast` 从手改 `sessionEntry` 收口到 gateway `sessions.patch` 共用的 patch 语义。
- 已新增通用 session patch runtime：
  - `src/auto-reply/reply/session-patch-runtime.ts`
- 已把 inline directive 持久化里的 `verbose / reasoning / elevated / exec` 收口到同一套 session patch 语义：
  - `src/auto-reply/reply/directive-handling.impl.ts`
  - `src/auto-reply/reply/directive-handling.persist.ts`
- 已把 `model selection` 持久化收口到共享 runtime：
  - `src/auto-reply/reply/directive-handling.impl.ts`
  - `src/auto-reply/reply/directive-handling.persist.ts`
  - `src/auto-reply/reply/session-reset-model.ts`
  - `src/auto-reply/reply/model-selection.ts`
- 已补 command session setting 测试：
  - `src/auto-reply/reply/commands-session-settings.test.ts`

已验证：

- `vitest run src/workflows/control-runtime.test.ts src/auto-reply/reply/commands-workflow.test.ts src/gateway/server-methods/workflow.test.ts`
- `pnpm lint src/workflows/control-runtime.ts src/auto-reply/reply/commands-workflow.ts src/gateway/server-methods/workflow.ts src/workflows/control-runtime.test.ts src/auto-reply/reply/commands-workflow.test.ts`
- `vitest run src/auto-reply/reply/commands-session-settings.test.ts src/gateway/sessions-patch.test.ts`
- `pnpm lint src/auto-reply/reply/commands-session.ts src/auto-reply/reply/commands-session-store.ts src/auto-reply/reply/commands-session-settings.test.ts`
- `vitest run src/auto-reply/reply/commands-session-settings.test.ts src/auto-reply/reply/directive-handling.model.test.ts src/gateway/sessions-patch.test.ts`
- `pnpm lint src/auto-reply/reply/session-patch-runtime.ts src/auto-reply/reply/commands-session-store.ts src/auto-reply/reply/directive-handling.persist.ts src/auto-reply/reply/directive-handling.impl.ts src/auto-reply/reply/commands-session.ts src/auto-reply/reply/commands-session-settings.test.ts`
- `vitest run src/auto-reply/reply/directive-handling.model.test.ts src/auto-reply/reply/model-selection.test.ts src/auto-reply/reply/session-reset-model.test.ts`
- `pnpm lint src/auto-reply/reply/session-patch-runtime.ts src/auto-reply/reply/directive-handling.impl.ts src/auto-reply/reply/directive-handling.persist.ts src/auto-reply/reply/model-selection.ts src/auto-reply/reply/session-reset-model.ts`

当前未完成：

- workflow controls 目前只共享了执行层，参数校验与 transport 结果映射还可以继续下沉。
- `reset / abort / lifecycle` 经代码复查后确认为 session runtime / ACP / transcript / hook cleanup 的复合状态机问题，不再作为 Phase 2 的 transport 收口项。
- `memory command API` 当前消费者已经直接复用 `src/memory/command-api.ts`，本 phase 未再发现需要单独收口的一组跨 transport 重复实现。

本 PR 收口结论：

1. Phase 2 里属于“transport 重复业务入口”的主链已经收完，可以关闭 `PR-02`。
2. workflow control 更深一层的参数/result contract 收紧，转入后续 phase 继续做，不阻塞本 PR。
3. `reset / abort / lifecycle` 转入后续围绕 session runtime 的专题改造，不再作为 `PR-02` 的合并条件。

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

### 当前完成情况

状态：`已完成（截至 2026-04-16）`

已完成：

- 已把 `agent-command.ts` 的准备期逻辑抽到 `src/agents/command/prepare.ts`：
  - command ingress 校验
  - command session 解析
  - command workspace / ACP 准备
  - 显式 override 归一化
  - session entry 持久化 helper
- 已把 `subagent-spawn.ts` 的 spawn contract 与 spawn runtime helper 拆出：
  - `src/agents/subagents/spawn-types.ts`
  - `src/agents/subagents/spawn-runtime.ts`
- `subagent-spawn.ts` 保持原 public API，但内部改为复用 `subagents` 子域 helper，不再继续堆在单文件里。
- 已为以下子域补最小入口文档：
  - `src/agents/command/README.md`
  - `src/agents/subagents/README.md`
  - `src/agents/runtime/README.md`
  - `src/agents/query-context/README.md`
  - `src/agents/tools/README.md`
  - `src/agents/special/README.md`
- 已更新 `src/agents/README.md` 的 Start Here，使 `command / runtime / query-context / subagents / special / tools` 成为显式阅读入口。
- 已补 focused unit tests：
  - `src/agents/command/prepare.test.ts`
  - `src/agents/subagents/spawn-runtime.test.ts`

已验证：

- `vitest run src/agents/command/prepare.test.ts src/agents/subagents/spawn-runtime.test.ts src/agents/subagent-spawn.test.ts src/agents/subagent-spawn.workspace.test.ts src/agents/subagent-spawn.model-session.test.ts`
- `vitest run src/agents/runtime/spawn-session.test.ts`
- `pnpm lint src/agents/agent-command.ts src/agents/command/prepare.ts src/agents/command/prepare.test.ts src/agents/subagent-spawn.ts src/agents/subagents/spawn-runtime.ts src/agents/subagents/spawn-runtime.test.ts src/agents/README.md src/agents/command/README.md src/agents/subagents/README.md src/agents/runtime/README.md src/agents/query-context/README.md src/agents/tools/README.md src/agents/special/README.md`
- `pnpm check`

本 PR 收口结论：

1. `src/agents` 内部的 `command` 和 `subagents` 两条子域已经从根文件热点中独立出来，`PR-03` 的第一阶段目标已完成。
2. 这次没有做机械搬目录或 package 拆分，仍然保持单仓内的安全渐进式重构。
3. 后续围绕 session runtime 的复合状态机收口，转入 `PR-SR`；special agent substrate 标准化转入 `PR-04`。

## PR-SR：Session Runtime / Reset-Abort-Lifecycle 收口

### 建议标题

`refactor: consolidate session runtime reset abort and lifecycle semantics`

### 对应位置

- 专题 PR
- 建议排在 `PR-03` 之后、`PR-04` 之前

### 为什么单独立项

- 这部分已经确认不是 Phase 2 那类 transport 共享 handler 问题。
- 它同时涉及 session reset trigger、carry-over policy、runtime cleanup、transcript rollover、ACP in-place reset、abort state 和 lifecycle hooks。
- 它也不适合塞进 `PR-03` 的 `agents` 子域化，否则会把两个都做重。

### 目标

把目前散落在 `auto-reply`、`gateway` 和 ACP 命令路径里的 `reset / abort / lifecycle` 语义，收成一套明确的 session runtime。

### 范围

- reset trigger / freshness / planning 收口
- reset carry-over policy 收口
- reset cleanup / transcript rollover / session file rebuild 收口
- ACP in-place reset adapter 收口
- abort executor / abort state 收口
- lifecycle hook / event emit 收口

### 非目标

- 不做 UI 信息架构调整
- 不重写 channel runtime
- 不引入新的 session 产品功能

### 主要目录

- `src/auto-reply/reply/session.ts`
- `src/auto-reply/reply/commands-core.ts`
- `src/auto-reply/reply/abort.ts`
- `src/gateway/session-reset-service.ts`
- `src/sessions/runtime`（计划新增）

### 必要测试

- reset / abort / lifecycle 行为冻结测试
- session runtime unit / integration
- ACP reset 主链测试
- 至少一条 `/new`、`sessions.reset`、`/stop` 的端到端主链验证

### Reviewer 关注点

- 是否真的收成单一状态机，而不是把重复逻辑搬了个位置
- carry-over policy 是否只剩一套
- transcript / runtime cleanup / lifecycle emit 是否不再散落多处

### 当前状态

状态：`已完成（截至 2026-04-16）`

规划结论：

1. 这项工作后续必须做，但不再属于 `PR-02` 的合并条件。
2. 结合当前价值评估，建议排在 `PR-03` 之后，而不是立刻抢在最前面。
3. 开工前应先补行为冻结测试，再逐步抽 `planner / carry-over / executor / ACP adapter / lifecycle`。

已完成：

- 已新增 `src/gateway/session-reset-service.test.ts`，冻结 gateway reset 的第一批核心语义：
  - reset 后保留哪些用户级 session 设置
  - reset 后清掉哪些 runtime 状态
  - gateway reset 是否发 `before_reset`
  - gateway reset 是否触发旧会话 unbind
- 已在 `src/auto-reply/reply/commands-core.test.ts` 冻结 ACP reset-in-place 的命令层行为：
  - 绑定 ACP 会话的 bare `/new` 会走 in-place reset 并返回成功回复
  - 绑定 ACP 会话的 `/new <tail>` 会把 tail 回写到 `ctx / rootCtx`，并设置 `AcpDispatchTailAfterReset`
- 已修正 `src/auto-reply/reply/abort.test.ts` 中 4 条 subagent abort/cascade 用例，使其对齐当前 subagent registry 的 latest-run 判定语义。
- 已新增 `src/sessions/runtime/reset-carry-over.ts` 与 `src/sessions/runtime/reset-carry-over.test.ts`，抽出第一块共享 reset carry-over seam：
  - `initSessionState` 的 `/new` carry-over 现在改走共享字段选择逻辑
  - gateway `sessions.reset` 也改走同一套 carry-over 选择逻辑
  - 当前仍保留两种 profile：`command-reset` 与 `gateway-reset`
- 已新增 `src/sessions/runtime/reset-artifacts.ts` 与 `src/sessions/transcript-archive.fs.ts`：
  - `initSessionState` 的旧 transcript 归档与 MCP runtime dispose 改走共享 helper
  - gateway `sessions.reset` 与 `sessions.delete` 的 transcript 归档也改走同一套 helper
- 已新增 `src/sessions/runtime/reset-lifecycle.ts`：
  - `session.ts` 中 `session_end / session_start` 的 rollover hook 发射已抽成独立 helper
- 已新增 `src/sessions/runtime/reset-cleanup.ts`：
  - gateway 侧 `stop durable worker / clear queue / stop subagents / abort embedded run / close ACP runtime` 的前置清理已抽成共享 cleanup helper
  - `session-reset-service.ts` 现在通过该 helper 暴露原有 `cleanupSessionBeforeMutation` API
  - 已在 `src/gateway/session-reset-service.test.ts` 补 cleanup 直测，覆盖活动 run 停不下来时返回 `UNAVAILABLE`、以及 ACP session 的 cancel/close 路径
- 已新增 `src/sessions/runtime/reset-plan.ts`：
  - `session.ts` 中 `reset trigger / tail / ACP default-trigger bypass / stale freshness / system-event freshness override` 的纯决策逻辑已抽成 planner
  - 当前 planner 只负责决策，不处理任何 session store / transcript / hook 副作用
- 已新增 `src/auto-reply/reply/session-target-context.ts`：
  - `session.ts` 中 `conversation binding context / targetSessionKey / native CommandTargetSessionKey fallback / ACP in-place reset target` 的入口解析已抽成独立 helper
  - 当前 helper 负责改写 `sessionCtxForState`，并为 planner 前的 reset 入口判断提供稳定上下文
- 已新增 `src/sessions/runtime/abort-executor.ts` 与 `src/sessions/runtime/abort-executor.test.ts`：
  - `/stop` 命令路径与 `tryFastAbortFromMessage` 现在共用同一套 abort 执行 helper
  - queue 清理、embedded run abort、`abortedLastRun` 持久化与 `abort memory` fallback 不再分散在 `commands-session-abort.ts` 与 `abort.ts`
  - ACP session cancel 现在也并进 shared abort executor；fast-abort、`/stop` 与 natural-language abort trigger 不再继续分叉维护 ACP 取消语义
  - 已新增 `src/auto-reply/reply/commands-session-abort.test.ts`，锁住 `/stop` 会把 ACP cancel metadata 透传到 shared abort executor
- 已新增 `src/auto-reply/reply/acp-reset-adapter.ts`：
  - `commands-core.ts` 不再直接处理 ACP reset-in-place 的 target 解析、结果映射、tail 回写与 hook session entry 选择
  - ACP reset 特殊路径现在通过独立 adapter 接回命令层，只给 transport 返回最终结果
- 已新增 `src/sessions/runtime/before-reset-hook.ts` 与 `src/sessions/runtime/before-reset-hook.test.ts`：
  - `commands-core.ts` 与 gateway `session-reset-service.ts` 的 `before_reset` plugin hook 发射现在共用同一套 helper
  - 命令层仍保留 transcript 归档回退，gateway 仍保留基于 `readSessionMessages(...)` 的加载方式，但 hook 上下文拼装与错误处理不再各写一套
- 已新增 `src/gateway/session-reset-entry.ts` 与 `src/gateway/session-reset-entry.test.ts`：
  - gateway `session-reset-service.ts` 中“构建下一个 reset 后 session entry”的 mutation 逻辑已抽成独立 helper
  - carry-over、model resolution、origin snapshot、token/runtime state 清零与新 session file 路径分配不再继续堆在 `performGatewaySessionReset(...)` 主函数里
- 已新增 `src/auto-reply/reply/session-entry-state.ts` 与 `src/auto-reply/reply/session-entry-state.test.ts`：
  - `session.ts` 中 next session entry 的构建逻辑已抽成独立 helper
  - deliveryContext、lastChannel/lastTo、meta patch、chatType 默认值与 thread label 收口不再混在 `initSessionState(...)` 主函数里
- 已新增 `src/sessions/runtime/reset-entry-state.ts` 与 `src/sessions/runtime/reset-entry-state.test.ts`：
  - `session.ts` 中“复用现有 session 还是生成新 sessionId、以及何时带上 command-reset carry-over”的执行态决策已抽成独立 helper
  - `initSessionState(...)` 不再继续内联维护 `sessionId / isNewSession / systemSent / abortedLastRun / baseEntry / resetCarryOver` 这组 reset 主状态
- 已新增 `src/sessions/runtime/reset-internal-hook.ts` 与 `src/sessions/runtime/reset-internal-hook.test.ts`：
  - `/new` 命令路径与 gateway `sessions.reset` 路径现在共用同一套 reset internal hook event 构建与触发 helper
  - `commands-core.ts` 与 `session-reset-service.ts` 不再各自手写 `createInternalHookEvent(...)+triggerInternalHook(...)`
- 已复用 `src/config/sessions/transcript.ts` 中导出的 `ensureSessionTranscriptHeader(...)`：
  - gateway `session-reset-service.ts` 不再继续保留一套内联 transcript header 初始化逻辑
  - reset 后 transcript 文件创建现在回到统一的 transcript helper 之上
- 已验证：
  - `vitest run src/auto-reply/reply/session-target-context.test.ts src/auto-reply/reply/session.test.ts src/auto-reply/reply/session.heartbeat-no-reset.test.ts src/gateway/session-reset-service.test.ts src/auto-reply/reply/commands-core.test.ts src/auto-reply/reply/abort.test.ts`
  - `vitest run src/sessions/runtime/reset-plan.test.ts src/auto-reply/reply/session.test.ts src/auto-reply/reply/session.heartbeat-no-reset.test.ts src/gateway/session-reset-service.test.ts src/auto-reply/reply/commands-core.test.ts src/auto-reply/reply/abort.test.ts`
  - `vitest run src/gateway/session-reset-service.test.ts src/sessions/runtime/reset-lifecycle.test.ts src/sessions/runtime/reset-artifacts.test.ts src/sessions/runtime/reset-carry-over.test.ts src/auto-reply/reply/session.test.ts src/auto-reply/reply/commands-core.test.ts src/auto-reply/reply/abort.test.ts`
  - `vitest run src/sessions/runtime/abort-executor.test.ts src/auto-reply/reply/abort.test.ts src/auto-reply/reply/commands-core.test.ts src/auto-reply/reply/session.test.ts src/gateway/session-reset-service.test.ts`
  - `vitest run src/auto-reply/reply/acp-reset-adapter.test.ts src/auto-reply/reply/commands-core.test.ts src/auto-reply/reply/abort.test.ts src/sessions/runtime/abort-executor.test.ts src/gateway/session-reset-service.test.ts`
  - `vitest run src/sessions/runtime/before-reset-hook.test.ts src/auto-reply/reply/commands-core.test.ts src/gateway/session-reset-service.test.ts`
  - `vitest run src/gateway/session-reset-entry.test.ts src/gateway/session-reset-service.test.ts`
  - `vitest run src/auto-reply/reply/session-entry-state.test.ts src/auto-reply/reply/session.test.ts src/auto-reply/reply/session.heartbeat-no-reset.test.ts`
  - `vitest run src/sessions/runtime/before-reset-hook.test.ts src/sessions/runtime/abort-executor.test.ts src/auto-reply/reply/acp-reset-adapter.test.ts src/auto-reply/reply/commands-core.test.ts src/auto-reply/reply/abort.test.ts src/gateway/session-reset-service.test.ts src/auto-reply/reply/session.test.ts src/auto-reply/reply/session.heartbeat-no-reset.test.ts`
  - `vitest run src/gateway/session-reset-entry.test.ts src/sessions/runtime/before-reset-hook.test.ts src/sessions/runtime/abort-executor.test.ts src/auto-reply/reply/acp-reset-adapter.test.ts src/auto-reply/reply/commands-core.test.ts src/auto-reply/reply/abort.test.ts src/gateway/session-reset-service.test.ts src/auto-reply/reply/session.test.ts src/auto-reply/reply/session.heartbeat-no-reset.test.ts`
  - `vitest run src/auto-reply/reply/commands-core.test.ts src/auto-reply/reply/session.test.ts src/auto-reply/reply/session.heartbeat-no-reset.test.ts src/auto-reply/reply/abort.test.ts src/sessions/runtime/abort-executor.test.ts src/gateway/session-reset-service.test.ts`
  - `vitest run src/sessions/runtime/reset-entry-state.test.ts src/auto-reply/reply/session.test.ts src/auto-reply/reply/session.heartbeat-no-reset.test.ts src/gateway/session-reset-service.test.ts src/auto-reply/reply/commands-core.test.ts src/auto-reply/reply/abort.test.ts`
  - `vitest run src/sessions/runtime/reset-internal-hook.test.ts src/auto-reply/reply/commands-core.test.ts src/gateway/session-reset-service.test.ts`
  - `vitest run src/sessions/runtime/abort-executor.test.ts src/auto-reply/reply/commands-session-abort.test.ts src/auto-reply/reply/abort.test.ts src/auto-reply/reply/commands-core.test.ts`
  - `vitest run src/gateway/session-reset-service.test.ts src/config/sessions/sessions.test.ts -t "appendAssistantMessageToSessionTranscript"`
  - `vitest run src/gateway/session-utils.fs.test.ts -t "skips files that do not exist and archives only existing ones"`
  - `pnpm lint src/sessions/runtime/reset-cleanup.ts src/gateway/session-reset-service.ts src/gateway/session-reset-service.test.ts src/sessions/runtime/reset-lifecycle.ts src/sessions/runtime/reset-lifecycle.test.ts src/sessions/transcript-archive.fs.ts src/sessions/runtime/reset-artifacts.ts src/sessions/runtime/reset-artifacts.test.ts src/sessions/runtime/reset-carry-over.ts src/sessions/runtime/reset-carry-over.test.ts src/auto-reply/reply/session.ts src/gateway/server-methods/sessions.ts src/auto-reply/reply/commands-core.test.ts src/auto-reply/reply/abort.test.ts`
  - `pnpm lint src/auto-reply/reply/acp-reset-adapter.ts src/auto-reply/reply/commands-core.ts src/auto-reply/reply/abort.ts src/auto-reply/reply/commands-session-abort.ts src/sessions/runtime/abort-executor.ts src/sessions/runtime/abort-executor.test.ts`
  - `pnpm lint src/sessions/runtime/abort-executor.ts src/sessions/runtime/abort-executor.test.ts src/auto-reply/reply/commands-session-abort.ts src/auto-reply/reply/commands-session-abort.test.ts src/auto-reply/reply/abort.ts`
  - `pnpm lint src/sessions/runtime/before-reset-hook.ts src/sessions/runtime/before-reset-hook.test.ts src/auto-reply/reply/commands-core.ts src/auto-reply/reply/commands-core.test.ts src/gateway/session-reset-service.ts`
  - `pnpm lint src/gateway/session-reset-entry.ts src/gateway/session-reset-entry.test.ts src/gateway/session-reset-service.ts`
  - `pnpm lint src/auto-reply/reply/session-entry-state.ts src/auto-reply/reply/session-entry-state.test.ts src/auto-reply/reply/session.ts`
  - `pnpm lint src/sessions/runtime/reset-entry-state.ts src/sessions/runtime/reset-entry-state.test.ts src/auto-reply/reply/session.ts`
  - `pnpm lint src/sessions/runtime/reset-internal-hook.ts src/sessions/runtime/reset-internal-hook.test.ts src/auto-reply/reply/commands-core.ts src/gateway/session-reset-service.ts`
  - `pnpm lint src/config/sessions/transcript.ts src/gateway/session-reset-service.ts src/gateway/session-reset-service.test.ts`
  - `pnpm check`

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

### 当前状态

状态：`已完成（截至 2026-04-16）`

已完成：

- 已开始把 special agent contract 校验从“仅运行时发现”往前移。
- `src/agents/special/runtime/registry.ts` 已新增 registry-level contract issue 枚举能力，允许直接检查所有已注册 special agent 定义是否满足统一 contract。
- `src/agents/special/runtime/registry.test.ts` 已新增 “all registered definitions stay contract-valid” 测试，先把当前 4 个已注册 special agent 锁住：
  - `verification`
  - `memory-extraction`
  - `dream`
  - `session-summary`
- `src/agents/special/runtime/definition-presets.ts` 已新增 substrate preset，开始把 special agent 的共用 policy 从各域 runner 里回收到 substrate：
  - shared `runtime_deny` tool policy helper
  - shared embedded memory special-agent definition preset
  - shared short parent-session prompt cache preset
- `memory-extraction / session-summary / dream` 已开始复用同一套 embedded memory definition preset，`verification` 也已复用 shared `runtime_deny` tool policy helper。
- memory file maintenance allowlist 已抽到共享入口，避免 `dream -> durable` 的导入环继续成为 special-agent substrate 收口阻力。
- `src/agents/special/runtime/action-feed.ts` 已新增 shared action-feed emitter，`memory-extraction / session-summary / dream` 不再各自手写一套 `emitAgentActionEvent` 包装器，memory special-agent 的 action payload 归一到同一条 substrate helper。
- `src/agents/special/runtime/runtime-deps.ts` 已新增 shared runtime deps bundle，memory special-agent 不再各自手写 `defaultSpecialAgentRuntimeDeps + emitAgentActionEvent` 组合逻辑。
- `src/agents/special/runtime/configured-observability.ts` 已新增 shared observability wiring helper，memory special-agent 不再各自手写 `getRuntimeConfigSnapshot + createSpecialAgentObservability` 接线。
- `src/agents/special/runtime/result-detail.ts` 已新增 shared result detail builder，memory special-agent 不再各自重复组装 `childRunId / childSessionKey / waitStatus / endedAt / usage` 这类 action detail。
- `src/agents/tools/verify-task-tool.ts` 也已开始复用 shared action-feed / result-detail helper，verification 这条 special-agent 主链不再保留独立包装语义。
- 已验证：
  - `vitest run src/agents/tools/verify-task-tool.test.ts src/agents/special/runtime/result-detail.test.ts src/agents/special/runtime/configured-observability.test.ts src/agents/special/runtime/runtime-deps.test.ts src/agents/special/runtime/action-feed.test.ts src/agents/special/runtime/definition-presets.test.ts src/agents/special/runtime/registry.test.ts src/memory/durable/agent-runner.test.ts src/memory/session-summary/agent-runner.test.ts src/memory/dreaming/agent-runner.test.ts`
  - `vitest run src/agents/pi-tools.verification-gating.test.ts`
  - `vitest run -c vitest.e2e.config.ts src/agents/pi-tools.before-tool-call.integration.e2e.test.ts -t "blocks non-allowlisted special-agent tools before plugin hooks run"`
  - `pnpm check`

收口结论：

1. Phase 4 的目标已经完成，可以关闭 `PR-04`。
2. 后续如果继续增强 special-agent 体验或新增类型，应作为新能力演进，不再作为 Phase 4 缺口。

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

### 当前完成情况

状态：`已完成（截至 2026-04-16）`

已完成：

- 已新增 shared cache governance substrate：
  - `src/cache/governance-types.ts`
  - `src/cache/governance.ts`
  - `src/cache/governance.test.ts`
- 已把 cache 正式收敛成 5 类并开始显式建模：
  - `query_prompt_identity`
  - `special_agent_snapshot`
  - `runtime_ttl`
  - `plugin_routing_control_plane`
  - `file_ui`
- 已为以下主链 cache 补显式 descriptor、owner、lifecycle、invalidation 与 observability：
  - `src/agents/query-context/cache-contract.ts`
  - `src/agents/context-cache.ts`
  - `src/agents/bootstrap-cache.ts`
  - `src/agents/special/runtime/cache-safe-params.ts`
  - `src/memory/engine/built-in-memory-runtime.ts`
  - `src/memory/session-summary/store.ts`
  - `src/routing/resolve-route.ts`
  - `src/gateway/model-pricing-cache.ts`
  - `ui/src/ui/chat/session-cache.ts`
- 已为主链 cache 补显式 invalidation / meta helper，而不是继续靠隐式 `Map.clear()` 约定：
  - `clearCachedContextTokens(...)`
  - `getModelContextTokenCacheMeta()`
  - `getBootstrapSnapshotCacheMeta()`
  - `getSpecialAgentCacheSafeParamsStoreConfig()`
  - `getBuiltInMemoryRuntimeBootstrapCacheMeta()`
  - `resetConfiguredBuiltInMemoryRuntimeCache()`
  - `clearSessionSummaryReadCache(...)`
  - `getSessionSummaryReadCacheMeta()`
  - `clearResolveRouteCaches(cfg)`
  - `getResolveRouteCacheMeta(cfg)`
  - `getChatSessionCacheMeta(map)`
- 已把 `src/agents/context.ts` 的 context-window cache reset 接到 shared invalidation helper，而不是继续直接操作底层 map。
- 已补 focused tests 覆盖 cache descriptor、meta、invalidation 与 memory runtime 接线：
  - `src/cache/governance.test.ts`
  - `src/agents/context-cache.test.ts`
  - `src/agents/bootstrap-cache.test.ts`
  - `src/agents/special/runtime/cache-safe-params.test.ts`
  - `src/memory/engine/built-in-memory-runtime.test.ts`
  - `src/memory/session-summary/store.test.ts`
  - `src/routing/resolve-route.test.ts`
  - `src/gateway/model-pricing-cache.test.ts`
  - `ui/src/ui/chat/session-cache.test.ts`
- 已补并通过至少一条 memory 主链 e2e：
  - `src/agents/pi-embedded-runner.e2e.test.ts -t "prefers the built-in memory runtime over the legacy context engine path"`

已验证：

- `vitest run src/cache/governance.test.ts src/agents/context-cache.test.ts src/agents/bootstrap-cache.test.ts src/agents/special/runtime/cache-safe-params.test.ts src/memory/engine/built-in-memory-runtime.test.ts src/memory/session-summary/store.test.ts src/routing/resolve-route.test.ts src/gateway/model-pricing-cache.test.ts ui/src/ui/chat/session-cache.test.ts`
- `vitest run src/memory/engine/context-memory-runtime.lifecycle.test.ts`
- `vitest run -c vitest.e2e.config.ts src/agents/pi-embedded-runner.e2e.test.ts -t "prefers the built-in memory runtime over the legacy context engine path"`
- `pnpm check`

收口结论：

1. Phase 5 的目标已经完成，可以关闭 `PR-05`。
2. 后续如果继续补更多 cache registry 消费方、UI 面板或 runtime inspection，属于增强项，不再作为 Phase 5 缺口。

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

### 当前完成情况

状态：`已完成（截至 2026-04-17）`

已完成：

- 已启动 `PR-06`，第一刀优先收 `workflow` 的渠道 outbound projection。
- 已新增共享 channels seam：
  - `src/channels/deliverable-target.ts`
  - `src/channels/deliverable-target.test.ts`
  - `src/channels/acp-delivery-visibility.ts`
  - `src/channels/acp-delivery-visibility.test.ts`
  - `src/channels/inbound-context.ts`
  - `src/channels/inbound-context.test.ts`
  - `src/channels/inbound-dedupe.ts`
  - `src/channels/inbound-dedupe.test.ts`
  - `src/channels/reply-to-mode.ts`
  - `src/channels/reply-to-mode.test.ts`
  - `src/channels/reply-threading.ts`
  - `src/channels/reply-threading.test.ts`
  - `src/channels/session-delivery-route.ts`
  - `src/channels/session-delivery-route.test.ts`
  - `src/channels/command-surface-context.ts`
  - `src/channels/command-surface-context.test.ts`
  - `src/channels/conversation-binding-input.ts`
  - `src/channels/conversation-binding-input.test.ts`
  - `src/channels/typing-mode.ts`
  - `src/channels/typing-mode.test.ts`
  - `src/channels/typing-policy.ts`
  - `src/channels/typing-policy.test.ts`
  - `src/channels/line-directives.ts`
  - `src/channels/line-directives.test.ts`
  - `src/channels/slack-directives.ts`
  - `src/channels/slack-directives.test.ts`
  - `src/channels/telegram-context.ts`
  - `src/channels/telegram-context.test.ts`
  - `src/channels/matrix-context.ts`
  - `src/channels/matrix-context.test.ts`
  - `src/channels/telegram-command-replies.ts`
  - `src/channels/telegram-command-replies.test.ts`
  - `src/channels/telegram-pagination.ts`
  - `src/channels/telegram-pagination.test.ts`
  - `src/channels/telegram-model-picker.ts`
  - `src/channels/telegram-model-picker.test.ts`
  - `src/channels/workflow-controls.ts`
  - `src/channels/workflow-controls.test.ts`
  - `src/channels/workflow-projection.ts`
  - `src/channels/workflow-projection.test.ts`
- `src/workflows/channel-forwarder.ts` 不再直接内联组装 Slack / LINE / Telegram / Discord 的 workflow payload，而是委托给 `src/channels/workflow-projection.ts`。
- `src/auto-reply/reply/commands-workflow.ts` 与 `src/workflows/channel-forwarder.ts` 已开始复用 `src/channels/workflow-controls.ts`，不再各自维护 Telegram / Discord 的 workflow 控件形态。
- `src/auto-reply/reply/commands-workflow.ts` 的 workflow command reply channelData 也已开始复用 `src/channels/workflow-projection.ts`，减少 command reply 与 channel forwarder 之间的渠道装配分叉。
- `src/auto-reply/reply/commands-models.ts` 与 `src/auto-reply/reply/directive-handling.model.ts` 已改为复用 `src/channels/telegram-model-picker.ts`，删除 `auto-reply/reply` 下的纯 Telegram picker 实现。
- `src/auto-reply/reply/commands-info.ts` 与 `src/plugin-sdk/command-auth.ts` 已改为复用 `src/channels/telegram-pagination.ts`，删除 `auto-reply/reply` 下的 Telegram 分页键盘实现。
- `src/workflows/channel-forwarder.ts`、`src/infra/exec-approval-forwarder.ts`、`src/media-understanding/echo-transcript.ts` 与 `src/tasks/task-registry.ts` 已改为复用 `src/channels/deliverable-target.ts`，开始把 deliverable target 归一化从调用侧抽成 channels 共享层。
- `src/channels/acp-delivery-visibility.ts` 已新增，承接 ACP delivery 的渠道可见性判定；`dispatch-acp-delivery.ts` 不再内联 Telegram block visibility 规则。
- `src/channels/inbound-context.ts` 与 `src/channels/inbound-dedupe.ts` 已新增，承接 inbound 归一化与 dedupe 语义；`auto-reply`、`plugin-sdk` 与 plugin runtime 不再从 `auto-reply/reply` 读取这些 inbound helper。
- `src/channels/reply-to-mode.ts` 已新增，承接 channel plugin threading contract 的 replyToMode 解析；`agent-runner`、`followup-runner`、`commands-info` 与 `gateway tools-effective` 已开始统一复用 channels 层的 channel-specific resolver。
- `src/channels/reply-threading.ts` 已新增，承接 payload-level replyTo filter；`reply-payloads-base.ts` 与 `agent-runner.ts` 不再从 `auto-reply/reply` 读取 reply threading filter helper。
- `src/auto-reply/reply/session-entry-state.ts` 与 `src/auto-reply/reply/session.ts` 已改为复用 `src/channels/session-delivery-route.ts`，把 session last-route 解析和 legacy main delivery retirement 一并收回 channels 层。
- `src/channels/telegram-command-replies.ts` 已新增，承接 `/commands` 与 `/models` 的 Telegram reply payload 成形；`commands-info.ts` 与 `commands-models.ts` 不再直接拼 `channelData.telegram.buttons`。
- `src/channels/command-surface-context.ts` 已新增，承接命令面上的 channel / account 解析；`commands-session.ts` 与 `commands-subagents/*` 不再从 `auto-reply/reply` 读取这类 surface helper。
- `src/channels/conversation-binding-input.ts` 已新增，承接 command/binding 输入归一化；`session-target-context.ts` 与 `commands-acp/context.ts` 不再从 `auto-reply/reply` 读取会话绑定输入 helper。
- `src/channels/typing-mode.ts` 已新增，承接渠道侧 typing mode / signaler 语义；`agent-runner.ts`、`followup-runner.ts` 与 `get-reply-run.ts` 不再从 `auto-reply/reply` 读取 typing mode helper。
- `src/channels/typing-policy.ts` 已新增，承接渠道侧 typing policy 判定；`get-reply-run.ts` 与 `dispatch-from-config.ts` 不再从 `auto-reply/reply` 读取 typing policy helper。
- `src/channels/telegram-context.ts` 与 `src/channels/matrix-context.ts` 已新增，承接 Telegram / Matrix conversationId 解析；`commands-session.ts` 与 `commands-subagents/*` 不再从 `auto-reply/reply` 读取这些渠道上下文 helper。
- `src/channels/line-directives.ts` 与 `src/channels/slack-directives.ts` 已新增，承接 LINE / Slack reply directive transform；`normalize-reply.ts` 不再从 `auto-reply/reply` 读取这些渠道特化 helper。
- workflow 层现在主要保留 `/workflow status|cancel|resume` 命令语义和 Discord resume callback 语义；渠道层开始接管 payload projection 与控件成形本身。
- `normalize-reply.ts` 已不再保留 LINE / Slack 渠道 transform；相关 reply directive transform 已统一收进 `src/channels`。
- 原来的 `src/auto-reply/reply/session-delivery.ts` 已删除，相关 delivery route helper 已转为 channels seam。
- 原来的 `src/auto-reply/reply/reply-threading.ts` 已删除，replyToMode resolver 和 payload-level reply threading filter 都已转到 channels 层。
- 原来的 `src/auto-reply/reply/channel-context.ts` 已删除，命令面 channel/account 解析已转为 channels seam。
- 原来的 `src/auto-reply/reply/conversation-binding-input.ts` 已删除，conversation binding 输入归一化已转为 channels seam。
- 原来的 `src/auto-reply/reply/typing-mode.ts` 已删除，typing mode / signaler 语义已转为 channels seam。
- 原来的 `src/auto-reply/reply/typing-policy.ts` 已删除，typing policy 判定已转为 channels seam。
- 原来的 `src/auto-reply/reply/inbound-context.ts` 与 `src/auto-reply/reply/inbound-dedupe.ts` 已删除，inbound 归一化与 dedupe 语义已转为 channels seam。
- 原来的 `src/auto-reply/reply/telegram-context.ts` 与 `src/auto-reply/reply/matrix-context.ts` 已删除，相关 conversation helper 已转为 channels seam。
- 原来的 `src/auto-reply/reply/line-directives.ts` 与 `src/auto-reply/reply/slack-directives.ts` 已删除，相关 reply directive transform 已转为 channels seam。
- 已把 `deliverable-target.ts`、`acp-delivery-visibility.ts`、`inbound-context.ts`、`inbound-dedupe.ts`、`reply-to-mode.ts`、`reply-threading.ts`、`session-delivery-route.ts`、`command-surface-context.ts`、`conversation-binding-input.ts`、`typing-mode.ts`、`typing-policy.ts`、`telegram-context.ts`、`matrix-context.ts`、`line-directives.ts`、`slack-directives.ts`、`telegram-command-replies.ts`、`telegram-pagination.ts`、`telegram-model-picker.ts`、`workflow-projection.ts` 与 `workflow-controls.ts` 补进 `src/channels/README.md` 的 maintainer 入口。

已验证：

- `vitest run src/channels/workflow-controls.test.ts src/channels/workflow-projection.test.ts src/workflows/channel-forwarder.test.ts src/auto-reply/reply/commands-workflow.test.ts`
- `vitest run src/channels/telegram-model-picker.test.ts src/auto-reply/reply/directive-handling.model.test.ts src/auto-reply/reply/commands.test.ts -t "/models command|lists providers on telegram|model directive info"`
- `vitest run src/channels/telegram-pagination.test.ts src/auto-reply/reply/commands.test.ts -t "buildCommandsPaginationKeyboard|/commands"`
- `vitest run src/channels/deliverable-target.test.ts src/workflows/channel-forwarder.test.ts src/infra/exec-approval-forwarder.test.ts src/media-understanding/apply.echo-transcript.test.ts`
- `vitest run src/channels/acp-delivery-visibility.test.ts src/auto-reply/reply/dispatch-acp-delivery.test.ts`
- `vitest run src/channels/inbound-context.test.ts src/channels/inbound-dedupe.test.ts src/auto-reply/inbound.test.ts src/auto-reply/reply/dispatch-from-config.test.ts -t "finalizeInboundContext|inbound dedupe|skips duplicates|builds a stable key"`
- `vitest run src/channels/reply-threading.test.ts src/channels/reply-to-mode.test.ts`
- `vitest run src/channels/reply-to-mode.test.ts src/auto-reply/reply/reply-flow.test.ts -t "createReplyToModeFilter" src/auto-reply/reply/commands-info.tools.test.ts src/gateway/server-methods/tools-effective.test.ts`
- `vitest run src/channels/session-delivery-route.test.ts src/auto-reply/reply/session-entry-state.test.ts src/auto-reply/reply/session.test.ts -t "dmScope delivery migration"`
- `vitest run src/channels/command-surface-context.test.ts src/auto-reply/reply/commands-session-lifecycle.test.ts src/auto-reply/reply/commands-subagents-focus.test.ts`
- `vitest run src/channels/conversation-binding-input.test.ts src/auto-reply/reply/session-target-context.test.ts src/auto-reply/reply/commands-acp.test.ts`
- `vitest run src/channels/typing-mode.test.ts src/channels/typing-policy.test.ts src/auto-reply/reply/get-reply-run.media-only.test.ts src/auto-reply/reply/reply-utils.test.ts -t "resolveTypingMode|createTypingSignaler|suppressTyping"`
- `vitest run src/channels/typing-policy.test.ts src/auto-reply/reply/get-reply-run.media-only.test.ts src/auto-reply/reply/dispatch-from-config.test.ts -t "suppressTyping|forces suppressTyping|forces internal webchat|forces system event"`
- `vitest run src/channels/telegram-command-replies.test.ts src/auto-reply/reply/commands.test.ts -t "buildCommandsPaginationKeyboard|/commands|/models command" src/auto-reply/reply/directive-handling.model.test.ts -t "model directive info"`
- `vitest run src/channels/telegram-context.test.ts src/channels/matrix-context.test.ts src/auto-reply/reply/commands-session-lifecycle.test.ts src/auto-reply/reply/commands-subagents-focus.test.ts`
- `pnpm lint src/channels/workflow-controls.ts src/channels/workflow-controls.test.ts src/channels/workflow-projection.ts src/channels/workflow-projection.test.ts src/workflows/channel-controls.ts src/workflows/channel-forwarder.ts src/workflows/channel-forwarder.test.ts src/auto-reply/reply/commands-workflow.ts src/auto-reply/reply/commands-workflow.test.ts src/channels/README.md`
- `pnpm lint src/channels/telegram-model-picker.ts src/channels/telegram-model-picker.test.ts src/auto-reply/reply/commands-models.ts src/auto-reply/reply/directive-handling.model.ts src/channels/README.md`
- `pnpm lint src/channels/telegram-pagination.ts src/channels/telegram-pagination.test.ts src/auto-reply/reply/commands-info.ts src/auto-reply/reply/commands.test.ts src/channels/README.md`
- `pnpm lint src/channels/deliverable-target.ts src/channels/deliverable-target.test.ts src/workflows/channel-forwarder.ts src/workflows/channel-forwarder.test.ts src/infra/exec-approval-forwarder.ts src/infra/exec-approval-forwarder.test.ts src/media-understanding/echo-transcript.ts src/media-understanding/apply.echo-transcript.test.ts src/tasks/task-registry.ts`
- `pnpm lint src/channels/acp-delivery-visibility.ts src/channels/acp-delivery-visibility.test.ts src/auto-reply/reply/dispatch-acp-delivery.ts src/channels/README.md`
- `pnpm lint src/channels/inbound-context.ts src/channels/inbound-context.test.ts src/channels/inbound-dedupe.ts src/channels/inbound-dedupe.test.ts src/auto-reply/dispatch.ts src/auto-reply/reply/get-reply.ts src/auto-reply/reply/dispatch-from-config.ts src/plugins/runtime/runtime-channel.ts src/plugins/runtime/types-channel.ts src/plugin-sdk/reply-runtime.ts src/plugin-sdk/reply-dispatch-runtime.ts src/link-understanding/apply.ts src/media-understanding/apply.ts src/channels/README.md`
- `pnpm lint src/channels/reply-threading.ts src/channels/reply-threading.test.ts src/auto-reply/reply/reply-payloads-base.ts src/auto-reply/reply/agent-runner.ts src/auto-reply/reply/reply-flow.test.ts src/channels/README.md`
- `pnpm lint src/channels/reply-to-mode.ts src/channels/reply-to-mode.test.ts src/auto-reply/reply/agent-runner.ts src/auto-reply/reply/followup-runner.ts src/auto-reply/reply/commands-info.ts src/auto-reply/reply/commands-info.tools.test.ts src/gateway/server-methods/tools-effective.ts src/gateway/server-methods/tools-effective.test.ts src/channels/README.md`
- `pnpm lint src/channels/session-delivery-route.ts src/channels/session-delivery-route.test.ts src/auto-reply/reply/session-entry-state.ts src/auto-reply/reply/session.ts src/channels/README.md`
- `pnpm lint src/channels/command-surface-context.ts src/channels/command-surface-context.test.ts src/auto-reply/reply/commands-session.ts src/auto-reply/reply/commands-subagents/shared.ts src/auto-reply/reply/commands-subagents/action-agents.ts src/channels/README.md`
- `pnpm lint src/channels/conversation-binding-input.ts src/channels/conversation-binding-input.test.ts src/auto-reply/reply/session-target-context.ts src/auto-reply/reply/session-target-context.test.ts src/auto-reply/reply/commands-acp/context.ts src/channels/README.md`
- `pnpm lint src/channels/typing-mode.ts src/channels/typing-mode.test.ts src/channels/typing-policy.ts src/channels/typing-policy.test.ts src/channels/README.md`
- `pnpm lint src/channels/typing-policy.ts src/channels/typing-policy.test.ts src/auto-reply/reply/get-reply-run.ts src/auto-reply/reply/dispatch-from-config.ts src/channels/README.md`
- `pnpm lint src/channels/line-directives.ts src/channels/line-directives.test.ts src/channels/slack-directives.ts src/channels/slack-directives.test.ts src/auto-reply/reply/normalize-reply.ts src/auto-reply/reply/reply-flow.test.ts src/channels/README.md`
- `pnpm lint src/channels/telegram-command-replies.ts src/channels/telegram-command-replies.test.ts src/auto-reply/reply/commands-info.ts src/auto-reply/reply/commands-models.ts src/channels/README.md`
- `pnpm lint src/channels/telegram-context.ts src/channels/telegram-context.test.ts src/channels/matrix-context.ts src/channels/matrix-context.test.ts src/auto-reply/reply/commands-session.ts src/auto-reply/reply/commands-subagents/action-focus.ts src/auto-reply/reply/commands-subagents/action-unfocus.ts src/auto-reply/reply/commands-subagents/shared.ts src/channels/README.md`
- `pnpm check`

下一步建议：

1. 进入 `PR-07`，把已收进 `src/channels` 的 workflow / tool / process projector 与 execution visibility 语义进一步统一。
2. 继续保持渠道相关改动优先落在 `src/channels` 或 channel plugin 中，不回流到 `auto-reply` / `workflows`。

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

### 当前完成情况

状态：`已完成（截至 2026-04-17）`

已完成：

- 已启动 `PR-07`，第一刀先收 workflow visibility。
- 已新增共享 workflow visibility seam：
  - `src/workflows/visibility.ts`
  - `src/workflows/visibility.test.ts`
- `src/workflows/action-feed.ts` 已改为复用 `src/workflows/visibility.ts`，不再自己维护 workflow root / step / compensation 的 projectedTitle / projectedSummary 生成逻辑。
- `src/agents/action-feed/projector.ts` 在 workflow detail 足够完整时，也已改为复用 `src/workflows/visibility.ts` 的 shared projection seam，而不是继续退回通用 tool/workflow 文案。
- `src/workflows/channel-forwarder.ts` 在 workflow projected 字段缺失时，也已开始复用 `src/workflows/visibility.ts` 的 shared projection seam，不再直接回退原始 workflow title / summary。
- `src/auto-reply/reply/commands-workflow.ts` 的 workflow status/cancel/resume 回复标题也已接到 `src/workflows/visibility.ts`，不再自己维护第二套 `Workflow waiting/completed/failed...` 字符串。
- `src/auto-reply/reply/execution-visibility.ts` 里的 workflow summary 与 workflow tool fallback 也已接到 `src/workflows/visibility.ts`，shared workflow title 语义开始同时覆盖 execution-visibility 链。
- `ACP projector` 当前走的 `projectAcpToolCallEvent(...)` 也已开始复用 shared workflow title 语义；workflow tool call 在 summary mode 下不再退回泛化的 `Workflow: ...` 文案。
- `src/commands/agent.inspect.ts` 现在也会把 workflow action 的 `projectedSummary` 带进 timeline summary；inspect 输出不再只显示 `Workflow waiting: ...` 而丢掉 `Current step: ...` 这类 shared summary。
- UI 侧 focused tests 也已对齐新的 shared workflow visibility 语义；`app-action-feed` / `chat view` 不再保留旧的 `Workflow: ...` 预期。
- `src/auto-reply/reply/execution-visibility.ts` 里 workflow summary 的最后一层 phase-aware fallback 也已收口；即使缺少结构化 workflow metadata，只要还有 object label，也会产出 `Running workflow: ...` 这类 shared title，而不再退回泛化的 `Workflow: ...`。
- 已新增 `src/agents/action-feed/projector.test.ts`，锁住 action-feed projector 在 workflow root / step fallback 场景下的 shared projection 语义。
- `src/workflows/visibility.ts` 现已支持 `currentStepId` fallback；即使 workflow steps 尚未完整加载，也能产出统一的 `Current step: ...` summary。
- workflow projectedTitle / projectedSummary 的来源开始从 `workflows/action-feed.ts` 内联字符串，收口到明确的 shared projector seam，为后续对齐 action feed / channel forwarder / UI / ACP 打基础。
- 已新增 shared approval visibility seam：
  - `src/infra/approval-visibility.ts`
  - `src/infra/approval-visibility.test.ts`
- `src/agents/action-feed/projector.ts` 的 approval fallback 已改为复用 shared approval visibility；raw approval action 不再通过通用 `wait_approval` intent 临时拼出另一套标题。
- `src/gateway/server-methods/exec-approval.ts` 与 `src/gateway/server-methods/plugin-approval.ts` 现在会在 emit action event 时直接附带 shared approval projectedTitle / projectedSummary。
- UI action feed focused tests 也已开始锁住 approval projected fields；`Waiting for exec approval` / `Approval granted` / `Approval unavailable` 不再依赖各层各自猜标题。
- 已新增 shared completion visibility seam：
  - `src/agents/tasks/completion-visibility.ts`
  - `src/agents/tasks/completion-visibility.test.ts`
- `src/agents/tasks/task-trajectory.ts` 现在会在 emit completion action event 时直接附带 shared completion projectedTitle / projectedSummary；`Completion decision` 这类泛标题开始被 `Completion accepted` / `Waiting for user confirmation` / `Waiting for external condition` / `Completion missing verification` 取代。
- `src/agents/action-feed/projector.ts` 的 completion fallback 也已开始复用 shared completion visibility；raw completion action 不再只剩一个泛化标题。
- UI action feed focused tests 已开始锁住 completion projected fields；completion 这条主线也开始和 workflow / approval 一样走 shared visibility seam。
- 已新增 shared memory visibility seam：
  - `src/memory/action-visibility.ts`
  - `src/memory/action-visibility.test.ts`
- `memory-extraction / session-summary / dream` 三条 runner 现在会在 emit memory action event 时直接附带 shared memory projectedTitle / projectedSummary，以及 `memoryKind / memoryPhase / memoryResultStatus` detail。
- `src/agents/action-feed/projector.ts` 的 memory fallback 也已开始复用 shared memory visibility；带 memory detail 的 raw memory action 不再只依赖各 runner 手写标题。
- UI action feed focused tests 也已开始锁住 memory projected fields；memory 这条主线现在也纳入 shared visibility seam。

已验证：

- `vitest run src/workflows/visibility.test.ts src/workflows/action-feed.test.ts src/workflows/channel-forwarder.test.ts`
- `pnpm lint src/workflows/visibility.ts src/workflows/visibility.test.ts src/workflows/action-feed.ts src/workflows/action-feed.test.ts src/workflows/channel-forwarder.ts src/workflows/channel-forwarder.test.ts`
- `vitest run src/agents/action-feed/projector.test.ts src/workflows/visibility.test.ts src/workflows/action-feed.test.ts src/workflows/channel-forwarder.test.ts ui/src/ui/app-action-feed.node.test.ts`
- `pnpm lint src/agents/action-feed/projector.ts src/agents/action-feed/projector.test.ts src/workflows/visibility.ts src/workflows/visibility.test.ts src/workflows/action-feed.ts src/workflows/action-feed.test.ts src/workflows/channel-forwarder.ts src/workflows/channel-forwarder.test.ts ui/src/ui/app-action-feed.node.test.ts`
- `vitest run src/workflows/channel-forwarder.test.ts src/workflows/visibility.test.ts src/agents/action-feed/projector.test.ts`
- `pnpm lint src/workflows/channel-forwarder.ts src/workflows/channel-forwarder.test.ts src/workflows/visibility.ts src/workflows/visibility.test.ts src/agents/action-feed/projector.ts src/agents/action-feed/projector.test.ts`
- `vitest run src/workflows/visibility.test.ts src/auto-reply/reply/commands-workflow.test.ts src/workflows/channel-forwarder.test.ts src/agents/action-feed/projector.test.ts`
- `pnpm lint src/workflows/visibility.ts src/workflows/visibility.test.ts src/auto-reply/reply/commands-workflow.ts src/auto-reply/reply/commands-workflow.test.ts src/workflows/channel-forwarder.ts src/workflows/channel-forwarder.test.ts src/agents/action-feed/projector.ts src/agents/action-feed/projector.test.ts`
- `vitest run src/auto-reply/reply/execution-visibility.test.ts src/workflows/visibility.test.ts src/auto-reply/reply/commands-workflow.test.ts src/workflows/channel-forwarder.test.ts src/agents/action-feed/projector.test.ts`
- `pnpm lint src/auto-reply/reply/execution-visibility.ts src/auto-reply/reply/execution-visibility.test.ts src/agents/action-feed/projector.ts src/agents/action-feed/projector.test.ts src/workflows/visibility.ts src/workflows/visibility.test.ts src/auto-reply/reply/commands-workflow.ts src/auto-reply/reply/commands-workflow.test.ts src/workflows/channel-forwarder.ts src/workflows/channel-forwarder.test.ts`
- `vitest run src/auto-reply/reply/execution-visibility.test.ts src/auto-reply/reply/acp-projector.test.ts src/workflows/visibility.test.ts src/auto-reply/reply/commands-workflow.test.ts src/workflows/channel-forwarder.test.ts src/agents/action-feed/projector.test.ts`
- `pnpm lint src/auto-reply/reply/execution-visibility.ts src/auto-reply/reply/execution-visibility.test.ts src/auto-reply/reply/acp-projector.ts src/auto-reply/reply/acp-projector.test.ts src/workflows/visibility.ts src/workflows/visibility.test.ts src/auto-reply/reply/commands-workflow.ts src/auto-reply/reply/commands-workflow.test.ts src/workflows/channel-forwarder.ts src/workflows/channel-forwarder.test.ts src/agents/action-feed/projector.ts src/agents/action-feed/projector.test.ts`
- `vitest run src/commands/agent.inspect.test.ts src/auto-reply/reply/execution-visibility.test.ts src/auto-reply/reply/acp-projector.test.ts src/workflows/visibility.test.ts src/auto-reply/reply/commands-workflow.test.ts src/workflows/channel-forwarder.test.ts src/agents/action-feed/projector.test.ts`
- `pnpm lint src/commands/agent.inspect.ts src/commands/agent.inspect.test.ts src/auto-reply/reply/execution-visibility.ts src/auto-reply/reply/execution-visibility.test.ts src/auto-reply/reply/acp-projector.ts src/auto-reply/reply/acp-projector.test.ts src/workflows/visibility.ts src/workflows/visibility.test.ts src/auto-reply/reply/commands-workflow.ts src/auto-reply/reply/commands-workflow.test.ts src/workflows/channel-forwarder.ts src/workflows/channel-forwarder.test.ts src/agents/action-feed/projector.ts src/agents/action-feed/projector.test.ts`
- `vitest run ui/src/ui/app-action-feed.node.test.ts ui/src/ui/views/chat.test.ts src/agents/action-feed/projector.test.ts src/auto-reply/reply/execution-visibility.test.ts src/auto-reply/reply/acp-projector.test.ts src/commands/agent.inspect.test.ts`
- `pnpm lint ui/src/ui/app-action-feed.node.test.ts ui/src/ui/views/chat.test.ts src/agents/action-feed/projector.test.ts src/auto-reply/reply/execution-visibility.test.ts src/auto-reply/reply/acp-projector.test.ts src/commands/agent.inspect.test.ts`
- `vitest run src/auto-reply/reply/execution-visibility.test.ts src/auto-reply/reply/acp-projector.test.ts src/commands/agent.inspect.test.ts ui/src/ui/app-action-feed.node.test.ts ui/src/ui/views/chat.test.ts src/auto-reply/reply/commands-workflow.test.ts src/workflows/channel-forwarder.test.ts src/agents/action-feed/projector.test.ts`
- `pnpm lint src/auto-reply/reply/execution-visibility.ts src/auto-reply/reply/execution-visibility.test.ts src/auto-reply/reply/acp-projector.ts src/auto-reply/reply/acp-projector.test.ts src/commands/agent.inspect.ts src/commands/agent.inspect.test.ts ui/src/ui/app-action-feed.node.test.ts ui/src/ui/views/chat.test.ts src/auto-reply/reply/commands-workflow.ts src/auto-reply/reply/commands-workflow.test.ts src/workflows/channel-forwarder.ts src/workflows/channel-forwarder.test.ts src/agents/action-feed/projector.ts src/agents/action-feed/projector.test.ts`
- `vitest run src/infra/approval-visibility.test.ts src/agents/action-feed/projector.test.ts src/gateway/server-methods/server-methods.test.ts src/gateway/server-methods/plugin-approval.test.ts ui/src/ui/app-action-feed.node.test.ts`
- `pnpm lint src/infra/approval-visibility.ts src/infra/approval-visibility.test.ts src/agents/action-feed/projector.ts src/agents/action-feed/projector.test.ts src/gateway/server-methods/exec-approval.ts src/gateway/server-methods/plugin-approval.ts src/gateway/server-methods/server-methods.test.ts src/gateway/server-methods/plugin-approval.test.ts ui/src/ui/app-action-feed.node.test.ts`
- `vitest run src/agents/tasks/completion-visibility.test.ts src/agents/action-feed/projector.test.ts src/agents/tasks/task-trajectory.test.ts ui/src/ui/app-action-feed.node.test.ts`
- `pnpm lint src/agents/tasks/completion-visibility.ts src/agents/tasks/completion-visibility.test.ts src/agents/action-feed/projector.ts src/agents/action-feed/projector.test.ts src/agents/tasks/task-trajectory.ts src/agents/tasks/task-trajectory.test.ts ui/src/ui/app-action-feed.node.test.ts`
- `vitest run src/memory/action-visibility.test.ts src/agents/action-feed/projector.test.ts src/agents/special/runtime/action-feed.test.ts src/memory/durable/agent-runner.test.ts src/memory/session-summary/agent-runner.test.ts src/memory/dreaming/agent-runner.test.ts ui/src/ui/app-action-feed.node.test.ts`
- `pnpm lint src/memory/action-visibility.ts src/memory/action-visibility.test.ts src/agents/action-feed/projector.ts src/agents/action-feed/projector.test.ts src/agents/special/runtime/action-feed.ts src/agents/special/runtime/action-feed.test.ts src/memory/durable/agent-runner.ts src/memory/durable/agent-runner.test.ts src/memory/session-summary/agent-runner.ts src/memory/session-summary/agent-runner.test.ts src/memory/dreaming/agent-runner.ts src/memory/dreaming/agent-runner.test.ts ui/src/ui/app-action-feed.node.test.ts`
- `pnpm check`

本 PR 收口结论：

1. workflow / approval / completion / memory 四条最明显的可见性主链已经收成 shared visibility seam，并接回主要消费面。
2. `action-feed` / `commands` / `execution-visibility` / `ACP projector` / `inspect` / UI focused surfaces 已开始消费同一套 projectedTitle / projectedSummary 语义，而不是继续各自维护标题模板。
3. artifact 或其他剩余事件若后续还发现新的重复 projector，可作为下一阶段增量收口，不再阻塞 `PR-07`。

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

### 当前完成情况

状态：`已完成（截至 2026-04-17）`

已完成：

- 已新增 shared plugin entry contract seam：
  - `src/plugins/entry-contract.ts`
  - `src/plugins/entry-contract.test.ts`
- `definePluginEntry(...)`、`defineChannelPluginEntry(...)`、`defineSetupPluginEntry(...)` 现在都会附带显式 entry lifecycle marker：
  - `plugin`
  - `channel`
  - `setup`
- `src/plugins/loader.ts`、`src/plugins/bundled-capability-runtime.ts`、`src/channels/plugins/bundled.ts` 已改为共用同一套 entry resolver，不再各自维护一份 plugin/channel/setup export shape 解析逻辑。
- bundled channel setup entry 与 full plugin entry 现在共享同一层 contract 解析，setup/runtime manifest lifecycle 不再只靠隐式 shape 约定。
- plugin contract focused tests 已补齐，锁住：
  - plugin entry marker
  - channel entry marker
  - setup entry marker
  - legacy unmarked export 兼容
  - bundled channel shape guard
  - plugin-sdk subpath surface 稳定性

已验证：

- `vitest run src/plugins/entry-contract.test.ts src/channels/plugins/bundled.shape-guard.test.ts src/plugins/contracts/plugin-sdk-subpaths.test.ts src/plugins/loader.test.ts -t "setup entry|cli-metadata mode|plugin entry path escapes|entry contract"`
- `pnpm lint src/plugins/entry-contract.ts src/plugins/entry-contract.test.ts src/plugin-sdk/plugin-entry.ts src/plugin-sdk/channel-plugin-builders.ts src/plugins/loader.ts src/plugins/bundled-capability-runtime.ts src/channels/plugins/bundled.ts`
- `pnpm check`

本 PR 收口结论：

1. plugin / channel / setup 三条最核心的 entry lifecycle contract 已统一，不再由 loader、bundled runtime、channels loader 各自维持一套 shape 约定。
2. plugin-sdk entry helper 已开始明确声明 lifecycle 类型，扩展更像在“接平台 surface”，而不是依赖主仓 loader 的隐式解析细节。
3. interactive / setup / runtime 的更细颗粒 helper 后续如果还有重复样板，可继续增量下沉，但不再阻塞 `PR-08`。

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

### 当前完成情况

状态：`已完成（截至 2026-04-17）`

已完成：

- 已把 advanced navigation 重新组织为平台信息架构分组：
  - `chat`
  - `workspace`
  - `automation`
  - `runtime`
  - `observe`
  - `settings`
- simple mode 已改成聚焦 5 个一级产品入口：
  - `overview`
  - `chat`
  - `channels`
  - `workflows`
  - `agents`
- UI 主命名已从旧控制台语义切到平台语义：
  - `overview`：`Home` -> `Overview`
  - `channels`：`Connect` -> `Channels`
  - `debug`：`Debug` -> `Inspect`
- 侧边栏品牌 eyebrow 已改成 `Platform`，不再继续沿用 `Control`。
- command palette 的一级导航项已对齐新的 IA，优先暴露：
  - `Overview`
  - `Chat`
  - `Channels`
  - `Workflows`
  - `Agents`
  - `Inspect`
  - `Settings`
- 多语言导航文案已同步更新：
  - `ui/src/i18n/locales/en.ts`
  - `ui/src/i18n/locales/zh-CN.ts`
  - `ui/src/i18n/locales/es.ts`
  - `ui/src/i18n/locales/de.ts`
  - `ui/src/i18n/locales/pt-BR.ts`

已验证：

- `pnpm --dir /Users/qianlei/crawclaw lint ui/src/ui/navigation.ts ui/src/ui/navigation.test.ts ui/src/ui/navigation-groups.test.ts ui/src/ui/app-render.ts ui/src/ui/views/command-palette.ts ui/src/i18n/locales/en.ts ui/src/i18n/locales/zh-CN.ts ui/src/i18n/locales/es.ts ui/src/i18n/locales/de.ts ui/src/i18n/locales/pt-BR.ts`
- `../node_modules/.bin/vitest run --config vitest.config.ts src/ui/navigation.test.ts src/ui/navigation-groups.test.ts`（在 `ui/` 目录）
- `pnpm check`

补充说明：

- `src/ui/navigation.browser.test.ts` 的 Playwright 浏览器用例在当前沙箱里会因监听端口 `EPERM` 被阻断，这属于运行环境限制，不是断言回归；本 PR 仍已通过对应的 jsdom focused tests 和全仓 `pnpm check`。

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

### 当前完成情况

状态：`已完成（截至 2026-04-17）`

已完成：

- 已新增专项文档：
  - `docs/zh-CN/concepts/project-package-split-prep.md`
- 已明确第一批可冻结的公开 surface：
  - `src/plugin-sdk/index.ts`
  - `src/plugin-sdk/entrypoints.ts`
  - `src/plugins/entry-contract.ts`
  - `src/workflows/api.ts`
  - `src/memory/command-api.ts`
  - `src/memory/cli-api.ts`
  - `src/memory/index.ts`
  - `src/gateway/server.ts`
  - `src/agents/special/runtime/*` 这一组 substrate seam
- 已给出未来 package 边界草案：
  - `control-plane-core`
  - `interaction-engine`
  - `agent-kernel`
  - `special-agent-substrate`
  - `channel-runtime`
  - `plugin-platform`
  - `memory-runtime`
  - `workflow-runtime`
- 已把 import graph 风险整理成表：
  - interaction 与 gateway 再次缠绕
  - channel runtime 被 workflow / UI 反向侵入
  - plugin-sdk facade 稳定性分层不足
  - agent-kernel 缺少真正的 top-level facade
  - UI 回退到消费 runtime internals
- 已把概念导航补上拆包准备入口：
  - `docs/zh-CN/concepts/index.md`

已验证：

- `pnpm check`

收口结论：

1. 当前已经具备“未来物理拆包”的边界准备条件。
2. 但并不建议马上拆仓；后续若真拆包，应先单独补 `interaction-engine` 与 `agent-kernel` 的 facade freeze。

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
