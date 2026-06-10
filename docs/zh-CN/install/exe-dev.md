---
read_when:
  - 你需要一台便宜的常开 Linux 主机来运行 Gateway
  - 你希望在不使用自己 VPS 的情况下实现远程 gateway 客户端访问
summary: 在 exe.dev（VM + HTTPS 代理）上运行 CrawClaw Gateway 以实现远程访问
title: exe.dev
x-i18n:
  generated_at: "2026-06-05T14:39:12Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 4bf45a913b8565ad11e7fc4f00d8284b53459cf4a0ee026275f0fd3586a03b82
  source_path: install/exe-dev.md
  workflow: 15
---

# exe.dev

目标：在 exe.dev VM 上运行 CrawClaw Gateway，可通过 `https://<vm-name>.exe.xyz` 从你的笔记本访问。

本页面假设使用 exe.dev 默认的 **exeuntu** 镜像。如果你选择了不同的发行版，请相应地映射软件包。

## 初学者快速路径

1. [https://exe.new/crawclaw](https://exe.new/crawclaw)
2. 根据需要填写你的认证密钥/token
3. 点击你的 VM 旁边的 "Agent" 并等待 Shelley 完成配置
4. 使用支持的 gateway 客户端连接到 `https://<vm-name>.exe.xyz/` 并使用你的 gateway token 进行认证
5. 通过 CrawClaw Desktop 或本地 Gateway API 批准所有待处理的设备配对请求

## 你需要什么

- exe.dev 账户
- 通过 [exe.dev](https://exe.dev) 访问虚拟机的 `ssh exe.dev` 权限（可选）

## 使用 Shelley 自动安装

Shelley，[exe.dev](https://exe.dev) 的智能体，可以使用我们的提示词即时安装 CrawClaw。使用的提示词如下：

```
在此 VM 上设置 CrawClaw Desktop 或 Gateway API 部署。根据需要添加提供的认证或 token。配置 nginx 将默认端口 18789 转发到默认启用站点配置的根路径，并确保启用 WebSocket 支持。通过桌面 UI 或 Gateway API 批准设备配对。exe.dev 会帮我们处理从端口 8000 到端口 80/443 的转发和 HTTPS，因此最终可访问的主机应该是 `<vm-name>.exe.xyz`，不带端口。
```

## 手动安装

## 1) 创建 VM

从你的设备：

```bash
ssh exe.dev new
```

然后连接：

```bash
ssh <vm-name>.exe.xyz
```

提示：保持此 VM **有状态**。CrawClaw 在 `~/.crawclaw/` 和 `~/.crawclaw/workspace/` 下存储状态。

## 2) 安装前置依赖（在 VM 上）

```bash
sudo apt-get update
sudo apt-get install -y git curl jq ca-certificates openssl
```

## 3) 安装 CrawClaw

使用适合你部署方式的支持安装流程为当前主机安装 CrawClaw 运行时，然后在本地回环端口 `18789` 上启动 Gateway。

## 4) 配置 nginx 将 CrawClaw 代理到端口 8000

使用以下配置编辑 `/etc/nginx/sites-enabled/default`：

```
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    listen 8000;
    listen [::]:8000;

    server_name _;

    location / {
        proxy_pass http://127.0.0.1:18789;
        proxy_http_version 1.1;

        # WebSocket 支持
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 标准代理头
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 长连接超时设置
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

## 5) 访问 CrawClaw 并授予权限

从支持的 gateway 客户端访问 `https://<vm-name>.exe.xyz/`。如果提示输入认证信息，请使用 VM 上 `gateway.auth.token` 中存储的 token。通过 CrawClaw Desktop 或本地 Gateway API 检索或轮换该 token。通过 CrawClaw Desktop 或本地 Gateway API 批准设备。如有疑问，请从浏览器使用 Shelley。

## 远程访问

远程访问由 [exe.dev](https://exe.dev) 的认证处理。默认情况下，来自端口 8000 的 HTTP 流量会通过邮箱认证转发到 `https://<vm-name>.exe.xyz`。

## 更新

packaged desktop installs 从 [GitHub Releases](https://github.com/qianleigood/crawclaw/releases)
更新。对于 source-checkout VM，调用 Gateway `update.run` control-plane RPC，或手动更新
checkout，然后重启拥有 Gateway 的 service。

指南：[更新](/install/updating)
