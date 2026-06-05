---
read_when:
  - 在 Oracle Cloud 上设置 CrawClaw
  - 为 CrawClaw 寻找低成本 VPS 托管
  - 希望在小服务器上 24/7 运行 CrawClaw
summary: Oracle Cloud 上的 CrawClaw（Always Free ARM）
title: Oracle Cloud（平台）
x-i18n:
  generated_at: "2026-06-05T14:41:30Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: a2beb54ed915a5b426c66fdb862b371c885d6a163c9adb680ed3d35d71ca0ae0
  source_path: platforms/oracle.md
  workflow: 15
---

# Oracle Cloud（OCI）上的 CrawClaw

## 目标

在 Oracle Cloud 的 **Always Free** ARM 层级上运行持久化的 CrawClaw Gateway 网关。

Oracle 的免费层级非常适合 CrawClaw（尤其是如果你已有 OCI 账户），但有一些权衡：

- ARM 架构（大多数功能可用，但某些二进制文件可能仅支持 x86）
- 容量和注册可能不稳定

## 成本对比（2026 年）

| 提供商       | 套餐            | 规格                  | 价格/月 | 备注               |
| ------------ | --------------- | --------------------- | ------- | ------------------ |
| Oracle Cloud | Always Free ARM | 最高 4 OCPU, 24GB RAM | $0      | ARM，容量有限      |
| Hetzner      | CX22            | 2 vCPU, 4GB RAM       | ~ $4    | 最便宜的付费选项   |
| DigitalOcean | Basic           | 1 vCPU, 1GB RAM       | $6      | 界面友好，文档完善 |
| Vultr        | Cloud Compute   | 1 vCPU, 1GB RAM       | $6      | 节点位置多         |
| Linode       | Nanode          | 1 vCPU, 1GB RAM       | $5      | 现属于 Akamai      |

---

## 前置条件

