---
read_when:
  - 在不运行完整智能体轮次的情况下调用工具
  - 构建需要工具策略执行的自动化
summary: 通过 Gateway HTTP 端点直接调用单个工具
title: 工具调用 API
x-i18n:
  generated_at: "2026-06-05T14:30:12Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: cc66b6430ce88c0730fea9defb81c8551e6c7847ddf5128b876b26f271c725c1
  source_path: gateway/tools-invoke-http-api.md
  workflow: 15
---

# 工具调用（HTTP）

CrawClaw 的 Gateway 暴露了一个简单的 HTTP 端点，用于直接调用单个工具。它始终启用，并使用 Gateway 认证和工具策略。与 OpenAI 兼容的 `/v1/*` 界面一样，共享密钥持有者认证被视为对整个 gateway 的可信操作员访问。

- `POST /tools/invoke`
- 与 Gateway 相同的端口（WS + HTTP 多路复用）：`http://<gateway-host>:<port>/tools/invoke`

默认最大 payload 大小为 2 MB。

## 认证

使用 Gateway 认证配置。发送持有者 token：

- `Authorization: Bearer <token>`

注意：

- 当 `gateway.auth.mode="token"` 时，使用 `gateway.auth.token`（或 `CRAWCLAW_GATEWAY_TOKEN`）。
- 当 `gateway.auth.mode="password"` 时，使用 `gateway.auth.password`（或 `CRAWCLAW_GATEWAY_PASSWORD`）。
- 如果配置了 `gateway.auth.rateLimit` 且发生太多认证失败，端点返回带有 `Retry-After` 的 `429`。

## 运行时边界（重要）

将此端点视为 gateway 实例的**完整操作员访问**界面。

- 此处的 HTTP 持有者认证不是窄化的每用户范围模型。
- 此端点的有效 Gateway token/密码应被视为所有者/操作员凭证。
- 对于共享密钥认证模式（`token` 和 `password`），即使调用者发送了更窄的 `x-crawclaw-scopes` header，端点也会恢复正常的完整操作员默认值。
- 共享密钥认证还将此端点上的直接工具调用视为所有者发送者轮次。
- 可信身份承载 HTTP 模式（例如可信代理认证或私有入口上的 `gateway.auth.mode="none"`）仍会遵守请求上声明的操作员范围。
- 只将此端点保持在 local loopback/tailnet/私有入口上；不要直接暴露到公共互联网。

认证矩阵：

- `gateway.auth.mode="token"` 或 `"password"` + `Authorization: Bearer ...`
  - 证明持有共享 gateway 操作员密钥
  - 忽略更窄的 `x-crawclaw-scopes`
  - 恢复完整的默认操作员范围集
  - 将此端点上的直接工具调用视为所有者发送者轮次
- 可信身份承载 HTTP 模式（例如可信代理认证，或私有入口上的 `gateway.auth.mode="none"`）
  - 认证某些外部可信身份或部署边界
  - 遵守声明的 `x-crawclaw-scopes` header
  - 只有当这些声明范围中实际存在 `operator.admin` 时才获得所有者语义

## 请求体

```json
{
  "tool": "sessions_list",
  "action": "json",
  "args": {},
  "sessionKey": "main",
  "dryRun": false
}
```

字段：

- `tool`（字符串，必需）：要调用的工具名称。
- `action`（字符串，可选）：如果工具 schema 支持 `action` 且省略了 args payload，则映射到 args。
- `args`（对象，可选）：工具特定的参数。
- `sessionKey`（字符串，可选）：目标会话密钥。如果省略或为 `"main"`，Gateway 使用配置的主会话密钥（遵守 `session.mainKey` 和默认智能体，或全局范围中的 `global`）。
- `dryRun`（布尔值，可选）：预留供将来使用；当前被忽略。

## 策略 + 路由行为

工具可用性通过 Gateway 智能体使用的相同策略链进行过滤：

- `tools.profile` / `tools.byProvider.profile`
- `tools.allow` / `tools.byProvider.allow`
- `agents.<id>.tools.allow` / `agents.<id>.tools.byProvider.allow`
- 组策略（如果会话密钥映射到组或渠道）
- 子智能体策略（使用子智能体会话密钥调用时）

如果工具被策略不允许，端点返回 **404**。

重要边界注意：

- 执行批准是操作员护栏，不是此 HTTP 端点的单独授权边界。如果工具通过 Gateway 认证 + 工具策略可达，`/tools/invoke` 不会添加额外的每次调用批准提示。
- 不要与不受信任的调用者共享 Gateway 持有者凭证。如果需要在信任边界之间进行隔离，请运行独立的 gateway（理想情况下使用独立的 OS 用户/主机）。

Gateway HTTP 默认还应用硬拒绝列表（即使会话策略允许该工具）：

- `bash` — 直接命令执行（RCE 暴露面）
- `spawn` — 任意子进程创建（RCE 暴露面）
- `shell` — shell 命令执行（RCE 暴露面）
- `fs_write` — 主机上的任意文件变更
- `fs_delete` — 主机上的任意文件删除
- `fs_move` — 主机上的任意文件移动/重命名
- `apply_patch` — 补丁应用可以重写任意文件
- `sessions_spawn` — 会话编排；远程生成智能体是 RCE
- `sessions_send` — 跨会话消息注入
- `cron` — 持久自动化控制平面
- `gateway` — gateway 控制平面；防止通过 HTTP 重新配置

你可以通过 `gateway.tools` 自定义此拒绝列表：

```json5
{
  gateway: {
    tools: {
      // 通过 HTTP /tools/invoke 阻止的额外工具
      deny: ["browser"],
      // 从默认拒绝列表中移除工具
      allow: ["gateway"],
    },
  },
}
```

为了帮助组策略解析上下文，你可以选择设置：

- `x-crawclaw-message-channel: <channel>`（示例：`ddingtalk`、`feishu`）
- `x-crawclaw-account-id: <accountId>`（当存在多个账户时）

## 响应

- `200` → `{ ok: true, result }`
- `400` → `{ ok: false, error: { type, message } }`（无效请求或工具输入错误）
- `401` → 未授权
- `429` → 认证速率受限（设置了 `Retry-After`）
- `404` → 工具不可用（未找到或未在允许列表中）
- `405` → 方法不允许
- `500` → `{ ok: false, error: { type, message } }`（意外的 tool 执行错误；清理后的消息）

## 示例

```bash
curl -sS http://127.0.0.1:18789/tools/invoke \
  -H 'Authorization: Bearer secret' \
  -H 'Content-Type: application/json' \
  -d '{
    "tool": "sessions_list",
    "action": "json",
    "args": {}
  }'
```
