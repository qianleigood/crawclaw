---
read_when:
  - 在 Raspberry Pi 上设置 CrawClaw
  - 在 ARM 设备上运行 CrawClaw
  - 打造经济实惠的常开个人 AI
summary: CrawClaw 在 Raspberry Pi 上的配置（经济型自托管方案）
title: Raspberry Pi（平台）
x-i18n:
  generated_at: "2026-06-05T14:41:54Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: f50759a7faa04d47671d5687366ca3c09a2d4db89b7018caed95960d7e013dd2
  source_path: platforms/raspberry-pi.md
  workflow: 15
---

# CrawClaw on Raspberry Pi

## 目标

在 Raspberry Pi 上运行持久化、常开的 CrawClaw Gateway，**一次性成本约 $35-80**（无月费）。

适合场景：

- 24/7 个人 AI 助手
- 家庭自动化中枢
- 低功耗、常驻的 Feishu/Weixin 机器人

## 硬件要求

| Pi 型号         | RAM     | 支持情况 | 备注                          |
| --------------- | ------- | -------- | ----------------------------- |
| **Pi 5**        | 4GB/8GB | ✅ 最佳  | 速度最快，推荐                |
| **Pi 4**        | 4GB     | ✅ 良好  | 对大多数用户来说是最佳选择    |
| **Pi 4**        | 2GB     | ✅ 可用  | 可用，建议添加 swap           |
| **Pi 4**        | 1GB     | ⚠️ 紧张  | 可用，需添加 swap，配置需极简 |
| **Pi 3B+**      | 1GB     | ⚠️ 较慢  | 可用但较慢                    |
| **Pi Zero 2 W** | 512MB   | ❌       | 不推荐                        |

**最低规格：** 1GB RAM、1 核、500MB 磁盘
**推荐配置：** 2GB+ RAM、64 位操作系统、16GB+ SD 卡（或 USB SSD）

## 你需要什么

- Raspberry Pi 4 或 5（推荐 2GB+）
- MicroSD 卡（16GB+）或 USB SSD（性能更好）
- 电源适配器（推荐官方 Pi PSU）
- 网络连接（以太网或 WiFi）
- 约 30 分钟

## 1) 烧录操作系统

使用 **Raspberry Pi OS Lite (64-bit)** —— 无头服务器无需桌面环境。

