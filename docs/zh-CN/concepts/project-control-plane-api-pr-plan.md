---
summary: 控制面 API 重构的 PR 拆分方案，按前端实际落地顺序安排 contract、capability、config 写路径、文档与测试
title: 控制面 API PR 计划
---

# 控制面 API PR 计划

这份文档把 [控制面 API 重构方案](/concepts/project-control-plane-api-refactor) 和 [控制面 API 实施清单](/concepts/project-control-plane-api-implementation-plan) 进一步压成 **可逐个提交的 PR 计划**。

目标是：

1. 每个 PR 都能独立评审、独立验证、独立回滚。
2. 先做前端收益最大的 contract/capability 收口。
3. 把命名和 alias 清理放到最后。

## 当前状态

| PR          | 状态   | 说明                                            |
| ----------- | ------ | ----------------------------------------------- |
| `PR-CPA-01` | 已完成 | 已落地当前前端 method surface inventory 文档    |
| `PR-CPA-02` | 已完成 | shared control-plane contract 骨架              |
| `PR-CPA-03` | 已完成 | typed request                                   |
| `PR-CPA-04` | 已完成 | workflow / agents / tools / usage 进入 contract |
| `PR-CPA-05` | 已完成 | TypeBox / protocol schema 补齐                  |
| `PR-CPA-06` | 已完成 | capability gating                               |
| `PR-CPA-07` | 已完成 | config 写路径收口                               |
| `PR-CPA-08` | 已完成 | 错误模型收口                                    |
| `PR-CPA-09` | 已完成 | 文档收口                                        |
| `PR-CPA-10` | 已完成 | preferred names / alias 收口                    |

## PR-CPA-01：冻结当前前端 method surface

### 目标

建立前端当前真实依赖的控制面 method inventory，避免后续边改边漂移。

### 范围

- 梳理 `ui/src/ui/controllers/*`
- 梳理 `ui/src/ui/chat/slash-command-executor.ts`
- 对照 `src/gateway/server-methods/*`
- 标注哪些 method：
  - 已有 schema
  - 已有 capability
  - 仍在用 unknown-method 探测

### 产出

- 一份 inventory 文档
- 一份 method 分类表：
  - stable
  - optional
  - debug/raw

### 验收

- 后续前端控制面改造都有统一基线
- inventory 可被 review 直接核对
- 已落地文档：
  - [控制面 API Inventory](/concepts/project-control-plane-api-inventory)

## PR-CPA-02：引入 shared control-plane contract 骨架

### 目标

建立一份 shared `ControlUiMethodContract`，作为前后端统一入口。

### 范围

- 新增 `src/gateway/protocol/control-ui-methods.ts`
- 定义：
  - method
  - paramsSchema
  - resultSchema
  - requiredScopes
  - capability
  - stability
  - effects

### 第一批覆盖

- `config.*`
- `sessions.*`
- `channels.status`
- `web.login.*`
- `health`
- `status`
- `system-presence`
- `last-heartbeat`

### 验收

- contract 文件可被 UI 和 gateway 共同 import
- stable 第一批方法有统一定义，不再散在 controller 里
- 已落地代码：
  - `src/gateway/protocol/control-ui-methods.ts`
  - `src/gateway/protocol/control-ui-methods.test.ts`

## PR-CPA-03：前端 request() typed 化

### 目标

让 `method -> params -> result` 关系由类型系统统一推断。

### 范围

- 修改 `ui/src/ui/gateway.ts`
- 让 `request()` 按 `ControlUiMethod` 推断 params/result
- 更新第一批 controller：
  - `config`
  - `sessions`
  - `channels`
  - `health`

### 验收

- controller 不再重复写局部 payload 类型
- method 名和 params 结构出错时，TypeScript 能直接报错
- 已落地代码：
  - `ui/src/ui/gateway.ts`
  - `ui/src/ui/controllers/config.ts`
  - `ui/src/ui/controllers/sessions.ts`
  - `ui/src/ui/controllers/channels.ts`
  - `ui/src/ui/controllers/health.ts`

