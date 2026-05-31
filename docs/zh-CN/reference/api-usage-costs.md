---
read_when:
  - 你想了解哪些功能会调用付费 API
  - 你需要审计密钥、成本和用量可见性
  - 你在解释 /status 或 /usage 成本报告
summary: 审计什么会花钱、哪些密钥被使用以及如何查看用量
title: API 用量与成本
x-i18n:
  generated_at: "2026-05-22T03:01:37Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: acdd769e33560b67111b277f840053688a1b022593833b5431ba6528efdea4a3
  source_path: reference/api-usage-costs.md
  workflow: 15
---

# API 用量与成本

本文列出了**会调用 API 密钥的功能**及其成本显示位置。重点介绍可能产生提供商用量或付费 API 调用的 CrawClaw 功能。

## 成本显示位置（聊天 + CLI）

**每会话成本快照**

- `/status` 显示当前会话模型、上下文用量和最后回复的 token 数。
- 如果模型使用 **API 密钥认证**， `/status` 还会显示最后回复的**预估成本**。

**每条消息成本页脚**

- `/usage full` 在每条回复后附加用量页脚，包括**预估成本**（仅限 API 密钥）。
- `/usage tokens` 仅显示 token 数；OAuth 流程会隐藏美元成本。

**CLI 用量窗口（提供商配额）**

- CrawClaw Desktop 或 local loopback Gateway API 和 CrawClaw Desktop 或 local loopback Gateway API 显示提供商**用量窗口**
  （配额快照，非每条消息成本）。

详见 [Token 使用与成本](/reference/token-use)。

## 密钥如何被发现

CrawClaw 可以从以下来源获取凭证：

- **Auth profiles**（每个智能体，存储在 `auth-profiles.json` 中）。
- **环境变量**（例如 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`）。
- **Config**（`models.providers.*.apiKey`、`plugins.entries.*.config.*`、
  `talk.providers.*.apiKey`）。
- **Skills**（`skills.entries.<name>.apiKey`），可以导出密钥到 skill 进程环境。

## 可能消耗密钥的功能

### 1) 核心模型响应（聊天 + 工具）

每次回复或工具调用都使用**当前模型提供商**（OpenAI、Anthropic 等）。这是用量和成本的主要来源。

详见 [模型](/providers/models) 的定价配置和 [Token 使用与成本](/reference/token-use) 的显示说明。

### 2) 媒体理解（音频/图片/视频）

入站媒体可以在回复运行前进行摘要/转录。这会使用模型/提供商 API。

- 音频：OpenAI / Groq / Deepgram（现在**密钥存在时自动启用**）。
- 图片：OpenAI / Anthropic / Google。
- 视频：Google。

详见 [媒体输入输出](/start/crawclaw#media-in-and-out)。

### 3) 记忆

内置记忆运行时可以调用配置的 LLM 角色进行持久提取、经验提取、梦境整合和会话摘要。
Hindsight 集成在启用时会调用配置的 Hindsight HTTP 服务。

详见 [记忆](/concepts/memory)。

### 4) Web 搜索工具

`web_search` 默认使用捆绑的托管 SearXNG 路径，不需要提供商 API 密钥。
当你明确启用提供商原生的 Codex web search 模式时，本机提供商 web 搜索仍会消耗模型提供商配额。

详见 [Web 搜索](/tools/web)。

### 5) Web 获取工具

`web_fetch` 使用活动的获取提供商，或在没有配置提供商时回退到直接获取 + readability。

详见 [Web 工具](/tools/web)。

### 6) 提供商用量快照（状态/健康）

某些状态命令会调用**提供商用量端点**以显示配额窗口或认证健康状态。
这些通常是低频调用，但仍会访问提供商 API：

- CrawClaw Desktop 或 local loopback Gateway API
- CrawClaw Desktop 或 local loopback Gateway API

详见 [模型](/concepts/models)。

### 7) 压缩保护摘要

压缩保护可以使用**当前模型**对会话历史进行摘要，这会在运行时调用提供商 API。

详见 [会话管理 + 压缩](/reference/session-management-compaction)。

### 8) 模型扫描/探测

CrawClaw Desktop 或 local loopback Gateway API 可以探测 OpenRouter 模型，并在启用探测时使用 `OPENROUTER_API_KEY`。

详见 [模型](/concepts/models)。

### 9) Talk（语音）

Talk 模式默认使用捆绑的 Rust 原生 `qwen3-tts` 提供商。
它不会从产品运行时调用 ElevenLabs、Microsoft 或 OpenAI 语音 API。

详见 [TTS](/tools/tts)。

### 10) Skills（第三方 API）

Skills 可以在 `skills.entries.<name>.apiKey` 中存储 `apiKey`。如果某个 skill 使用该密钥调用外部 API，则会根据 skill 的提供商产生成本。

详见 [Skills](/tools/skills)。
