---
read_when:
  - 你想在 Linux 服务器或云 VPS 上运行 Gateway
  - 你需要托管指南的快速索引
  - 你想为 CrawClaw 进行通用 Linux 服务器调优
sidebarTitle: Linux Server
summary: 在 Linux 服务器或云 VPS 上运行 CrawClaw — 提供商选择、架构和调优
title: Linux 服务器
x-i18n:
  generated_at: "2026-06-05T15:02:08Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 840d8d0763cb95c205c599f5a3087b90e7ae556a4c16ee1f0146aaf49ed3b304
  source_path: vps.md
  workflow: 15
---

# Linux 服务器

在任何 Linux 服务器或云 VPS 上运行 CrawClaw Gateway。本页面帮助你选择提供商、解释云端部署的工作方式，并涵盖适用于所有环境的通用 Linux 调优。

## 选择提供商

<CardGroup cols={2}>
  <Card title="Railway" href="/install/railway">一键、浏览器设置</Card>
  <Card title="Northflank" href="/install/northflank">一键、浏览器设置</Card>
  <Card title="DigitalOcean" href="/install/digitalocean">简单的付费 VPS</Card>
  <Card title="Oracle Cloud" href="/install/oracle">永久免费 ARM 层</Card>
  <Card title="Azure" href="/install/azure">Linux VM</Card>
  <Card title="exe.dev" href="/install/exe-dev">带 HTTPS 代理的 VM</Card>
  <Card title="Raspberry Pi" href="/install/raspberry-pi">ARM 自主托管</Card>
</CardGroup>

**AWS (EC2 / Lightsail / 免费层)** 也能良好运行。社区视频演练请访问
[x.com/techfrenAJ/status/2014934471095812547](https://x.com/techfrenAJ/status/2014934471095812547)
（社区资源 — 可能不再可用）。

## 云端设置工作原理

- **Gateway 在 VPS 上运行**，拥有状态和工作区。
- 你通过 Tailscale/SSH 上的 gateway 客户端从笔记本或手机连接。
- 将 VPS 作为事实来源，定期**备份**状态和工作区。
- 安全默认设置：保持 Gateway 在 loopback 上，并通过 SSH 隧道或 Tailscale Serve 访问。
  如果绑定到 `lan` 或 `tailnet`，需要设置 `gateway.auth.token` 或 `gateway.auth.password`。

相关页面：[Gateway 远程访问](/gateway/remote)、[平台中心](/platforms)。

## VPS 上的共享公司智能体

当每个用户都在相同的信任边界内且智能体仅用于业务时，为团队运行单一智能体是一种有效的设置。

- 保持在专用运行时上（VPS/VM/容器 + 专用 OS 用户/账户）。
- 不要让该运行时登录个人 Apple/Google 账户或个人浏览器/密码管理器配置文件。
- 如果用户之间存在对抗性，按 gateway/主机/OS 用户分离。

安全模型详情：[安全](/gateway/security)。

## 小型 VM 和 ARM 主机启动调优

如果在低功耗 VM（或 ARM 主机）上 Desktop 和 Gateway API 操作感觉缓慢，请启用 Node 的模块编译缓存：

```bash
grep -q 'NODE_COMPILE_CACHE=/var/tmp/crawclaw-compile-cache' ~/.bashrc || cat >> ~/.bashrc <<'EOF'
export NODE_COMPILE_CACHE=/var/tmp/crawclaw-compile-cache
mkdir -p /var/tmp/crawclaw-compile-cache
export CRAWCLAW_NO_RESPAWN=1
EOF
source ~/.bashrc
```

- `NODE_COMPILE_CACHE` 改善重复命令的启动时间。
- `CRAWCLAW_NO_RESPAWN=1` 避免自重启路径的额外启动开销。
- 首次命令运行会预热缓存；后续运行会更快。
- 有关 Pi 的具体信息，请参阅 [Raspberry Pi](/install/raspberry-pi)。

### systemd 调优清单（可选）

对于使用 `systemd` 的 VM 主机，请考虑：

- 添加服务环境以获得稳定的启动路径：
  - `CRAWCLAW_NO_RESPAWN=1`
  - `NODE_COMPILE_CACHE=/var/tmp/crawclaw-compile-cache`
- 保持重启行为明确：
  - `Restart=always`
  - `RestartSec=2`
  - `TimeoutStartSec=90`
- 优先使用 SSD 支持的磁盘用于状态/缓存路径，以减少随机 I/O 冷启动惩罚。

示例：

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

`Restart=` 策略如何帮助自动化恢复：
[systemd 可以自动化服务恢复](https://www.redhat.com/en/blog/systemd-automate-recovery)。
