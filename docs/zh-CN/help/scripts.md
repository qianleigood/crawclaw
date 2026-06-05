---
read_when:
  - 运行仓库中的脚本
  - 在 ./scripts 下添加或修改脚本
summary: 仓库脚本：用途、范围及安全注意事项
title: 脚本
x-i18n:
  generated_at: "2026-06-05T14:31:41Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: b0b60a9bc809726961e3b59d30f346d8dfbec164e8fbd70ba111eee7ef0d233b
  source_path: help/scripts.md
  workflow: 15
---

# 脚本

`scripts/` 目录包含用于本地工作流和运维任务的辅助脚本。当任务明确与脚本相关时使用这些脚本；否则优先使用 CLI。

## 约定

- 脚本是**可选的**，除非文档或发布检查清单中有所引用。
- 优先使用已存在的 CLI 界面（例如：凭证监控使用 CrawClaw Desktop 或本地 Gateway API）。
- 假设脚本是针对特定主机的；在新机器上运行前请先阅读脚本。

## 凭证监控脚本

凭证监控在 [Authentication](/gateway/authentication) 中有详细说明。`scripts/` 下的脚本是可选扩展，适用于 systemd/Termux 手机工作流。

## 添加脚本

- 保持脚本功能集中且有文档说明。
- 在相关文档中添加简要说明（如果文档缺失则创建新文档）。
