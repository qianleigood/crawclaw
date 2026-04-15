---
read_when:
  - 设置认证过期监控或告警
  - 自动化 Claude Code / Codex OAuth 刷新检查
summary: 监控模型提供商的 OAuth 过期状态
title: 认证监控
x-i18n:
  generated_at: "2026-02-03T10:03:53Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: eef179af9545ed7ab881f3ccbef998869437fb50cdb4088de8da7223b614fa2b
  source_path: automation/auth-monitoring.md
  workflow: 15
---

# 认证监控

CrawClaw 通过 `crawclaw models status` 提供 OAuth 过期健康状态。请使用该命令进行自动化和告警；脚本层现在只保留通用的定时监控和 systemd 集成。

## 推荐方式：CLI 检查（可移植）

```bash
crawclaw models status --check
```

退出码：

- `0`：正常
- `1`：凭证过期或缺失
- `2`：即将过期（24 小时内）

此方式适用于 cron/systemd，无需额外脚本。

## 可选脚本（运维）

这些脚本位于 `scripts/` 目录下，属于**可选**内容。它们假定你在 Gateway 网关主机本地运行，或者通过 SSH 维护这台主机，并针对 systemd 用户定时器做了调优。

- `scripts/claude-auth-status.sh` 现在使用 `crawclaw models status --json` 作为数据来源（如果 CLI 不可用则回退到直接读取文件），因此请确保 `crawclaw` 在定时器的 `PATH` 中。
- `scripts/auth-monitor.sh`：cron/systemd 定时器目标；发送告警（ntfy 或手机）。
- `scripts/systemd/crawclaw-auth-monitor.{service,timer}`：systemd 用户定时器。
- `scripts/claude-auth-status.sh`：Claude Code + CrawClaw 认证检查器（完整/json/简洁模式）。

如果你不需要定时监控或 systemd 定时器，可以跳过这些脚本。
