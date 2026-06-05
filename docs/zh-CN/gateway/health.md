---
read_when:
  - 诊断渠道连接或 Gateway 健康状况
  - 了解 Desktop 健康检查和 Gateway API 探测
summary: 通过 CrawClaw Desktop 和 Gateway API 进行 Gateway 健康监控
title: 健康检查
x-i18n:
  generated_at: "2026-06-05T14:16:43Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 318fcdb74e323bc7631061e9bf7382a18c6481e6dd3f6a93eda971fd05dc3b0b
  source_path: gateway/health.md
  workflow: 15
---

# 健康检查

使用 CrawClaw Desktop 查看正常健康视图。使用 Gateway API 进行自动化或外部监控。

## 快速检查

- **Desktop 状态** — 本地 Gateway 可达性、运行时状态、关联的认证、会话和最近活动。
- **Desktop 诊断** — 粘贴安全的故障排除数据和日志访问。
- **Gateway 健康 API** — 机器可读的健康快照，用于自动化。
- **渠道探测** — 在需要更深入诊断时对支持的渠道进行实时检查。

## 深度诊断

- 磁盘上的凭证：`~/.crawclaw/credentials/<channel>/<accountId>/`。
- 会话存储：`~/.crawclaw/agents/<agentId>/sessions/`。
- 日志：使用 CrawClaw Desktop 日志或主机日志收集获取 Gateway 进程日志。
- 重新关联流程：当日志中出现认证状态码或 `loggedOut` 时，使用渠道设置面板。

## 健康监控配置

- `gateway.channelHealthCheckMinutes`：Gateway 检查渠道健康状况的频率。
- `gateway.channelStaleEventThresholdMinutes`：已连接渠道在重启前可以保持空闲的最长时间。
- `gateway.channelMaxRestartsPerHour`：每个渠道/账户的一小时滚动重启上限。
- `channels.<provider>.healthMonitor.enabled`：按渠道覆盖。
- `channels.<provider>.accounts.<accountId>.healthMonitor.enabled`：按账户覆盖。

## 故障排除

- **Gateway 无法访问** — 从 CrawClaw Desktop 重启并验证嵌入式 Rust 运行时已就绪。
- **渠道已登出** — 从 Desktop 渠道设置重新关联账户。
- **无入站消息** — 确认发送者白名单和群聊 @ 规则。

有关 API 级别的详细信息，请参阅 [Gateway 协议](/gateway/protocol) 和
[Gateway 故障排除](/gateway/troubleshooting)。
