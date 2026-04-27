---
summary: 面向浏览器 Control UI 的控制面 RPC 契约文档
read_when:
  - 你在扩展浏览器 Control UI
  - 你想知道前端可以稳定依赖哪些 Gateway 方法
  - 你想把 config patch/set/apply、capability 规则放在同一个地方理解
title: 控制面 RPC
---

# 控制面 RPC

这页文档描述的是浏览器 Control UI 使用的**前端控制面 RPC 契约**。

它故意比完整 Gateway 协议更窄：

- 完整 WebSocket 帧模型仍在 TypeBox / protocol 文档里。
- 这页只聚焦前端真正依赖的：
  - 稳定 method surface
  - capability gating
  - config 写路径语义

## 契约来源

当前有效的控制面契约来自 4 个地方：

1. shared method contract：
   - `src/gateway/protocol/control-ui-methods.ts`
2. protocol schema：
   - `src/gateway/protocol/schema/*`
   - `src/gateway/protocol/schema/protocol-schemas.ts`
3. Gateway method dispatch：
   - `src/gateway/server-methods.ts`
4. 运行时能力协商：
   - `hello-ok.features.methods`

推荐这样理解它们之间的关系：

- `control-ui-methods.ts` 负责定义前端稳定 method map：
  - method
  - params schema
  - result schema
  - required scopes
  - capability
  - stability
  - side effects
- TypeBox 负责提供这些 method 背后的共享 schema 对象。
- `hello-ok.features.methods` 负责告诉前端：当前连接到的 gateway 实际支持哪些 optional surface。

## 稳定 method surface

当前第一批稳定 surface 包括：

- `config.*`
- `sessions.*`
- `channels.status`
- `exec.approvals.get`
- `exec.approvals.set`
- `agents.list`
- `agent.inspect`
- `tools.catalog`
- `tools.effective`
- `usage.status`
- `usage.cost`
- `sessions.usage*`
- `workflow.*`
- `system.health`
- `system.status`
- `system-presence`
- `system.mainSessionWake.last`

当前 optional capability-gated methods 包括：

- `channels.login.start`
- `channels.login.wait`
- `exec.approvals.node.get`
- `exec.approvals.node.set`

当前仍保留的 legacy alias 如下：

| Preferred name                | Legacy alias             |
| ----------------------------- | ------------------------ |
| `channels.login.start`        | `web.login.start`        |
| `channels.login.wait`         | `web.login.wait`         |
| `system.health`               | `health`                 |
| `system.status`               | `status`                 |
| `system.mainSessionWake.last` | `last-main-session-wake` |

完整列表以这里为准：

- `src/gateway/protocol/control-ui-methods.ts`

## Capability 语义

浏览器 Control UI 不应该再通过“先调用，再看是不是 `unknown method`”来探测 optional feature。

应该直接使用 hello 协商结果：

- `hello-ok.features.methods` 是运行时事实来源
- `client.hasMethod("<method>")` 判断单个 method 是否存在
- `client.hasCapability("<capability>")` 判断一组 optional surface 是否可用

当前已成组的 capability key：

| Capability            | Methods                                              |
| --------------------- | ---------------------------------------------------- |
| `channels.login`      | `channels.login.start`、`channels.login.wait`        |
| `exec.approvals.node` | `exec.approvals.node.get`、`exec.approvals.node.set` |

前端应该遵循：

- stable method 缺失：视为 gateway/version mismatch
- optional capability 缺失：在发请求前就隐藏或禁用相关 UI

## Config 写路径模型

Control UI 继续坚持“配置文件中心”模型，不新增 `settings.*`。

推荐写路径：

| 编辑模式  | Method         | 含义                        |
| --------- | -------------- | --------------------------- |
| Form mode | `config.patch` | 对象字段编辑的首选路径      |
| Raw mode  | `config.set`   | 整份快照写入                |
| Apply     | `config.apply` | 校验并应用/重载运行中的配置 |

当前 UI 真实行为：

- Form mode：优先 `config.patch`
- Raw mode：使用 `config.set`
- Form mode 中遇到数组 diff：当前仍保守回退到 `config.set`

这条设计是有意的：

- 前端仍然围绕“编辑配置文件”
- 但能 patch 的地方优先 patch，不再默认整份 round-trip

## 错误 detail code

第一批结构化 request detail code 现在定义在：

- `src/gateway/protocol/request-error-details.ts`

当前已经由 gateway 主 RPC 路径发射的有：

| Code                 | 含义                             |
| -------------------- | -------------------------------- |
| `SCOPE_MISSING`      | 请求因为缺少 operator scope 失败 |
| `METHOD_UNAVAILABLE` | 当前 gateway 不支持该 method     |

当前 detail payload 还会携带：

- `missingScope`
- `method`

前端应优先读取 detail code，而不是解析 message 文案。

message 匹配现在只应保留为兼容兜底。

已预留但还没在 server 主链里系统化发射的 code 包括：

- `CAPABILITY_MISSING`
- `PATCH_CONFLICT`
- `CONFIG_RELOAD_REQUIRED`
- `CONFIG_RESTART_REQUIRED`

## Bootstrap 与 hello

前端目前需要关注两类 payload：

### Bootstrap

当前 bootstrap payload 仍然故意保持很小：

- `basePath`
- `assistantName`
- `assistantAvatar`

见：

- `src/gateway/control-ui-contract.ts`

### Hello

WebSocket hello 当前负责：

- supported methods
- supported events
- capability gating 输入
- 初始 runtime snapshot

就前端 capability 决策来说，**现在 hello 比 bootstrap 更重要**。

## 什么时候直接看 TypeBox

在这些场景下，应该直接看 TypeBox / `ProtocolSchemas`：

- 需要复用共享协议对象 shape
- 需要 runtime validation / JSON Schema 生成
- 需要共享 schema 引用

在这些场景下，应该先看 `control-ui-methods.ts`：

- 需要 UI-facing method list
- 需要按 method 映射 params/result
- 需要 required scopes
- 需要 capability 分组
- 需要 stability/effects 元信息

实际前端工作里，通常两者都要用。

## 相关文档

- [Control UI](/web/control-ui)
- [TypeBox](/concepts/typebox)
- [Gateway 协议](/gateway/protocol)
