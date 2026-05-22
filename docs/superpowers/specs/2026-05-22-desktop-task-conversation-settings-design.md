---
title: "Desktop Task Conversation And Settings Design"
summary: "Design for landing the CrawClaw Desktop task conversation and settings experience"
read_when:
  - You are implementing or reviewing the CrawClaw Desktop conversation surface
  - You are changing CrawClaw Desktop settings, task events, or desktop API state contracts
---

# Desktop Task Conversation And Settings Design

## Summary

CrawClaw Desktop should make the task conversation the primary product surface.
The first screen should behave like a local task control console: the user sends
a task, CrawClaw shows the user message, model response, tool calls, plugin
results, permission decisions, running state, and failures in one chronological
thread.

Settings should support that task flow. Existing settings sections stay visible
because they describe the intended desktop product, but every control must have
an honest state. Settings that already affect task execution should persist
through the Rust Desktop API. Settings whose system effect is not implemented
yet can persist as desktop UI preferences, but they must not imply that a native
system action has already happened.

This design chooses the task event stream approach over a static UI showcase, a
plugin-only first pass, or an agent-only first pass.

## Goals

- Make the default conversation thread render real task events from desktop
  state, not static demonstration messages.
- Represent user messages, assistant replies, tool calls, tool results,
  permissions, status updates, and errors as structured conversation messages.
- Keep plugin and workflow results in the same task timeline instead of pushing
  them only into plugin pages or string lists.
- Preserve settings page breadth while clearly separating active settings from
  planned or preview-only settings.
- Persist task-related settings and desktop UI preferences through Rust-owned
  desktop stores.
- Keep the first implementation scoped to the current Tauri desktop app and
  Rust Desktop API.
- Keep the transition compatible with existing Rust tests by deriving or
  retaining legacy `resultItems` during the first pass.

## Non-Goals

- Do not implement every planned setting as a real operating-system integration
  in this pass.
- Do not add TypeScript test suites.
- Do not turn the desktop app into a full admin console before the task
  conversation is usable.
- Do not remove the existing agent, plugin, memory, or settings workspaces.
- Do not rewrite provider runtime ownership or plugin SDK boundaries.
- Do not create a new JavaScript plugin SDK surface.
- Do not touch security-owned CODEOWNERS paths for unrelated cleanup.

## Assumptions

- The desktop product boundary remains `apps/crawclaw-desktop`.
- Rust owns the Desktop API, desktop stores, runtime supervision, and task
  events.
- React remains the desktop renderer layer.
- Existing session transcripts remain the durable source for persisted
  conversation history.
- Provider-backed message sends can fail when the runtime is missing or provider
  config is unavailable, and that failure should be visible in the conversation.
- The current static media, workflow, and tool bubbles are useful visual
  templates, but they should not be the default thread content unless backed by
  real events.

## Selected Approach

Use a structured task timeline as the shared contract between Rust and React.

Rust emits and stores task messages. React renders those messages by kind.
Settings persist through the Rust Desktop API. Plugin tools and permission
decisions append their own task messages into the selected thread.

This is the smallest approach that makes the desktop app feel productized
without requiring every future workspace to be fully implemented first.

## Conversation Model

Add structured messages to `ConversationState`:

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

`resultItems` stays during the first implementation as a compatibility field.
It should be derived from the same underlying messages where practical, and new
UI code should prefer `messages`.

## Conversation Experience

The default thread should show:

- an empty state when there is no selected thread and no messages
- user task bubbles after send
- a running indicator while task execution is active
- assistant message bubbles for model output
- tool call and tool result bubbles with tool name, status, and result summary
- permission bubbles with allow or deny controls when the request is pending
- error bubbles with a clear code and human-readable explanation
- runtime status as context, not as the main content when real messages exist

Static image, video, n8n, ComfyUI, schedule, and voice examples should no longer
appear as default conversation messages. They can remain as rendering templates
or future event-specific components, but the default page should not show them
unless real data asks for them.

## Settings Model

Expand desktop preferences so the settings page can persist current and planned
settings without pretending every planned setting already has a native system
effect.

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

To reduce churn, the first implementation can keep existing top-level
`selectedModel`, `selectedThinking`, and `permissionMode` fields as compatibility
aliases while adding the grouped fields. New settings UI should write the grouped
fields and keep aliases synchronized until callers are migrated.

## Settings Experience

Keep all existing settings sections visible:

- General
- Model and replies
- Permissions and confirmations
- Memory preferences
- Notifications
- Data and privacy
- Advanced

Each setting row should expose one of three states:

- Active: persisted and affects desktop task behavior now.
- Preview: persisted as a desktop preference but not connected to an operating
  system action yet.
