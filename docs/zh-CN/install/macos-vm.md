---
read_when:
  - 你想要将 CrawClaw 与你的主机 macOS 环境隔离
  - 你想要一个可克隆的、可重置的 macOS 环境
  - 你想要比较本地与托管 macOS VM 的选项
summary: 在隔离的、可重置的 macOS VM 中运行 CrawClaw
title: macOS 虚拟机
x-i18n:
  generated_at: "2026-06-10T19:01:00Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 86571b1fc04fbc512529d05519f008ff5d39cc68692a54ac9434ca3fe9c155ff
  source_path: install/macos-vm.md
  workflow: 15
---

## 推荐默认配置（大多数用户）

- **小型 Linux VPS**：用于始终在线的 Gateway，成本低廉。参见 [VPS 托管](/vps)。
- **专用硬件**（Mac mini 或 Linux 主机）：如果你需要完全控制权，并且需要一个**住宅 IP** 用于浏览器自动化。许多网站会屏蔽数据中心 IP，因此本地浏览通常效果更好。

当你特别需要 macOS 独有功能（Weixin/Weixin）或想要与日常使用的 Mac 完全隔离时，可以使用 macOS VM。

## macOS VM 选项

### Apple Silicon Mac 上的本地 VM（Lume）

这为你提供：

- 隔离环境中的完整 macOS 环境（你的主机保持干净）
- 通过 Weixin 支持 Weixin（在 Linux/Windows 上不可能实现）
- 通过克隆 VM 快速重置
- 无需额外硬件或云成本

### 托管 Mac 提供商（云端）

如果你想要云端的 macOS，托管 Mac 提供商也可以：

- [MacStadium](https://www.macstadium.com/)（托管 Mac）
- 其他托管 Mac 供应商也可以使用；请按照他们的 VM + SSH 文档操作

一旦你可以通过 SSH 访问 macOS VM，继续下面的第 6 步。

---

## 快速路径（Lume，有经验的用户）

1. 安装 Lume
2. `lume create crawclaw --os macos --ipsw latest`
3. 完成设置助手，启用远程登录（SSH）
4. `lume run crawclaw --no-display`
5. 通过 SSH 登录，安装 CrawClaw，配置渠道
6. 完成

---

## 你需要什么（Lume）

- Apple Silicon Mac（M1/M2/M3/M4）
- 主机上运行 macOS Sequoia 或更高版本
- 每个 VM 约 60 GB 可用磁盘空间
- 约 20 分钟

---

## 1) 安装 Lume

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/lume/scripts/install.sh)"
```

如果 `~/.local/bin` 不在你的 PATH 中：

```bash
echo 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.zshrc && source ~/.zshrc
```

验证：

```bash
lume --version
```

文档：[Lume 安装](https://cua.ai/docs/lume/guide/getting-started/installation)

---

## 2) 创建 macOS VM

```bash
lume create crawclaw --os macos --ipsw latest
```

这会下载 macOS 并创建 VM。VNC 窗口会自动打开。

注意：下载时间取决于你的网络连接，可能需要一段时间。

---

## 3) 完成设置助手

在 VNC 窗口中：

1. 选择语言和地区
2. 跳过 Apple ID（或如果你想以后使用 Weixin，请登录）
3. 创建用户账户（记住用户名和密码）
4. 跳过所有可选功能

设置完成后，启用 SSH：

1. 打开系统设置 → 通用 → 共享
2. 启用“远程登录”

---

## 4) 获取 VM IP 地址

```bash
lume get crawclaw
```

查找 IP 地址（通常为 `192.168.64.x`）。

---

## 5) SSH 连接到 VM

```bash
ssh youruser@192.168.64.X
```

将 `youruser` 替换为你创建的用户名，将 IP 替换为你的 VM 的 IP。

---

## 6) 安装 CrawClaw

在 VM 内部：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化配置。

按照新手引导提示设置你的模型提供商（Anthropic、OpenAI 等）。

---

## 7) 配置渠道

编辑配置文件：

```bash
nano ~/.crawclaw/crawclaw.json
```

添加你的渠道：

```json5
{
  channels: {
    weixin: {
      dmPolicy: "allowlist",
      allowFrom: ["+15551234567"],
    },
    feishu: {
      botToken: "YOUR_BOT_TOKEN",
    },
  },
}
```

然后登录 Weixin（扫描二维码）：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化配置。

---

## 8) 无显示运行 VM

停止 VM 并在无显示的情况下重启：

```bash
lume stop crawclaw
lume run crawclaw --no-display
```

VM 在后台运行。CrawClaw 的守护进程保持 gateway 运行。

查看状态：

使用 CrawClaw Desktop 或通过 VM 访问路径调用本地 Gateway API。

---

## 附加功能：Weixin 集成

这是在 macOS 上运行的主要优势功能。使用 [Weixin](https://weixin.app) 将 Weixin 添加到 CrawClaw。

在 VM 内部：

1. 从 weixin.app 下载 Weixin
2. 使用你的 Apple ID 登录
3. 启用 Web API 并设置密码
4. 将 Weixin webhook 指向你的 gateway（例如：`https://your-gateway-host:3000/weixin-webhook?password=<password>`）

添加到你的 CrawClaw 配置：

```json5
{
  channels: {
    weixin: {
      serverUrl: "http://localhost:1234",
      password: "your-api-password",
      webhookPath: "/weixin-webhook",
    },
  },
}
```

重启 gateway。现在你的智能体可以发送和接收 Weixin。

完整设置详情：[Weixin 渠道](/channels/index)

---

## 保存黄金镜像

在进一步自定义之前，快照你的干净状态：

```bash
lume stop crawclaw
lume clone crawclaw crawclaw-golden
```

随时重置：

```bash
lume stop crawclaw && lume delete crawclaw
lume clone crawclaw-golden crawclaw
lume run crawclaw --no-display
```

---

## 24/7 运行

保持 VM 运行的方法：

- 保持 Mac 插入电源
- 在系统设置 → 节能中禁用睡眠
- 必要时使用 `caffeinate`

对于真正的始终在线，考虑使用专用 Mac mini 或小型 VPS。参见 [VPS 托管](/vps)。

---

## 故障排除

| 问题                  | 解决方案                                                                   |
| --------------------- | -------------------------------------------------------------------------- |
| 无法 SSH 连接到 VM    | 检查 VM 系统设置中的“远程登录”是否已启用                                   |
| VM IP 不显示          | 等待 VM 完全启动，再次运行 `lume get crawclaw`                             |
| Lume 命令未找到       | 将 `~/.local/bin` 添加到你的 PATH                                          |
| Weixin 二维码无法扫描 | 确保你在运行 CrawClaw Desktop 或本地 Gateway API 时登录的是 VM（而非主机） |

---

## 相关文档

- [VPS 托管](/vps)
- [Gateway 远程访问](/gateway/remote)
- [Weixin 渠道](/channels/index)
- [Lume 快速开始](https://cua.ai/docs/lume/guide/getting-started/quickstart)
- [Lume CLI 参考](https://cua.ai/docs/lume/reference/cli-reference)
- [无人值守 VM 设置](https://cua.ai/docs/lume/guide/fundamentals/unattended-setup)（高级）
