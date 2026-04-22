---
read_when:
  - 了解 CrawClaw 中 Pi SDK 集成设计
  - 修改 Pi 智能体会话生命周期、工具或提供商布线
summary: CrawClaw 嵌入式 Pi 智能体集成与会话生命周期的架构
title: Pi 集成架构
x-i18n:
  generated_at: "2026-04-21T13:26:16Z"
  model: MiniMax-M2.7
  provider: minimax
  source_hash: 989feea2e7b77969a0d127298b8e333533ec47330116b5b98adfdf4efc6cb5f6
  source_path: pi.md
  workflow: 15
---

# Pi 集成架构

本文档描述了 CrawClaw 如何与 [pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) 及其兄弟包（`pi-ai`、`pi-agent-core`、`pi-tui`）集成，以提供其 AI 智能体能力。

## 概述

CrawClaw 使用 pi SDK 将 AI 编程智能体嵌入到其消息网关架构中。CrawClaw 不是将 pi 作为子进程启动或使用 RPC 模式，而是直接通过 `createAgentSession()` 导入并实例化 pi 的 `AgentSession`。这种嵌入式方法提供：

- 对会话生命周期和事件处理的完全控制
- 自定义工具注入（消息、沙箱、渠道特定操作）
- 每个渠道/上下文的系统提示自定义
- 支持分支/压缩的会话持久化
- 多账户认证配置文件轮换及故障转移
- 与提供商无关的模型切换

## 包依赖

```json
{
  "@mariozechner/pi-agent-core": "0.68.0",
  "@mariozechner/pi-ai": "0.68.0",
  "@mariozechner/pi-coding-agent": "0.68.0",
  "@mariozechner/pi-tui": "0.68.0"
}
```

| 包                | 用途                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `pi-ai`           | 核心 LLM 抽象：`Model`、`streamSimple`、消息类型、提供商 API                               |
| `pi-agent-core`   | 智能体循环、工具执行、`AgentMessage` 类型                                                  |
| `pi-coding-agent` | 高级 SDK：`createAgentSession`、`SessionManager`、`AuthStorage`、`ModelRegistry`、内置工具 |
| `pi-tui`          | 终端 UI 组件（用于 CrawClaw 的本地 TUI 模式）                                              |

## 文件结构

