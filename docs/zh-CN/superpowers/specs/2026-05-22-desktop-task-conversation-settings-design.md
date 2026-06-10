---
title: "Desktop Task Conversation And Settings Design"
summary: "CrawClaw Desktop task conversation 与 settings experience 的落地设计"
x-i18n:
  generated_at: "2026-06-10T12:26:38Z"
  model: codex
  provider: openai
  source_hash: 64aed1dc6847ef65d3f0658b1253e50fece897baffffe7fc56692b6417052352
  source_path: superpowers/specs/2026-05-22-desktop-task-conversation-settings-design.md
  workflow: 15
---

# Desktop Task Conversation And Settings Design

## Summary

CrawClaw Desktop 应该把 task conversation 作为 primary product surface。首屏应像一个 local task control console：用户发送 task，CrawClaw 在同一个 chronological thread 中展示 user message、model response、tool calls、plugin results、permission decisions、running state 和 failures。

Settings 应支撑该 task flow。现有 settings sections 保持可见，因为它们描述了目标 desktop product；但每个 control 都必须有诚实的状态。已经影响 task execution 的 settings 应通过 Rust Desktop API 持久化。系统效果尚未实现的 settings 可以作为 desktop UI preferences 持久化，但不能暗示 native system action 已经发生。

这个设计选择 task event stream approach，而不是 static UI showcase、plugin-only first pass 或 agent-only first pass。

## Goals

- 让默认 conversation thread 从 desktop state 渲染真实 task events，而不是 static demonstration messages。
- 将 user messages、assistant replies、tool calls、tool results、permissions、status updates 和 errors 表示为 structured conversation messages。
- 将 plugin 和 workflow results 保持在同一个 task timeline 中，而不是只推到 plugin pages 或 string lists。
- 保留 settings page 的 breadth，同时清晰区分 active settings 与 planned 或 preview-only settings。
- 通过 Rust-owned desktop stores 持久化 task-related settings 和 desktop UI preferences。
- 第一版实现限定在当前 Tauri desktop app 和 Rust Desktop API。
- 通过在第一版中派生或保留 legacy `resultItems`，保持与现有 Rust tests 兼容。

## Non-Goals

- 本轮不把每个 planned setting 都实现为真实 operating-system integration。
- 不添加 TypeScript test suites。
- 不在 task conversation 可用之前把 desktop app 变成完整 admin console。
- 不移除现有 agent、plugin、memory 或 settings workspaces。
- 不重写 provider runtime ownership 或 plugin SDK boundaries。
- 不创建新的 JavaScript plugin SDK surface。
- 不为无关 cleanup 触碰 security-owned CODEOWNERS paths。

## Assumptions

- Desktop product boundary 仍然是 `apps/crawclaw-desktop`。
- Rust 拥有 Desktop API、desktop stores、runtime supervision 和 task events。
- React 仍然是 desktop renderer layer。
- 现有 session transcripts 仍然是 persisted conversation history 的 durable source。
- Provider-backed message sends 可能在 runtime missing 或 provider config unavailable 时失败，该失败应在 conversation 中可见。
- 当前 static media、workflow 和 tool bubbles 是有用的 visual templates，但除非有真实 events 支撑，否则不应作为默认 thread content。

## Selected Approach

使用 structured task timeline 作为 Rust 和 React 之间的 shared contract。

Rust emits 并 stores task messages。React 按 kind 渲染这些 messages。Settings 通过 Rust Desktop API 持久化。Plugin tools 和 permission decisions 将自己的 task messages append 到 selected thread。

这是让 desktop app 感到 productized 的最小方案，不要求先完整实现每个未来 workspace。

## Conversation Model

向 `ConversationState` 添加 structured messages：

```ts
type ConversationMessage =
  | {
      id: string;
      kind: "user";
      text: string;
      createdAt: string;
    }
  | {
      id: string;
      kind: "assistant";
      text: string;
      createdAt: string;
    }
  | {
      id: string;
      kind: "toolCall";
      toolId: string;
      title: string;
      detail?: string;
      createdAt: string;
    }
  | {
      id: string;
      kind: "toolResult";
      toolId: string;
      title: string;
      ok: boolean;
      text: string;
      createdAt: string;
    }
  | {
      id: string;
      kind: "permission";
      requestId: string;
      title: string;
      detail: string;
      status: "pending" | "approved" | "denied";
      createdAt: string;
    }
  | {
      id: string;
      kind: "status";
      title: string;
      detail: string;
      tone: "neutral" | "ok" | "danger" | "idle";
      createdAt: string;
    }
  | {
      id: string;
      kind: "error";
      code: string;
      title: string;
      detail: string;
      createdAt: string;
    };
```

