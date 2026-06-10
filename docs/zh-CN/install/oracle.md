---
summary: "在 Oracle Cloud Always Free ARM tier 上托管 CrawClaw"
read_when:
  - 你正在 Oracle Cloud 上设置 CrawClaw
  - 你想为 CrawClaw 找免费的 VPS 托管
  - 你想在小型服务器上 24/7 运行 CrawClaw
title: "Oracle Cloud"
x-i18n:
  generated_at: "2026-06-10T11:57:53Z"
  model: codex
  provider: openai
  source_hash: 8a7d9b721e1a617995d47dd33d11a964a9b885ef019e0aedfa7c0adb5940ac5a
  source_path: install/oracle.md
  workflow: 15
---

# Oracle Cloud

在 Oracle Cloud 的 **Always Free** ARM tier 上运行持久 CrawClaw Gateway（最多 4 OCPU、24 GB RAM、200 GB storage），无需费用。

## 前置条件

- Oracle Cloud 账号（[注册](https://www.oracle.com/cloud/free/)）-- 如果遇到问题，参见 [community signup guide](https://gist.github.com/rssnyder/51e3cfedd730e7dd5f4a816143b25dbd)
- Tailscale 账号（[tailscale.com](https://tailscale.com) 免费）
- SSH key pair
- 大约 30 分钟

## 设置

<Steps>
  <Step title="创建 OCI instance">
    1. 登录 [Oracle Cloud Console](https://cloud.oracle.com/)。
    2. 导航到 **Compute > Instances > Create Instance**。
    3. 配置：
       - **Name:** `crawclaw`
       - **Image:** Ubuntu 24.04 (aarch64)
       - **Shape:** `VM.Standard.A1.Flex` (Ampere ARM)
       - **OCPUs:** 2（或最多 4）
       - **Memory:** 12 GB（或最多 24 GB）
       - **Boot volume:** 50 GB（最多 200 GB 免费）
       - **SSH key:** 添加你的 public key
    4. 点击 **Create**，并记下 public IP address。

    <Tip>
    如果 instance 创建失败并显示 "Out of capacity"，尝试不同的 availability domain，或稍后重试。Free tier capacity 有限。
    </Tip>

  </Step>

  <Step title="连接并更新系统">
    ```bash
    ssh ubuntu@YOUR_PUBLIC_IP

    sudo apt update && sudo apt upgrade -y
    sudo apt install -y build-essential
    ```

    `build-essential` 是某些依赖在 ARM 上编译所必需的。

  </Step>

  <Step title="配置用户和 hostname">
    ```bash
    sudo hostnamectl set-hostname crawclaw
    sudo passwd ubuntu
    sudo loginctl enable-linger ubuntu
    ```

    启用 linger 可以让 user services 在 logout 后继续运行。

  </Step>

  <Step title="安装 Tailscale">
    ```bash
    curl -fsSL https://tailscale.com/install.sh | sh
    sudo tailscale up --ssh --hostname=crawclaw
    ```

    从现在开始，通过 Tailscale 连接：`ssh ubuntu@crawclaw`。

  </Step>

  <Step title="安装 CrawClaw">
    安装此 host 支持的 CrawClaw Gateway/Desktop release，或从源码构建。如果安装过程修改了 PATH，请重新加载 shell。

    当提示 "How do you want to hatch your bot?" 时，选择 **Do this later**。

  </Step>

  <Step title="配置 Gateway">
    使用 token auth 和 Tailscale Serve 做安全远程访问。

    通过 CrawClaw Desktop 或本地 Gateway API 配置 `gateway.bind: "loopback"`、`gateway.auth.mode: "token"` 和 `gateway.tailscale.mode: "serve"`，然后重启：

    ```bash
    systemctl --user restart crawclaw-gateway
    ```

  </Step>

  <Step title="锁定 VCN security">
    在 network edge 阻止除 Tailscale 之外的所有流量：

    1. 在 OCI Console 中进入 **Networking > Virtual Cloud Networks**。
    2. 点击你的 VCN，然后进入 **Security Lists > Default Security List**。
    3. **Remove** 除 `0.0.0.0/0 UDP 41641`（Tailscale）之外的所有 ingress rules。
    4. 保留默认 egress rules（允许所有 outbound）。

    这会在 network edge 阻止 SSH 22、HTTP、HTTPS 和其他所有入口流量。从此之后只能通过 Tailscale 连接。

  </Step>

  <Step title="验证">
    ```bash
    systemctl --user status crawclaw-gateway
    tailscale serve status
    curl http://localhost:18789
    ```

    从 tailnet 中任意设备访问 Gateway：

    ```text
    https://crawclaw.<tailnet-name>.ts.net/
    ```

    将 `<tailnet-name>` 替换为你的 tailnet name（可在 `tailscale status` 中查看）。

  </Step>
</Steps>

## Fallback: SSH tunnel

如果 Tailscale Serve 无法工作，从本机创建 SSH tunnel：

```bash
ssh -L 18789:127.0.0.1:18789 ubuntu@crawclaw
```

然后把受支持的 gateway client 连接到 `http://localhost:18789`。

## 故障排除

**Instance creation fails ("Out of capacity")** -- Free tier ARM instances 很热门。尝试不同的 availability domain，或在非高峰时间重试。

**Tailscale 无法连接** -- 运行 `sudo tailscale up --ssh --hostname=crawclaw --reset` 重新认证。

**Gateway 无法启动** -- 运行 CrawClaw Desktop 或本地 Gateway API，并用 `journalctl --user -u crawclaw-gateway -n 50` 检查日志。

**ARM binary 问题** -- 大多数 npm packages 可以在 ARM64 上运行。对于 native binaries，查找 `linux-arm64` 或 `aarch64` releases。用 `uname -m` 验证 architecture。

## 后续步骤

- [Channels](/channels) -- 连接 Feishu、Weixin、community chat 等
- [Gateway configuration](/gateway/configuration) -- 所有 config options
- [Updating](/install/updating) -- 保持 CrawClaw 更新