```
src/agents/
├── pi-embedded-runner.ts          # 从 pi-embedded-runner/ 重导出
├── pi-embedded-runner/
│   ├── run.ts                     # 主入口：runEmbeddedPiAgent()
│   ├── run/
│   │   ├── attempt.ts             # 单次尝试逻辑，包含会话设置
│   │   ├── params.ts              # RunEmbeddedPiAgentParams 类型
│   │   ├── payloads.ts            # 从运行结果构建响应负载
│   │   ├── images.ts              # 视觉模型图像注入
│   │   └── types.ts               # EmbeddedRunAttemptResult
│   ├── abort.ts                   # 中止错误检测
│   ├── cache-ttl.ts               # 上下文修剪的缓存 TTL 追踪
│   ├── compact.ts                 # 手动/自动压缩逻辑
│   ├── extensions.ts              # 为嵌入式运行加载 pi 扩展
│   ├── extra-params.ts            # 提供商特定的流参数
│   ├── google.ts                  # Google/Gemini 轮次排序修复
│   ├── history.ts                 # 历史限制（私信 vs 群组）
│   ├── lanes.ts                   # 会话/全局命令通道
│   ├── logger.ts                  # 子系统日志记录器
│   ├── model.ts                   # 通过 ModelRegistry 进行模型解析
│   ├── runs.ts                    # 活动运行追踪、中止、队列
│   ├── sandbox-info.ts           # 系统提示的沙箱信息
│   ├── session-manager-cache.ts   # SessionManager 实例缓存
│   ├── session-manager-init.ts    # 会话文件初始化
│   ├── system-prompt.ts           # 系统提示构建器
│   ├── tool-split.ts              # 将工具拆分为 builtIn vs custom
│   ├── types.ts                  # EmbeddedPiAgentMeta、EmbeddedPiRunResult
│   └── utils.ts                   # ThinkLevel 映射、错误描述
├── pi-embedded-subscribe.ts       # 会话事件订阅/分发
├── pi-embedded-subscribe.types.ts # SubscribeEmbeddedPiSessionParams
├── pi-embedded-subscribe.handlers.ts # 事件处理器工厂
├── pi-embedded-subscribe.handlers.lifecycle.ts
├── pi-embedded-subscribe.handlers.types.ts
├── pi-embedded-block-chunker.ts   # 流式阻止回复分块
├── pi-embedded-messaging.ts       # 消息工具发送追踪
├── pi-embedded-helpers.ts         # 错误分类、轮次验证
├── pi-embedded-helpers/           # 辅助模块
├── pi-embedded-utils.ts           # 格式化工具
├── pi-tools.ts                    # createCrawClawCodingTools()
├── pi-tools.abort.ts              # 工具的 AbortSignal 包装
├── pi-tools.policy.ts             # 工具白名单/黑名单策略
├── pi-tools.read.ts               # 读取工具自定义
├── pi-tools.schema.ts             # 工具 schema 规范化
├── pi-tools.types.ts              # AnyAgentTool 类型别名
├── pi-tool-definition-adapter.ts  # AgentTool -> ToolDefinition 适配器
├── pi-settings.ts                 # 设置覆盖
├── pi-hooks/                      # 自定义 pi 钩子
│   ├── compaction-safeguard.ts    # 保护扩展
│   ├── compaction-safeguard-runtime.ts
│   ├── context-pruning.ts         # 基于缓存 TTL 的上下文修剪扩展
│   └── context-pruning/
├── model-auth.ts                  # 认证配置文件解析
├── auth-profiles.ts               # 配置文件存储、冷启动、故障转移
├── model-selection.ts             # 默认模型解析
├── models-config.ts               # models.json 生成
├── model-catalog.ts               # 模型目录缓存
├── context-window-guard.ts        # 上下文窗口验证
├── failover-error.ts              # FailoverError 类
├── defaults.ts                    # DEFAULT_PROVIDER、DEFAULT_MODEL
├── system-prompt.ts               # buildAgentSystemPrompt()
├── system-prompt-params.ts        # 系统提示参数解析
├── system-prompt-report.ts        # 调试报告生成
├── tool-summaries.ts              # 工具描述摘要
├── tool-policy.ts                 # 工具策略解析
├── transcript-policy.ts           # 转录验证策略
├── skills.ts                      # 技能快照/提示构建
├── skills/                        # 技能子系统
├── sandbox.ts                     # 沙箱上下文解析
├── sandbox/                       # 沙箱子系统
├── channel-tools.ts               # 渠道特定工具注入
├── crawclaw-tools.ts              # CrawClaw 特定工具
├── bash-tools.ts                  # exec/process 工具
├── apply-patch.ts                 # apply_patch 工具（OpenAI）
├── tools/                         # 各个工具实现
│   ├── browser-tool.ts
│   ├── canvas-tool.ts
│   ├── cron-tool.ts
│   ├── gateway-tool.ts
│   ├── image-tool.ts
│   ├── message-tool.ts
│   ├── nodes-tool.ts
│   ├── session*.ts
│   ├── web-*.ts
│   └── ...
└── ...
```

渠道特定的消息操作运行时现在位于插件所有的扩展目录中，而不是 `src/agents/tools` 下，例如：

- Discord 插件操作运行时文件
- Slack 插件操作运行时文件
- Telegram 插件操作运行时文件
- WhatsApp 插件操作运行时文件

## 核心集成流程

### 1. 运行嵌入式智能体

主入口是 `pi-embedded-runner/run.ts` 中的 `runEmbeddedPiAgent()`：

```typescript
import { runEmbeddedPiAgent } from "./agents/pi-embedded-runner.js";

const result = await runEmbeddedPiAgent({
  sessionId: "user-123",
  sessionKey: "main:whatsapp:+1234567890",
  sessionFile: "/path/to/session.jsonl",
  workspaceDir: "/path/to/workspace",
  config: crawclawConfig,
  prompt: "Hello, how are you?",
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  timeoutMs: 120_000,
  runId: "run-abc",
  onBlockReply: async (payload) => {
    await sendToChannel(payload.text, payload.mediaUrls);
  },
});
```

### 2. 会话创建

