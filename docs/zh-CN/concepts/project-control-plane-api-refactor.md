---
summary: 面向前端的 Gateway 控制面 API 重构方案，聚焦共享 contract、能力协商、配置写入主路径和文档测试收口
title: 控制面 API 重构方案
---

# 控制面 API 重构方案

这份方案关注的是 **前端真正消费的 Gateway 控制面 API**，不是 CLI、外部 HTTP API，也不是把整个 Gateway transport 改成另一种协议。

目标是：

1. 让前端继续使用现有 WebSocket RPC 模型。
2. 保留以配置文件为中心的设置心智模型。
3. 把当前分散、字符串化、能力探测不稳定的前端 API 收成一套可以持续扩展的 contract。

## 结论先说

不建议：

- 改成 REST
- 改成 GraphQL
- 新增一整套 `settings.*` 资源 API
- 一次性重命名全部旧方法

建议做的是：

1. 新增一套 **前端共享 RPC contract**
2. 把 `hello-ok.features.methods/events` 真正接成 **capability gating**
3. 明确 `config.patch` 是表单主写路径，`config.set` 只服务 Raw 编辑
4. 补齐前端真实使用的方法 schema / 文档 / 测试覆盖

一句话：

**保留 WebSocket RPC 和配置文件中心，但把前端可依赖的 control-plane contract 做完整。**

## 当前状态

### 已经有的基础

- Gateway 通过 WebSocket RPC 提供控制面方法。
- Control UI 已经在使用：
  - `config.get`
  - `config.schema`
  - `config.set`
  - `config.apply`
  - `config.patch`
- `hello-ok` 已经返回：
  - `features.methods`
  - `features.events`
- UI 已经共享了一部分后端类型，例如：
  - `shared/session-types`
  - `agents/runtime/agent-inspection`
  - `shared/config-ui-hints-types`
- `channels.status` 已经有“schema-light、便于插件扩展”的先例。

### 当前问题

#### 1. method contract 仍然是字符串化

前端请求入口目前还是：

- `request<T>(method: string, params?: unknown)`

结果是：

- controller 到处手写方法名
- 局部 payload 类型分散在 UI 各文件
- 改 method 名、参数结构、返回结构时，前后端很容易漂移

#### 2. capability 机制存在，但没有产品化

Gateway 已经在 `hello-ok` 里下发 `features.methods/events`，但正式 UI 页面并没有普遍用它来决定：

- 是否展示某块功能
- 是否禁用某个入口
- 是否用降级路径

当前典型表现是：

- 先调用
- 再根据 `unknown method` 报错判断能力是否存在

这会让前端在扩展更多可选能力时继续堆 try/catch 探测逻辑。

#### 3. TypeBox 还不是前端控制面 API 的完整 source of truth

目前 TypeBox schema 已覆盖：

- sessions
- config
- cron
- channels
- wizard
- agents/models/skills 的一部分

但前端重度依赖的方法还没有全部进入 schema，例如：

- `workflow.*`
- `agent.inspect`
- `system-presence`
- `last-heartbeat`
- 一部分 debug/control UI 特有 surface

所以当前 TypeBox 更像“部分协议 schema”，还不是“前端控制面 contract 的完整源头”。

#### 4. 方法命名和资源边界不一致

现在同时存在：

- 资源型方法：`workflow.*`、`sessions.*`、`config.*`
- 平铺方法：`health`、`status`、`last-heartbeat`、`system-presence`
- 渠道登录方法：`web.login.*`
- 插件特化方法：`feishu.cli.status`

这会让前端越来越依赖“记住每个功能各自的命名习惯”。

#### 5. 设置主线虽然可用，但还没完全收口

当前前端可以通过 `config.*` 改配置，这个方向是对的，也应该继续坚持。

但现在：

- 表单主线还没有明确全面转向 `config.patch`
- `config.schema` / `uiHints` 还不够表达：
  - 修改后是否需要 restart
  - 修改后是否只需要 reconnect
  - 字段是否依赖某 capability
  - 字段是否 runtime-derived / 只读

也就是说，**配置文件 API 已有，但前端围绕它的编辑体验和元信息还不够完整。**

## 设计目标

### 主目标

1. 前端有一份明确、共享、可推断的 RPC contract。
2. 前端不再依赖 `unknown method` 探测。
3. 配置编辑继续以 `config.*` 为中心，但写路径和元信息更清晰。
4. TypeBox / 文档 / 测试三者对齐。

### 非目标

1. 不改传输协议。
2. 不把配置编辑改造成独立 settings 域模型。
3. 不要求一次性迁完所有旧方法。
4. 不要求插件扩展面全部强 schema 化。

## 设计原则

### 1. Transport 稳定，contract 收口

保留现在的 WebSocket `req/res/event`。

改造重点只放在：

- method contract
- capability declaration
- config-edit semantics

### 2. 配置文件继续是设置主真相

前端设置继续围绕：

- `config.get`
- `config.schema`
- `config.patch`
- `config.set`
- `config.apply`

不额外发明一层 `settings.*` 作为正式主线。

