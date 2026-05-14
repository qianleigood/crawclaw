---
read_when:
  - 渠道已连接但消息无法流通
  - 排查渠道配置错误（意图、权限、隐私模式）
summary: 渠道专属故障排除快捷指南
title: 渠道故障排除
x-i18n:
  generated_at: "2026-02-01T19:58:09Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 6542ee86b3e50929caeaab127642d135dfbc0d8a44876ec2df0fff15bf57cd63
  source_path: channels/troubleshooting.md
  workflow: 14
---

# 渠道故障排除

本仓库中的捆绑 TypeScript 渠道插件已经移除。该页面只保留 Rust-native 渠道适配器重新引入前的共享 Gateway 检查。

首先运行：

```bash
crawclaw doctor
crawclaw channels status --probe
```

`channels status --probe` 会在 Rust-native 渠道适配器安装后输出运行状态和探测结果。