在 `runEmbeddedPiAgent()` 调用的 `runEmbeddedAttempt()` 内部，使用 pi SDK：

```typescript
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";

const resourceLoader = new DefaultResourceLoader({
  cwd: resolvedWorkspace,
  agentDir,
  settingsManager,
  additionalExtensionPaths,
});
await resourceLoader.reload();

const { session } = await createAgentSession({
  cwd: resolvedWorkspace,
  agentDir,
  authStorage: params.authStorage,
  modelRegistry: params.modelRegistry,
  model: params.model,
  thinkingLevel: mapThinkingLevel(params.thinkLevel),
  tools: builtInTools,
  customTools: allCustomTools,
  sessionManager,
  settingsManager,
  resourceLoader,
});

applySystemPromptOverrideToSession(session, systemPromptOverride);
```

### 3. 事件订阅

`subscribeEmbeddedPiSession()` 订阅 pi 的 `AgentSession` 事件：

```typescript
const subscription = subscribeEmbeddedPiSession({
  session: activeSession,
  runId: params.runId,
  verboseLevel: params.verboseLevel,
  reasoningMode: params.reasoningLevel,
  toolResultFormat: params.toolResultFormat,
  onToolResult: params.onToolResult,
  onReasoningStream: params.onReasoningStream,
  onBlockReply: params.onBlockReply,
  onPartialReply: params.onPartialReply,
  onAgentEvent: params.onAgentEvent,
});
```

处理的事件包括：

- `message_start` / `message_end` / `message_update`（流式文本/思考）
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`
- `turn_start` / `turn_end`
- `agent_start` / `agent_end`
- `auto_compaction_start` / `auto_compaction_end`

### 4. 提示

设置完成后，向会话发送提示：

```typescript
await session.prompt(effectivePrompt, { images: imageResult.images });
```

SDK 处理完整的智能体循环：发送到 LLM、执行工具调用、流式传输响应。

图像注入是提示本地的：CrawClaw 从当前提示加载图像引用，并通过 `images` 为该轮次传递。它不会重新扫描旧的历史轮次来重新注入图像负载。

## 工具架构

### 工具管道

1. **基础工具**：pi 的 `createCodingTools` / `createReadTool` 输出（读取、bash、编辑、写入）
2. **自定义替换**：CrawClaw 用 `exec`/`process` 替换 bash，为沙箱自定义读取/编辑/写入
3. **CrawClaw 工具**：消息、浏览器、画布、会话、计时器、网关等
4. **渠道工具**：Discord/Telegram/Slack/WhatsApp 特定的操作工具
5. **策略过滤**：工具按配置文件、提供商、智能体、群组、沙箱策略过滤
6. **Schema 规范化**：为 Gemini/OpenAI 特性清理 schema
7. **AbortSignal 包装**：工具被包装以尊重中止信号

### 工具定义适配器

pi-agent-core 的 `AgentTool` 与 pi-coding-agent 的 `ToolDefinition` 具有不同的 `execute` 签名。`pi-tool-definition-adapter.ts` 中的适配器弥合了这一差异：

```typescript
export function toToolDefinitions(tools: AnyAgentTool[]): ToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    label: tool.label ?? name,
    description: tool.description ?? "",
    parameters: tool.parameters,
    execute: async (toolCallId, params, onUpdate, _ctx, signal) => {
      // pi-coding-agent 签名与 pi-agent-core 不同
      return await tool.execute(toolCallId, params, signal, onUpdate);
    },
  }));
}
```

### 工具拆分策略

`splitSdkTools()` 通过 `customTools` 传递所有工具：

```typescript
export function splitSdkTools(options: { tools: AnyAgentTool[]; sandboxEnabled: boolean }) {
  return {
    builtInTools: [], // 空。我们覆盖一切
    customTools: toToolDefinitions(options.tools),
  };
}
```

这确保 CrawClaw 的策略过滤、沙箱集成和扩展工具集在提供商之间保持一致。

## 系统提示构建

系统提示在 `buildAgentSystemPrompt()`（`system-prompt.ts`）中构建。它组装包含多个部分的完整提示，包括工具、工具调用风格、安全护栏、CrawClaw CLI 参考、Skills、文档、工作区、沙箱、消息、回复标签、语音、静默回复、遗留心跳、运行时元数据，加上启用时的记忆和反应，以及可选的上下文文件和额外系统提示内容。子智能体使用的最小提示模式下会修剪部分。

提示在会话创建后通过 `applySystemPromptOverrideToSession()` 应用：

```typescript
const systemPromptOverride = createSystemPromptOverride(appendPrompt);
applySystemPromptOverrideToSession(session, systemPromptOverride);
```

## 会话管理

### 会话文件

会话是具有树结构（id/parentId 链接）的 JSONL 文件。Pi 的 `SessionManager` 处理持久化：

```typescript
const sessionManager = SessionManager.open(params.sessionFile);
```

CrawClaw 用 `guardSessionManager()` 包装它以确保工具结果安全。

### 会话缓存

`session-manager-cache.ts` 缓存 SessionManager 实例以避免重复文件解析：

```typescript
await prewarmSessionFile(params.sessionFile);
sessionManager = SessionManager.open(params.sessionFile);
trackSessionManagerAccess(params.sessionFile);
```

### 历史限制

`limitHistoryTurns()` 根据渠道类型（私信 vs 群组）修剪对话历史。

### 压缩

自动压缩在上下文溢出时触发。`compactEmbeddedPiSessionDirect()` 处理手动压缩：

```typescript
const compactResult = await compactEmbeddedPiSessionDirect({
  sessionId, sessionFile, provider, model, ...
});
```

## 认证与模型解析

### 认证配置文件

CrawClaw 维护一个包含每个提供商多个 API 密钥的认证配置文件存储：

```typescript
const authStore = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
const profileOrder = resolveAuthProfileOrder({ cfg, store: authStore, provider, preferredProfile });
```

配置文件在失败时轮换并追踪冷启动：

```typescript
await markAuthProfileFailure({ store, profileId, reason, cfg, agentDir });
const rotated = await advanceAuthProfile();
```

### 模型解析

```typescript
import { resolveModel } from "./pi-embedded-runner/model.js";