## PR-CPA-04：workflow / agents / tools / usage 进入 contract

### 目标

把前端重度使用、但当前最容易漂移的 domain 拉进 shared contract。

### 范围

- `workflow.*`
- `agents.*`
- `agent.inspect`
- `tools.catalog`
- `tools.effective`
- `usage.*`

### 同步工作

- 补前端 controller 类型
- 补 gateway side contract coverage

### 验收

- workflow 页和 agents/tools 页不再靠本地影子类型维护
- 前端主线 method surface 基本进入 contract

### 当前结果

`PR-CPA-04` 已落地：

- `src/gateway/protocol/control-ui-methods.ts`
  - 新增：
    - `workflow.*`
    - `agents.list`
    - `agent.inspect`
    - `tools.catalog`
    - `tools.effective`
    - `usage.status`
    - `usage.cost`
    - `sessions.usage*`
- `ui/src/ui/controllers/agents.ts`
- `ui/src/ui/controllers/workflows.ts`
- `ui/src/ui/controllers/usage.ts`

当前策略是：

- params 先统一并入 shared contract
- 已有 TypeBox/schema 的结果类型直接进入 typed request
- 尚未进入 TypeBox 的结果 payload 继续保留 controller 侧明确类型，留待 `PR-CPA-05` 补齐

## PR-CPA-05：TypeBox / protocol schema 补齐前端主线

### 目标

把 contract 中的前端主线方法补到 TypeBox / protocol schema。

### 第一批重点

- `workflow.*`
- `agent.inspect`
- `system-presence`
- `last-heartbeat`
- `health`
- `status`
- `usage.*`

### 特别说明

- `channels.status` 继续保持 schema-light
- 不强行把所有 plugin-docked payload 做成封闭严格 schema

### 验收

- “前端主线 method” 与 TypeBox/schema 的覆盖关系基本对齐
- 文档里不再出现“schema 是单一事实源，但前端主线其实没覆盖”的错位

### 当前结果

`PR-CPA-05` 已落地：

- 新增 protocol schema：
  - `src/gateway/protocol/schema/workflow.ts`
  - `src/gateway/protocol/schema/usage.ts`
- 扩展：
  - `src/gateway/protocol/schema/agent.ts`
  - `src/gateway/protocol/schema/protocol-schemas.ts`
  - `src/gateway/protocol/schema/types.ts`
- `src/gateway/protocol/control-ui-methods.ts` 已改为直接复用这些 schema，不再继续内联 ad-hoc local schema

这轮补齐的重点是：

- `workflow.*`
  - params schema
  - UI 主线结果 payload 的 schema-light result
- `agent.inspect`
  - params schema
  - inspection snapshot 的 light result schema
- `usage.*`
  - `usage.status`
  - `usage.cost`
  - `sessions.usage*`

当前策略仍然是：

- 对前端重度依赖的 payload 提供稳定的 TypeBox 入口
- 对扩展性较强、结构很深的 payload 使用 schema-light，而不是一口气做成过度封闭 schema

## PR-CPA-06：Capability gating 正式接入 UI

### 目标

把 `hello-ok.features.methods/events` 变成正式 capability system。

### 范围

- 新增 UI helper：
  - `hasMethod()`
  - `hasCapability()`
- 第一批替换：
  - `feishu.cli.status`
  - `web.login.*`
  - `exec.approvals.node.*`

### 同步工作

- 扩展 bootstrap contract：
  - `apiVersion`
  - `contractVersion`
  - `capabilities`
  - `uiProfile`

### 验收

- UI 页面不再以 `unknown method` 作为主探测机制
- 可选功能入口能稳定地显示、禁用或隐藏

### 当前结果

`PR-CPA-06` 已落地：

- `ui/src/ui/gateway.ts`
  - 新增：
    - `client.hello`
    - `client.hasMethod()`
    - `client.hasCapability()`
