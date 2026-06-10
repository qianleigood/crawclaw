---
read_when:
  - 运行或排除远程 gateway 设置
summary: 使用 SSH 隧道（Gateway WS）和 tailnet 进行远程访问
title: 远程访问
x-i18n:
  generated_at: "2026-06-10T20:35:00Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 509d45890480d7594b2a4f39fc9c7b3bb86e76b2887eef3539dfc7cc959bb6c9
  source_path: gateway/remote.md
  workflow: 15
---

# 远程访问（SSH、隧道和 tailnet）

此仓库支持“通过 SSH 远程访问”，即在专用主机（桌面/服务器）上运行一个 Gateway（主节点），客户端连接到它。

- 对于**操作员**：SSH 隧道是通用的备选方案。
- 对于**远程客户端**：根据需要通过 **Tailscale** 或 SSH 隧道连接到 Gateway **WebSocket**（局域网/tailnet）。

## 核心概念

- Gateway WebSocket 绑定到配置端口上的 **local loopback**（默认为 18789）。
- 对于远程使用，你可以通过 SSH 转发该 local loopback 端口（或使用 tailnet/VPN 并减少隧道使用）。

## 常见的 VPN/tailnet 设置（智能体所在位置）

将 **Gateway 主机**视为“智能体所在位置”。它拥有会话、凭证配置、渠道和状态。
你的笔记本/桌面客户端连接到该主机。

### 1) 在 tailnet 中运行始终在线的 Gateway（VPS 或家用服务器）

在持久性主机上运行 Gateway，并通过 **Tailscale** 或 SSH 访问它。

- 保持 `gateway.bind: "loopback"` 并使用 **Tailscale Serve** 或 SSH 隧道为远程客户端服务。
- **备选方案：** 保持 loopback + 从任何需要访问的机器建立 SSH 隧道。
- **示例：** [exe.dev](/install/exe-dev) 用于简易 VM，或 [DigitalOcean](/install/digitalocean) 用于传统 VPS。

当你的笔记本经常休眠但希望智能体始终在线时，这是理想选择。

### 2) 家用桌面运行 Gateway，笔记本作为远程控制

笔记本**不**运行智能体。它远程连接：

- 使用 SSH 隧道加 Gateway 客户端。
- 保持本地隧道打开，以便健康检查和客户端访问转发的 Gateway。

### 3) 笔记本运行 Gateway，从其他机器远程访问

保持 Gateway 本地但安全地暴露它：

- 从其他机器通过 SSH 隧道连接到笔记本，或
- 使用 Tailscale Serve 并保持 Gateway 仅限 loopback。

指南：[Tailscale](/gateway/tailscale)。

## 命令流（什么在哪里运行）

一个 Gateway 运行时拥有状态、渠道和主机端工具。

流程示例（飞书 -> Gateway 工具）：

- 飞书消息到达 **Gateway**。
- Gateway 运行 **智能体**并在策略允许时调用本地工具。
- Gateway 回复到飞书。

注意：

- 每台主机只应运行一个 gateway，除非你有意运行隔离的配置文件（参见[多个 gateway](/gateway/multiple-gateways)）。

## SSH 隧道（Desktop + 工具）

创建到远程 Gateway WS 的本地隧道：

```bash
ssh -N -L 18789:127.0.0.1:18789 user@host
```

隧道建立后：

- CrawClaw Desktop 和本地自动化客户端可以通过 `ws://127.0.0.1:18789` 访问远程 gateway。
- Gateway API 客户端可以在需要时指向转发的 URL。

注意：将 `18789` 替换为你配置的 `gateway.port` 或 `CRAWCLAW_GATEWAY_PORT`。
远程客户端应提供明确的 token 或密码，而不是依赖隐式本地凭证。

## 远程默认值

你可以持久化远程目标，以便 Desktop 和 Gateway API 操作默认使用它：

```json5
{
  gateway: {
    mode: "remote",
    remote: {
      url: "ws://127.0.0.1:18789",
      token: "your-token",
    },
  },
}
```

当 gateway 仅为 loopback 时，将 URL 保持在 `ws://127.0.0.1:18789`，并先打开 SSH 隧道。

## 凭证优先级

Gateway 凭证解析在调用/探测/状态路径和社区私信 exec-approval 监控中遵循一个共享契约。Node-host 使用相同的底层契约，但有一个 local-mode 例外（它故意忽略 `gateway.remote.*`）：

- 显式凭证（`--token`、`--password` 或工具 `gatewayToken`）在接受显式认证的调用路径上始终优先。
- URL 覆盖安全性：
  - 显式 URL 覆盖不会重用隐式配置凭证。
  - Env URL 覆盖（`CRAWCLAW_GATEWAY_URL`）只能使用 env 凭证（`CRAWCLAW_GATEWAY_TOKEN` / `CRAWCLAW_GATEWAY_PASSWORD`）。
- 本地模式默认值：
  - token：`CRAWCLAW_GATEWAY_TOKEN` -> `gateway.auth.token` -> `gateway.remote.token`（远程备选仅在本地 auth token 输入未设置时适用）
  - password：`CRAWCLAW_GATEWAY_PASSWORD` -> `gateway.auth.password` -> `gateway.remote.password`（远程备选仅在本地 auth password 输入未设置时适用）
- 远程模式默认值：
  - token：`gateway.remote.token` -> `CRAWCLAW_GATEWAY_TOKEN` -> `gateway.auth.token`
  - password：`CRAWCLAW_GATEWAY_PASSWORD` -> `gateway.remote.password` -> `gateway.auth.password`
