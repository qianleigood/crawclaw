---
summary: 控制面 API 重构的实施清单，按阶段拆分共享 contract、capability、config 写路径、文档和测试收口
title: 控制面 API 实施清单
---

# 控制面 API 实施清单

这份文档是 [控制面 API 重构方案](/concepts/project-control-plane-api-refactor) 的可执行拆分版。

目标不是“一次性重写全部 API”，而是按可回滚、可验证的阶段推进。

## 总原则

1. 不改传输层，继续保留 Gateway WebSocket RPC。
2. 不新增 `settings.*` 主线，继续围绕 `config.*`。
3. 先收口 contract，再做命名和 alias 清理。
4. 每一阶段都要带测试和文档，不留“之后再补”。

## Phase A：盘点与冻结

### 目标

把前端当前真实依赖的控制面 method surface 冻结成一份清单，避免边改边漂移。

### 产出

1. 一份 `Control UI method inventory`
   - 按 controller 列出当前实际调用的方法
   - 标注：
     - method
     - params 来源
     - result 类型来源
     - required scope
     - 是否 optional
2. 一份 `capability inventory`
   - 哪些方法应走 capability gating
   - 哪些目前仍靠 unknown-method 探测
3. 一份 `schema coverage inventory`
   - 哪些前端方法已经在 TypeBox 中
   - 哪些还没进 schema

### 文件范围

- `ui/src/ui/controllers/*`
- `ui/src/ui/chat/slash-command-executor.ts`
- `ui/src/ui/gateway.ts`
- `src/gateway/server-methods/*`
- `src/gateway/protocol/schema/*`

### 验收

- 形成一份稳定清单文档或测试基线
- 之后新增前端 method 必须显式进清单

## Phase B：共享 contract 骨架

### 目标

建立一份前后端都能消费的 shared control-plane method contract。

### 产出

新增：

- `src/gateway/protocol/control-ui-methods.ts`

定义内容至少包括：

- `method`
- `paramsSchema`
- `resultSchema`
- `requiredScopes`
- `capability`
- `stability`
- `effects`

同时导出：

- `ControlUiMethod`
- `ControlUiMethodParamsMap`
- `ControlUiMethodResultMap`

### 第一批覆盖范围

- `config.*`
- `sessions.*`
- `channels.status`
- `web.login.*`
- `health`
- `status`
- `system-presence`
- `last-heartbeat`

### 当前进度

`PR-CPA-02` 已先落地这一批骨架：

- `config.*`
- `sessions.*`
- `channels.status`
- `web.login.*`
- `health`
- `status`
- `system-presence`
- `last-heartbeat`

`PR-CPA-04` 已继续把这一批并进同一 contract：

- `workflow.*`
- `agents.list`
- `agent.inspect`
- `tools.catalog`
- `tools.effective`
- `usage.status`
- `usage.cost`
- `sessions.usage*`

当前还未并入 shared contract 的主线，主要是：

- `devices.*`
- `nodes.*`
- 少量 optional / plugin-docked surface

### 验收

- contract 文件成为 UI 控制面 method 的唯一汇总入口
- 不要求所有方法第一天都 100% 覆盖，但前端主线必须先进入

## Phase C：Typed request

### 目标

把前端 `request<T>()` 从“只约束返回值”改成“method 决定 params 和 result”。

### 产出

修改：

- `ui/src/ui/gateway.ts`

目标形态：

```ts
request<K extends ControlUiMethod>(
  method: K,
  params: ControlUiMethodParamsMap[K],
): Promise<ControlUiMethodResultMap[K]>
```

### 同步调整

- `ui/src/ui/controllers/*`
- `ui/src/ui/chat/slash-command-executor.ts`

### 当前进度

`PR-CPA-03` 已先落地这一批：

- `ui/src/ui/gateway.ts`
- `ui/src/ui/controllers/config.ts`
- `ui/src/ui/controllers/sessions.ts`
- `ui/src/ui/controllers/channels.ts`
- `ui/src/ui/controllers/health.ts`

当前策略是：

- contract 内方法走 typed overload
- 非 contract 方法继续走 fallback overload

这样已经先收了两批主线：

- `config / sessions / channels / health`
- `workflow / agents / tools / usage`

同时不把 optional/plugin-docked surface 一次性混进来。

### 验收

- controller 不再需要自己声明大部分局部 payload 类型
- method 名拼错 / params 结构错时，TypeScript 直接报错

## Phase D：TypeBox / schema 补齐

### 目标

把前端真实依赖、但目前未进入 TypeBox 的控制面方法补进 schema。

### 第一批重点

- `workflow.*`
- `agent.inspect`
- `system-presence`
- `last-heartbeat`
- `health`
- `status`
- `usage.*`

### 特别策略

#### `channels.status`

维持当前 schema-light 原则：

- 参数 schema 明确
- 高层结果字段稳定
- 渠道账户快照允许 dockable 扩展

#### `plugin` / `channel` 扩展方法

不强求全部做成封闭严格 schema，但必须进 contract 与 capability 清单。

### 当前进度

`PR-CPA-05` 已先补齐这一批前端主线：