`resultItems` 在第一版中保留为 compatibility field。它应尽量从同一组 underlying messages 派生，新 UI code 应优先使用 `messages`。

## Conversation Experience

Default thread 应展示：

- 没有 selected thread 且没有 messages 时的 empty state
- send 后的 user task bubbles
- task execution active 时的 running indicator
- model output 对应的 assistant message bubbles
- 带 tool name、status 和 result summary 的 tool call 与 tool result bubbles
- request pending 时带 allow 或 deny controls 的 permission bubbles
- 带 clear code 和 human-readable explanation 的 error bubbles
- runtime status 作为 context；当真实 messages 存在时，不作为主内容

Static image、video、n8n、ComfyUI、schedule 和 voice examples 不应再作为默认 conversation messages 出现。它们可以继续作为 rendering templates 或未来 event-specific components，但默认页面不应展示它们，除非真实数据需要。

## Settings Model

扩展 desktop preferences，让 settings page 可以持久化当前和 planned settings，同时不假装每个 planned setting 已经有 native system effect。

```ts
type DesktopPreferences = {
  taskDefaults: {
    selectedModel: string;
    selectedThinking: string;
    permissionMode: string;
    responseSpeed: "标准" | "更快" | "更稳";
    allowTools: boolean;
    showReasoningSummary: boolean;
  };
  confirmationDefaults: {
    confirmFileChanges: boolean;
    confirmCommands: boolean;
    confirmExternalApps: boolean;
    confirmHighRisk: boolean;
  };
  notificationDefaults: {
    notifyTaskDone: boolean;
    notifyConfirmNeeded: boolean;
    notifyDreamDone: boolean;
    notifyAutomationFailed: boolean;
    notificationSound: boolean;
  };
  uiDefaults: {
    defaultPage: string;
    language: string;
    appearance: string;
    launchAtLogin: boolean;
    showInMenuBar: boolean;
  };
  memoryDefaults: {
    rememberPreferences: boolean;
    rememberProjectContext: boolean;
    memoryDreamEnabled: boolean;
    memoryDreamFrequency: string;
    memoryCleanupConfirmation: string;
  };
  privacyDefaults: {
    dataLocation: string;
  };
  advancedDefaults: {
    logLevel: string;
  };
};
```

为减少 churn，第一版实现可以在添加 grouped fields 的同时保留现有 top-level `selectedModel`、`selectedThinking` 和 `permissionMode` fields 作为 compatibility aliases。新的 settings UI 应写入 grouped fields，并在 callers 迁移完成前保持 aliases 同步。

## Settings Experience

保持所有现有 settings sections 可见：

- General
- Model and replies
- Permissions and confirmations
- Memory preferences
- Notifications
- Data and privacy
- Advanced

每个 setting row 应暴露三种状态之一：

- Active: 已持久化，并且现在会影响 desktop task behavior。
- Preview: 作为 desktop preference 持久化，但尚未连接到 operating system action。
- Planned: 为 product completeness 可见；当用户操作会暗示真实 system effect 时禁用。

Examples：

- Model、thinking level、permission mode、confirmation defaults 和 task notification defaults 是 active。
- Appearance、language、response speed、memory preference defaults 和 log level 可以在第一版作为 preview preferences。
- Launch at login、menu bar behavior、cache cleanup、data export、data deletion 和 diagnostics generation 在 native actions 存在前应保持 planned。

## Backend Data Flow

### Bootstrap

1. Probe runtime status。
2. 从 Rust stores 加载 agents、memory、plugin manifest、preferences 和 sessions。
3. 将 persisted session transcripts 转换为 selected thread 的 structured conversation messages。
4. 返回同时带 structured messages 和 compatibility `resultItems` 的 `DesktopState`。

### Send Task

