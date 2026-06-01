---
read_when:
  - 诊断 channel connectivity 或 gateway health
  - 了解 desktop health checks 和 Gateway API probes
summary: 通过 CrawClaw Desktop 和 Gateway API 进行 Gateway health monitoring
title: Health Checks
x-i18n:
  generated_at: "2026-02-03T07:47:59Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 74f242e98244c135e1322682ed6b67d70f3b404aca783b1bb5de96a27c2c1b01
  source_path: gateway/health.md
  workflow: 15
---

# Health Checks

正常 health view 使用 CrawClaw Desktop。自动化或外部 monitoring 使用 Gateway API。

## 快速检查

- **Desktop status** — local Gateway reachability、runtime status、linked auth、sessions 和 recent activity。
- **Desktop diagnostics** — paste-safe troubleshooting data 和 log access。
- **Gateway health API** — 面向自动化的 machine-readable health snapshots。
- **Channel probes** — 需要深入诊断时，对受支持 channels 执行 live checks。

## 深度诊断

- 磁盘上的 credentials：`~/.crawclaw/credentials/<channel>/<accountId>/`。
- Session store：`~/.crawclaw/agents/<agentId>/sessions/`。
- Logs：使用 CrawClaw Desktop logs 或 host log collection 查看 Gateway process。
- Relink flow：当 logs 中出现 auth status codes 或 `loggedOut` 时，使用 channel settings panel 重新链接。

## Health monitor config

- `gateway.channelHealthCheckMinutes`：Gateway 检查 channel health 的频率。
- `gateway.channelStaleEventThresholdMinutes`：connected channel 在 restart 前可保持 idle 的时间。
- `gateway.channelMaxRestartsPerHour`：每个 channel/account 的 rolling one-hour restart cap。
- `channels.<provider>.healthMonitor.enabled`：per-channel override。
- `channels.<provider>.accounts.<accountId>.healthMonitor.enabled`：per-account override。

## 失败时

- **Gateway unreachable** — 从 CrawClaw Desktop 重启，并确认 embedded Rust runtime 已就绪。
- **Channel logged out** — 从 desktop channel settings 重新链接账号。
- **No inbound messages** — 确认 sender allowlists 和 group mention rules。

API 级细节见 [Gateway protocol](/gateway/protocol) 和 [Gateway troubleshooting](/gateway/troubleshooting)。
