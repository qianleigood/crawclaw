---
summary: "在 Raspberry Pi 上托管 CrawClaw，实现 always-on self-hosting"
read_when:
  - 你正在 Raspberry Pi 上设置 CrawClaw
  - 你在 ARM 设备上运行 CrawClaw
  - 你想构建便宜的 always-on personal AI
title: "Raspberry Pi"
x-i18n:
  generated_at: "2026-06-10T11:57:53Z"
  model: codex
  provider: openai
  source_hash: 96a271139b6eef7499560367422970a5eaf6140e13a8aec8367cccbf62e92dda
  source_path: install/raspberry-pi.md
  workflow: 15
---

# Raspberry Pi

在 Raspberry Pi 上运行持久、always-on 的 CrawClaw Gateway。由于 Pi 只承担 Gateway 角色（模型通过 API 在云端运行），即使配置普通的 Pi 也能很好处理工作负载。

## 前置条件

- Raspberry Pi 4 或 5，2 GB+ RAM（推荐 4 GB）
- MicroSD card（16 GB+）或 USB SSD（性能更好）
- 官方 Pi power supply
- 网络连接（Ethernet 或 WiFi）
- 64-bit Raspberry Pi OS（必需，不要使用 32-bit）
- 大约 30 分钟

## 设置

<Steps>
  <Step title="刷入 OS">
    使用 **Raspberry Pi OS Lite (64-bit)**，headless server 不需要 desktop。

    1. 下载 [Raspberry Pi Imager](https://www.raspberrypi.com/software/)。
    2. 选择 OS：**Raspberry Pi OS Lite (64-bit)**。
    3. 在 settings dialog 中预先配置：
       - Hostname: `gateway-host`
       - Enable SSH
       - 设置 username 和 password
       - 配置 WiFi（如果不使用 Ethernet）
    4. 刷入 SD card 或 USB drive，插入并启动 Pi。

  </Step>

  <Step title="通过 SSH 连接">
    ```bash
    ssh user@gateway-host
    ```
  </Step>

  <Step title="更新系统">
    ```bash
    sudo apt update && sudo apt upgrade -y
    sudo apt install -y git curl build-essential

    # Set timezone (important for cron and reminders)
    sudo timedatectl set-timezone America/Chicago
    ```

  </Step>

  <Step title="安装 Node.js 24">
    ```bash
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt install -y nodejs
    node --version
    ```
  </Step>

  <Step title="添加 swap，2 GB 或更低内存设备很重要">
    ```bash
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

    # Reduce swappiness for low-RAM devices
    echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
    sudo sysctl -p
    ```

  </Step>

  <Step title="安装 CrawClaw">
    安装与你的 Raspberry Pi OS 兼容的 Linux/ARM CrawClaw package，或从 source checkout 构建。
  </Step>

  <Step title="运行 onboarding">
    使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

    按 wizard 操作。对于 headless 设备，推荐使用 API keys 而不是 OAuth。Feishu 是最容易开始的 channel。

  </Step>

  <Step title="验证">
    ```bash
    sudo systemctl status crawclaw
    journalctl -u crawclaw -f
    ```
  </Step>

  <Step title="从你的电脑访问 Gateway">
    在另一个 terminal 创建 SSH tunnel：

    ```bash
    ssh -N -L 18789:127.0.0.1:18789 user@gateway-host
    ```

    在本地 browser 打开打印出的 URL。对于 always-on remote access，参见 [Tailscale integration](/gateway/tailscale)。

  </Step>
</Steps>

## 性能建议

**使用 USB SSD** -- SD cards 速度慢且容易磨损。USB SSD 会明显提升性能。参见 [Pi USB boot guide](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#usb-mass-storage-boot)。

**启用 module compile cache** -- 加快低功耗 Pi host 上重复 CLI invocation 的速度：

```bash
grep -q 'NODE_COMPILE_CACHE=/var/tmp/crawclaw-compile-cache' ~/.bashrc || cat >> ~/.bashrc <<'EOF' # pragma: allowlist secret
export NODE_COMPILE_CACHE=/var/tmp/crawclaw-compile-cache
mkdir -p /var/tmp/crawclaw-compile-cache
export CRAWCLAW_NO_RESPAWN=1
EOF
source ~/.bashrc
```

**降低内存占用** -- 对于 headless setup，释放 GPU memory 并禁用不用的 services：

```bash
echo 'gpu_mem=16' | sudo tee -a /boot/config.txt
sudo systemctl disable bluetooth
```

## 故障排除

**内存不足** -- 用 `free -h` 确认 swap 已启用。禁用不用的 services（`sudo systemctl disable cups bluetooth avahi-daemon`）。只使用 API-based models。

**性能慢** -- 使用 USB SSD，而不是 SD card。用 `vcgencmd get_throttled` 检查 CPU throttling（应返回 `0x0`）。

**Service 无法启动** -- 用 `journalctl -u crawclaw --no-pager -n 100` 检查日志，并运行 CrawClaw Desktop 或本地 Gateway API。

**ARM binary 问题** -- 如果某个 skill 报 "exec format error"，检查该 binary 是否有 ARM64 build。用 `uname -m` 验证 architecture（应显示 `aarch64`）。

**WiFi 掉线** -- 禁用 WiFi power management：`sudo iwconfig wlan0 power off`。

## 后续步骤

- [Channels](/channels) -- 连接 Feishu、Weixin、community chat 等
- [Gateway configuration](/gateway/configuration) -- 所有 config options
- [Updating](/install/updating) -- 保持 CrawClaw 更新