1. `POST /api/desktop/messages` 验证 text 非空。
2. Rust 选择 active thread，或创建新 thread。
3. 将 user message append 到 transcript 和 desktop state。
4. Runtime 使用 selected task defaults 运行 task。
5. 成功时，将 assistant output append 到 transcript 和 desktop state。
6. 失败时，将 error message append 到 desktop state，并 emit `operationFailed` event。
7. `stateChanged` event 更新 renderer。

### Plugin Tool

1. `POST /api/desktop/plugins/{pluginId}/tools/{toolId}/invoke` 将 `toolCall` message append 到 active 或 plugin thread。
2. Rust 调用 Rust-native plugin tool。
3. 成功时，Rust append 带 `ok: true` 的 `toolResult` message。
4. 失败时，Rust append 带 `ok: false` 的 `toolResult` message，并 emit typed failure。

### Permission

1. Pending permission request append 或 update 一个 `permission` message。
2. 用户 approval 或 denial 同时更新 `permissionRequest` 和匹配的 conversation message。
3. Thread 显示 final status，而不是只依赖单独 floating notice。

### Settings

1. Settings controls 调用 `PATCH /api/desktop/preferences`。
2. Rust 校验 known enum-like fields 和 booleans。
3. Rust 写入 expanded preferences record。
4. Rust 更新 `DesktopState.preferences` 并 emit `stateChanged`。

## Frontend Components

### `ChatThread`

`ChatThread` 应拆分为 focused render helpers：

- `ConversationMessageList`
- `UserMessageBubble`
- `AssistantMessageBubble`
- `ToolCallBubble`
- `ToolResultBubble`
- `PermissionMessageBubble`
- `StatusMessageBubble`
- `ErrorMessageBubble`
- `EmptyConversationState`

这样可以防止文件继续膨胀，并让每种 message kind 可以通过 inspection 和 browser verification 测试。

### `ChatWorkspace`

`ChatWorkspace` 保留 composer behavior、command menus、model selection、thinking selection 和 permission mode selection。它应将 message rendering 委托给 message list，并停止拥有 static demonstration content。

### `SettingsWorkspace`

`SettingsWorkspace` 应使用来自 `DesktopState` 的 preference values，而不是为 persisted controls 使用 local-only `useState`。对于 model-add form 是否打开这类 transient UI state，local component state 仍可接受。

Rows 应展示 active、preview 或 planned status，而不是隐藏 planned features。

## Error Handling

- Empty message sends 返回 `400`，且不 mutate state。
- Missing runtime 返回 `503`，并在 conversation 中展示 error message。
- Provider unavailable failures 保留 typed error code，并出现在 thread 中。
- Plugin invocation failures 创建 failed tool result message。
- Invalid preference payloads 返回 `400`，并且不 partial persist。
- Store failures 返回 typed desktop operation failure，并在 thread 或 runtime checks 中呈现 readable error。
- Unknown message kinds 应渲染为 safe status message，而不是让 renderer 崩溃。

## Testing Strategy

使用 Rust tests 覆盖 backend behavior 和 contract generation。不要添加新的 TypeScript test suites。

Focused tests：

- desktop bootstrap includes `conversation.messages`
- sending a message appends structured user and assistant messages
- provider failure appends a structured error message
- plugin invocation appends tool call and tool result messages
- permission decision updates the structured permission message
- expanded preferences persist through restart
- desktop contract generation stays in sync

Frontend verification：

- 运行 desktop renderer build 或 repo desktop build command
- 在 browser 中打开 `http://127.0.0.1:1420/`
- 验证 empty state、send failure state、settings status labels，以及没有 default static demo thread overlap

## Migration Plan

1. 添加 Rust message 和 expanded preferences models。
2. 生成 TypeScript desktop contract。
3. 让 stores 和 bootstrap 加载 structured messages 与 grouped preferences。
4. 更新 send message、plugin invocation 和 permission routes，以写入 structured messages。
5. 重构 `ChatThread` 渲染真实 message kinds。
6. 更新 settings 读取和写入 persisted preferences。
7. 运行 focused Rust tests、contract check 和 desktop renderer build。

## Open Decisions

第一版没有刻意留下 product decisions。Exact visual copy 和最终 status labels 集可以在 implementation 过程中细化，只要 active、preview 和 planned 的区分保持可见。