const { model, error, authStorage, modelRegistry } = resolveModel(
  provider,
  modelId,
  agentDir,
  config,
);

// 使用 pi 的 ModelRegistry 和 AuthStorage
authStorage.setRuntimeApiKey(model.provider, apiKeyInfo.apiKey);
```

### 故障转移

当配置时，`FailoverError` 触发模型回退：

```typescript
if (fallbackConfigured && isFailoverErrorMessage(errorText)) {
  throw new FailoverError(errorText, {
    reason: promptFailoverReason ?? "unknown",
    provider,
    model: modelId,
    profileId,
    status: resolveFailoverStatus(promptFailoverReason),
  });
}
```

## Pi 扩展

CrawClaw 加载自定义 pi 扩展以实现特殊行为：

### 压缩保护

`src/agents/pi-hooks/compaction-safeguard.ts` 为压缩添加护栏，包括自适应令牌预算以及工具失败和文件操作摘要：

```typescript
if (resolveCompactionMode(params.cfg) === "safeguard") {
  setCompactionSafeguardRuntime(params.sessionManager, { maxHistoryShare });
  paths.push(resolvePiExtensionPath("compaction-safeguard"));
}
```

### 上下文修剪

`src/agents/pi-hooks/context-pruning.ts` 实现基于缓存 TTL 的上下文修剪：

```typescript
if (cfg?.agents?.defaults?.contextPruning?.mode === "cache-ttl") {
  setContextPruningRuntime(params.sessionManager, {
    settings,
    contextWindowTokens,
    isToolPrunable,
    lastCacheTouchAt,
  });
  paths.push(resolvePiExtensionPath("context-pruning"));
}
```

## 流式传输与阻止回复

### 内容

// 如果 enforceFinalTag，仅返回 <final>...</final> 内容
};

````

### 回复指令

回复指令如 `[[media:url]]`、`[[voice]]`、`[[reply:id]]` 被解析和提取：

```typescript
const { text: cleanedText, mediaUrls, audioAsVoice, replyToId } = consumeReplyDirectives(chunk);
````

## 错误处理

### 错误分类

`pi-embedded-helpers.ts` 对错误进行分类以进行适当处理：

