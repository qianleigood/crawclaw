---
read_when:
  - 选择支持的设置路径
  - 设置新环境
sidebarTitle: Onboarding Overview
summary: CrawClaw Desktop 新手引导和 Gateway API 设置概览
title: 新手引导概览
x-i18n:
  generated_at: "2026-06-05T14:49:10Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: ac4786d1385162f66ca3b03f1165d03df96f9cba11722ac1ff63006c32617dc8
  source_path: start/onboarding-overview.md
  workflow: 15
---

# 新手引导概览

CrawClaw 新手引导现在在 Apple 平台的 **CrawClaw Desktop** 中开始。桌面应用拥有模型认证、工作区默认值、Gateway 生命周期、插件、渠道、诊断和本地运行时状态。

自动化和无头集成应改用本地 Gateway API，而非公共 `crawclaw` 命令。

## 我应该使用哪个路径？

| 路径             | 最适合                               |
| ---------------- | ------------------------------------ |
| CrawClaw Desktop | 正常设置、设置、模型认证、插件、日志 |
| Gateway API      | 本地自动化和集成控制平面             |
| 配置文件         | 在 `~/.crawclaw` 下可审查的高级更改  |

## 新手引导配置什么

桌面设置配置：

1. **模型提供商和认证** — 你所选提供商的 API key、OAuth 或设置令牌。
2. **工作区** — 智能体文件、引导模板和记忆的目录。
3. **Gateway 网关** — local loopback 绑定、认证模式、本地运行时状态和健康检查。
4. **渠道** — 桌面 Gateway 暴露的支持的消息渠道。
5. **插件和工具** — 捆绑的 Rust 原生插件加上托管的原生工具运行时。
6. **记忆和体验** — 本地捕获、召回和维护设置。

## 自动化

使用 Gateway API 进行脚本化设置、配置修补、状态、健康检查、
会话和插件操作。Desktop 和自动化共享相同的本地
Gateway 控制平面，以保持行为一致。

相关文档：

- [Desktop 安装](/install/desktop)
- [Gateway 协议](/gateway/protocol)
- [Gateway 故障排除](/gateway/troubleshooting)
