---
summary: "在 DigitalOcean Droplet 上托管 CrawClaw"
read_when:
  - 你正在 DigitalOcean 上设置 CrawClaw
  - 你想为 CrawClaw 找一个简单的付费 VPS
title: "DigitalOcean"
x-i18n:
  generated_at: "2026-06-10T11:57:53Z"
  model: codex
  provider: openai
  source_hash: 82426d08b01bef2faf01a5c8e3c29b5689e1b2b9c1cb086e01db29d504d2a652
  source_path: install/digitalocean.md
  workflow: 15
---

# DigitalOcean

在 DigitalOcean Droplet 上运行一个持久 CrawClaw Gateway。

## 前置条件

- DigitalOcean 账号（[注册](https://cloud.digitalocean.com/registrations/new)）
- SSH key pair，或愿意使用 password auth
- 大约 20 分钟

## 设置

<Steps>
  <Step title="创建 Droplet">
    <Warning>
    使用干净的基础镜像（Ubuntu 24.04 LTS）。除非你已经审核过启动脚本和防火墙默认值，否则避免使用第三方 Marketplace 一键镜像。
    </Warning>

    1. 登录 [DigitalOcean](https://cloud.digitalocean.com/)。
    2. 点击 **Create > Droplets**。
    3. 选择：
       - **Region:** 离你最近的区域
       - **Image:** Ubuntu 24.04 LTS
       - **Size:** Basic、Regular、1 vCPU / 1 GB RAM / 25 GB SSD
       - **Authentication:** SSH key（推荐）或 password
    4. 点击 **Create Droplet**，并记下 IP address。

  </Step>

  <Step title="连接并安装">
    ```bash
    ssh root@YOUR_DROPLET_IP

    apt update && apt upgrade -y

    # Install Node.js 24
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    apt install -y nodejs

    # Install the supported CrawClaw Gateway/Desktop release for this host, or build from source.
    ```

    然后使用 CrawClaw Desktop 或本地 Gateway API 验证 Gateway 状态。

  </Step>

  <Step title="运行 onboarding">
    使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

    wizard 会引导你完成 model auth、channel setup、gateway token generation 和 daemon installation（systemd）。

  </Step>

  <Step title="添加 swap，1 GB Droplet 推荐">
    ```bash
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    ```
  </Step>

  <Step title="验证 Gateway">
    ```bash
    systemctl --user status crawclaw-gateway.service
    journalctl --user -u crawclaw-gateway.service -f
    ```
  </Step>

  <Step title="访问 Gateway">
    Gateway 默认绑定到 loopback。选择下面一种方式。

    **选项 A: SSH tunnel，最简单**

    ```bash
    # From your local machine
    ssh -L 18789:localhost:18789 root@YOUR_DROPLET_IP
    ```

    然后将受支持的 gateway client 连接到 `http://localhost:18789`。

    **选项 B: Tailscale Serve**

    ```bash
    curl -fsSL https://tailscale.com/install.sh | sh
    tailscale up
    ```

    通过 CrawClaw Desktop 或本地 Gateway API 配置 `gateway.bind: "loopback"` 和 `gateway.tailscale.mode: "serve"`。

    然后从 tailnet 中任意设备把受支持的 gateway client 连接到 `https://<magicdns>/`。

    **选项 C: Tailnet bind，无 Serve**

    使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

    然后把受支持的 gateway client 连接到 `http://<tailscale-ip>:18789`（需要 token）。

  </Step>
</Steps>

## 故障排除

**Gateway 无法启动** -- 运行 CrawClaw Desktop 或本地 Gateway API，并用 `journalctl --user -u crawclaw-gateway.service -n 50` 检查日志。

**端口已被占用** -- 运行 `lsof -i :18789` 找到进程，然后停止它。

**内存不足** -- 用 `free -h` 确认 swap 已启用。如果仍然 OOM，使用 API-based models（Claude、GPT）而不是本地模型，或升级到 2 GB Droplet。

## 后续步骤

- [Channels](/channels) -- 连接 Feishu、Weixin、community chat 等
- [Gateway configuration](/gateway/configuration) -- 所有 config options
- [Updating](/install/updating) -- 保持 CrawClaw 更新