### 3. 允许 dockable surface，但必须能力显式化

像 `channels.status` 这种可扩展 surface 可以继续 schema-light。

但所有可选方法都必须通过：

- `hello-ok.features`
- 或 bootstrap capability metadata

显式暴露，不再允许 UI 靠报错推断。

### 4. 先收口主线，再清 alias

先把前端主调用面稳定下来，再考虑旧方法别名收口。

## API 分层

### A. Stable control-plane surface

这批是前端主线 API，应当进入 shared contract。

- `config.*`
- `sessions.*`
- `workflow.*`
- `agents.*`
- `tools.*`
- `cron.*`
- `nodes.*`
- `devices.*`
- `usage.*`
- `system.*`
- `health` / `status`

### B. Optional first-class surface

这批是正式支持，但不是每个部署都一定有。

- `channels.status`
- `web.login.*`
- `feishu.cli.status`
- `exec.approvals.node.*`
- 某些 node/approval 相关 surface

这些必须有稳定 capability 声明。

### C. Plugin-docked surface

这类允许插件扩展，但前端不得直接假定存在。

要求：

- 通过 capability / manifest metadata 暴露
- 不鼓励 UI 直接硬编码方法名

### D. Debug raw surface

Debug 页可继续保留手工 RPC 调用能力。

但这部分不属于 stable front-end contract。

## 核心设计

## 1. 共享 RPC contract

新增一份共享 contract，建议位置：

- `src/gateway/protocol/control-ui-methods.ts`

每个方法定义为：

```ts
type ControlUiMethodDefinition = {
  method: string;
  paramsSchema?: TSchema;
  resultSchema?: TSchema;
  requiredScopes?: string[];
  capability?: string;
  stability: "stable" | "optional" | "debug";
  effects?: {
    writesConfig?: boolean;
    restart?: "none" | "reconnect" | "reload" | "restart";
  };
};
```

同时导出：

- `ControlUiMethod`
- `ControlUiMethodParamsMap`
- `ControlUiMethodResultMap`

### UI request 目标形态

```ts
request<K extends ControlUiMethod>(
  method: K,
  params: ControlUiMethodParamsMap[K],
): Promise<ControlUiMethodResultMap[K]>
```

这样 controller 不再自己维护一套：

- method 名
- params 结构
- payload 结构

## 2. TypeBox 补齐前端真实使用的方法

现有 TypeBox 不需要废弃，但要补齐 control UI 真正使用的 surface。

第一批补齐：

- `workflow.list`
- `workflow.get`
- `workflow.runs`
- `workflow.status`
- `workflow.run`
- `workflow.cancel`
- `workflow.resume`
- `workflow.deploy`
- `workflow.republish`
- `workflow.update`
- `workflow.rollback`
- `workflow.delete`
- `workflow.versions`
- `workflow.diff`
- `agent.inspect`
- `system-presence`
- `last-heartbeat`
- `health`
- `status`
- `usage.cost`
- `sessions.usage`
- `sessions.usage.timeseries`
- `sessions.usage.logs`

### 特别说明：`channels.status`

这条继续保持当前原则：

- 参数 schema 明确
- 返回 schema 保持 schema-light
- 允许插件渠道以可扩展 snapshot 字段接入

也就是说：

- `channels.status` 不应该被强行改成极其封闭的严格 schema
- 但它的 capability、目标对象和高层字段仍要稳定

## 3. capability 协商

### 继续使用 `hello-ok.features`

现有 `hello-ok.features.methods/events` 不变，但要正式接入 UI 主逻辑。

前端新增统一 helper：

- `hasMethod(method)`
- `hasCapability(capability)`

UI 所有可选功能入口都先看 capability，再决定：

- 显示
- 禁用
- 隐藏
- 降级

### bootstrap 扩展

当前 bootstrap config 只含：

- `basePath`
- `assistantName`
- `assistantAvatar`

建议扩展为：

```ts
type ControlUiBootstrapConfig = {
  basePath: string;
  assistantName: string;
  assistantAvatar: string;
  apiVersion: string;
  contractVersion: string;
  capabilities?: string[];
  uiProfile?: string;
};
```

其中：

- `apiVersion`：控制面 API 代际
- `contractVersion`：前端 contract 文档/类型版本
- `capabilities`：bootstrap 可提前用的能力位

### 为什么 bootstrap 也要带能力信息

因为这能让 UI 在 WebSocket 连上之前就决定：

- 某些入口要不要展示 skeleton
- 某些 onboarding / first-run hint 要不要出现
- 某些 tab 是否默认可见

## 4. 配置写入主路径

继续坚持配置文件 API。

### 主写路径收口

#### 表单模式

默认写路径：

- `config.patch`

适合：

- section 保存
- 局部 path 更新
- 配置卡片编辑
- 小范围增量修改

#### Raw 模式

默认写路径：

- `config.set`

适合：

- 用户直接编辑原始 JSON/JSON5
- 全文替换

#### 最终应用

应用路径：

- `config.apply`

适合：

- 应用并触发 restart/reload
- 配置校验后真正落地