- Oracle Cloud 账户（[注册](https://www.oracle.com/cloud/free/)）— 如果遇到问题请参见 [社区注册指南](https://gist.github.com/rssnyder/51e3cfedd730e7dd5f4a816143b25dbd)
- Tailscale 账户（[tailscale.com](https://tailscale.com) 免费注册）
- 约 30 分钟

## 1) 创建 OCI 实例

1. 登录 [Oracle Cloud Console](https://cloud.oracle.com/)
2. 导航到 **Compute → Instances → Create Instance**
3. 配置：
   - **名称：** `crawclaw`
   - **镜像：** Ubuntu 24.04 (aarch64)
   - **规格：** `VM.Standard.A1.Flex` (Ampere ARM)
   - **OCPU：** 2（或最高 4）
   - **内存：** 12 GB（或最高 24 GB）
   - **启动卷：** 50 GB（最高 200 GB 免费）
   - **SSH 密钥：** 添加你的公钥
4. 点击 **Create**
5. 记录公网 IP 地址

**提示：** 如果实例创建失败并显示"Out of capacity"，请尝试不同的可用性域或稍后重试。免费层级容量有限。

## 2) 连接并更新

```bash
# 通过公网 IP 连接
ssh ubuntu@YOUR_PUBLIC_IP

# 更新系统
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential
```

**注意：** `build-essential` 是某些依赖项 ARM 编译所必需的。

## 3) 配置用户和主机名

```bash
# 设置主机名
sudo hostnamectl set-hostname crawclaw

# 为 ubuntu 用户设置密码
sudo passwd ubuntu

# 启用 lingering（用户服务在登出后继续运行）
sudo loginctl enable-linger ubuntu
```

## 4) 安装 Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --hostname=crawclaw
```

这将启用 Tailscale SSH，这样你就可以从 tailnet 上的任何设备通过 `ssh crawclaw` 连接——无需公网 IP。

验证：

```bash
tailscale status
```

**从现在开始，通过 Tailscale 连接：** `ssh ubuntu@crawclaw`（或使用 Tailscale IP）。

## 5) 安装 CrawClaw

为此主机安装受支持的 CrawClaw Gateway/Desktop 版本，或从源代码构建。如果安装后 PATH 发生变化，请重新加载 shell。

当提示"How do you want to hatch your bot?"时，选择 **"Do this later"**。

> 注意：如果遇到 ARM 原生构建问题，请先尝试系统包（例如 `sudo apt install -y build-essential`），再考虑 Homebrew。

## 6) 配置 Gateway 网关（local loopback + 令牌认证）并启用 Tailscale Serve

使用令牌认证作为默认值。它可预测且无需任何不安全的浏览器客户端认证标志。

通过 CrawClaw Desktop 或本地 Gateway API 配置 `gateway.bind: "loopback"`、`gateway.auth.mode: "token"` 和 `gateway.tailscale.mode: "serve"`，然后重启：

```bash
systemctl --user restart crawclaw-gateway
```

## 7) 验证

```bash
# 检查守护进程状态
systemctl --user status crawclaw-gateway

# 检查 Tailscale Serve 状态
tailscale serve status

# 测试本地响应
curl http://localhost:18789
```

## 8) 锁定 VCN 安全

现在一切正常工作后，锁定 VCN 以阻止除 Tailscale 外的所有流量。OCI 的虚拟云网络在网络边缘充当防火墙——流量在到达你的实例之前就被阻止了。

1. 在 OCI Console 中进入 **Networking → Virtual Cloud Networks**
2. 点击你的 VCN → **Security Lists** → Default Security List
3. **移除**所有入站规则，除了：
   - `0.0.0.0/0 UDP 41641` (Tailscale)
4. 保留默认出站规则（允许所有出站）

这将在网络边缘阻止 22 端口 SSH、HTTP、HTTPS 和其他所有流量。从现在开始，你只能通过 Tailscale 连接。

---

## 访问 Gateway 网关

从 Tailscale 网络上的任何设备：

```
https://crawclaw.<tailnet-name>.ts.net/
```

将 `<tailnet-name>` 替换为你的 tailnet 名称（可在 `tailscale status` 中查看）。

无需 SSH 隧道。Tailscale 提供：

- HTTPS 加密（自动证书）
- 通过 Tailscale 身份认证
- 从 tailnet 上的任何设备访问（笔记本、手机等）

---

## 安全：VCN + Tailscale（推荐基线）

VCN 已锁定（仅开放 UDP 41641）且 Gateway 网关绑定到 local loopback，你将获得强大的纵深防御：公共流量在网络边缘被阻止，管理访问通过你的 tailnet 进行。

此设置通常可以消除仅用于阻止互联网范围 SSH 暴力破解的额外基于主机的防火墙规则的必要性——但你仍应保持操作系统更新、运行 CrawClaw Desktop 或本地 Gateway API，并验证你没有意外地在公共接口上监听。

### 已有的保护

| 传统步骤       | 是否需要   | 原因                                             |
| -------------- | ---------- | ------------------------------------------------ |
| UFW 防火墙     | 否         | VCN 在流量到达实例前阻止                         |
| fail2ban       | 否         | 如果 VCN 在 22 端口阻止，则无暴力破解            |
| sshd 加固      | 否         | Tailscale SSH 不使用 sshd                        |
| 禁用 root 登录 | 否         | Tailscale 使用 Tailscale 身份而非系统用户        |
| SSH 密钥仅认证 | 否         | Tailscale 通过你的 tailnet 认证                  |
| IPv6 加固      | 通常不需要 | 取决于你的 VCN/子网设置；验证实际分配/暴露的内容 |

### 仍然推荐

- **凭证权限：** `chmod 700 ~/.crawclaw`
- **安全审计：** CrawClaw Desktop 或本地 Gateway API
- **系统更新：** 定期 `sudo apt update && sudo apt upgrade`
- **监控 Tailscale：** 在 [Tailscale 管理控制台](https://login.tailscale.com/admin) 中审查设备

### 验证安全态势

```bash
# 确认无公网端口监听
sudo ss -tlnp | grep -v '127.0.0.1\|::1'

# 验证 Tailscale SSH 处于活动状态
tailscale status | grep -q 'offers: ssh' && echo "Tailscale SSH active"

# 可选：完全禁用 sshd
sudo systemctl disable --now ssh
```

---

## 回退方案：SSH 隧道

如果 Tailscale Serve 不工作，请使用 SSH 隧道：

```bash
# 从你的本地机器（通过 Tailscale）
ssh -L 18789:127.0.0.1:18789 ubuntu@crawclaw
```

然后打开 `http://localhost:18789`。

---

## 故障排除

### 实例创建失败（"Out of capacity"）

免费层级 ARM 实例很受欢迎。尝试：

- 不同的可用性域
- 在非高峰时段重试（清晨）
- 选择规格时使用"Always Free"过滤器

### Tailscale 无法连接

```bash
# 检查状态
sudo tailscale status

# 重新认证
sudo tailscale up --ssh --hostname=crawclaw --reset
```

### Gateway 网关无法启动

```bash
journalctl --user -u crawclaw-gateway -n 50
```

### 无法到达浏览器客户端

```bash
# 验证 Tailscale Serve 正在运行
tailscale serve status

# 检查 gateway 是否在监听
curl http://localhost:18789

# 如需要则重启
systemctl --user restart crawclaw-gateway
```

### ARM 二进制文件问题

某些工具可能没有 ARM 构建版本。检查：

```bash
uname -m  # 应显示 aarch64
```

大多数 npm 包都可以正常工作。对于二进制文件，请查找 `linux-arm64` 或 `aarch64` 版本。

---

## 持久化

所有状态位于：

- `~/.crawclaw/` — 配置、凭证、会话数据
- `~/.crawclaw/workspace/` — 工作区（SOUL.md、记忆、产物）

定期备份：

```bash
tar -czvf crawclaw-backup.tar.gz ~/.crawclaw ~/.crawclaw/workspace
```

---

## 另请参阅

- [Gateway 远程访问](/gateway/remote) — 其他远程访问模式
- [Tailscale 集成](/gateway/tailscale) — 完整 Tailscale 文档
- [Gateway 配置](/gateway/configuration) — 所有配置选项
- [DigitalOcean 指南](/platforms/digitalocean) — 如果你想要付费 + 更简单的注册
