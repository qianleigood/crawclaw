---
read_when:
  - 选择支持的设置路径
  - 设置新环境
sidebarTitle: Onboarding Overview
summary: CrawClaw Desktop onboarding 和 Gateway API 设置概览
title: Onboarding Overview
x-i18n:
  generated_at: "2026-03-16T06:27:56Z"
  model: gpt-5.4
  provider: openai
  source_hash: 8a22945f0780515be7ec1b94b5ff486828cf9b8f060ab598a31eb17ee0a5c60b
  source_path: start/onboarding-overview.md
  workflow: 15
---

# Onboarding Overview

CrawClaw onboarding 现在从 Apple 平台上的 **CrawClaw Desktop** 开始。Desktop app 拥有 model auth、workspace defaults、Gateway lifecycle、plugins、channels、diagnostics 和 local runtime state。

自动化和 headless 集成应使用本地 Gateway API，而不是公共 `crawclaw` 命令。

## 应该使用哪条路径？

| Path             | Best for                                          |
| ---------------- | ------------------------------------------------- |
| CrawClaw Desktop | Normal setup, settings, model auth, plugins, logs |
| Gateway API      | Local automation and integration control planes   |
| Config files     | Reviewable advanced changes under `~/.crawclaw`   |

## Onboarding 会配置什么

Desktop setup 会配置：

1. **Model provider and auth** — 为选定 provider 配置 API key、OAuth 或 setup token。
2. **Workspace** — agent files、bootstrap templates 和 memory 的目录。
3. **Gateway** — loopback bind、auth mode、local runtime state 和 health。
4. **Channels** — desktop Gateway 暴露的受支持 message channels。
5. **Plugins and tools** — bundled Rust-native plugins 和 managed native tool runtimes。
6. **Memory and experience** — local capture、recall 和 maintenance settings。

## 自动化

脚本化设置、config patching、status、health、session 和 plugin operations 使用 Gateway API。Desktop 和自动化共享同一个本地 Gateway control plane，因此行为保持一致。

相关文档：

- [Desktop install](/install/desktop)
- [Gateway protocol](/gateway/protocol)
- [Gateway troubleshooting](/gateway/troubleshooting)
