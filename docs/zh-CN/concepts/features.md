---
read_when:
  - 你想了解 CrawClaw 支持的全部功能
summary: CrawClaw 跨渠道、路由、媒体和用户体验的功能
title: 功能
x-i18n:
  generated_at: "2026-06-05T14:12:31Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: d59753dbe7546e0cb1e62418d4d6360c690e87ca58cd71f7c7f1e9ead8cec2ec
  source_path: concepts/features.md
  workflow: 15
---

# 功能

## 亮点

<Columns>
  <Card title="渠道" icon="message-square">
    通过单一 Gateway 网关支持飞书、社区聊天和 Weixin。
  </Card>
  <Card title="插件" icon="plug">
    通过扩展添加原生渠道等功能。
  </Card>
  <Card title="路由" icon="route">
    多智能体路由，支持独立会话。
  </Card>
  <Card title="媒体" icon="image">
    支持图片、音频和文档的输入输出。
  </Card>
</Columns>

## 完整列表

**渠道：**

- Weixin、飞书、社区聊天、Weixin（内置）
- 飞书、QQBot、DingTalk、Weixin 和 ESP32
- 支持群聊，通过 @ 激活
- 私信安全，支持白名单和配对

**智能体：**

- Rust 智能体运行时，支持工具流式传输
- 多智能体路由，每个工作区或发送者对应独立会话
- 会话：单聊合并到共享 `main`；群聊独立隔离
- 流式传输和分块处理长响应

**认证和提供商：**

- 35+ 模型提供商（Anthropic、OpenAI、Google 等）
- 通过 OAuth 进行订阅认证（如 OpenAI Codex）
- 支持自定义和自托管提供商（vLLM、SGLang、Ollama，以及任何兼容 OpenAI 或 Anthropic 的端点）

**媒体：**

- 图片、音频、视频和文档的输入输出
- 语音笔记转录
- 语音合成，支持多提供商

**工具和自动化：**

- 网页搜索（内置 SearXNG）
- 定时任务和事件驱动的主会话唤醒
- Skills、插件和工作流管道（Lobster）
