---
read_when:
  - 在 DigitalOcean 上设置 CrawClaw
  - 寻找便宜的 CrawClaw VPS 托管
summary: CrawClaw on DigitalOcean（简单的付费 VPS 选项）
title: DigitalOcean（平台）
x-i18n:
  generated_at: "2026-06-05T14:41:10Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 88b0229f38fecfb0f2234cc7768c8c6ff45e6e4bfcb4affeaec3862090093256
  source_path: platforms/digitalocean.md
  workflow: 15
---

# DigitalOcean 上的 CrawClaw

## 目标

在 DigitalOcean 上运行持久的 CrawClaw Gateway，**每月 $6**（或使用预留定价 $4/月）。

如果你想要 $0/月的选项且不介意 ARM + 提供商特定设置，请参阅 [Oracle Cloud 指南](/platforms/oracle)。

## 成本比较（2026 年）

| 提供商       | 方案            | 规格                  | 价格/月       | 备注                   |
| ------------ | --------------- | --------------------- | ------------- | ---------------------- |
| Oracle Cloud | Always Free ARM | 最高 4 OCPU, 24GB RAM | $0            | ARM，容量有限/注册繁琐 |
| Hetzner      | CX22            | 2 vCPU, 4GB RAM       | €3.79 (约 $4) | 最便宜的付费选项       |
| DigitalOcean | Basic           | 1 vCPU, 1GB RAM       | $6            | 简单的 UI，文档完善    |
| Vultr        | Cloud Compute   | 1 vCPU, 1GB RAM       | $6            | 多个机房位置           |
| Linode       | Nanode          | 1 vCPU, 1GB RAM       | $5            | 现属于 Akamai          |

**选择提供商：**

- DigitalOcean：最简 UX + 可预测的设置（本文档）
- Oracle Cloud：可以 $0/月，但更繁琐且仅限 ARM（请参阅 [Oracle 指南](/platforms/oracle)）

---

## 前置条件

