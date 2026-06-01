---
read_when:
  - 你想了解 CrawClaw 支持的完整功能列表
summary: CrawClaw 在渠道、路由、媒体和用户体验方面的功能。
title: 功能
x-i18n:
  generated_at: "2026-02-04T17:53:22Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 1b6aee0bfda751824cb6b3a99080b4c80c00ffb355a96f9cff1b596d55d15ed4
  source_path: concepts/features.md
  workflow: 15
---

## 亮点

<Columns>
  <Card title="渠道" icon="message-square">
    通过单个 Gateway 网关支持 Weixin、Feishu、QQBot 和 Weixin。
  </Card>
  <Card title="插件" icon="plug">
    通过扩展添加 Feishu 等更多平台。
  </Card>
  <Card title="路由" icon="route">
    多智能体路由，支持隔离会话。
  </Card>
  <Card title="媒体" icon="image">
    支持图片、音频和文档的收发。
  </Card>
  <Card title="Gateway 客户端" icon="monitor">
    CLI、TUI、自动化和浏览器来源客户端。
  </Card>
  <Card title="节点模式" icon="smartphone">
    macOS 节点模式与无头节点，支持 Canvas 和远程命令。
  </Card>
</Columns>

## 完整列表

- 多渠道 Gateway 控制平面，统一管理会话、路由、presence 和节点
- 通过 Weixin Web（Baileys）集成 Weixin
- Feishu 机器人支持（grammY）
- QQBot 机器人支持（channels.qqbot.js）
- Feishu 机器人支持（插件）
- 通过本地 imsg CLI 集成 Weixin（macOS）
- Rust agent runtime，支持工具流式传输
- 长响应的流式传输和分块处理
- 多智能体路由，按工作区或发送者隔离会话
- built-in memory runtime：durable memory、session summary、dream、knowledge recall
- special agent substrate：verification、memory-extraction、session-summary、dream
- workflow 运行链：本地注册、执行同步、渠道回投、resume/cancel/status
- Action Feed / execution visibility：统一展示 tool、workflow 和过程事件
- 通过 OAuth 进行 Anthropic 和 OpenAI 的订阅认证
- 会话：私信合并为共享的 `main`；群组相互隔离
- 群聊支持，通过提及激活
- 图片、音频和文档的媒体支持
- 可选的语音消息转录钩子
- macOS 节点模式，支持配对、Canvas、相机和远程命令
- 无头节点主机，支持配对和 `system.run`
- ACP / 控制平面互操作，用于外部 agent 和运行时桥接

## 建议配套阅读

- 如果你要看项目整体结构： [项目整体架构总览](/concepts/project-architecture-overview)
- 如果你要看智能体运行细节： [智能体运行时](/concepts/agent)
- 如果你要看记忆层： [记忆](/concepts/memory)

<Note>
旧版 Claude、Codex、Gemini 和 Opencode 专用运行路径已被移除。CrawClaw 的生产 agent 执行路径由 Rust runtime 拥有。
</Note>
