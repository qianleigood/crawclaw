---
summary: 关于 CrawClaw 安装、配置和运行时支持的常见问题
title: 常见问题
---

# 常见问题

本页回答当前 CrawClaw Desktop、本地 Gateway API、Rust agent runtime、模型提供商、会话、日志和远程访问的常见问题。运行时诊断请参阅[故障排除](/gateway/troubleshooting)，完整配置项请参阅[配置](/gateway/configuration)。

## 出问题后的最初 60 秒

1. 打开 CrawClaw Desktop，确认 Gateway 是否可达、当前 agent 是否在线、模型提供商是否有可用凭据。
2. 如果需要自动化检查，调用本地 Gateway API 的诊断、日志和健康检查接口。
3. 如果 RPC 不可达，先查看本机日志文件：

   ```bash
   tail -f "$(ls -t /tmp/crawclaw/crawclaw-*.log | head -1)"
   ```

4. 如果 Gateway 在远程主机上，先确认 SSH 隧道、Tailscale Serve/Funnel 或显式 Gateway URL + token/password 是否仍有效。
5. 共享诊断信息时，优先分享 Desktop 或 Gateway API 生成的脱敏报告，不要直接贴原始日志。

## 安装和首次设置

### 推荐的安装方式是什么

普通用户使用 GitHub Releases 中的 CrawClaw Desktop 发行包。首次启动后，在 Desktop 中完成 agent、workspace、provider 和 Gateway 设置。

贡献者或开发者可以从源码运行：

```bash
git clone https://github.com/qianleigood/crawclaw.git
cd crawclaw
pnpm install
pnpm build
```

Desktop 用户不需要全局 `crawclaw` 命令。

### 如何开始聊天

完成 Desktop onboarding 后，可以从已连接的渠道发送消息，也可以使用 Desktop 客户端连接本地 Gateway。默认 Gateway 端口是 `18789`。

### 需要什么运行时

源码开发需要 Node 24.x 或 Node 25.x 和 pnpm。生产使用以 CrawClaw Desktop 和 Rust runtime 为准；Bun 不推荐作为 Gateway 运行时。

### 是否支持 Raspberry Pi

支持。建议使用 64-bit OS 和 Node 24.x 或 Node 25.x。个人用途通常需要 512MB 到 1GB RAM、1 core 和约 500MB 磁盘；如果还要保留日志、媒体或其他服务，2GB RAM 更稳妥。

## Gateway 和远程访问

### Gateway 是什么

Gateway 是单进程控制面，负责渠道连接、WebSocket 控制平面、agent 运行、会话状态和工具调用。当前用户入口是 CrawClaw Desktop 和本地 Gateway API。

### 本地和远程客户端如何认证

本机客户端通常连接 `http://127.0.0.1:18789/` 或 `ws://127.0.0.1:18789`。如果需要认证，使用 Gateway 配置里的 token 或 password。

远程访问推荐三种方式：

- SSH 隧道：`ssh -N -L 18789:127.0.0.1:18789 user@gateway-host`
- Tailscale Serve：Gateway 继续只绑定 loopback，由 Tailscale 暴露 HTTPS 入口
- Tailnet/LAN bind：只在明确配置 token/password 后使用

参阅[远程访问](/gateway/remote)和[Tailscale](/gateway/tailscale)。

### 可以在同一台主机运行多个 Gateway 吗

可以，但每个实例必须使用独立端口、状态目录和配置文件。默认推荐每台主机只运行一个 Gateway，避免渠道会话、凭据和 workspace 状态漂移。

## 模型和提供商

### 如何配置模型提供商

优先使用 CrawClaw Desktop 的 provider 设置。高级自动化可以通过本地 Gateway API 写入 provider config，并刷新 Desktop 状态。

provider 插件只负责 provider-specific 行为：凭据解析、模型目录、请求传输和响应解析。通用推理循环由 Rust agent runtime 持有。

### Do I need a Claude or OpenAI subscription to run this

不需要。CrawClaw 可以使用 API key、setup-token 或受支持的 OAuth/profile 凭据。具体是否可用取决于 provider 本身的认证方式和你的账号权限。

### Can I use Claude Max subscription without an API key

可以使用 Anthropic setup-token 路径，但它不是可刷新 OAuth。生产和高稳定性场景仍建议使用 API key。

### Where do I find an Anthropic setup token

在 Gateway 主机上运行 Anthropic 官方 `claude setup-token` 流程，然后把 token 粘贴到 CrawClaw Desktop 或通过 Gateway API 写入对应认证配置。

### Why am I seeing HTTP 429 rate limit error from Anthropic

这通常表示 Anthropic 侧限流或订阅额度限制。处理顺序：

1. 确认当前 agent 实际使用的 provider/profile。
2. 检查是否有可用 fallback 模型。
3. 如果使用 setup-token，考虑切换到 API key 或降低并发。
4. 如果是临时额度窗口，等待 provider 侧恢复。

参阅[Gateway 故障排除](/gateway/troubleshooting)。

### 如何动态选择不同上下文窗口的模型