- `workflow.*`
- `agent.inspect`
- `usage.status`
- `usage.cost`
- `sessions.usage*`

当前落地形态是：

- 新 schema 进入 `src/gateway/protocol/schema/{workflow,usage}.ts`
- `agent.inspect` schema 进入 `src/gateway/protocol/schema/agent.ts`
- `ProtocolSchemas` 与 `schema/types.ts` 已同步导出
- `control-ui-methods.ts` 已切到直接复用这些 schema

这意味着：

- shared contract 不再依赖大量 local ad-hoc schema
- `workflow / agent.inspect / usage` 已开始具备真正可共享的 protocol 入口
- 后续 UI typed request 可以逐步把结果类型也从本地影子类型迁到 shared schema types

### 验收

- 前端主线 method 基本都能在 `ProtocolSchemas` 或共享 contract 中找到对应定义
- `docs/concepts/typebox.md` 不再与现实脱节

## Phase E：Capability gating

### 目标

把现有 `hello-ok.features.methods/events` 正式接入 UI 主逻辑。

### 产出

新增 UI helper：

- `hasMethod()`
- `hasCapability()`

### 第一批替换点

- `feishu.cli.status`
- `web.login.*`
- `exec.approvals.node.*`
- 其他 node-target / plugin-target optional surface

### bootstrap 扩展

扩展：

- `src/gateway/control-ui-contract.ts`

从当前的：

- `basePath`
- `assistantName`
- `assistantAvatar`

扩成：

- `apiVersion`
- `contractVersion`
- `capabilities`
- `uiProfile`

### 验收

- 正式 UI 页面不再以 `unknown method` 作为主能力探测手段
- capability 缺失时，页面能稳定隐藏、禁用或降级

### 当前进度

`PR-CPA-06` 已先落地这一批：

- `ui/src/ui/gateway.ts`
  - 新增 `hello`、`hasMethod()`、`hasCapability()`
- `ui/src/ui/controllers/channels.ts`
  - `feishu.cli.status`
  - `web.login.*`
- `ui/src/ui/controllers/exec-approvals.ts`
  - `exec.approvals.get`
  - `exec.approvals.set`
  - `exec.approvals.node.*`

同时 shared contract 也已补入：

- `exec.approvals.get`
- `exec.approvals.set`
- `exec.approvals.node.get`
- `exec.approvals.node.set`

其中 node-scoped approvals 已被收成 optional capability-gated surface。

当前还没做的是：

- `bootstrap contract` 扩展
- 更系统的 capability metadata/versioning

所以这轮的完成度可以定义为：

- **UI 已停止把 unknown-method 当作主能力探测手段**
- **bootstrap/versioned capability contract 仍留待后续单独收口**

## Phase F：配置写路径收口

### 目标

坚持“配置文件中心”模型，但明确前端主写路径。

### 目标语义

- 表单编辑：`config.patch`
- Raw 编辑：`config.set`
- 应用生效：`config.apply`

### 产出

1. 调整 Control UI config controller
2. 补齐 `config.schema` / `uiHints` 元信息：
   - `effect`
   - `availability`
   - `readonly`
   - `source`
   - `restartScope`

### 验收

- UI 不再默认通过整份 raw round-trip 处理所有表单修改
- 前端可以稳定区分：
  - 仅保存配置
  - 需要 reconnect
  - 需要 reload
  - 需要 restart

### 当前进度

`PR-CPA-07` 已先落地这一批：

- `ui/src/ui/controllers/config.ts`
  - `saveConfig()` 现在会按模式分流：
    - form mode：优先 `config.patch`
    - raw mode：`config.set`
  - patch 会基于：
    - `configFormOriginal`
    - 经 schema coercion 后的当前表单对象

- `ui/src/ui/controllers/config.test.ts`
  - 已补 form/raw/array-fallback 三类 focused tests

当前保守策略是：

- 普通对象字段编辑走 `config.patch`
- 数组 diff 仍回退到 `config.set`

也就是说，前端已经不再默认把所有表单改动都做成整份 raw round-trip，但数组 patch 语义仍留待后续细化。

## Phase G：错误模型收口

### 目标

让前端不再依赖 message 文案判断。

### 产出

补 structured detail codes，例如：

- `SCOPE_MISSING`
- `METHOD_UNAVAILABLE`
- `CAPABILITY_MISSING`
- `PATCH_CONFLICT`
- `CONFIG_RELOAD_REQUIRED`
- `CONFIG_RESTART_REQUIRED`
- `REAUTH_REQUIRED`

### 第一批替换点

- `ui/src/ui/controllers/scope-errors.ts`
- 所有基于 `message.includes(...)` 的 fallback

### 验收

- UI 错误提示和禁用态都优先走 detail code
- 文案 fallback 只作为兼容兜底

### 当前进度

`PR-CPA-08` 已先落地第一批 control-plane error details：

- 新增 shared detail code 常量：
  - `src/gateway/protocol/request-error-details.ts`
- `src/gateway/server-methods.ts`
  - 缺 scope 的 RPC 错误现在附带：
    - `SCOPE_MISSING`
    - `missingScope`
    - `method`
  - unknown method 的 RPC 错误现在附带：
    - `METHOD_UNAVAILABLE`
    - `method`
