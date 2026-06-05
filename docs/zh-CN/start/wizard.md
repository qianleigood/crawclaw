---
read_when:
  - 运行或配置桌面新手引导
  - 设置新机器
sidebarTitle: Desktop Onboarding
summary: Desktop 新手引导：Gateway、工作区、渠道、模型和 Skills 设置
title: Desktop 新手引导
x-i18n:
  generated_at: "2026-06-05T14:49:23Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 8ac7c28017a9c49e6d524facf746bfb34528e8dc44f08cd3b3291036c307657b
  source_path: start/wizard.md
  workflow: 15
---

# Desktop 新手引导

CrawClaw Desktop 是支持的 Apple 平台设置界面。使用该应用配置认证、本地 Gateway 状态、工作区默认值、渠道、插件、
Skills、日志和诊断。

公共 `crawclaw` 命令已停用。自动化应直接调用本地 Gateway API。

## 快速开始 vs 高级

新手引导以**快速开始**开始以获得安全的本地默认值，**高级**用于显式控制。

<Tabs>
  <Tab title="快速开始">
    - 本地 Gateway 在 local loopback 上
    - Desktop 管理的随机端口
    - Desktop 管理的令牌认证
    - 工作区在 `~/.crawclaw` 下
    - 捆绑的 Rust 运行时和原生插件
  </Tab>
  <Tab title="高级">
    - 显式工作区、模型、渠道、插件和记忆设置
    - Gateway API 自动化以实现可重复设置
    - 应用敏感更改前直接审查配置
  </Tab>
</Tabs>

## 新手引导配置什么

1. **模型/认证** — 选择支持的提供商/认证流程和默认模型。
2. **工作区** — 选择智能体文件和引导状态所在的位置。
3. **Gateway 网关** — 启动和监控嵌入式 Rust Gateway。
4. **渠道** — 连接支持的消息表面。
5. **输出和呈现** — 设置回复可见性和流式传输默认值。
6. **记忆/体验** — 启用本地捕获、召回和维护流程。
7. **Skills 和插件** — 启用捆绑的 Skills 和桌面支持的插件。
8. **健康检查** — 验证本地 Gateway 和运行时已就绪。

## 稍后重新配置

使用 CrawClaw Desktop 设置进行正常更改。使用 Gateway API 进行自动化、配置修补、状态、健康检查、会话和插件操作。

## 相关文档

- [新手引导概览](/start/onboarding-overview)
- [Desktop 安装](/install/desktop)
- [Gateway 协议](/gateway/protocol)
- [Gateway 故障排除](/gateway/troubleshooting)
