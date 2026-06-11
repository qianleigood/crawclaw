---
read_when:
  - 在 macOS 或 node 客户端上调试 Bonjour 发现问题
  - 更改 mDNS 服务类型、TXT 记录或发现用户体验
summary: Bonjour/mDNS 发现 + 调试（Gateway 信标、客户端和常见故障模式）
title: Bonjour 发现
x-i18n:
  generated_at: "2026-06-05T14:15:57Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: fecbe59f7fe704bde732689be4be87dc6cfd1a41dce80509a03b76cc3799b28b
  source_path: gateway/bonjour.md
  workflow: 15
---

# Bonjour / mDNS 发现

CrawClaw 使用 Bonjour（mDNS / DNS‑SD）作为**仅 LAN 便利功能**来发现活动的 Gateway（WebSocket 端点）。这是尽力而为的服务，**不会**取代 SSH 或 Tailnet 连接。

## 通过 Tailscale 的广域网 Bonjour（单播 DNS-SD）

如果节点和网关在不同的网络中，多播 mDNS 不会跨边界。你可以通过在 Tailscale 上切换到**单播 DNS‑SD**（"广域网 Bonjour"）来保持相同的发现用户体验。

高级步骤：

1. 在网关主机上运行 DNS 服务器（可通过 Tailnet 访问）。
2. 在专用区域下发布 `_crawclaw-gw._tcp` 的 DNS‑SD 记录（例如：`crawclaw.internal.`）。
3. 配置 Tailscale **split DNS**，使你选择的域通过该 DNS 服务器为客户端解析。

CrawClaw 支持任何发现域；`crawclaw.internal.` 只是一个示例。当前节点客户端浏览 `local.` 和你配置的广域网域。

### Gateway 配置（推荐）

```json5
{
  gateway: { bind: "tailnet" }, // 仅 tailnet（推荐）
  discovery: { wideArea: { enabled: true } }, // 启用广域网 DNS-SD 发布
}
```

### 一次性 DNS 服务器设置（网关主机）

通过 Desktop config 或 `config.patch` 设置 `discovery.wideArea.enabled=true`；如果不使用默认 domain，也设置 `discovery.wideArea.domain`。Gateway 会把 DNS-SD zone 写到 `~/.crawclaw/dns/`；在 gateway host 上运行 CoreDNS 或其他 DNS server，并将其指向该 zone。

将 DNS server 配置为：

- 仅在网关的 Tailscale 接口上监听端口 53
- 从 `~/.crawclaw/dns/<domain>.db` 提供你选择的域（例如：`crawclaw.internal.`）

从 tailnet 连接的主机验证：

```bash
dns-sd -B _crawclaw-gw._tcp crawclaw.internal.
dig @<TAILNET_IPV4> -p 53 _crawclaw-gw._tcp.crawclaw.internal PTR +short
```

### Tailscale DNS 设置

在 Tailscale 管理控制台中：

- 添加指向网关 tailnet IP 的 nameserver（UDP/TCP 53）。
- 添加 split DNS，使你的发现域使用该 nameserver。

一旦客户端接受 tailnet DNS，节点客户端就可以在你的发现域中浏览 `_crawclaw-gw._tcp`，而无需多播。

### Gateway 监听器安全（推荐）

Gateway WS 端口（默认 `18789`）默认绑定到 loopback。对于 LAN/tailnet 访问，请显式绑定并保持认证启用。

对于仅 tailnet 设置：

- 在 `~/.crawclaw/crawclaw.json` 中设置 `gateway.bind: "tailnet"`。
- 重启 Gateway。

## 发布内容

只有 Gateway 发布 `_crawclaw-gw._tcp`。

## 服务类型

- `_crawclaw-gw._tcp` — 网关传输信标（供 macOS 和 node 客户端使用）。

## TXT 键名（非机密提示）

Gateway 发布小的非机密提示以方便 UI 流程：

- `role=gateway`
- `displayName=<友好名称>`
- `lanHost=<hostname>.local`
- `gatewayPort=<端口>`（Gateway WS + HTTP）
- `gatewayTls=1`（仅在启用 TLS 时）
- `gatewayTlsSha256=<sha256>`（仅在启用 TLS 且指纹可用时）
- `sshPort=<端口>`（未覆盖时默认为 22）
- `transport=gateway`
- `tailnetDns=<magicdns>`（Tailnet 可用时的可选提示）

安全说明：

- Bonjour/mDNS TXT 记录是**未认证的**。客户端不得将 TXT 视为权威路由。
- 客户端应使用解析后的服务端点（SRV + A/AAAA）进行路由。将 `lanHost`、`tailnetDns`、`gatewayPort` 和 `gatewayTlsSha256` 仅视为提示。
- TLS pinning 不得允许广告的 `gatewayTlsSha256` 覆盖先前存储的 pin。
- Gateway 客户端应将基于发现直连视为**仅 TLS** 方式，并在信任首次指纹之前需要显式用户确认。

## 在 macOS 上调试

有用的内置工具：

- 浏览实例：

  ```bash
  dns-sd -B _crawclaw-gw._tcp local.
  ```

- 解析一个实例（替换 `<instance>`）：

  ```bash
  dns-sd -L "<instance>" _crawclaw-gw._tcp local.
  ```

如果浏览有效但解析失败，你通常会遇到 LAN 策略或 mDNS 解析器问题。

## 在 Gateway 日志中调试

Gateway 写入滚动日志文件（在启动时打印为 `gateway log file: ...`）。查找 `bonjour:` 行，特别是：

- `bonjour: advertise failed ...`
- `bonjour: ... name conflict resolved` / `hostname conflict resolved`
- `bonjour: watchdog detected non-announced service ...`

## 在 node 客户端上调试

当前 Apple 平台节点客户端使用 `NWBrowser` 发现 `_crawclaw-gw._tcp`。

捕获日志：

- 设置 → Gateway → 高级 → **发现调试日志**
- 设置 → Gateway → 高级 → **发现日志** → 复现 → **复制**

日志包含浏览器状态转换和结果集更改。

## 常见故障模式

- **Bonjour 不跨网络**：使用 Tailnet 或 SSH。
- **多播被阻止**：某些 Wi‑Fi 网络禁用 mDNS。
- **睡眠/接口抖动**：macOS 可能暂时丢弃 mDNS 结果；重试。
- **浏览有效但解析失败**：保持机器名称简单（避免表情符号或标点符号），然后重启 Gateway。服务实例名称源自主机名，因此过于复杂的名称可能会混淆某些解析器。

## 转义的实例名称（`\032`）

Bonjour/DNS‑SD 经常将服务实例名称中的字节转义为十进制 `\DDD` 序列（例如空格变为 `\032`）。

- 这在协议层面是正常的。
- UI 应该解码以供显示（iOS 使用 `BonjourEscapes.decode`）。

## 禁用/配置

- `CRAWCLAW_DISABLE_BONJOUR=1` 禁用发布（遗留：`CRAWCLAW_DISABLE_BONJOUR`）。
- `~/.crawclaw/crawclaw.json` 中的 `gateway.bind` 控制 Gateway 绑定模式。
- `CRAWCLAW_SSH_PORT` 覆盖 TXT 中广告的 SSH 端口（遗留：`CRAWCLAW_SSH_PORT`）。
- `CRAWCLAW_TAILNET_DNS` 在 TXT 中发布 MagicDNS 提示（遗留：`CRAWCLAW_TAILNET_DNS`）。

## 相关文档

- 发现策略和传输选择：[设备发现](/gateway/discovery)
- 配对 + 审批：[配对](/channels/pairing)
