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
| `PR-00` | Phase 0    | `未开始` | 已有路线图和规划文档，但还没有严格完成一次 baseline freeze 执行与归档。                                                                                                                                                                                                                                                             |
| `PR-01` | Phase 1    | `已完成` | 目录 maintainer 文档、运行时边界 lint、扩展生态 boundary 清理和主门禁接线已经全部落地。                                                                                                                                                                                                                                             |
| `PR-02` | Phase 2    | `已完成` | workflow controls、session patch 与 model selection 的共享 runtime 已收口；更深的 session runtime 重构转入后续 phase。                                                                                                                                                                                                              |
| `PR-03` | Phase 3    | `已完成` | `command` / `subagents` 子域已显式化，两个热点文件已拆薄，并补了子域入口文档与 focused tests。                                                                                                                                                                                                                                      |
| `PR-SR` | 专题       | `已完成` | session runtime 的 reset / abort / lifecycle 主链已完成收口：行为冻结测试、shared runtime seam、ACP reset adapter、shared abort executor、shared reset internal hook、gateway reset entry/helper 与 transcript header 统一接线都已落地，主状态机不再散落在 `session.ts`、`abort.ts`、`commands-core.ts` 与 gateway reset 主流程里。 |
| `PR-04` | Phase 4    | `未开始` | special agent substrate 标准化尚未开工。                                                                                                                                                                                                                                                                                            |
| `PR-05` | Phase 5    | `未开始` | cache 治理尚未开工。                                                                                                                                                                                                                                                                                                                |
| `PR-06` | Phase 6    | `未开始` | channel runtime 收口尚未开工。                                                                                                                                                                                                                                                                                                      |
| `PR-07` | Phase 7    | `未开始` | 执行事件与可见性全链统一尚未开工。                                                                                                                                                                                                                                                                                                  |
| `PR-08` | Phase 8    | `未开始` | plugin platform 清理尚未开工。                                                                                                                                                                                                                                                                                                      |
| `PR-09` | Phase 9    | `未开始` | UI 信息架构重构尚未开工。                                                                                                                                                                                                                                                                                                           |
| `PR-10` | Phase 10   | `未开始` | 物理拆分准备尚未开工。                                                                                                                                                                                                                                                                                                              |

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
