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
3. 第 5-7 周：Phase 3
4. 第 8 周：Session Runtime 专题收口
5. 第 9-10 周：Phase 4-5
6. 第 11-13 周：Phase 6-7
7. 第 14 周：Phase 8-9
8. 第 15 周：Phase 10 与收口

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

### 当前完成情况

状态：`已完成（截至 2026-04-17）`

已完成：

1. 已产出 baseline 专项文档：
   - [项目基线冻结](/concepts/project-baseline-freeze)
2. 已冻结当前目录 owner 基线：
   - `src/gateway`
   - `src/auto-reply`
   - `src/agents`
   - `src/channels`
   - `src/plugins`
   - `src/memory`
   - `src/workflows`
3. 已冻结当前业务入口基线：
   - CLI commands
   - channel text commands
   - gateway methods
   - UI actions
4. 已冻结当前缓存与 e2e / smoke 基线：
   - cache governance 分类
   - `pnpm check`
   - `pnpm test`
   - `pnpm test:e2e`
   - docker smoke 命令面
5. 已冻结当前 top 风险，后续 phase 可按同一 baseline 比较是否继续收敛。

已验证：

- `pnpm check`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:docker:onboard`
- `pnpm test:docker:gateway-network`

说明：

- baseline 已完成从“冻结真实状态”到“恢复真实门禁”的收口：
  - `pnpm check` 通过
  - `pnpm test` 通过
  - `pnpm test:e2e` 通过
  - `pnpm test:docker:onboard` 通过
  - `pnpm test:docker:gateway-network` 通过
- 后续若 baseline 再出现红项，应按新回归处理，而不是继续视为历史失败面。

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

状态：`已完成（截至 2026-04-16）`

已完成：

- 已开始从 `workflow controls` 下手。
- 已新增 `src/workflows/control-runtime.ts` 作为 command 与 gateway 共享的 workflow control 执行层。
- 已把 `workflow status / cancel / resume` 的 command 与 gateway 调度接到同一套共享执行路径。
- 已把 `session controls` 的第一批命令 `/send`、`/usage`、`/fast` 接到共享 session patch 语义，不再直接手改 `sessionEntry`。
- 已把 inline directive 持久化里的 `verbose / reasoning / elevated / exec` 也接到同一套 shared session patch runtime。
- 已把 `model selection` 持久化也收口到共享 runtime，覆盖 inline directive、session reset 和无效存储模型回退到默认的路径。
- 已确认 `memory command API` 当前消费者已经复用 `src/memory/command-api.ts`，这一批没有额外的 transport 重复实现需要再拆。

收口说明：

- workflow control 更深一层的参数校验、domain 结果映射、transport 输出边界，转入后续 phase 继续收紧。
- `reset / abort / lifecycle` 经代码复查后确认为 session runtime / ACP / transcript / hook cleanup 的复合状态机问题，不再作为 Phase 2 的收口条件。
- 因此 Phase 2 里“把重复业务语义从 transport 层拉回共享 handler”的主线已经完成，可以关闭对应 PR。

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

### 当前状态

状态：`已完成（截至 2026-04-16）`

已完成：

- 已把 `agent-command.ts` 的准备期逻辑抽到 `src/agents/command/prepare.ts`，让 command ingress、session 解析和 workspace / ACP 准备不再继续沉在根文件里。
- 已把 `subagent-spawn.ts` 的 spawn contract 和 spawn runtime helper 拆到 `src/agents/subagents/spawn-types.ts` 与 `src/agents/subagents/spawn-runtime.ts`。
- 已为 `command / subagents / runtime / query-context / tools / special` 补最小入口文档，显式化 `src/agents` 内部的主要子域。
- 已补 focused unit tests，锁住新的 command / subagent helper 行为。
- 已通过针对性 runtime 测试与全仓 `pnpm check`。

收口说明：

- 这轮重点是先把最清晰的两条 owner 线 `command` 与 `subagents` 从根文件热点里抽出来。
- 没有做机械搬目录，也没有直接碰 `pi-embedded-runner` 这种更高风险的主循环热点。
- 后续如果继续细化 `agents`，应该优先沿现有子域做增量收口，而不是再往根层堆 helper。

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

## 专题：Session Runtime / Reset-Abort-Lifecycle 收口

### 目标

把 `reset / abort / lifecycle` 从当前分散的复合状态机，收成一套明确的 session runtime 实现。

### 当前状态

状态：`已完成（截至 2026-04-16）`

已完成：

- 已新增 `src/gateway/session-reset-service.test.ts`，先冻结 gateway reset 的第一批语义：
  - carry-over 字段保留
  - runtime 状态清理
  - `before_reset` hook 发射
  - reset 后会话 unbind
- 已在 `src/auto-reply/reply/commands-core.test.ts` 冻结 ACP reset-in-place 的命令层行为：
  - 绑定 ACP 会话的 bare `/new` 会走 in-place reset 并返回成功回复
  - 绑定 ACP 会话的 `/new <tail>` 会把 tail 回写到 `ctx / rootCtx`，并设置 `AcpDispatchTailAfterReset`
- 已修正 `src/auto-reply/reply/abort.test.ts` 中 4 条 subagent abort/cascade 用例，使其对齐当前 subagent registry 的 latest-run 判定语义。
- 已新增 `src/sessions/runtime/reset-carry-over.ts` 与对应测试，抽出第一块共享 reset carry-over seam，让 `/new` 与 gateway `sessions.reset` 共用同一套字段保留逻辑；当前仍按 `command-reset / gateway-reset` 两种 profile 区分。
- 已新增 `src/sessions/runtime/reset-artifacts.ts` 与 `src/sessions/transcript-archive.fs.ts`，让 transcript 归档和旧 session MCP runtime dispose 不再散在 reset 路径里；`/new`、gateway `sessions.reset`、gateway `sessions.delete` 已开始共用同一套 archive helper。
- 已新增 `src/sessions/runtime/reset-lifecycle.ts`，让 `session_end / session_start` 的 rollover hook 发射从 `session.ts` 主函数中抽离出来。
- 已新增 `src/sessions/runtime/reset-cleanup.ts`，让 gateway 侧的 runtime 前置清理不再散在 `session-reset-service.ts` 中；`stop durable worker / clear queue / stop subagents / abort embedded run / close ACP runtime` 已开始共用同一套 cleanup helper。
- 已新增 `src/sessions/runtime/reset-plan.ts`，让 `session.ts` 中 `reset trigger / tail / ACP default-trigger bypass / stale freshness / system-event freshness override` 的纯决策逻辑从主函数中抽离出来。
- 已新增 `src/auto-reply/reply/session-target-context.ts`，让 `conversation binding context / targetSessionKey / native CommandTargetSessionKey fallback / ACP in-place reset target` 的入口解析从 `session.ts` 主函数中抽离出来。
- 已新增 `src/sessions/runtime/abort-executor.ts`，让 `/stop` 命令路径与 fast-abort 路径开始共用同一套 abort 执行 helper；queue 清理、embedded run abort、abort state 持久化与 abort memory fallback 不再分散在 `commands-session-abort.ts` 与 `abort.ts`。
- ACP session cancel 也已并进 shared abort executor；fast-abort、`/stop` 与 natural-language abort trigger 不再继续分叉维护 ACP 取消语义。
- 已新增 `src/auto-reply/reply/commands-session-abort.test.ts`，锁住 `/stop` 会把 ACP cancel metadata 透传到 shared abort executor。
- 已新增 `src/auto-reply/reply/acp-reset-adapter.ts`，让 `commands-core.ts` 不再直接处理 ACP reset-in-place 的 target 解析、结果映射、tail 回写与 hook session entry 选择。
- 已新增 `src/sessions/runtime/before-reset-hook.ts`，让 `commands-core.ts` 与 gateway `session-reset-service.ts` 的 `before_reset` plugin hook 发射共用同一套 helper；命令层保留 transcript 归档回退，gateway 保留基于 `readSessionMessages(...)` 的加载方式。
- 已新增 `src/gateway/session-reset-entry.ts`，让 gateway `session-reset-service.ts` 中“构建 reset 后新 session entry”的 mutation 逻辑抽成独立 helper；carry-over、model resolution、origin snapshot、runtime/token state 清零与新 session file 路径分配不再继续堆在 service 主函数里。
- 已新增 `src/auto-reply/reply/session-entry-state.ts`，让 `session.ts` 中 next session entry 的构建逻辑抽成独立 helper；deliveryContext、lastChannel/lastTo、meta patch、chatType 默认值与 thread label 收口不再混在 `initSessionState(...)` 主函数里。
- 已新增 `src/sessions/runtime/reset-entry-state.ts`，让 `session.ts` 中“是否复用现有 session、何时生成新 sessionId、以及何时携带 command-reset carry-over”的执行态决策从主函数中抽离出来。
- 已新增 `src/sessions/runtime/reset-internal-hook.ts`，让 `/new` 命令路径与 gateway `sessions.reset` 路径开始共用同一套 reset internal hook event 构建与触发 helper。
- 已复用 `src/config/sessions/transcript.ts` 中导出的 `ensureSessionTranscriptHeader(...)`，让 gateway `session-reset-service.ts` 不再继续保留一套内联 transcript header 初始化逻辑。
- 已通过：
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

### 为什么放在这里

- 这项工作长期价值很高，但短期投入产出比不如 `Phase 3` 的 `agents` 子域化。
- 它已经确认不属于 `Phase 2` 的 transport 入口收口问题。
- 它也不适合直接塞进 `Phase 4` 的 special agent substrate 标准化。
- 因此更合适的时序是：`Phase 3` 完成后，单独做一轮 session runtime 收口，再继续后续 phase。

### 详细任务

1. 先补行为冻结测试：
   - 普通 `/new`
   - `/new` 带 tail
   - ACP 绑定会话的 in-place reset
   - stale session 自动 reset
   - `/stop`
   - fast-abort
   - `abortedLastRun` 的消费
   - `before_reset / session_start / session_end` hooks
2. 抽 reset planner：
   - reset trigger
   - freshness / reset policy
   - ACP bypass 判断
3. 抽 reset carry-over policy：
   - reset 后保留哪些 session 字段
   - reset 后清掉哪些 runtime 状态
4. 抽 reset executor：
   - runtime cleanup
   - transcript rollover
   - session file rebuild
   - old session archive
5. 抽 ACP in-place reset adapter：
   - bound ACP session 的特殊 reset 路径
   - reset tail 的续跑逻辑
6. 抽 abort executor 与 abort state：
   - active run cancel
   - queue clear
   - subagent cascade stop
   - abort state persist / consume
7. 收口 lifecycle hooks 与内部事件发射
8. 最后删除旧路径和重复分支

### 涉及目录

- `src/auto-reply/reply/session.ts`
- `src/auto-reply/reply/commands-core.ts`
- `src/auto-reply/reply/abort.ts`
- `src/gateway/session-reset-service.ts`
- `src/sessions/runtime`（计划新增）

### 验收标准

- `session.ts` 只负责入口归一化与 runtime 调用
- `session-reset-service.ts` 只负责 gateway adapter
- `commands-core.ts` 不再直接处理 ACP reset 细节
- `reset / abort / lifecycle` 主逻辑只剩一套

### 必要测试

- reset / abort / lifecycle 行为冻结测试
- session runtime unit / integration
- ACP reset 主链测试
- 至少一条 `/new`、`sessions.reset`、`/stop` 的端到端主链验证

## Phase 4：Special Agent 正式化

### 目标

让后台 agent 变成统一 substrate，而不是各域自己的私有机制。

### 当前状态

状态：`已完成（截至 2026-04-16）`

已完成：

- 已开始把 special agent contract 校验从纯运行时路径前移到 registry 层。
- 已为 registry 增加“列出所有已注册 special agent contract 问题”的能力，先把定义层标准化拉成可测试入口。
- 已新增 registry-level contract test，锁住当前已注册 special agent 定义的 contract 合法性。
- 已新增 special-agent substrate definition preset，开始把共用 policy 从 memory runner 下沉回 substrate。
- `memory-extraction / session-summary / dream` 已开始共用 embedded memory definition preset；`verification` 已开始共用 shared `runtime_deny` tool policy helper。
- memory file maintenance allowlist 已抽成共享入口，减少 `dream` 与 `durable` 之间的定义层耦合。
- 已新增 shared action-feed emitter，开始统一 memory special-agent 的 action payload 发射路径，减少 runner 本地重复包装逻辑。
- 已新增 shared runtime deps bundle，开始统一 memory special-agent 对 `runSpecialAgentToCompletion` 和 action-feed 的 runtime 依赖拼装方式。
- 已新增 shared configured observability helper，开始统一 memory special-agent 对 runtime config 和 observability 的接线方式。
- 已新增 shared result detail helper，开始统一 memory special-agent 对 child-run metadata、wait status、endedAt 和 usage detail 的组装方式。
- verification tool 也已开始复用 shared action-feed 和 result-detail helper，special-agent substrate 的标准化不再只覆盖 memory 路径。
- 已补 special-agent focused/integration/e2e 覆盖，验证 registry contract、memory runners、verification tool 和 special-agent tool gating 主链。

收口说明：

1. Phase 4 目标已完成，后续不再把 special-agent substrate 标准化视为当前重构主线缺口。
2. 后续新增 special agent 类型或更深 observability 体验，转入后续独立增强项处理。

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

### 当前状态

状态：`已完成（截至 2026-04-16）`

已完成：

- 已新增 shared cache governance substrate：
  - `src/cache/governance-types.ts`
  - `src/cache/governance.ts`
  - `src/cache/governance.test.ts`
- 已把 cache 按 5 类开始显式建模：
  - `query_prompt_identity`
  - `special_agent_snapshot`
  - `runtime_ttl`
  - `plugin_routing_control_plane`
  - `file_ui`
- 已为 query context、context-window、workspace bootstrap、special-agent snapshot、built-in memory runtime、session summary、route resolution、gateway model pricing、UI session cache 等主链 cache 补显式 descriptor。
- 已为这些 cache 补 shared invalidation / observability helper，而不是继续依赖隐式 `Map.clear()` 与局部知识。
- 已把 `context.ts` 的 reset 路径接到 shared invalidation helper。
- 已补 focused cache governance tests、memory integration test，以及至少一条 memory 主链 e2e。

收口说明：

- Phase 5 的重点是把 cache owner / key / lifecycle / invalidation / observability 显式化，而不是一次性为所有 cache 都做 UI 面板。
- 后续如果继续把 registry 暴露给更多 inspect / UI surface，属于增强项，不再作为 Phase 5 缺口。

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

### 当前状态

状态：`已完成（截至 2026-04-17）`

已完成：

- 已启动 Phase 6，第一刀先收 `workflow` 的渠道 outbound projection。
- 已新增 `src/channels/workflow-projection.ts` 作为 channels 层的 workflow payload projector。
- 已新增 `src/channels/workflow-controls.ts` 作为 channels 层的 workflow Telegram / Discord 控制组件 seam。
- 已新增 `src/channels/telegram-model-picker.ts`，把 `/models` 的 Telegram provider/model picker 从 `auto-reply/reply` 收回 channels 层。
- 已新增 `src/channels/telegram-pagination.ts`，把 `/commands` 的 Telegram 分页 inline keyboard 从 `auto-reply/reply` 收回 channels 层。
- 已新增 `src/channels/deliverable-target.ts`，把简单的 deliverable target 归一化从 workflow / approval / media 等调用方里收成共享 channels seam。
- 已新增 `src/channels/acp-delivery-visibility.ts`，把 ACP delivery 的渠道可见性判定从 `auto-reply/reply` 收回 channels 层。
- 已新增 `src/channels/inbound-context.ts` 与 `src/channels/inbound-dedupe.ts`，把 inbound 归一化与 dedupe 语义从 `auto-reply/reply` 收回 channels 层。
- 已新增 `src/channels/reply-to-mode.ts`，把 channel plugin threading contract 的 replyToMode 解析从 `auto-reply/reply` 收回 channels 层。
- 已新增 `src/channels/reply-threading.ts`，把 payload-level reply threading filter 从 `auto-reply/reply` 收回 channels 层。
- 已新增 `src/channels/session-delivery-route.ts`，把 session last-route 解析从 `auto-reply/reply` 收成共享 channels seam。
- 已新增 `src/channels/command-surface-context.ts`，把命令面上的 channel / account 解析从 `auto-reply/reply` 收成共享 channels seam。
- 已新增 `src/channels/conversation-binding-input.ts`，把 conversation binding 输入归一化从 `auto-reply/reply` 收成共享 channels seam。
- 已新增 `src/channels/typing-mode.ts`，把 typing mode / signaler 语义从 `auto-reply/reply` 收回 channels 层。
- 已新增 `src/channels/typing-policy.ts`，把 typing policy 判定从 `auto-reply/reply` 收回 channels 层。
- 已新增 `src/channels/telegram-command-replies.ts`，把 `/commands` 与 `/models` 的 Telegram reply payload 成形从 `auto-reply/reply` 收回 channels 层。
- 已新增 `src/channels/telegram-context.ts` 与 `src/channels/matrix-context.ts`，把 Telegram / Matrix conversation helper 从 `auto-reply/reply` 收回 channels 层。
- 已新增 `src/channels/line-directives.ts` 与 `src/channels/slack-directives.ts`，把 LINE / Slack reply directive transform 从 `auto-reply/reply` 收回 channels 层。
- `src/workflows/channel-forwarder.ts` 已开始改为复用 channels projector，而不是继续内联拼装 Slack / LINE / Telegram / Discord payload。
- `src/auto-reply/reply/commands-workflow.ts` 与 `src/workflows/channel-forwarder.ts` 已开始复用 `src/channels/workflow-controls.ts`，workflow 层收缩为 `/workflow status|cancel|resume` 命令语义与 resume callback 语义。
- `src/auto-reply/reply/commands-workflow.ts` 的 workflow command reply channelData 也已开始复用 `src/channels/workflow-projection.ts` 的共享装配器，不再单独维护 Telegram / Discord channelData 结构。
- `src/auto-reply/reply/commands-models.ts` 与 `src/auto-reply/reply/directive-handling.model.ts` 已改为复用 `src/channels/telegram-model-picker.ts`，不再保留 `auto-reply/reply` 下的 Telegram picker 实现。
- `src/auto-reply/reply/commands-info.ts` 与 `src/plugin-sdk/command-auth.ts` 已改为复用 `src/channels/telegram-pagination.ts`，不再保留 `auto-reply/reply` 下的 Telegram 分页键盘实现。
- `src/workflows/channel-forwarder.ts`、`src/infra/exec-approval-forwarder.ts`、`src/media-understanding/echo-transcript.ts` 与 `src/tasks/task-registry.ts` 已开始复用 `src/channels/deliverable-target.ts`，减少各自手写的 deliverable target 归一化。
- `src/auto-reply/reply/agent-runner.ts`、`src/auto-reply/reply/followup-runner.ts`、`src/auto-reply/reply/commands-info.ts` 与 `src/gateway/server-methods/tools-effective.ts` 已改为复用 `src/channels/reply-to-mode.ts`，不再继续从 `auto-reply/reply` 读取 channel-specific replyToMode resolver。
- `src/auto-reply/reply/reply-payloads-base.ts` 与 `src/auto-reply/reply/agent-runner.ts` 已改为复用 `src/channels/reply-threading.ts`，原来的 `src/auto-reply/reply/reply-threading.ts` 已删除。
- `src/auto-reply/reply/dispatch-acp-delivery.ts` 已改为复用 `src/channels/acp-delivery-visibility.ts`，不再内联 Telegram block visibility 判定。
- `src/auto-reply/dispatch.ts`、`src/auto-reply/reply/get-reply.ts`、`src/auto-reply/reply/dispatch-from-config.ts`、`src/plugins/runtime/runtime-channel.ts` 与 `src/plugin-sdk/reply-runtime.ts` 已改为复用 `src/channels/inbound-context.ts` / `src/channels/inbound-dedupe.ts`，原来的 `src/auto-reply/reply/inbound-context.ts` 与 `src/auto-reply/reply/inbound-dedupe.ts` 已删除。
- `src/auto-reply/reply/session-entry-state.ts` 与 `src/auto-reply/reply/session.ts` 已改为复用 `src/channels/session-delivery-route.ts`，原来的 `src/auto-reply/reply/session-delivery.ts` 已删除。
- `src/auto-reply/reply/commands-session.ts` 与 `src/auto-reply/reply/commands-subagents/*` 已改为复用 `src/channels/command-surface-context.ts`，原来的 `src/auto-reply/reply/channel-context.ts` 已删除。
- `src/auto-reply/reply/session-target-context.ts` 与 `src/auto-reply/reply/commands-acp/context.ts` 已改为复用 `src/channels/conversation-binding-input.ts`，原来的 `src/auto-reply/reply/conversation-binding-input.ts` 已删除。
- `src/auto-reply/reply/agent-runner.ts`、`src/auto-reply/reply/followup-runner.ts` 与 `src/auto-reply/reply/get-reply-run.ts` 已改为复用 `src/channels/typing-mode.ts`，原来的 `src/auto-reply/reply/typing-mode.ts` 已删除。
- `src/auto-reply/reply/get-reply-run.ts` 与 `src/auto-reply/reply/dispatch-from-config.ts` 已改为复用 `src/channels/typing-policy.ts`，原来的 `src/auto-reply/reply/typing-policy.ts` 已删除。
- `src/auto-reply/reply/commands-info.ts` 与 `src/auto-reply/reply/commands-models.ts` 已开始复用 `src/channels/telegram-command-replies.ts`，不再直接内联 Telegram command reply payload。
- `src/auto-reply/reply/commands-session.ts` 与 `src/auto-reply/reply/commands-subagents/*` 已开始复用 `src/channels/telegram-context.ts` / `src/channels/matrix-context.ts`，原来的 `src/auto-reply/reply/telegram-context.ts` 与 `src/auto-reply/reply/matrix-context.ts` 已删除。
- `src/auto-reply/reply/normalize-reply.ts` 已改为复用 `src/channels/line-directives.ts` / `src/channels/slack-directives.ts`，原来的 `src/auto-reply/reply/line-directives.ts` 与 `src/auto-reply/reply/slack-directives.ts` 已删除。
- 已补 focused tests：
  - `src/channels/deliverable-target.test.ts`
  - `src/channels/acp-delivery-visibility.test.ts`
  - `src/channels/inbound-context.test.ts`
  - `src/channels/inbound-dedupe.test.ts`
  - `src/channels/reply-to-mode.test.ts`
  - `src/channels/reply-threading.test.ts`
  - `src/channels/session-delivery-route.test.ts`
  - `src/channels/command-surface-context.test.ts`
  - `src/channels/conversation-binding-input.test.ts`
  - `src/channels/typing-mode.test.ts`
  - `src/channels/typing-policy.test.ts`
  - `src/channels/line-directives.test.ts`
  - `src/channels/slack-directives.test.ts`
  - `src/channels/telegram-command-replies.test.ts`
  - `src/channels/telegram-context.test.ts`
  - `src/channels/matrix-context.test.ts`
  - `src/auto-reply/reply/session.test.ts` 中的 `dmScope delivery migration` focused cases
  - `src/channels/telegram-pagination.test.ts`
  - `src/channels/telegram-model-picker.test.ts`
  - `src/channels/workflow-controls.test.ts`
  - `src/channels/workflow-projection.test.ts`
  - `src/workflows/channel-forwarder.test.ts`
  - `src/auto-reply/reply/commands-workflow.test.ts`

当前判断：

- 这条 seam 已先把“channel payload 如何投影”和“Telegram / Discord 控件如何成形”从 workflow 逻辑里剥出来。
- workflow 控制命令和 resume callback 语义仍暂留在 `src/workflows`，但实际渠道展示结构已经开始收回 `src/channels`。
- inbound normalization、threading / binding / typing、Telegram / Matrix / LINE / Slack transform 与 workflow/projector 主链都已收进 `src/channels`。
- `auto-reply` / `workflows` 现在主要保留 reply orchestration、命令语义和 workflow 语义，不再承载大块渠道 payload 组装与渠道 transform 逻辑。

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

### 当前状态

状态：`已完成（截至 2026-04-17）`

已完成：

- 已启动 Phase 7，第一刀先收 workflow visibility。
- 已新增 `src/workflows/visibility.ts` 与 `src/workflows/visibility.test.ts`，把 workflow root / step / compensation 的 projectedTitle / projectedSummary 生成从 `src/workflows/action-feed.ts` 收成共享 seam。
- `src/workflows/action-feed.ts` 已改为复用 `src/workflows/visibility.ts`，后续 workflow channel forwarder、ACP projector、UI inspect/action feed 可以继续吃同一层 workflow visibility 语义。
- `src/agents/action-feed/projector.ts` 在 workflow detail 足够完整时，也已改为复用 `src/workflows/visibility.ts` 的 shared projection seam；action feed 不再只靠通用 tool/workflow fallback 文案兜 workflow root / step 场景。
- `src/workflows/channel-forwarder.ts` 与 `src/auto-reply/reply/commands-workflow.ts` 现在也开始共用 `src/workflows/visibility.ts`；workflow 渠道回投和 `/workflow status|cancel|resume` 回复不再各自维护第二套标题语义。
- `src/auto-reply/reply/execution-visibility.ts` 里的 workflow summary 与 workflow tool fallback 也已接到 `src/workflows/visibility.ts`；workflow shared title 语义已开始同时覆盖 action feed、channel forwarder、commands、execution-visibility 四条展示路径。
- `ACP projector` 走的 `projectAcpToolCallEvent(...)` 现在也开始复用 shared workflow title 语义；workflow tool call 在 summary mode 下不再退回泛化的 `Workflow: ...` 文案。
- `src/commands/agent.inspect.ts` 现在也会把 workflow action 的 `projectedSummary` 带进 timeline summary；inspect 输出不再丢掉 `Current step: ...` 这类 shared workflow summary。
- UI focused tests 也已对齐新的 shared workflow visibility 语义；`app-action-feed` / `chat view` 不再保留旧的 `Workflow: ...` 预期。
- `src/auto-reply/reply/execution-visibility.ts` 里 workflow summary 的最后一层 phase-aware fallback 也已收口；即使缺少结构化 workflow metadata，只要还有 object label，也会产出 `Running workflow: ...` 这类 shared title。
- `src/workflows/visibility.ts` 已支持 `currentStepId` fallback；即使 steps 还没完整加载，也能产出统一的 `Current step: ...` summary。
- 已新增 `src/infra/approval-visibility.ts`，把 approval waiting / granted / denied / unavailable 的 projectedTitle / projectedSummary 生成收成 shared seam。
- `src/agents/action-feed/projector.ts` 与 gateway approval handlers 已开始复用 shared approval visibility；approval action feed / inspect / UI 的标题不再依赖通用 `wait_approval` intent fallback。
- UI focused tests 也已开始锁住 approval projected fields；approval 这条主线现在和 workflow 一样开始走明确的 shared visibility seam。
- 已新增 `src/agents/tasks/completion-visibility.ts`，把 completion accepted / waiting_user / waiting_external / verification_missing 的 projectedTitle / projectedSummary 生成收成 shared seam。
- `src/agents/tasks/task-trajectory.ts` 与 `src/agents/action-feed/projector.ts` 已开始复用 shared completion visibility；completion action feed 不再只显示泛化的 `Completion decision`。
- UI focused tests 也已开始锁住 completion projected fields；completion 这条主线现在也开始走 shared visibility seam。
- 已新增 `src/memory/action-visibility.ts`，把 memory-extraction / session-summary / dream 的 projectedTitle / projectedSummary 生成收成 shared seam。
- `memory-extraction / session-summary / dream` 三条 runner 现在会在 emit memory action event 时直接附带 shared memory projectedTitle / projectedSummary，以及 `memoryKind / memoryPhase / memoryResultStatus` detail。
- `src/agents/action-feed/projector.ts` 的 memory fallback 也已开始复用 shared memory visibility；带 memory detail 的 raw memory action 不再只依赖各 runner 手写标题。
- UI focused tests 也已开始锁住 memory projected fields；memory 这条主线现在也纳入 shared visibility seam。
- 已补 focused tests：
  - `src/workflows/visibility.test.ts`
  - `src/workflows/action-feed.test.ts`
  - `src/workflows/channel-forwarder.test.ts`
  - `src/agents/action-feed/projector.test.ts`
  - `src/auto-reply/reply/commands-workflow.test.ts`
  - `src/auto-reply/reply/execution-visibility.test.ts`
  - `src/auto-reply/reply/acp-projector.test.ts`
  - `src/commands/agent.inspect.test.ts`
  - `ui/src/ui/app-action-feed.node.test.ts`
  - `ui/src/ui/views/chat.test.ts`
  - `src/memory/action-visibility.test.ts`
  - `src/agents/special/runtime/action-feed.test.ts`
  - `src/memory/durable/agent-runner.test.ts`
  - `src/memory/session-summary/agent-runner.test.ts`
  - `src/memory/dreaming/agent-runner.test.ts`

收口说明：

- workflow / approval / completion / memory 四条最明显的 visibility 主链已经收口到 shared seam。
- `action-feed` / `commands` / `execution-visibility` / `ACP projector` / `inspect` / UI focused surfaces 已开始消费同一套 projectedTitle / projectedSummary 语义。
- artifact 或其他剩余事件如果后续再发现分叉，可作为下一阶段增量收口，不再阻塞 Phase 7。

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

### 当前状态

状态：`已完成（截至 2026-04-17）`

已完成：

- 已新增 `src/plugins/entry-contract.ts`，把 plugin entry / channel entry / setup entry 的导出 contract 收成 shared seam。
- `definePluginEntry(...)`、`defineChannelPluginEntry(...)`、`defineSetupPluginEntry(...)` 现在都会附带显式 lifecycle marker，不再只依赖 loader 的隐式 shape 推断。
- `src/plugins/loader.ts`、`src/plugins/bundled-capability-runtime.ts`、`src/channels/plugins/bundled.ts` 已改为共用同一套 entry resolver；plugin/channel/setup 的 runtime 与 setup lifecycle 不再由三处各自维护一份解析逻辑。
- 已补 focused contract tests，锁住 plugin/channel/setup entry marker、legacy export 兼容、bundled channel shape guard 与 plugin-sdk subpath surface 稳定性。

收口说明：

- 这轮优先收的是 Phase 8 里最核心的 `manifest / runtime / setup` entry contract，而不是继续扩展更多单点 helper。
- entry lifecycle contract 统一之后，extension 不再需要隐式适配 loader/bundled runtime 的不同 export 解析逻辑。
- interactive / setup / runtime 的更细颗粒 helper 若后续还发现重复样板，可继续增量下沉，但不再阻塞 Phase 8。

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

### 当前完成情况

状态：`已完成（截至 2026-04-17）`

已完成：

1. 已把 UI 导航从旧控制台分组改成平台信息架构分组：
   - `chat`
   - `workspace`
   - `automation`
   - `runtime`
   - `observe`
   - `settings`
2. 已把 simple mode 收敛为 5 个一级入口：
   - `overview`
   - `chat`
   - `channels`
   - `workflows`
   - `agents`
3. 已统一页面命名，减少旧控制台语义：
   - `Home` -> `Overview`
   - `Connect` -> `Channels`
   - `Debug` -> `Inspect`
4. 已同步 command palette、sidebar brand 和多语言导航文案，使 UI 表达更接近平台模型，而不是功能堆页。

已验证：

- UI focused tests：
  - `ui/src/ui/navigation.test.ts`
  - `ui/src/ui/navigation-groups.test.ts`
- `pnpm check`

说明：

- 浏览器侧 `navigation.browser.test.ts` 在当前沙箱环境下会因 Playwright 监听端口受限触发 `EPERM`，因此本阶段以 jsdom focused tests + 全仓门禁作为最终验收。

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

### 当前完成情况

状态：`已完成（截至 2026-04-17）`

已完成：

1. 已产出拆包准备专项文档：
   - [模块公开 Surface 与拆包准备](/concepts/project-package-split-prep)
2. 已冻结第一批可以作为 future package facade 的公开 surface：
   - plugin platform：`src/plugin-sdk/index.ts`、`src/plugin-sdk/entrypoints.ts`、`src/plugins/entry-contract.ts`
   - workflow runtime：`src/workflows/api.ts`
   - memory runtime：`src/memory/command-api.ts`、`src/memory/cli-api.ts`、`src/memory/index.ts`
   - control plane：`src/gateway/server.ts`
   - special agent substrate：`src/agents/special/runtime/*`
3. 已明确未来 package 边界草案：
   - `control-plane-core`
   - `interaction-engine`
   - `agent-kernel`
   - `special-agent-substrate`
   - `channel-runtime`
   - `plugin-platform`
   - `memory-runtime`
   - `workflow-runtime`
4. 已整理 import graph 风险表，明确哪些目录虽边界清晰，但仍不适合立刻物理拆包。

已验证：

- `pnpm check`

结论：

- 未来如果要拆包，当前已经不需要先再做一轮大规模边界排雷。
- 但 `interaction-engine` 与 `agent-kernel` 仍建议先补 facade freeze，而不是直接迁目录。

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
