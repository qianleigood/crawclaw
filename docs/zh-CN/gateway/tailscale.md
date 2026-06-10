---
read_when:
  - 在localhost外部公开面向浏览器的Gateway访问
  - 自动化 tailnet 或公共浏览器客户端访问
summary: 用于面向浏览器的Gateway访问的集成Tailscale Serve/Funnel
title: Tailscale
x-i18n:
  generated_at: "2026-06-10T20:49:27Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 0c1a16e85208826febc26095729f727df382d66ef7318865811d3b7170feab77
  source_path: gateway/tailscale.md
  workflow: 15
---

# Tailscale（Gateway 浏览器访问）

CrawClaw 可以自动配置 Tailscale **Serve**（tailnet）或 **Funnel**（公共），用于面向浏览器的 Gateway 访问和 WebSocket 端口。这使 Gateway 保持绑定到 local loopback，而 Tailscale 提供 HTTPS、路由和（对于 Serve）身份 header。

## 模式

- `serve`：通过 `tailscale serve` 仅限 tailnet 的 Serve。Gateway 保持在 `127.0.0.1`。
- `funnel`：通过 `tailscale funnel` 的公共 HTTPS。CrawClaw 需要共享密码。
- `off`：默认（无 Tailscale 自动化）。

## 认证

设置 `gateway.auth.mode` 来控制握手：

- `token`（当设置了 `CRAWCLAW_GATEWAY_TOKEN` 时的默认值）
- `password`（通过 `CRAWCLAW_GATEWAY_PASSWORD` 或配置文件的共享密钥）

当 `tailscale.mode = "serve"` 且 `gateway.auth.allowTailscale` 为 `true` 时，浏览器客户端/WebSocket 认证可以使用 Tailscale 身份 header（`tailscale-user-login`）而无需提供 token/密码。CrawClaw 通过本地 Tailscale 守护进程（`tailscale whois`）解析 `x-forwarded-for` 地址并将其与 header 匹配来验证身份，然后才接受它。CrawClaw 仅在请求通过带有 Tailscale 的 `x-forwarded-for`、`x-forwarded-proto` 和 `x-forwarded-host` header 的 local loopback 到达时，才将其视为 Serve。
HTTP API 端点（例如 `/v1/*`、`/tools/invoke` 和 `/api/channels/*`）仍需要 token/密码认证。这种无 token 流程假定 gateway 主机是可信的。如果同一主机上可能运行不受信任的本地代码，请禁用 `gateway.auth.allowTailscale` 并改用 token/密码认证。
要强制使用显式凭证，请设置 `gateway.auth.allowTailscale: false` 或强制使用 `gateway.auth.mode: "password"`。

## 配置示例

### 仅限 Tailnet（Serve）

```json5
{
  gateway: {
    bind: "loopback",
    tailscale: { mode: "serve" },
  },
}
```

打开：`https://<magicdns>/`

### 仅限 Tailnet（绑定到 Tailnet IP）

当你想让 Gateway 直接监听 Tailnet IP 时使用此模式（无 Serve/Funnel）。

```json5
{
  gateway: {
    bind: "tailnet",
    auth: { mode: "token", token: "your-token" },
  },
}
```

从另一个 Tailnet 设备连接：

- 浏览器客户端：`http://<tailscale-ip>:18789/`
- WebSocket：`ws://<tailscale-ip>:18789`

注意：local loopback（`http://127.0.0.1:18789`）在此模式下**不会**工作。

### 公共互联网（Funnel + 共享密码）

```json5
{
  gateway: {
    bind: "loopback",
    tailscale: { mode: "funnel" },
    auth: { mode: "password", password: "replace-me" },
  },
}
```

优先使用 `CRAWCLAW_GATEWAY_PASSWORD`，而不是将密码提交到磁盘。

## Gateway API 示例

Tailscale Serve 可以通过身份 header 满足浏览器客户端/WebSocket 认证，但 HTTP API
仍然需要 Gateway bearer auth。使用 Tailscale HTTPS URL 和配置的 token 或密码：

```bash
curl -sS https://<magicdns>/v1/models \
  -H 'Authorization: Bearer <gateway-token-or-password>'
```

对于 Funnel，使用公开 Funnel URL 和 `gateway.auth.password` 或
`CRAWCLAW_GATEWAY_PASSWORD` 中配置的共享密码：

```bash
curl -sS https://<funnel-host>/tools/invoke \
  -H 'Authorization: Bearer <gateway-password>' \
  -H 'Content-Type: application/json' \
  -d '{
    "tool": "sessions_list",
    "action": "json",
    "args": {}
  }'
```

尽量把 `/tools/invoke` 和 `/v1/*` 放在 tailnet 或 private ingress 后。这些
endpoint 的 bearer credentials 代表 Gateway 实例的完整 operator access。

## 注意事项

- Tailscale Serve/Funnel 需要安装 `tailscale` CLI 并登录。
- `tailscale.mode: "funnel"` 除非认证模式为 `password`，否则拒绝启动以避免公开暴露。
- 如果你希望 CrawClaw 在关闭时撤销 `tailscale serve` 或 `tailscale funnel` 配置，请设置 `gateway.tailscale.resetOnExit`。
- `gateway.bind: "tailnet"` 是直接 Tailnet 绑定（无 HTTPS，无 Serve/Funnel）。
- `gateway.bind: "auto"` 优先使用 local loopback；如果你想仅限 Tailnet，请使用 `tailnet`。
- Serve/Funnel 暴露的是 **Gateway 浏览器客户端 + WS**。

## 浏览器控制（远程 Gateway + 本地浏览器）

如果你在一台机器上运行 Gateway，但想在另一台机器上驱动浏览器，请使用远程 CDP 端点并将其保持在同一 tailnet 上。

对于浏览器控制，请避免使用 Funnel；将远程 CDP 视为操作员访问。

## Tailscale 先决条件 + 限制

- Serve 需要为你的 tailnet 启用 HTTPS；如果缺少，CLI 会提示。
- Serve 注入 Tailscale 身份 header；Funnel 不会。
- Funnel 需要 Tailscale v1.38.3+、MagicDNS、启用 HTTPS 和 funnel 节点属性。
- Funnel 仅支持通过 TLS 的端口 `443`、`8443` 和 `10000`。
- 在 macOS 上使用 Funnel 需要开源 Tailscale 应用变体。

## 了解更多

- Tailscale Serve 概览：[https://tailscale.com/kb/1312/serve](https://tailscale.com/kb/1312/serve)
- `tailscale serve` 命令：[https://tailscale.com/kb/1242/tailscale-serve](https://tailscale.com/kb/1242/tailscale-serve)
- Tailscale Funnel 概览：[https://tailscale.com/kb/1223/tailscale-funnel](https://tailscale.com/kb/1223/tailscale-funnel)
- `tailscale funnel` 命令：[https://tailscale.com/kb/1311/tailscale-funnel](https://tailscale.com/kb/1311/tailscale-funnel)
