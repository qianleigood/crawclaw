---
read_when:
  - 你想通过 Tailscale 访问 Gateway 网关
  - 你想使用仍保留的浏览器 Web 界面与访问方式
summary: Gateway 网关 Web 界面：WebChat、绑定模式和安全
title: Web
x-i18n:
  generated_at: "2026-02-03T10:13:29Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 4da8bc9831018c482ac918a759b9739f75ca130f70993f81911818bc60a685d1
  source_path: web/index.md
  workflow: 15
---

# Web（Gateway 网关）

Gateway 网关保留了一组 Web 访问方式，与 Gateway 网关 WebSocket 共享同一端口：

- 默认：`http://<host>:18789/`
- 可选前缀：设置 `gateway.controlUi.basePath`（例如 `/crawclaw`）

本页重点介绍绑定模式、安全和仍保留的 Web 界面。

## Webhooks

当 `hooks.enabled=true` 时，Gateway 网关还在同一 HTTP 服务器上公开一个小型 webhook 端点。
参见 [Gateway 网关配置](/gateway/configuration) → `hooks` 了解认证 + 载荷。

## 配置

Web 访问仍然沿用 `gateway.controlUi` 这组网关配置键来控制浏览器来源、前缀和兼容策略：

```json5
{
  gateway: {
    controlUi: { enabled: true, basePath: "/crawclaw" }, // basePath 可选
  },
}
```

## Tailscale 访问

### 集成 Serve（推荐）

保持 Gateway 网关在本地回环上，让 Tailscale Serve 代理它：

```json5
{
  gateway: {
    bind: "loopback",
    tailscale: { mode: "serve" },
  },
}
```

然后启动 Gateway 网关：

```bash
crawclaw gateway
```

打开：

- `https://<magicdns>/`（或你配置的 `gateway.controlUi.basePath`）

### Tailnet 绑定 + 令牌

```json5
{
  gateway: {
    bind: "tailnet",
    controlUi: { enabled: true },
    auth: { mode: "token", token: "your-token" },
  },
}
```

然后启动 Gateway 网关（非本地回环绑定需要令牌）：

```bash
crawclaw gateway
```

打开：

- `http://<tailscale-ip>:18789/`（或你配置的 `gateway.controlUi.basePath`）

### 公共互联网（Funnel）

```json5
{
  gateway: {
    bind: "loopback",
    tailscale: { mode: "funnel" },
    auth: { mode: "password" }, // 或 CRAWCLAW_GATEWAY_PASSWORD
  },
}
```

## 安全注意事项

- Gateway 网关认证默认是必需的（令牌/密码或 Tailscale 身份头）。
- 非本地回环绑定仍然**需要**共享令牌/密码（`gateway.auth` 或环境变量）。
- 向导默认生成 Gateway 网关令牌（即使在本地回环上）。
- 浏览器客户端发送 `connect.params.auth.token` 或 `connect.params.auth.password`。
- 使用 Serve 时，当 `gateway.auth.allowTailscale` 为 `true` 时，Tailscale 身份头可以满足认证（无需令牌/密码）。设置 `gateway.auth.allowTailscale: false` 以要求显式凭证。参见 [Tailscale](/gateway/tailscale) 和 [安全](/gateway/security)。
- `gateway.tailscale.mode: "funnel"` 需要 `gateway.auth.mode: "password"`（共享密码）。

## 当前状态

- 浏览器 Control UI 已从项目中移除。
- 保留的 Web 访问方式以 [WebChat](/web/webchat) 和相关浏览器客户端接入为主。
- `gateway.controlUi.*` 这组配置键仍然保留，用于浏览器来源校验、前缀与兼容策略。
