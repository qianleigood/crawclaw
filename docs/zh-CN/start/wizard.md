---
read_when:
  - 运行或配置 desktop onboarding
  - 设置一台新机器
sidebarTitle: "Desktop Onboarding"
summary: Desktop onboarding：用于 Gateway、workspace、channels、models 和 skills 的设置
title: Desktop Onboarding
x-i18n:
  generated_at: "2026-03-16T06:28:38Z"
  model: gpt-5.4
  provider: openai
  source_hash: 99fd87dddd78798eb0087ad9433e5a32de2af110b6e65ee351b1a194a11c7df3
  source_path: start/wizard.md
  workflow: 15
---

# Desktop Onboarding

CrawClaw Desktop 是当前支持的 Apple-platform 设置界面。使用 app 配置 auth、本地 Gateway state、workspace defaults、channels、plugins、skills、logs 和 diagnostics。

公共 `crawclaw` 命令已退役。自动化应直接调用本地 Gateway API。

## QuickStart 与 Advanced

Onboarding 从 **QuickStart** 开始以提供安全的本地默认值；需要明确控制时使用 **Advanced**。

<Tabs>
  <Tab title="QuickStart">
    - Local Gateway on loopback
    - Desktop-managed random port
    - Desktop-managed token auth
    - Workspace under `~/.crawclaw`
    - Bundled Rust runtime and native plugins
  </Tab>
  <Tab title="Advanced">
    - Explicit workspace, model, channel, plugin, and memory settings
    - Gateway API automation for repeatable setup
    - Direct config review before applying sensitive changes
  </Tab>
</Tabs>

## Onboarding 会配置什么

1. **Model/Auth** — 选择受支持的 provider/auth flow 和默认模型。
2. **Workspace** — 选择 agent files 和 bootstrap state 的位置。
3. **Gateway** — 启动并监控 embedded Rust Gateway。
4. **Channels** — 连接支持的 messaging surfaces。
5. **Output and presentation** — 设置 reply visibility 和 streaming defaults。
6. **Memory / Experience** — 启用本地 capture、recall 和 maintenance flows。
7. **Skills and plugins** — 启用 bundled skills 和 desktop-supported plugins。
8. **Health check** — 验证本地 Gateway 和 runtime 已就绪。

## 稍后重新配置

常规更改使用 CrawClaw Desktop settings。自动化、config patching、status、health、sessions 和 plugin operations 使用 Gateway API。

## 相关文档

- [Onboarding overview](/start/onboarding-overview)
- [Desktop install](/install/desktop)
- [Gateway protocol](/gateway/protocol)
- [Gateway troubleshooting](/gateway/troubleshooting)