- `ui/src/ui/controllers/channels.ts`
  - `feishu.cli.status` 不再靠 `unknown method` 探测
  - `web.login.*` 改为先看 method 能力再发请求
- `ui/src/ui/controllers/exec-approvals.ts`
  - gateway / node exec approvals 都先走 method/capability 判断
  - node-scoped exec approvals 不再直接盲调 `exec.approvals.node.*`
- `src/gateway/protocol/control-ui-methods.ts`
  - 补进：
    - `exec.approvals.get`
    - `exec.approvals.set`
    - `exec.approvals.node.get`
    - `exec.approvals.node.set`
  - 其中 node-scoped approvals 已标为 optional capability-gated surface

这轮还没做的是：

- `bootstrap contract` 扩展
- 更广的 capability 元信息下发

所以 `PR-CPA-06` 当前完成的是 **UI 正式改用 capability/method gating**，而不是把 bootstrap/versioned capability 模型也一口气收完。

## PR-CPA-07：config 写路径收口

### 目标

坚持配置文件中心模型，但明确表单/Raw/Apply 三条路径。

### 目标语义

- 表单模式：`config.patch`
- Raw 模式：`config.set`
- 应用：`config.apply`

### 同步增强

- 扩 `config.schema` / `uiHints` 元信息：
  - `effect`
  - `availability`
  - `readonly`
  - `source`
  - `restartScope`

### 验收

- 前端设置体验仍然是“改配置文件”
- 但不再所有编辑都依赖整份 raw round-trip

### 当前结果

`PR-CPA-07` 已落地：

- `ui/src/ui/controllers/config.ts`
  - `saveConfig()` 现在会根据编辑模式与 diff 形态选择写路径：
    - form mode：优先 `config.patch`
    - raw mode：`config.set`
  - form mode 的 patch 现在基于：
    - `configFormOriginal`
    - 当前表单经 schema coercion 后的对象
  - 当 diff 中出现数组改动时，暂时回退到 `config.set`

- `ui/src/ui/controllers/config.test.ts`
  - 已补：
    - form mode -> `config.patch`
    - raw mode -> `config.set`
    - 数组 diff -> 回退 `config.set`

这轮的边界是：

- 已经把前端默认写路径从“表单也走整份 set”收成了“表单优先 patch”
- 但还没有去解决数组 patch 的更细语义，所以数组编辑仍保守回退到 `config.set`

## PR-CPA-08：错误模型收口

### 目标

把前端从 message 文案判断迁移到 structured detail code。

### 范围

- 新增 detail codes：
  - `SCOPE_MISSING`
  - `METHOD_UNAVAILABLE`
  - `CAPABILITY_MISSING`
  - `PATCH_CONFLICT`
  - `CONFIG_RELOAD_REQUIRED`
  - `CONFIG_RESTART_REQUIRED`
  - `REAUTH_REQUIRED`

### 同步工作

- 替换 `scope-errors.ts` 等 message fallback 主路径

### 验收

- UI 的禁用态、错误态、下一步提示都基于稳定 code

### 当前结果

`PR-CPA-08` 已落地第一批控制面错误模型收口：

- 新增 shared detail code 常量：
  - `src/gateway/protocol/request-error-details.ts`
- `src/gateway/server-methods.ts`
  - 缺 scope 时现在会附带：
    - `code: SCOPE_MISSING`
    - `missingScope`
    - `method`
  - unknown method 时现在会附带：
    - `code: METHOD_UNAVAILABLE`
    - `method`
- `ui/src/ui/controllers/scope-errors.ts`
  - 现在优先读取 structured detail code
  - `AUTH_UNAUTHORIZED` 和旧 message 文案只保留兼容兜底
- 新增 focused tests：
  - `src/gateway/server-methods.details.test.ts`
  - `ui/src/ui/controllers/scope-errors.test.ts`