```typescript
isContextOverflowError(errorText)     // 上下文过大
isCompactionFailureError(errorText)   // 压缩失败
isAuthAssistantError(lastAssistant)   // 认证失败
isRateLimitAssistantError(...)        // 速率限制
isFailoverAssistantError(...)         // 应故障转移
classifyFailoverReason(errorText)     // "auth" | "rate_limit" | "quota" | "timeout" | ...
```

### 思考级别回退

如果不支持某个思考级别，它会回退：

```typescript
const fallbackThinking = pickFallbackThinkingLevel({
  message: errorText,
  attempted: attemptedThinking,
});
if (fallbackThinking) {
  thinkLevel = fallbackThinking;
  continue;
}
```

## 沙箱集成

启用沙箱模式时，工具和路径受到约束：

```typescript
const sandbox = await resolveSandboxContext({
  config: params.config,
  sessionKey: sandboxSessionKey,
  workspaceDir: resolvedWorkspace,
});

if (sandboxRoot) {
  // 使用沙箱隔离的读取/编辑/写入工具
  // Exec 在容器中运行
  // 浏览器使用桥接 URL
}
```

## 提供商特定处理

### Anthropic

- 拒绝魔法字符串清理
- 连续角色的轮次验证
- Claude Code 参数兼容性

### Google/Gemini

- 轮次排序修复（`applyGoogleTurnOrderingFix`）
- 工具 schema 清理（`sanitizeToolsForGoogle`）
- 会话历史清理（`sanitizeSessionHistory`）

### OpenAI

- Codex 模型的 `apply_patch` 工具
- 思考级别降级处理

## TUI 集成

CrawClaw 还有本地 TUI 模式，直接使用 pi-tui 组件：

```typescript
// src/tui/tui.ts
import { ... } from "@mariozechner/pi-tui";
```

这提供了与 pi 原生模式类似的交互式终端体验。

## 与 Pi CLI 的主要区别

| 方面     | Pi CLI                  | CrawClaw 嵌入式                                                                                 |
| -------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| 调用方式 | `pi` 命令 / RPC         | 通过 `createAgentSession()` 的 SDK                                                              |
| 工具     | 默认编程工具            | 自定义 CrawClaw 工具套件                                                                        |
| 系统提示 | AGENTS.md + prompts     | 动态按渠道/上下文                                                                               |
| 会话存储 | `~/.pi/agent/sessions/` | `~/.crawclaw/agents/<agentId>/sessions/`（或 `$CRAWCLAW_STATE_DIR/agents/<agentId>/sessions/`） |
| 认证     | 单个凭证                | 带轮换的多配置文件                                                                              |
| 扩展     | 从磁盘加载              | 程序化 + 磁盘路径                                                                               |
| 事件处理 | TUI 渲染                | 基于回调（onBlockReply 等）                                                                     |

## 未来考虑

潜在重工作的领域：

1. **工具签名对齐**：目前在不同 pi-agent-core 和 pi-coding-agent 签名之间适配
2. **会话管理器包装**：`guardSessionManager` 增加了安全性但也增加了复杂性
3. **扩展加载**：可以更直接地使用 pi 的 `ResourceLoader`
4. **流式处理器复杂性**：`subscribeEmbeddedPiSession` 已经变得很大
5. **提供商特性**：许多提供商特定的代码路径 pi 可能潜在处理

## 测试

Pi 集成覆盖以下测试套件：

- `src/agents/pi-*.test.ts`
- `src/agents/pi-embedded-*.test.ts`
- `src/agents/pi-embedded-helpers*.test.ts`
- `src/agents/pi-embedded-runner*.test.ts`
- `src/agents/pi-embedded-runner/**/*.test.ts`
- `src/agents/pi-embedded-subscribe*.test.ts`
- `src/agents/pi-tools*.test.ts`
- `src/agents/pi-tool-definition-adapter*.test.ts`
- `src/agents/pi-settings.test.ts`
- `src/agents/pi-hooks/**/*.test.ts`

实时/可选加入：

- `src/agents/pi-embedded-runner-extraparams.live.test.ts`（启用 `CRAWCLAW_LIVE_TEST=1`）

有关当前运行命令，请参阅 [Pi 开发工作流](/pi-dev)。