- `ui/src/ui/controllers/scope-errors.ts`
  - 现在优先走 structured detail code
  - 旧 message 文案和 `AUTH_UNAUTHORIZED` 仅保留兼容兜底

这意味着：

- 第一批前端主线已经不再需要把 message 文案当作 scope 判断的主路径
- `scope / unknown-method` 两类 RPC 错误已经开始具备稳定 detail code

当前还没做的是：

- `CAPABILITY_MISSING`
- `PATCH_CONFLICT`
- `CONFIG_RELOAD_REQUIRED`
- `CONFIG_RESTART_REQUIRED`
- `REAUTH_REQUIRED`

这些 code 已经进入 shared 常量，但还没有在 gateway/server 主链里系统化发射。

## Phase H：命名收口

### 目标

逐步把方法名收成更一致的资源型结构，但不做一次性 breaking rename。

### 建议的 preferred names

- `system.health`
- `system.status`
- `system.heartbeat.last`
- `channels.login.start`
- `channels.login.wait`

### 保留 alias

保留现有：

- `health`
- `status`
- `last-heartbeat`
- `web.login.*`

直到：

- UI 主路径完成切换
- 文档完成迁移
- contract 测试覆盖齐全

### 验收

- 新前端代码只用 preferred names
- 旧 alias 仅作为兼容面存在

### 当前进度

`PR-CPA-10` 已先完成这一轮：

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
- shared contract 已显式标注 `aliasFor`
- UI 的 health / debug / channel login 主路径已优先走 preferred names，再在旧 gateway 上回退到 alias
- `control-plane-rpc` 文档也已同步加入 preferred names 与 legacy alias 对照

## Phase I：文档收口

### 目标

补一份前端真正可依赖的 control-plane API 文档。

### 新增

- `docs/gateway/control-plane-rpc.md`

### 应包含

1. stable methods
2. optional methods
3. plugin-docked methods
4. bootstrap payload
5. hello capability semantics
6. config patch / set / apply 模型
7. error detail codes
8. preferred names vs legacy aliases

### 同步更新

- `docs/web/control-ui.md`
- `docs/concepts/typebox.md`

### 验收

- 控制 UI 文档不再只写“能做什么”，而是有明确 contract 说明
- TypeBox 文档对 schema 覆盖范围的表述与现状一致

### 当前进度

`PR-CPA-09` 已先落地这一批：

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

这意味着：

- 前端控制面已经有一份独立的 contract 文档，不再只散在功能页里
- `Control UI` 文档已经把 capability gating、config patch/set/apply 模型接回 contract 文档
- `TypeBox` 文档已经改成与当前 reality 对齐：TypeBox 负责 protocol schema，`control-ui-methods.ts` 负责前端 method contract

## Phase J：测试与门禁

### 目标

把 contract 变成可自动验证的工程约束。

### 产出

新增测试：

1. contract coverage
   - stable methods 都能在 gateway registry 找到
2. UI typed request coverage
   - 常用 controller method 能正确推断 params/result
3. capability gating
   - capability 缺失时 UI 不会误调用
4. alias consistency
   - preferred name 与 legacy alias 结果一致
5. config write-path coverage
   - form 走 `patch`
   - raw 走 `set`
   - apply 走 `apply`

### 验收

- CI 能防止 contract 漂移
- 新增前端控制面方法时，必须补 contract 和测试

## 建议的实施顺序

推荐按下面顺序推进：

1. Phase A
2. Phase B
3. Phase C
4. Phase D
5. Phase E
6. Phase F
7. Phase G
8. Phase I
9. Phase J
10. Phase H

原因：

- 命名收口应该放后面
- 先把 contract、schema、capability、config 写路径稳定住

## 风险控制

### 风险 1：一次性全量接 contract 太大

处理：

- 先只覆盖前端真实在用 surface
- Debug/raw surface 延后

### 风险 2：过度严格 schema 破坏 dockable surface

处理：

- `channels.status` 保持 schema-light
- plugin 扩展保持 capability-first，而不是全部封死

### 风险 3：`config.patch` 推进破坏 Raw 体验

处理：

- 明确 patch 只服务表单模式
- Raw 继续完全保留 `config.set`

### 风险 4：命名收口过早造成双轨维护过久

处理：

- 把命名放到最后
- 先把 contract 层和 capability 层做好

## 最后结论

这组改造最核心的不是“换协议”，也不是“另起一层 settings API”，而是：

1. 让前端拿到一份共享 contract
2. 让 capability 成为正式机制
3. 让 `config.patch / set / apply` 语义清晰
4. 让文档、schema、测试跟上

按这份实施清单推进，前端就可以在不放弃当前 Gateway WS RPC 和配置文件中心模型的前提下，得到一套更稳、更可扩、更容易继续演进的控制面 API。

## 相关文档

- [控制面 API 重构方案](/concepts/project-control-plane-api-refactor)
- [控制面 API PR 计划](/concepts/project-control-plane-api-pr-plan)
- [控制面 API Inventory](/concepts/project-control-plane-api-inventory)