这轮的边界也很明确：

- 已把第一批前端主线最常见的 `scope / unknown-method` 错误收成稳定 detail code
- `scope-errors.ts` 已不再把 message 文案当作主判断路径
- `CAPABILITY_MISSING / PATCH_CONFLICT / CONFIG_RELOAD_REQUIRED / CONFIG_RESTART_REQUIRED` 这些 code 已先进入 shared 常量，但当前还没有在 server 主链里全面发射

## PR-CPA-09：文档收口

### 目标

为前端补一份真正可依赖的 control-plane API 文档。

### 范围

- 新增：
  - `docs/gateway/control-plane-rpc.md`
- 更新：
  - `docs/web/control-ui.md`
  - `docs/concepts/typebox.md`
  - 中文对应页

### 内容

- stable methods
- optional methods
- capability 语义
- bootstrap payload
- config patch/set/apply 语义
- error detail codes

### 验收

- 前端控制面 API 不再只有“功能说明”，而有真正 contract 文档

### 当前结果

`PR-CPA-09` 已落地：

- 新增：
  - `docs/gateway/control-plane-rpc.md`
  - `docs/zh-CN/gateway/control-plane-rpc.md`
- 更新：
  - `docs/web/control-ui.md`
  - `docs/zh-CN/web/control-ui.md`
  - `docs/concepts/typebox.md`
  - `docs/zh-CN/concepts/typebox.md`
  - `docs/gateway/index.md`
  - `docs/zh-CN/gateway/index.md`

这轮文档链的结果是：

- `Control UI` 页不再只讲功能，而是明确指向前端可依赖的 control-plane RPC contract
- `TypeBox` 页不再把自己描述成“前端控制面 contract 的唯一来源”，而是明确与 `control-ui-methods.ts` 分工
- `Gateway` 入口页现在也能直接进入 `control-plane-rpc`

## PR-CPA-10：preferred names 与 alias 收口

### 目标

在 contract、capability、schema、文档都稳定后，再收命名。

### 第一批 preferred names

- `system.health`
- `system.status`
- `system.heartbeat.last`
- `channels.login.start`
- `channels.login.wait`

### 保留 alias

- `health`
- `status`
- `last-heartbeat`
- `web.login.*`

### 验收

- 新前端代码统一走 preferred names
- legacy alias 只保留兼容角色

### 当前结果

`PR-CPA-10` 已落地：

- Gateway 新增 preferred names：
  - `system.health`
  - `system.status`
  - `system.heartbeat.last`
  - `channels.login.start`
  - `channels.login.wait`
- legacy alias 继续保留：
  - `health`
  - `status`
  - `last-heartbeat`
  - `web.login.*`
- shared contract 现在会显式标注 `aliasFor`
- UI 主路径已优先走 preferred names，再在旧 gateway 上回退到 legacy alias
- `control-plane-rpc` 文档已补 preferred names 与 alias 对照表

## 推荐执行顺序

1. `PR-CPA-01`
2. `PR-CPA-02`
3. `PR-CPA-03`
4. `PR-CPA-04`
5. `PR-CPA-05`
6. `PR-CPA-06`
7. `PR-CPA-07`
8. `PR-CPA-08`
9. `PR-CPA-09`
10. `PR-CPA-10`

## 最小优先级集合

如果不想一次做完整套，我建议最少先做这 4 个：

1. `PR-CPA-01`
2. `PR-CPA-02`
3. `PR-CPA-03`
4. `PR-CPA-06`

因为只做完这四个，前端就已经能明显受益：

- 方法面有统一入口
- request 有类型推断
- capability 不再靠报错探测
- 后续继续扩 API 时不再完全字符串化

## 相关文档

- [控制面 API 重构方案](/concepts/project-control-plane-api-refactor)
- [控制面 API 实施清单](/concepts/project-control-plane-api-implementation-plan)
- [控制面 API Inventory](/concepts/project-control-plane-api-inventory)
