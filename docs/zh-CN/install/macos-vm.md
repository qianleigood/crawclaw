---
read_when:
  - 你希望 CrawClaw 与你的主机 macOS 环境隔离
  - 你希望拥有一个可重置的 macOS 环境，可以克隆
  - 你想比较本地与托管 macOS 虚拟机的选项
title: macOS 虚拟机
x-i18n:
  generated_at: "2026-06-05T14:39:34Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: cab97254772354af353006341a7df08a72e49bf0d11c801304224bce2a48e4cf
  source_path: install/macos-vm.md
  workflow: 15
---

## 推荐默认选项（大多数用户）

- **小型 Linux VPS**：用于常驻 Gateway 网关，成本低廉。参见 [VPS 托管](/vps)。
- **专用硬件**（Mac mini 或 Linux 主机）：如果你想要完全控制权以及用于浏览器自动化的**住宅 IP**。许多网站会屏蔽数据中心 IP，因此本地浏览通常效果更好。

当你特别需要 macOS 独有能力（微信）或者想要与日常使用的 Mac 完全隔离时，使用 macOS 虚拟机。

## macOS 虚拟机选项

### 在 Apple Silicon Mac 上本地运行虚拟机（Lume）

这为你提供：

- 完全隔离的 macOS 环境（你的主机保持干净）
- 通过微信获得微信支持（在 Linux/Windows 上不可能实现）
- 通过克隆虚拟机即时重置
- 无额外硬件或云成本

### 托管 Mac 提供商（云端）

如果你想在云端运行 macOS，托管 Mac 提供商也可以：

- [MacStadium](https://www.macstadium.com/)（托管 Mac）
- 其他托管 Mac 供应商也可使用；按照他们的虚拟机 + SSH 文档操作

一旦你通过 SSH 访问 macOS 虚拟机，继续下面的第 6 步。

---

## 快速路径（Lume，有经验用户）

1. 安装 Lume
2. `lume create crawclaw --os macos --ipsw latest`
3. 完成设置助理，启用远程登录（SSH）
4. `lume run crawclaw --no-display`
5. SSH 登录，安装 CrawClaw，配置渠道
6. 完成

---

## 你需要什么（Lume）

- Apple Silicon Mac（M1/M2/M3/M4）
- 主机上运行 macOS Sequoia 或更高版本
- 每个虚拟机约 60 GB 可用磁盘空间
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

## 2) 创建 macOS 虚拟机

```bash
lume create crawclaw --os macos --ipsw latest
```

这会下载 macOS 并创建虚拟机。VNC 窗口会自动打开。

注意：下载时间取决于你的网络连接。

---

## 3) 完成设置助理

在 VNC 窗口中：

1. 选择语言和地区
2. 跳过 Apple ID（或如果你想以后使用微信，请登录）
3. 创建用户账户（记住用户名和密码）
4. 跳过所有可选功能

设置完成后，启用 SSH：

1. 打开系统设置 → 通用 → 共享
2. 启用"远程登录"

---

## 4) 获取虚拟机 IP 地址

```bash
lume get crawclaw
```

查找 IP 地址（通常为 `192.168.64.x`）。

---

## 5) SSH 登录虚拟机

```bash
ssh youruser@192.168.64.X
```

将 `youruser` 替换为你创建账户的用户名，IP 替换为你虚拟机的 IP。

---

## 6) 安装 CrawClaw

在虚拟机内：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

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

然后登录微信（扫描二维码）：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

---

## 8) 无头运行虚拟机

停止虚拟机并重新启动，不带显示：

```bash
lume stop crawclaw
lume run crawclaw --no-display
```

虚拟机在后台运行。CrawClaw 的守护进程保持 gateway 运行。

检查状态：

通过虚拟机访问路径使用 CrawClaw Desktop 或本地 Gateway API。

---

## 附加功能：微信集成

这是在 macOS 上运行的关键功能。使用 [微信](https://weixin.app) 将微信添加到 CrawClaw。

在虚拟机内：

1. 从 weixin.app 下载微信
2. 使用你的 Apple ID 登录
3. 启用 Web API 并设置密码
4. 将微信 webhook 指向你的 gateway（例如：`https://your-gateway-host:3000/weixin-webhook?password=<password>`）

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

重启 gateway。现在你的智能体可以发送和接收微信了。

完整设置详情：[微信渠道](/channels/index)

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

保持虚拟机运行：

- 保持 Mac 接通电源
- 在系统设置 → 节能中禁用睡眠
- 需要时使用 `caffeinate`

对于真正的常驻运行，考虑使用专用 Mac mini 或小型 VPS。参见 [VPS 托管](/vps)。

---

## 故障排除

| 问题                | 解决方案                                                                    |
| ------------------- | --------------------------------------------------------------------------- |
| 无法 SSH 登录虚拟机 | 检查虚拟机系统设置中是否启用了"远程登录"                                    |
| 虚拟机 IP 未显示    | 等待虚拟机完全启动，重新运行 `lume get crawclaw`                            |
| Lume 命令未找到     | 将 `~/.local/bin` 添加到你的 PATH                                           |
| 微信二维码无法扫描  | 确保在运行 CrawClaw Desktop 或本地 Gateway API 时已登录到虚拟机（不是主机） |

---

## 相关文档

- [VPS 托管](/vps)
- [Gateway 远程](/gateway/remote)
- [微信渠道](/channels/index)
- [Lume 快速开始](https://cua.ai/docs/lume/guide/getting-started/quickstart)
- [Lume CLI 参考](https://cua.ai/docs/lume/reference/cli-reference)
- [无人值守虚拟机设置](https://cua.ai/docs/lume/guide/fundamentals/unattended-setup)（高级）