- Node-host local-mode 例外：`gateway.remote.token` / `gateway.remote.password` 被忽略。
- 远程探测/状态 token 检查默认是严格的：针对远程模式时，它们只使用 `gateway.remote.token`（没有本地 token 备选）。
- Gateway env 覆盖只使用 `CRAWCLAW_GATEWAY_*`。

## 通过 SSH 的 Gateway 客户端

Gateway 客户端直接连接到 Gateway WebSocket。

- 通过 SSH 转发 `18789`（见上文），然后将客户端连接到 `ws://127.0.0.1:18789`。

## 通过 SSH 远程访问

使用相同的隧道进行远程状态检查和 Gateway 客户端。

## 安全规则（远程/VPN）

简版：**保持 Gateway 仅限 loopback**，除非你确定需要绑定。

- **Loopback + SSH/Tailscale Serve** 是最安全的默认设置（无公开暴露）。
- 明文 `ws://` 默认仅限 loopback。对于可信的私有网络，在客户端进程中设置 `CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS=1` 作为紧急方案。
- **非 loopback 绑定**（`lan`/`tailnet`/`custom`，或当 loopback 不可用时的 `auto`）必须使用 auth token/密码。
- `gateway.remote.token` / `.password` 是客户端凭证来源。它们**本身**不配置服务端认证。
- 本地调用路径只能在 `gateway.auth.*` 未设置时使用 `gateway.remote.*` 作为备选。
- 如果 `gateway.auth.token` / `gateway.auth.password` 通过 SecretRef 显式配置但未解析，则解析失败关闭（无远程备选掩盖）。
- `gateway.remote.tlsFingerprint` 在使用 `wss://` 时固定远程 TLS 证书。
- **Tailscale Serve** 可以在 `gateway.auth.allowTailscale: true` 时通过身份标识 header 认证浏览器客户端/WebSocket 流量；HTTP API 端点仍需要 token/密码认证。这种无 token 流程假定 gateway 主机是可信的。如果你想在所有地方都使用 token/密码，请将其设置为 `false`。
- 将浏览器控制视为操作员访问：仅限 tailnet 且需认证。

深入了解：[安全](/gateway/security)。

### macOS：通过 LaunchAgent 持久化 SSH 隧道

对于连接到远程 gateway 的 macOS 客户端，最简单的持久化设置使用 SSH `LocalForward` 配置条目加上 LaunchAgent，以在重启和崩溃后保持隧道活动。

#### 步骤 1：添加 SSH 配置

编辑 `~/.ssh/config`：

```ssh
Host remote-gateway
    HostName <REMOTE_IP>
    User <REMOTE_USER>
    LocalForward 18789 127.0.0.1:18789
    IdentityFile ~/.ssh/id_rsa
```

将 `<REMOTE_IP>` 和 `<REMOTE_USER>` 替换为你的值。

#### 步骤 2：复制 SSH 密钥（一次性）

```bash
ssh-copy-id -i ~/.ssh/id_rsa <REMOTE_USER>@<REMOTE_IP>
```

#### 步骤 3：配置 gateway token

在 Gateway 主机和 macOS 客户端配置同一个 shared token。

在 Gateway 主机上，把服务端 auth 存到 `~/.crawclaw/crawclaw.json` 或服务环境中：

```json5
{
  gateway: {
    auth: {
      mode: "token",
      token: "<gateway-token>",
    },
  },
}
```

在 macOS 客户端上，可以在客户端配置中设置 `gateway.remote.token`，也可以在重新打开 CrawClaw Desktop 前把 token 导出到 GUI launch 环境：

```bash
launchctl setenv CRAWCLAW_GATEWAY_TOKEN "<gateway-token>"
```

不要把 gateway token 写进 SSH LaunchAgent plist。LaunchAgent 只负责 SSH 隧道；CrawClaw 客户端单独提供 Gateway auth。

#### 步骤 4：创建 LaunchAgent

保存为 `~/Library/LaunchAgents/ai.crawclaw.ssh-tunnel.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.crawclaw.ssh-tunnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/ssh</string>
        <string>-N</string>
        <string>remote-gateway</string>
    </array>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

#### 步骤 5：加载 LaunchAgent

```bash
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/ai.crawclaw.ssh-tunnel.plist
```

隧道将在登录时自动启动，崩溃时重启，并保持转发端口活动。

注意：如果你有旧设置遗留的 `com.crawclaw.ssh-tunnel` LaunchAgent，请卸载并删除它。

#### 故障排除

检查隧道是否运行：

```bash
ps aux | grep "ssh -N remote-gateway" | grep -v grep
lsof -i :18789
```

重启隧道：

```bash
launchctl kickstart -k gui/$UID/ai.crawclaw.ssh-tunnel
```

停止隧道：

```bash
launchctl bootout gui/$UID/ai.crawclaw.ssh-tunnel
```

| 配置条目                             | 作用                                  |
| ------------------------------------ | ------------------------------------- |
| `LocalForward 18789 127.0.0.1:18789` | 将本地端口 18789 转发到远程端口 18789 |
| `ssh -N`                             | SSH 不执行远程命令（仅端口转发）      |
| `KeepAlive`                          | 隧道崩溃时自动重启                    |
| `RunAtLoad`                          | LaunchAgent 登录时加载后启动隧道      |