1. 下载 [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. 选择操作系统：**Raspberry Pi OS Lite (64-bit)**
3. 点击齿轮图标（⚙️）进行预配置：
   - 设置主机名：`gateway-host`
   - 启用 SSH
   - 设置用户名/密码
   - 配置 WiFi（如果不使用以太网）
4. 烧录到 SD 卡/USB 驱动器
5. 插入并启动 Pi

## 2) 通过 SSH 连接

```bash
ssh user@gateway-host
# 或使用 IP 地址
ssh user@192.168.x.x
```

## 3) 系统设置

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装必要软件包
sudo apt install -y git curl build-essential

# 设置时区（对 cron/提醒很重要）
sudo timedatectl set-timezone America/Chicago  # 改为你的时区
```

## 4) 安装 Node.js 24 (ARM64)

```bash
# 通过 NodeSource 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# 验证
node --version  # 应显示 v24.x.x
npm --version
```

## 5) 添加 Swap（1GB 或更少时必须）

Swap 防止内存不足崩溃：

```bash
# 创建 2GB swap 文件
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 永久生效
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 优化低内存（降低 swappiness）
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

## 6) 安装 CrawClaw

### 选项 A：标准安装（推荐）

使用支持的要运行 Linux ARM 构建的安装流程。如果你需要一个可修改的运行时，请使用下面的源码检出路径。

### 选项 B：可修改安装（用于折腾）

```bash
git clone https://github.com/qianleigood/crawclaw.git
cd crawclaw
npm install
npm run build
npm link
```

可修改安装让你直接访问日志和代码——有助于调试 ARM 特定问题。

## 7) 运行新手引导

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 实现自动化。

按照向导操作：

1. **Gateway 模式：** 本地
2. **认证：** 推荐 API 密钥（OAuth 在无头 Pi 上可能不稳定）
3. **渠道：** Feishu 最容易上手
4. **守护进程：** 是（systemd）

## 8) 验证安装

```bash
# 检查服务状态
sudo systemctl status crawclaw

# 查看日志
journalctl -u crawclaw -f
```

## 9) 访问 CrawClaw Gateway

将 `user@gateway-host` 替换为你的 Pi 用户名和主机名或 IP 地址。

在你的电脑上，创建到 Pi 的 SSH 隧道：

```bash
ssh -N -L 18789:127.0.0.1:18789 user@gateway-host
```

在电脑上的另一个终端中，创建 SSH 隧道：

```bash
ssh -N -L 18789:127.0.0.1:18789 user@gateway-host
```

然后通过转发的本地地址连接支持的 gateway 客户端。

如果客户端要求认证，请使用 `gateway.auth.token`（或 `CRAWCLAW_GATEWAY_TOKEN`）中的 token。

要获得常开远程访问，请参阅 [Tailscale](/gateway/tailscale)。

---

## 性能优化

### 使用 USB SSD（巨大改进）

SD 卡速度慢且容易磨损。USB SSD 可显著提升性能：

```bash
# 检查是否从 USB 启动
lsblk
```

参见 [Pi USB 启动指南](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#usb-mass-storage-boot) 进行设置。

### 加速本地运行时启动（模块编译缓存）

在低功耗 Pi 主机上，启用 Node 的模块编译缓存，使重复的本地运行时启动更快：

```bash
grep -q 'NODE_COMPILE_CACHE=/var/tmp/crawclaw-compile-cache' ~/.bashrc || cat >> ~/.bashrc <<'EOF' # pragma: allowlist secret
export NODE_COMPILE_CACHE=/var/tmp/crawclaw-compile-cache
mkdir -p /var/tmp/crawclaw-compile-cache
export CRAWCLAW_NO_RESPAWN=1
EOF
source ~/.bashrc
```

注意事项：

- `NODE_COMPILE_CACHE` 可加速后续运行（`status`、`health`、`--help`）。
- `/var/tmp` 比 `/tmp` 更能承受重启。
- `CRAWCLAW_NO_RESPAWN=1` 可避免 CLI 自我重启带来的额外启动成本。
- 首次运行会预热缓存；后续运行受益最大。

### systemd 启动调优（可选）

如果这个 Pi 主要运行 CrawClaw，添加服务 drop-in 以减少重启抖动并保持启动环境稳定：

```bash
sudo systemctl edit crawclaw
```

```ini
[Service]
Environment=CRAWCLAW_NO_RESPAWN=1
Environment=NODE_COMPILE_CACHE=/var/tmp/crawclaw-compile-cache
Restart=always
RestartSec=2
TimeoutStartSec=90
```

然后应用：

```bash
sudo systemctl daemon-reload
sudo systemctl restart crawclaw
```

如果可能，将 CrawClaw 状态/缓存保存在 SSD 备份存储上，以避免冷启动时 SD 卡随机 I/O 瓶颈。

`Restart=` 策略如何帮助自动化恢复：
[systemd 可以自动化服务恢复](https://www.redhat.com/en/blog/systemd-automate-recovery)。

### 减少内存使用

```bash
# 禁用 GPU 内存分配（无头）
echo 'gpu_mem=16' | sudo tee -a /boot/config.txt

# 如果不需要蓝牙则禁用
sudo systemctl disable bluetooth
```

### 监控资源

```bash
# 检查内存
free -h

# 检查 CPU 温度
vcgencmd measure_temp

# 实时监控
htop
```

---

## ARM 特定说明

### 二进制兼容性

大多数 CrawClaw 功能在 ARM64 上工作，但某些外部二进制文件可能需要 ARM 构建：

| 工具              | ARM64 状态 | 备注                                |
| ----------------- | ---------- | ----------------------------------- |
| Node.js           | ✅         | 运行良好                            |
| Weixin (Baileys)  | ✅         | 纯 JS，无问题                       |
| Feishu            | ✅         | 纯 JS，无问题                       |
| gog (Gmail CLI)   | ⚠️         | 检查是否有 ARM 发布版               |
| Chromium (浏览器) | ✅         | `sudo apt install chromium-browser` |

如果某个 skill 失败，请检查其二进制文件是否有 ARM 构建。许多 Go/Rust 工具有；有些没有。

### 32 位 vs 64 位

**始终使用 64 位操作系统。** Node.js 和许多现代工具需要它。检查方法：

```bash
uname -m
# 应显示：aarch64（64 位）而不是 armv7l（32 位）
```

---

## 推荐模型设置

由于 Pi 只是 Gateway（模型在云端运行），请使用基于 API 的模型：

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-20250514",
        "fallbacks": ["openai/gpt-4o-mini"]
      }
    }
  }
}
```

**不要尝试在 Pi 上运行本地 LLM** —— 即使是小模型也太慢了。让 Claude/GPT 做繁重的工作。

---

## 开机自启动

新手引导会完成此设置，但可以验证：

```bash
# 检查服务是否已启用
sudo systemctl is-enabled crawclaw

# 如果未启用则启用
sudo systemctl enable crawclaw

# 开机启动
sudo systemctl start crawclaw
```

---

## 故障排除

### 内存不足（OOM）

```bash
# 检查内存
free -h

# 添加更多 swap（参见第 5 步）
# 或减少 Pi 上运行的服务
```

### 性能缓慢

- 使用 USB SSD 代替 SD 卡
- 禁用不需要的服务：`sudo systemctl disable cups bluetooth avahi-daemon`
- 检查 CPU 限流：`vcgencmd get_throttled`（应返回 `0x0`）

### 服务无法启动

```bash
# 检查日志
journalctl -u crawclaw --no-pager -n 100

# 常见修复：重新构建
cd ~/crawclaw  # 如果使用可修改安装
npm run build
sudo systemctl restart crawclaw
```

### ARM 二进制问题

如果 skill 因 "exec format error" 失败：

1. 检查该二进制文件是否有 ARM64 构建
2. 尝试从源码构建

### WiFi 断开

对于使用 WiFi 的无头 Pis：

```bash
# 禁用 WiFi 电源管理
sudo iwconfig wlan0 power off

# 永久生效
echo 'wireless-power off' | sudo tee -a /etc/network/interfaces
```

---

## 成本对比

| 配置           | 一次性成本 | 月费     | 备注               |
| -------------- | ---------- | -------- | ------------------ |
| **Pi 4 (2GB)** | ~$45       | $0       | + 电费（~$5/年）   |
| **Pi 4 (4GB)** | ~$55       | $0       | 推荐               |
| **Pi 5 (4GB)** | ~$60       | $0       | 最佳性能           |
| **Pi 5 (8GB)** | ~$80       | $0       | 性能过剩但面向未来 |
| DigitalOcean   | $0         | $6/月    | $72/年             |
| Hetzner        | $0         | €3.79/月 | ~$50/年            |

**回本时间：** Pi 在约 6-12 个月内即可收回成本，相比云 VPS。

---

## 另请参阅

- [Linux 指南](/platforms/linux) —— 通用 Linux 设置
- [DigitalOcean 指南](/platforms/digitalocean) —— 云替代方案
- [Tailscale](/gateway/tailscale) —— 远程访问