- Planned: visible for product completeness, disabled when a user action would
  otherwise imply a real system effect.

Examples:

- Model, thinking level, permission mode, confirmation defaults, and task
  notification defaults are active.
- Appearance, language, response speed, memory preference defaults, and log level
  can be preview preferences in the first pass.
- Launch at login, menu bar behavior, cache cleanup, data export, data deletion,
  and diagnostics generation should stay planned until native actions exist.

## Backend Data Flow

### Bootstrap

1. Probe runtime status.
2. Load agents, memory, plugin manifest, preferences, and sessions from Rust
   stores.
3. Convert persisted session transcripts into structured conversation messages
   for the selected thread.
4. Return `DesktopState` with both structured messages and compatibility
   `resultItems`.

### Send Task

1. `POST /api/desktop/messages` validates non-empty text.
2. Rust picks the active thread or creates a new one.
3. The user message is appended to the transcript and desktop state.
4. The runtime runs the task using the selected task defaults.
5. On success, assistant output is appended to transcript and desktop state.
6. On failure, an error message is appended to desktop state and an
   `operationFailed` event is emitted.
7. A `stateChanged` event updates the renderer.

### Plugin Tool

1. `POST /api/desktop/plugins/{pluginId}/tools/{toolId}/invoke` appends a
   `toolCall` message to the active or plugin thread.
2. Rust invokes the Rust-native plugin tool.
3. On success, Rust appends a `toolResult` message with `ok: true`.
4. On failure, Rust appends a `toolResult` message with `ok: false` and emits a
   typed failure.

### Permission

1. A pending permission request appends or updates a `permission` message.
2. User approval or denial updates both `permissionRequest` and the matching
   conversation message.
3. The thread shows the final status without relying on a separate floating
   notice only.

### Settings

1. Settings controls call `PATCH /api/desktop/preferences`.
2. Rust validates known enum-like fields and booleans.
3. Rust writes the expanded preferences record.
4. Rust updates `DesktopState.preferences` and emits `stateChanged`.

## Frontend Components

### `ChatThread`

`ChatThread` should be split into focused render helpers:

- `ConversationMessageList`
- `UserMessageBubble`
- `AssistantMessageBubble`
- `ToolCallBubble`
- `ToolResultBubble`
- `PermissionMessageBubble`
- `StatusMessageBubble`
- `ErrorMessageBubble`
- `EmptyConversationState`

This keeps the file from growing further and makes each message kind testable by
inspection and browser verification.

### `ChatWorkspace`

`ChatWorkspace` keeps composer behavior, command menus, model selection,
thinking selection, and permission mode selection. It should delegate message
rendering to the message list and stop owning static demonstration content.

### `SettingsWorkspace`

`SettingsWorkspace` should use preference values from `DesktopState` instead of
local-only `useState` for persisted controls. Local component state remains
acceptable for transient UI state such as whether a model-add form is open.

Rows should show active, preview, or planned status without hiding planned
features.

## Error Handling

- Empty message sends return `400` and do not mutate state.
- Missing runtime returns `503` and shows an error message in the conversation.
- Provider unavailable failures keep their typed error code and appear in the
  thread.
- Plugin invocation failures create a failed tool result message.
- Invalid preference payloads return `400` and do not partially persist.
- Store failures return a typed desktop operation failure and surface a readable
  error in the thread or runtime checks.
- Unknown message kinds should render as a safe status message instead of
  crashing the renderer.

## Testing Strategy

Use Rust tests for backend behavior and contract generation. Do not add new
TypeScript test suites.

Focused tests:

- desktop bootstrap includes `conversation.messages`
- sending a message appends structured user and assistant messages
- provider failure appends a structured error message
- plugin invocation appends tool call and tool result messages
- permission decision updates the structured permission message
- expanded preferences persist through restart
- desktop contract generation stays in sync

Frontend verification:

- run the desktop renderer build or the repo desktop build command
- open `http://127.0.0.1:1420/` in the browser
- verify empty state, send failure state, settings status labels, and no default
  static demo thread overlap

## Migration Plan

1. Add the Rust message and expanded preferences models.
2. Generate the TypeScript desktop contract.
3. Teach stores and bootstrap to load structured messages and grouped
   preferences.
4. Update send message, plugin invocation, and permission routes to write
   structured messages.
5. Refactor `ChatThread` to render real message kinds.
6. Update settings to read and write persisted preferences.
7. Run focused Rust tests, contract check, and desktop renderer build.

## Open Decisions

No product decisions are intentionally left open for the first pass. Exact visual
copy and the final set of status labels can be refined during implementation as
long as the active, preview, and planned distinction remains visible.