### `config.schema` / `uiHints` 要补的元信息

建议新增或标准化：

- `effect`
  - `none`
  - `reconnect`
  - `reload`
  - `restart`
- `availability`
  - `always`
  - `capability:<id>`
  - `platform:<id>`
- `readonly`
  - `true | false`
- `source`
  - `config`
  - `runtime_derived`
- `restartScope`
  - `gateway`
  - `channel`
  - `provider`
  - `daemon`

这样前端仍然只是“编辑配置文件”，但可以做出更产品化的设置 UI。

## 5. 命名策略

不建议立即做大规模 breaking rename。

建议分两层：

### Preferred names

逐步引入统一资源型命名，例如：

- `system.health`
- `system.status`
- `system.heartbeat.last`
- `channels.login.start`
- `channels.login.wait`

### Legacy aliases

保留旧名：

- `health`
- `status`
- `last-heartbeat`
- `web.login.*`

前端新代码优先走 preferred names；旧名保留一段时间。

## 6. node/gateway 多目标收口

像 exec approvals 这类“双 method + target”模型，前端负担很重。

建议统一成：

```ts
{
  target: {
    kind: "gateway";
  }
}
```

或：

```ts
{
  target: { kind: "node", nodeId: "..." }
}
```

第一批最适合改：

- `exec.approvals.*`

旧方法保留 alias：

- `exec.approvals.get`
- `exec.approvals.node.get`

新 preferred 形态：

- `exec.approvals.read`
- `exec.approvals.write`

参数带 `target`

## 7. 错误模型

当前前端仍在依赖 message 文案兜底识别 scope 缺失，这是不稳定的。

建议补齐 structured detail codes：

- `SCOPE_MISSING`
- `METHOD_UNAVAILABLE`
- `CAPABILITY_MISSING`
- `PATCH_CONFLICT`
- `CONFIG_RELOAD_REQUIRED`
- `CONFIG_RESTART_REQUIRED`
- `REAUTH_REQUIRED`

要求：

- UI 不再靠 `message.includes(...)` 判断
- 所有前端禁用态、提示、后续动作都基于 detail code

## 8. 文档方案

当前文档缺的不是“功能介绍”，而是“前端 contract 文档”。

建议新增：

- `docs/gateway/control-plane-rpc.md`

内容应包含：

1. stable methods
2. optional methods
3. plugin-docked surface
4. bootstrap payload
5. hello capability semantics
6. config patch/apply semantics
7. error detail codes
8. preferred names vs legacy aliases

同时更新：

- `docs/web/control-ui.md`
- `docs/concepts/typebox.md`

把“TypeBox 已是完整单一事实源”的表述改成与现状一致。

## 9. 测试方案

### Contract coverage tests

新增：

- UI contract tests
- gateway contract registration tests
- capability gating tests

覆盖：

1. contract 中的 stable methods 都能在 gateway registry 找到
2. 可选方法 capability 缺失时，UI 不会调用
3. `config.patch` / `config.set` / `config.apply` 语义分离
4. legacy alias 与 preferred name 返回一致 payload

### 文档测试

补一类检查：

- `control-plane-rpc.md` 中列出的 stable method，必须能在 contract 中找到

## 实施顺序

### Step 1

建立 `ControlUiMethodContract`，先覆盖前端当前真实使用的 surface。

### Step 2

UI `request()` 切成 typed request。

### Step 3

表单主写路径明确切到 `config.patch`，Raw 继续 `config.set`。

### Step 4

把 `hello.features` 接成正式 capability gating，先替换：

- `feishu.cli.status`
- `web.login.*`
- node approvals

### Step 5

补齐 structured error detail codes。

### Step 6

补文档：

- `control-plane-rpc.md`
- `web/control-ui.md`
- `concepts/typebox.md`

### Step 7

最后再清 preferred names / alias。

## 风险

### 1. 一次性强 schema 化会压死可扩展 surface

像 `channels.status` 这种不能做成过度严格的封闭 schema。

### 2. 过早大规模改名会拖慢前端迭代

优先收口 contract，不要先打 rename 战争。

### 3. `config.patch` 推进太急会破坏 Raw 模式

必须明确：

- patch 只服务结构化表单
- Raw 继续保留 `set`

## 最终结论

面向前端，这次 API 重构最应该做的不是“换协议”，也不是“再发明 settings API”，而是：

1. **共享 contract**
2. **正式 capability**
3. **配置写路径收口**
4. **文档 + schema + 测试对齐**

这样做可以同时保住：

- 当前 Gateway WS RPC 模型
- 当前配置文件中心模型
- 当前插件/渠道的扩展弹性

又能把前端从：

- 字符串方法名
- unknown-method 探测
- message 文案判断
- 局部影子类型

这几种长期维护风险里拉出来。

## 相关文档

- [控制面 API 实施清单](/concepts/project-control-plane-api-implementation-plan)
- [控制面 API PR 计划](/concepts/project-control-plane-api-pr-plan)
- [控制面 API Inventory](/concepts/project-control-plane-api-inventory)
