---
read_when:
  - 连接消息渠道
  - 更新渠道文档、配对、允许列表或路由行为
summary: 消息渠道架构、内置原生渠道和共享 Gateway 路由模型
title: 渠道
x-i18n:
  generated_at: "2026-05-22T02:58:19Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: efdfb948f5fd0054eafeaf6bdb12264ad648917ca7996cc9d258e8d35b180294
  source_path: channels/index.md
  workflow: 15
---

# 渠道

CrawClaw 渠道将外部对话连接到本地 Gateway。CrawClaw Desktop 拥有设置和状态界面；Gateway 拥有认证、路由、会话绑定和投递；Rust 渠道契约拥有原生渠道能力和 Desktop 配置元数据。

## 当前架构

- 原生渠道能力描述符位于 `crates/crawclaw-channels`。
- Desktop 渠道配置字段从同一渠道目录读取。
- 捆绑插件仍可通过清单和 Rust 原生描述符贡献渠道相关能力。
- TypeScript 渠道钩子不是公开的生产契约。

## 内置原生渠道

| 渠道     | 用途                          | 备注                              |
| -------- | ----------------------------- | --------------------------------- |
| DingTalk | DingTalk 机器人控制平面       | Rust 原生配置和生命周期接口       |
| Feishu   | Feishu 或 Lark 机器人控制平面 | Rust 原生配置和生命周期接口       |
| ESP32    | ESP32 设备配对和投递          | Rust 原生设备渠道                 |
| QQ Bot   | QQ 机器人控制平面             | Rust 原生配置和生命周期接口       |
| Weixin   | Weixin QR 登录渠道            | Rust 原生 Desktop 和 Gateway 接口 |

## 访问控制和激活

渠道访问通过 Gateway 安全设置和渠道自有设置进行配置。使用配对实现私有访问，使用允许列表管理房间或发送者策略，以及多智能体路由来映射不同发送者或房间到对应智能体。

## 私信和群组的访问控制

私信和群组对话使用相同的 Gateway 信任边界，但应分别审查。私信通常需要配对或明确的发送者允许列表。群组通常需要房间允许列表、提及策略和智能体路由规则。

## 反应通知

反应行为因渠道而异。Feishu 和类似渠道通过渠道配置和本地 Gateway 状态公开反应通知设置。

## 反应级别

Weixin 和其他渠道在支持类反应事件时可能公开反应级别设置。请将这些设置保留在所属渠道界面下，而不是向核心工具添加提供商特定行为。

## 相关

- [配对](/channels/pairing)
- [渠道路由](/channels/channel-routing)
- [群组](/channels/groups)
- [渠道故障排除](/channels/troubleshooting)