当前模型能力来自 provider catalog 和 runtime model metadata。Rust agent runtime 会根据模型窗口、压缩设置、保留 token、近期上下文和工具结果投影来决定是否压缩或裁剪。不同模型的上下文窗口不应硬编码在文档示例里，应以 provider metadata 和运行时配置为准。

## Why are there two exec approval configs for chat approvals

它们控制不同层级：

- `approvals.exec`：把审批提示转发到聊天目的地。
- `channels.<channel>.execApprovals`：让某个渠道成为原生审批客户端。

真正的执行权限仍由 host exec policy 决定。聊天配置只决定审批提示出现在哪里，以及用户如何回复。大多数部署不需要同时配置两层；只有在需要多渠道转发或渠道特定 UX 时才配置对应项。参阅[Exec Approvals](/tools/exec-approvals)。

## Env vars and env loading

环境变量有三类来源：

- 启动 Gateway 进程时的宿主环境。
- `~/.crawclaw/.env` 中由 Gateway 加载的变量。
- 配置里的 SecretRef 或 `${ENV}` 替换。

`NODE_EXTRA_CA_CERTS` 这类 Node 启动期变量必须在进程启动前存在，不要只依赖写入 `.env` 后热加载。

## Where things live on disk

默认状态在 `~/.crawclaw/` 下。常见内容包括：

- `~/.crawclaw/crawclaw.json`：主配置。
- `~/.crawclaw/.env`：本机环境变量。
- `~/.crawclaw/credentials/`：凭据和 auth profiles。
- `~/.crawclaw/agents/<agentId>/sessions/`：会话日志。
- `~/.crawclaw/workspace/`：默认 agent workspace。

不要把真实 token、手机号、密钥或生产配置提交到 workspace 仓库。

### Where does CrawClaw store its data

CrawClaw 数据主要保存在 Gateway 主机的本地磁盘。迁移机器时，要同时迁移 state 目录和 workspace；只复制 workspace 会丢失会话、凭据或渠道状态。

### What's the recommended backup strategy

备份这几类内容：

- `~/.crawclaw/crawclaw.json`
- `~/.crawclaw/credentials/`
- `~/.crawclaw/agents/<agentId>/sessions/`
- agent workspace

备份前先确认没有把明文密钥、真实手机号、生产 token 或敏感媒体同步到不可信位置。

## 会话、上下文和压缩

### 如何开始一个新对话

在聊天里发送 `/new`，或在 Desktop 中创建新会话。不同群组、线程和私聊是否共享上下文，取决于 channel/session key 策略。

### 为什么上下文会被截断或压缩

Rust agent runtime 会根据模型上下文窗口、保留 token、近期消息、工具结果大小和 compaction policy 自动压缩。小上下文模型会更早触发压缩；大工具结果会更快消耗窗口。

### 我遇到 context too large 怎么办

先开启或调整 compaction，再减少大型工具输出、附件摘要和长历史注入。必要时新开会话，或把长期事实写入 workspace memory 文件。

## 日志和调试

### 日志在哪里

常见文件日志位于 `/tmp/crawclaw/`。Desktop 日志视图和 `logs.tail` Gateway API 会读取相同的运行时日志流。

### Gateway 看起来活着但 RPC 不可达怎么办

先确认端口 `18789` 是否被占用、Desktop 指向的 URL 是否正确、远程隧道是否仍在、token/password 是否匹配。端口冲突会表现为 Gateway WebSocket bind 失败。

### 如何重启 Gateway

本地用户通过 CrawClaw Desktop 重启 Gateway。自动化场景通过 Gateway API 或宿主管理器重启，不再依赖旧的公共 CLI 子命令。

## 安全

### 是否可以把 CrawClaw 暴露到公网

不建议直接裸露到公网。优先使用 loopback + SSH 隧道、Tailscale Serve 或受控反向代理。非 loopback 访问必须显式配置 token/password，并且要限制渠道 allowlist。

### 我的机器人应该有自己的邮箱、GitHub 账户或电话号码吗

如果它会代表你对外沟通，建议使用独立账号并限制权限。不要把个人主账号的长期凭据交给公开渠道或不可信输入。

### 如果 AI 做了坏事怎么办

1. 停止 Gateway 进程。
2. 把 `gateway.bind` 改回 `loopback`，关闭 Tailscale Funnel/Serve 或公网代理。
3. 禁用有风险渠道，移除宽泛 allowlist。
4. 轮换可能泄露的 token、API key 和 OAuth profile。
5. 保留脱敏日志用于复盘。

## 媒体和附件

### 生成了图片或 PDF 但没有发出去

确认工具结果里有可访问的 media URL 或文件路径，并确认当前渠道支持对应附件类型。某些渠道只支持最终回复发送附件，不支持流式中间事件发送附件。

## 相关页面

- [安装](/install)
- [快速开始](/start/getting-started)
- [Gateway](/gateway)
- [远程访问](/gateway/remote)
- [日志](/logging)
- [故障排除](/gateway/troubleshooting)
