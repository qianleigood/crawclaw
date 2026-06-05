---
read_when:
  - 你想了解哪些功能可能调用付费 API
  - 你需要审计密钥、成本和用量可见性
  - 你在解释 /status 或 /usage 成本报告
summary: 审计哪些功能可以消费资金、哪些密钥被使用以及如何查看用量
title: API 使用与成本
x-i18n:
  generated_at: "2026-06-05T14:46:38Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 5f6cd16d5f77af48a10f8630d7623de537ab8ced1d888c38ddf098c3462f93de
  source_path: reference/api-usage-costs.md
  workflow: 15
---

# API 使用与成本

本文档列出了**可以调用 API 密钥的功能**及其成本显示位置。它专注于可能产生提供商使用量或付费 API 调用的 CrawClaw 功能。

## 成本显示位置（聊天 + CLI）

**每个会话的成本快照**

- `/status` 显示当前会话模型、上下文使用量和上次回复 token。
- 如果模型使用 **API 密钥认证**，`/status` 还会显示上次回复的**预估成本**。

**每条消息的成本页脚**

- `/usage full` 在每条回复后附加用量页脚，包括**预估成本**（仅限 API 密钥）。
- `/usage tokens` 仅显示 token；OAuth 流程隐藏美元成本。

**提供商用量窗口**

- CrawClaw Desktop 和本地 Gateway API 显示提供商**用量窗口**（配额快照，非每条消息成本）。

详情和示例请参见 [Token 使用与成本](/reference/token-use)。

## 密钥如何被发现

CrawClaw 可以从以下来源获取凭证：

- **认证配置**（每个智能体，存储在 `auth-profiles.json`）。
- **环境变量**（例如 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`）。
- **配置**（`models.providers.*.apiKey`、`plugins.entries.*.config.*`、`talk.providers.*.apiKey`）。
- **Skills**（`skills.entries.<name>.apiKey`），可能将密钥导出到 skill 进程环境。

## 可以消费密钥的功能

### 1) 核心模型响应（聊天 + 工具）

每次回复或工具调用都使用**当前模型提供商**（OpenAI、Anthropic 等）。这是主要的使用量和成本来源。

定价配置请参见 [Models](/providers/models)，显示请参见 [Token 使用与成本](/reference/token-use)。

### 2) 媒体理解（音频/图像/视频）

入站媒体可以在回复运行前进行摘要/转录。这使用模型/提供商 API。

- 音频：OpenAI / Groq / Deepgram（现在当密钥存在时**自动启用**）。
- 图像：OpenAI / Anthropic / Google。
- 视频：Google。

参见 [媒体输入输出](/start/crawclaw#media-in-and-out)。

### 3) 记忆

内置记忆运行时可以为持久化提取、经验提取、梦境整合和会话摘要调用配置的 LLM 角色。Hindsight 集成在启用时也可以调用你配置的 Hindsight HTTP 端点。

参见 [记忆](/concepts/memory)。

### 4) Web 搜索工具

`web_search` 默认使用捆绑的托管 SearXNG 路径，不需要提供商 API 密钥。当你明确启用提供商原生的 Codex web 搜索模式时，原生提供商 web 搜索仍然可以消耗模型提供商配额。

参见 [Web 搜索](/tools/web)。

### 5) Web 获取工具

`web_fetch` 使用活跃的获取提供商，或在没有配置提供商时回退到直接获取 + readability。

参见 [Web 工具](/tools/web)。

### 6) 提供商用量快照（状态/健康）

某些状态命令调用**提供商用量端点**以显示配额窗口或认证健康状况。这些通常是低容量调用，但仍然会访问提供商 API：

- CrawClaw Desktop 或本地 Gateway API
- CrawClaw Desktop 或本地 Gateway API

参见 [Models](/concepts/models)。

### 7) 压缩保护摘要

压缩保护可以使用**当前模型**摘要会话历史，这在运行时调用提供商 API。

参见 [会话管理 + 压缩](/reference/session-management-compaction)。

### 8) 模型扫描/探测

CrawClaw Desktop 或本地 Gateway API 可以探测 OpenRouter 模型，并在启用探测时使用 `OPENROUTER_API_KEY`。

参见 [Models](/concepts/models)。

### 9) Talk（语音）

Talk 模式默认使用捆绑的 Rust 原生 `qwen3-tts` 提供商。它不会从产品运行时调用 ElevenLabs、Microsoft 或 OpenAI 语音 API。

参见 [TTS](/tools/tts)。

### 10) Skills（第三方 API）

Skills 可以在 `skills.entries.<name>.apiKey` 中存储 `apiKey`。如果 skill 使用该密钥进行外部 API 调用，则可能根据 skill 的提供商产生成本。

参见 [Skills](/tools/skills)。