- DigitalOcean 账户（[注册送 $200 免费额度](https://m.do.co/c/signup)）
- SSH 密钥对（或愿意使用密码认证）
- 约 20 分钟

## 1) 创建 Droplet

<Warning>
使用干净的基础镜像（Ubuntu 24.04 LTS）。除非你已审查了启动脚本和防火墙默认值，否则避免使用第三方 Marketplace 一键镜像。
</Warning>

1. 登录 [DigitalOcean](https://cloud.digitalocean.com/)
2. 点击 **创建 → Droplets**
3. 选择：
   - **区域：** 离你最近（或离你的用户最近）
   - **镜像：** Ubuntu 24.04 LTS
   - **规格：** Basic → Regular → **$6/月**（1 vCPU, 1GB RAM, 25GB SSD）
   - **认证：** SSH 密钥（推荐）或密码
4. 点击 **创建 Droplet**
5. 记下 IP 地址

## 2) 通过 SSH 连接

```bash
ssh root@YOUR_DROPLET_IP
```

## 3) 安装 CrawClaw

```bash
# 更新系统
apt update && apt upgrade -y

# 安装 Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs

# 为此主机安装支持的 CrawClaw Gateway/Desktop 版本，或从源码构建。
```

然后使用 CrawClaw Desktop 或本地 Gateway API 验证 Gateway 状态。

## 4) 运行新手引导

当你通过 SSH 或 Tailscale 将本地 Desktop 与 droplet 配对时，使用 CrawClaw
Desktop。在 headless droplet 上，直接调用 Gateway API：用 `status` 或
`health` 检查 readiness，用 `config.patch` 做 scoped config writes，用
`models.list` 和 `usage.status` 查看 model/provider 状态，用 `channels.status`
或 `channels.config.patch` 检查和修改 channel readiness/config。

向导将引导你完成：

- 模型认证（API 密钥或 OAuth）
- 渠道设置（Feishu、Weixin、community chat 等）
- Gateway 令牌（自动生成）
- 守护进程安装（systemd）

## 5) 验证 Gateway

```bash
# 检查服务
systemctl --user status crawclaw-gateway.service

# 查看日志
journalctl --user -u crawclaw-gateway.service -f
```

## 6) 访问 Gateway

Gateway 默认绑定到 loopback。要从另一台机器访问：

**选项 A：SSH 隧道（推荐）**

```bash
# 从你的本地机器
ssh -L 18789:localhost:18789 root@YOUR_DROPLET_IP

# 然后打开：http://localhost:18789
```

**选项 B：Tailscale Serve（HTTPS，仅 loopback）**

```bash
# 在 droplet 上
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

通过 CrawClaw Desktop 或本地 Gateway API 配置 `gateway.bind: "loopback"` 和 `gateway.tailscale.mode: "serve"`。

打开：`https://<magicdns>/`

注意事项：

- Serve 保持 Gateway 仅限 loopback，并通过 Tailscale 身份标头认证浏览器客户端/WebSocket 流量（无令牌认证假设受信任的 gateway 主机；HTTP API 仍需要令牌/密码）。
- 要改为要求令牌/密码，请设置 `gateway.auth.allowTailscale: false` 或使用 `gateway.auth.mode: "password"`。

**选项 C：Tailnet 绑定（无 Serve）**

通过 `config.patch` 或经 review 的 `~/.crawclaw/crawclaw.json` 修改，把
`gateway.bind` 设为 `"tailnet"`，并启用 token 或 password auth，然后重启
user service。打开远程客户端前，用 `status` 验证新的 bind mode。

打开：`http://<tailscale-ip>:18789`（需要令牌）。

## 7) 连接你的渠道

### Feishu

在 CrawClaw Desktop channel settings 中配置 Feishu account，或在 droplet 上用
`channels.config.patch` patch channel block。依赖生产消息投递前，用
`channels.status` 验证 readiness。

### Weixin

在 gateway host 上通过正常 interactive session flow 关联 Weixin。自动化可以用
`channels.status` 检查 readiness，并 patch non-secret channel config，但不能独立完成
QR/session login。

有关其他提供商，请参阅 [Channels](/channels)。

---

## 1GB RAM 优化

$6 droplet 只有 1GB RAM。为了保持流畅运行：

### 添加 swap（推荐）

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 使用更轻量的模型

如果你遇到 OOM，请考虑：

- 使用基于 API 的模型（Claude、GPT）而非本地模型
- 将 `agents.defaults.model.primary` 设置为更小的模型

### 监控内存

```bash
free -h
htop
```

---

## 持久化

所有状态位于：

- `~/.crawclaw/` — 配置、凭证、会话数据
- `~/.crawclaw/workspace/` — 工作区（SOUL.md、记忆等）

这些在重启后保留。定期备份：

```bash
tar -czvf crawclaw-backup.tar.gz ~/.crawclaw ~/.crawclaw/workspace
```

---

## Oracle Cloud 免费替代方案

Oracle Cloud 提供**始终免费**的 ARM 实例，功能显著强于这里的任何付费选项 —— **$0/月**。

| 你获得的内容   | 规格          |
| -------------- | ------------- |
| **4 OCPU**     | ARM Ampere A1 |
| **24GB RAM**   | 绰绰有余      |
| **200GB 存储** | 块存储        |
| **永久免费**   | 无信用卡扣费  |

**注意事项：**

- 注册可能繁琐（如果失败请重试）
- ARM 架构 —— 大多数功能正常，但某些二进制文件需要 ARM 构建

有关完整设置指南，请参阅 [Oracle Cloud](/platforms/oracle)。有关注册提示和注册流程故障排除，请参阅此[社区指南](https://gist.github.com/rssnyder/51e3cfedd730e7dd5f4a816143b25dbd)。

---

## 故障排除

### Gateway 无法启动

```bash
journalctl -u crawclaw --no-pager -n 50
```

### 端口已被占用

```bash
lsof -i :18789
kill <PID>
```

### 内存不足

```bash
# 检查内存
free -h

# 添加更多 swap
# 或升级到 $12/月 droplet（2GB RAM）
```

---

## 另请参阅

- [Tailscale](/gateway/tailscale) — 安全远程访问
- [配置](/gateway/configuration) — 完整配置参考
