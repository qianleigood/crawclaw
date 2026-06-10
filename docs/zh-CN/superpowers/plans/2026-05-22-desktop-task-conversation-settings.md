---
title: "Desktop Task Conversation And Settings Implementation Plan"
summary: "CrawClaw Desktop task-event conversation surface 和 persistent settings 的实施计划"
x-i18n:
  generated_at: "2026-06-10T13:03:53Z"
  model: codex
  provider: openai
  source_hash: 8a6be721b018b14325e47153deca472ffab64aafbdaf0b0d97f851662c38e9d4
  source_path: superpowers/plans/2026-05-22-desktop-task-conversation-settings.md
  workflow: 15
---

# Desktop Task Conversation And Settings Implementation Plan

> **面向 agentic workers：** REQUIRED SUB-SKILL：使用
> superpowers:subagent-driven-development（推荐）或
> superpowers:executing-plans 逐项实施这个计划。步骤使用
> checkbox（`- [ ]`）语法跟踪。

**Goal:** 为 CrawClaw Desktop 构建 task-event conversation surface 和 persistent desktop settings。

**Architecture:** Rust 拥有 desktop API contract、persistent stores、session state、task events 和 preference validation。React 渲染 Rust contract，并且本地只保留 transient component state。`resultItems` 作为 compatibility read model 保留，而新的 UI code 消费 structured `conversation.messages`。

**Tech Stack:** Rust、Tauri、Axum、serde、React、TypeScript、Vite、oxfmt。

---

## 文件结构

- Modify `apps/crawclaw-desktop/src-tauri/src/models.rs`
  - Add structured conversation message types.
  - Add grouped desktop preference structs while keeping existing top-level
    compatibility fields.
- Modify `apps/crawclaw-desktop/src-tauri/src/desktop_contract.rs`
  - Update the generated TypeScript contract source string.
- Modify `apps/crawclaw-desktop/src/generated/desktop-api-contract.generated.ts`
  - Regenerate from the Rust desktop contract source.
- Modify `crates/crawclaw-runtime/src/desktop_runtime_stores.rs`
  - Extend persisted desktop preferences.
  - Derive structured conversation messages from transcripts.
- Modify `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_state.rs`
  - Initialize grouped preferences and empty conversation messages.
- Modify `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`
  - Merge expanded preferences and session messages into desktop state.
  - Persist grouped preferences.
- Modify `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_agent_routes.rs`
  - Accept and validate expanded preferences.
- Modify `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_native_operations.rs`
  - Append user, assistant, and error messages for task sends.
- Modify `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_plugin_operations.rs`
  - Append tool call and tool result messages.
- Modify `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_core_routes.rs`
  - Update permission decision state in the structured message list.
- Modify `apps/crawclaw-desktop/src-tauri/tests/gateway_desktop_api_test.rs`
  - Add focused Rust integration tests for message and preference behavior.
- Modify `apps/crawclaw-desktop/src/views/chat-thread.tsx`
  - Replace static demo rendering with structured message rendering.
- Create `apps/crawclaw-desktop/src/views/conversation-messages.tsx`
  - Own per-message React renderers.
- Modify `apps/crawclaw-desktop/src/views/chat-workspace.tsx`
  - Pass structured messages to the message list and keep composer behavior.
- Modify `apps/crawclaw-desktop/src/views/settings-workspace.tsx`
  - Bind controls to persisted preferences and show active, preview, or planned
    row status.
- Modify `apps/crawclaw-desktop/src/App.tsx`
  - Send expanded preference patches from chat and settings.
- Modify `apps/crawclaw-desktop/src/api/desktop-client.ts`
  - Type the expanded preference patch.
- Modify `apps/crawclaw-desktop/src/api/desktop-initial-state.ts`
  - Match the expanded contract in unavailable mode.
- Modify `apps/crawclaw-desktop/src/app/use-desktop-state.ts`
  - Append operation errors into structured conversation messages.
- Modify `apps/crawclaw-desktop/src/styles/app.css`
  - Add styles for real task bubbles and settings row status.

## Task 1: 添加 Conversation Message Contract

**Files:**

- Modify: `apps/crawclaw-desktop/src-tauri/src/models.rs`
- Modify: `apps/crawclaw-desktop/src-tauri/src/desktop_contract.rs`
- Modify: `apps/crawclaw-desktop/src/generated/desktop-api-contract.generated.ts`
- Test: `apps/crawclaw-desktop/src-tauri/tests/desktop_contract_test.rs`

- [ ] **Step 1: 编写失败的 contract test expectation**

Update `apps/crawclaw-desktop/src-tauri/tests/desktop_contract_test.rs`:

```rust
#[test]
fn desktop_api_contract_exposes_structured_conversation_messages() {
    let source = crawclaw_desktop::desktop_contract::desktop_api_contract_source();

    assert!(source.contains("export type ConversationMessage ="));
    assert!(source.contains("kind: 'toolResult'"));
    assert!(source.contains("messages: ConversationMessage[]"));
}
```

- [ ] **Step 2: 运行 contract test 并确认失败**

Run:

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml desktop_api_contract_exposes_structured_conversation_messages
```

Expected: `desktop_api_contract_exposes_structured_conversation_messages` fails
because `ConversationMessage` is absent.

- [ ] **Step 3: 添加 Rust model types**

In `apps/crawclaw-desktop/src-tauri/src/models.rs`, add:

```rust
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConversationMessage {
    User {
        id: String,
        text: String,
        created_at: String,
    },
    Assistant {
        id: String,
        text: String,
        created_at: String,
    },
    ToolCall {
        id: String,
        tool_id: String,
        title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
        created_at: String,
    },
    ToolResult {
        id: String,
        tool_id: String,
        title: String,
        ok: bool,
        text: String,
        created_at: String,
    },
    Permission {
        id: String,
        request_id: String,
        title: String,
        detail: String,
        status: PermissionStatus,
        created_at: String,
    },
    Status {
        id: String,
        title: String,
        detail: String,
        tone: String,
        created_at: String,
    },
    Error {
        id: String,
        code: String,
        title: String,
        detail: String,
        created_at: String,
    },
}
```

Then add `pub messages: Vec<ConversationMessage>,` to `ConversationState` before
`result_items`.

- [ ] **Step 4: 更新 contract source**

In `apps/crawclaw-desktop/src-tauri/src/desktop_contract.rs`, add this block
above `export interface ConversationState`:

```ts
export type ConversationMessage =
  | { kind: "user"; id: string; text: string; createdAt: string }
  | { kind: "assistant"; id: string; text: string; createdAt: string }
  | {
      kind: "toolCall";
      id: string;
      toolId: string;
      title: string;
      detail?: string;
      createdAt: string;
    }
  | {
      kind: "toolResult";
      id: string;
      toolId: string;
      title: string;
      ok: boolean;
      text: string;
      createdAt: string;
    }
  | {
      kind: "permission";
      id: string;
      requestId: string;
      title: string;
      detail: string;
      status: PermissionStatus;
      createdAt: string;
    }
  | {
      kind: "status";
      id: string;
      title: string;
      detail: string;
      tone: BadgeTone;
      createdAt: string;
    }
  | {
      kind: "error";
      id: string;
      code: string;
      title: string;
      detail: string;
      createdAt: string;
    };
```

Then update the contract string:

```ts
export interface ConversationState {
  messages: ConversationMessage[];
  resultItems: string[];
  runtimeChecks: RuntimeCheck[];
  slashCommands: CommandSuggestion[];
  skillCommands: SkillSuggestion[];
  draftMessages: DraftMessage[];
}
```

- [ ] **Step 5: 生成 TypeScript contract**

Run:

```bash
pnpm desktop:contract:gen
```

Expected: `apps/crawclaw-desktop/src/generated/desktop-api-contract.generated.ts`
contains the same `ConversationMessage` type and `messages` field.

- [ ] **Step 6: 运行 contract checks**

Run:

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml desktop_api_contract_exposes_structured_conversation_messages desktop_api_contract_generated_types_are_current
```

Expected: both tests pass.

- [ ] **Step 7: 提交**

Run:

```bash
scripts/committer "Desktop: add conversation message contract" \
  apps/crawclaw-desktop/src-tauri/src/models.rs \
  apps/crawclaw-desktop/src-tauri/src/desktop_contract.rs \
  apps/crawclaw-desktop/src/generated/desktop-api-contract.generated.ts \
  apps/crawclaw-desktop/src-tauri/tests/desktop_contract_test.rs
```

## Task 2: 添加 Expanded Preference Contract And Store

**Files:**

- Modify: `apps/crawclaw-desktop/src-tauri/src/models.rs`
- Modify: `apps/crawclaw-desktop/src-tauri/src/desktop_contract.rs`
- Modify: `apps/crawclaw-desktop/src/generated/desktop-api-contract.generated.ts`
- Modify: `crates/crawclaw-runtime/src/desktop_runtime_stores.rs`
- Modify: `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_state.rs`
- Modify: `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`
- Modify: `apps/crawclaw-desktop/src-tauri/tests/gateway_desktop_api_test.rs`

- [ ] **Step 1: 编写失败的 persistence test**

Add this test to `apps/crawclaw-desktop/src-tauri/tests/gateway_desktop_api_test.rs`:

```rust
#[cfg(unix)]
#[tokio::test]
async fn gateway_expanded_preferences_persist_through_rust_runtime_store() {
    let runtime_layout = create_runtime_fixture(
        "desktop-expanded-preferences-store",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{
      "taskDefaults":{"selectedModel":"ollama/local","selectedThinking":"low","permissionMode":"只读模式","responseSpeed":"更快","allowTools":false,"showReasoningSummary":true},
      "confirmationDefaults":{"confirmFileChanges":false,"confirmCommands":false,"confirmExternalApps":true,"confirmHighRisk":true},
      "notificationDefaults":{"notifyTaskDone":true,"notifyConfirmNeeded":true,"notifyDreamDone":false,"notifyAutomationFailed":true,"notificationSound":true},
      "uiDefaults":{"defaultPage":"记忆","language":"中文","appearance":"深色","launchAtLogin":true,"showInMenuBar":false},
      "memoryDefaults":{"rememberPreferences":true,"rememberProjectContext":false,"memoryDreamEnabled":true,"memoryDreamFrequency":"每天","memoryCleanupConfirmation":"仅重要记忆"},
      "privacyDefaults":{"dataLocation":"本机默认位置"},
      "advancedDefaults":{"logLevel":"详细"}
    }"#;
    let (status, _) = request(
        server.addr,
        format!(
            "PATCH /api/desktop/preferences HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;
    assert_eq!(status, 200);

    let restarted_server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("restarted gateway should start");
    let (status, body) = request(
        restarted_server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    let preferences = &json["desktopState"]["preferences"];
    assert_eq!(preferences["selectedModel"], "ollama/local");
    assert_eq!(preferences["selectedThinking"], "low");
    assert_eq!(preferences["permissionMode"], "只读模式");
    assert_eq!(preferences["taskDefaults"]["allowTools"], false);
    assert_eq!(preferences["confirmationDefaults"]["confirmCommands"], false);
    assert_eq!(preferences["notificationDefaults"]["notificationSound"], true);
    assert_eq!(preferences["uiDefaults"]["defaultPage"], "记忆");
    assert_eq!(preferences["memoryDefaults"]["memoryDreamFrequency"], "每天");
    assert_eq!(preferences["advancedDefaults"]["logLevel"], "详细");
}
```

- [ ] **Step 2: 运行 test 并确认失败**

Run:

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml gateway_expanded_preferences_persist_through_rust_runtime_store
```

Expected: the test fails because grouped preference fields are not accepted or
persisted.

- [ ] **Step 3: 添加 grouped preference models**

In `apps/crawclaw-desktop/src-tauri/src/models.rs`, add structs named:

```rust
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDefaults {
    pub selected_model: String,
    pub selected_thinking: String,
    pub permission_mode: String,
    pub response_speed: String,
    pub allow_tools: bool,
    pub show_reasoning_summary: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmationDefaults {
    pub confirm_file_changes: bool,
    pub confirm_commands: bool,
    pub confirm_external_apps: bool,
    pub confirm_high_risk: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationDefaults {
    pub notify_task_done: bool,
    pub notify_confirm_needed: bool,
    pub notify_dream_done: bool,
    pub notify_automation_failed: bool,
    pub notification_sound: bool,
}
```

Also add `UiDefaults`, `MemoryDefaults`, `PrivacyDefaults`, and
`AdvancedDefaults`:

```rust
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UiDefaults {
    pub default_page: String,
    pub language: String,
    pub appearance: String,
    pub launch_at_login: bool,
    pub show_in_menu_bar: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDefaults {
    pub remember_preferences: bool,
    pub remember_project_context: bool,
    pub memory_dream_enabled: bool,
    pub memory_dream_frequency: String,
    pub memory_cleanup_confirmation: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyDefaults {
    pub data_location: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedDefaults {
    pub log_level: String,
}
```

Extend `DesktopPreferences` with these grouped fields while keeping
`selected_model`, `selected_thinking`, and `permission_mode`.

- [ ] **Step 4: 添加 default constructors**

In `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_state.rs`, add helper
functions:

```rust
fn task_defaults(selected_model: &str, selected_thinking: &str, permission_mode: &str) -> TaskDefaults {
    TaskDefaults {
        selected_model: selected_model.to_string(),
        selected_thinking: selected_thinking.to_string(),
        permission_mode: permission_mode.to_string(),
        response_speed: "标准".to_string(),
        allow_tools: true,
        show_reasoning_summary: false,
    }
}

fn confirmation_defaults() -> ConfirmationDefaults {
    ConfirmationDefaults {
        confirm_file_changes: true,
        confirm_commands: true,
        confirm_external_apps: true,
        confirm_high_risk: true,
    }
}
```

Add matching helpers for notification, UI, memory, privacy, and advanced
defaults. Use them in `initial_desktop_state`.

- [ ] **Step 5: 扩展 runtime preference store record**

In `crates/crawclaw-runtime/src/desktop_runtime_stores.rs`, extend
`DesktopPreferencesRecord`:

```rust
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPreferencesRecord {
    pub selected_model: String,
    pub selected_thinking: String,
    pub permission_mode: String,
    #[serde(default)]
    pub task_defaults: serde_json::Value,
    #[serde(default)]
    pub confirmation_defaults: serde_json::Value,
    #[serde(default)]
    pub notification_defaults: serde_json::Value,
    #[serde(default)]
    pub ui_defaults: serde_json::Value,
    #[serde(default)]
    pub memory_defaults: serde_json::Value,
    #[serde(default)]
    pub privacy_defaults: serde_json::Value,
    #[serde(default)]
    pub advanced_defaults: serde_json::Value,
}
```

Use JSON values in the runtime crate to avoid creating a dependency on desktop
UI model types.

- [ ] **Step 6: 合并并持久化 grouped fields**

In `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`, update
`merge_persisted_preferences` so each non-null JSON value is deserialized into
the matching desktop model before assignment. Update `persist_desktop_preferences`
to serialize each grouped field with `serde_json::to_value`.

- [ ] **Step 7: 更新 TypeScript contract source 和 generated file**

Add grouped preference interfaces to `apps/crawclaw-desktop/src-tauri/src/desktop_contract.rs`,
then run:

```bash
pnpm desktop:contract:gen
```

Expected: generated contract exposes grouped fields and retains top-level
compatibility aliases.

- [ ] **Step 8: 运行 preference tests 和 contract check**

Run:

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml gateway_expanded_preferences_persist_through_rust_runtime_store desktop_api_contract_generated_types_are_current
```

Expected: both tests pass.

- [ ] **Step 9: 提交**

Run:

```bash
scripts/committer "Desktop: persist expanded preferences" \
  apps/crawclaw-desktop/src-tauri/src/models.rs \
  apps/crawclaw-desktop/src-tauri/src/desktop_contract.rs \
  apps/crawclaw-desktop/src/generated/desktop-api-contract.generated.ts \
  crates/crawclaw-runtime/src/desktop_runtime_stores.rs \
  apps/crawclaw-desktop/src-tauri/src/gateway/desktop_state.rs \
  apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs \
  apps/crawclaw-desktop/src-tauri/tests/gateway_desktop_api_test.rs
```

## Task 3: 构建 Structured Session Message Read Model

**Files:**

- Modify: `crates/crawclaw-runtime/src/desktop_runtime_stores.rs`
- Modify: `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`
- Modify: `apps/crawclaw-desktop/src-tauri/tests/gateway_desktop_api_test.rs`

- [ ] **Step 1: 编写失败的 bootstrap test**

Extend `gateway_bootstrap_reads_persisted_rust_session_transcripts` in
`apps/crawclaw-desktop/src-tauri/tests/gateway_desktop_api_test.rs` with:

```rust
assert_eq!(
    json["desktopState"]["conversation"]["messages"][0]["kind"],
    "user"
);
assert_eq!(
    json["desktopState"]["conversation"]["messages"][0]["text"],
    "remember this session"
);
assert_eq!(
    json["desktopState"]["conversation"]["messages"][1]["kind"],
    "assistant"
);
assert_eq!(
    json["desktopState"]["conversation"]["messages"][1]["text"],
    "persisted assistant reply"
);
```

- [ ] **Step 2: 运行 test 并确认失败**

Run:

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml gateway_bootstrap_reads_persisted_rust_session_transcripts
```

Expected: the test fails because `conversation.messages` is absent or empty.

- [ ] **Step 3: 扩展 `DesktopSessionRecord`**

In `crates/crawclaw-runtime/src/desktop_runtime_stores.rs`, add:

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesktopConversationMessageRecord {
    pub kind: String,
    pub text: String,
    pub source: Option<String>,
}
```

Then add `pub messages: Vec<DesktopConversationMessageRecord>,` to
`DesktopSessionRecord`.

- [ ] **Step 4: 从 transcript entries 派生 message records**

Add this helper in `crates/crawclaw-runtime/src/desktop_runtime_stores.rs`:

```rust
pub(super) fn transcript_message_record(
    entry: DesktopTranscriptEntry,
) -> Option<DesktopConversationMessageRecord> {
    let content = entry.content.trim();
    if content.is_empty() {
        return None;
    }
    let kind = match entry.role.as_str() {
        "user" => "user",
        "assistant" => "assistant",
        _ => "status",
    };
    Some(DesktopConversationMessageRecord {
        kind: kind.to_string(),
        text: content.to_string(),
        source: entry.source,
    })
}
```

In `load_sessions`, parse transcript entries once, clone for `result_items`, and
collect `messages` with `transcript_message_record`.

- [ ] **Step 5: 将 records 转换为 desktop model messages**

In `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`, add:

```rust
fn conversation_messages_from_session(
    thread_id: &str,
    session: &DesktopSessionRecord,
) -> Vec<ConversationMessage> {
    session
        .messages
        .iter()
        .enumerate()
        .map(|(index, message)| {
            let id = format!("{thread_id}-message-{index}");
            match message.kind.as_str() {
                "user" => ConversationMessage::User {
                    id,
                    text: message.text.clone(),
                    created_at: "已保存".to_string(),
                },
                "assistant" => ConversationMessage::Assistant {
                    id,
                    text: message.text.clone(),
                    created_at: "已保存".to_string(),
                },
                _ => ConversationMessage::Status {
                    id,
                    title: message.kind.clone(),
                    detail: message.text.clone(),
                    tone: "neutral".to_string(),
                    created_at: "已保存".to_string(),
                },
            }
        })
        .collect()
}
```

Use it anywhere `desktop_state.conversation.result_items = session.result_items`
is currently assigned.

- [ ] **Step 6: 运行 bootstrap transcript test**

Run:

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml gateway_bootstrap_reads_persisted_rust_session_transcripts
```

Expected: test passes and legacy `resultItems` assertions still pass.

- [ ] **Step 7: 提交**

Run:

```bash
scripts/committer "Desktop: load structured session messages" \
  crates/crawclaw-runtime/src/desktop_runtime_stores.rs \
  apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs \
  apps/crawclaw-desktop/src-tauri/tests/gateway_desktop_api_test.rs
```

## Task 4: 在 Task Sends 中写入 Structured Messages

**Files:**

- Modify: `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_native_operations.rs`
- Modify: `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`
- Modify: `apps/crawclaw-desktop/src-tauri/tests/gateway_desktop_api_test.rs`

- [ ] **Step 1: 扩展 success 和 failure tests**

In `gateway_send_message_is_rust_backed_and_streams_session_events`, add:

```rust
let messages = json["conversation"]["messages"]
    .as_array()
    .expect("conversation messages");
assert!(messages.iter().any(|message| {
    message["kind"] == "user" && message["text"] == "hello from desktop"
}));
assert!(messages.iter().any(|message| {
    message["kind"] == "assistant" && message["text"] == "provider says hello"
}));
```

In `gateway_send_message_provider_failure_returns_typed_failure`, after the
`503` assertion, fetch `/api/desktop/state` and assert:

```rust
assert!(json["conversation"]["messages"]
    .as_array()
    .expect("conversation messages")
    .iter()
    .any(|message| message["kind"] == "error"
        && message["code"] == "provider_unavailable"));
```

- [ ] **Step 2: 运行 focused tests 并确认失败**

Run:

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml gateway_send_message_is_rust_backed_and_streams_session_events gateway_send_message_provider_failure_returns_typed_failure
```

Expected: at least one assertion fails because send paths do not update
`conversation.messages`.

- [ ] **Step 3: 添加 message helper functions**

In `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`, add:

```rust
fn now_message_id(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

fn conversation_user_message(text: String) -> ConversationMessage {
    ConversationMessage::User {
        id: now_message_id("user"),
        text,
        created_at: "刚刚".to_string(),
    }
}

fn conversation_assistant_message(text: String) -> ConversationMessage {
    ConversationMessage::Assistant {
        id: now_message_id("assistant"),
        text,
        created_at: "刚刚".to_string(),
    }
}

fn conversation_error_message(code: &str, detail: String) -> ConversationMessage {
    ConversationMessage::Error {
        id: now_message_id("error"),
        code: code.to_string(),
        title: "任务失败".to_string(),
        detail,
        created_at: "刚刚".to_string(),
    }
}
```

Keep these helpers private in the desktop API module and use them from child
modules through `super::`.

- [ ] **Step 4: 在 success 和 failure 时 append messages**

In `desktop_native_operations.rs`, update `DesktopNativeMutation::SendMessage`:

```rust
desktop_state
    .conversation
    .messages
    .push(conversation_user_message(send_result.user_text.clone()));
desktop_state
    .conversation
    .messages
    .push(conversation_assistant_message(send_result.assistant_text.clone()));
```

Replace the `map_err` expression around `state.agent_runtime.send_message(...)`
with an explicit `match` so the error branch can mutate async state before
returning:

```rust
let send_result = match state.agent_runtime.send_message(thread_id, text).await {
    Ok(send_result) => send_result,
    Err(error) => {
        let _ = state.events.send(DesktopEvent::OperationFailed {
            code: error.code().to_string(),
            message: error.message().to_string(),
        });
        {
            let mut desktop_state = state.desktop_state.write().await;
            desktop_state.conversation.messages.push(conversation_error_message(
                error.code(),
                error.message().to_string(),
            ));
        }
        return Err(agent_runtime_error_status(&error));
    }
};
```

- [ ] **Step 5: 运行 send tests**

Run:

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml gateway_send_message_is_rust_backed_and_streams_session_events gateway_send_message_provider_failure_returns_typed_failure
```

Expected: both tests pass.

- [ ] **Step 6: 提交**

Run:

```bash
scripts/committer "Desktop: write task conversation messages" \
  apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs \
  apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_native_operations.rs \
  apps/crawclaw-desktop/src-tauri/tests/gateway_desktop_api_test.rs
```

## Task 5: 写入 Tool 和 Permission Messages

**Files:**

- Modify: `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_plugin_operations.rs`
- Modify: `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_core_routes.rs`
- Modify: `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`
- Modify: `apps/crawclaw-desktop/src-tauri/tests/gateway_desktop_api_test.rs`

- [ ] **Step 1: 添加 focused assertions**

Add a test named `gateway_plugin_invocation_records_tool_messages` that invokes
`qwen3-tts/qwen3_tts_build_payload` with a small input and asserts that
`conversation.messages` contains `toolCall` and `toolResult` entries.

Add a helper test in `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`
under `#[cfg(test)]`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::gateway::desktop_state::initial_desktop_state;
    use crate::models::{PermissionStatus, RuntimeStatus};
    use crawclaw_core::{RuntimeCompatStatus, RuntimeStatusValue};

    fn ready_runtime_status() -> RuntimeStatus {
        RuntimeStatus {
            status: RuntimeStatusValue::Ready,
            detail: "ready".to_string(),
            runtime_root: "/tmp/crawclaw-test".to_string(),
            binary_path: "/tmp/crawclaw-test/bin/crawclaw-runtime".to_string(),
            compat: RuntimeCompatStatus::default(),
        }
    }

    #[test]
    fn upsert_permission_message_updates_existing_message() {
        let mut state = initial_desktop_state(&ready_runtime_status());

        upsert_permission_message(&mut state, "permission-1", PermissionStatus::Pending);
        upsert_permission_message(&mut state, "permission-1", PermissionStatus::Approved);

        let permission_messages = state
            .conversation
            .messages
            .iter()
            .filter(|message| matches!(message, ConversationMessage::Permission { .. }))
            .count();
        assert_eq!(permission_messages, 1);
        assert!(matches!(
            state.conversation.messages.last(),
            Some(ConversationMessage::Permission {
                request_id,
                status: PermissionStatus::Approved,
                ..
            }) if request_id == "permission-1"
        ));
    }
}
```

- [ ] **Step 2: 运行 tests 并确认失败**

Run:

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml gateway_plugin_invocation_records_tool_messages
```

Expected: test fails because plugin invocation writes only string result items.

- [ ] **Step 3: 添加 tool message helpers**

In `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`, add:

```rust
fn conversation_tool_call_message(tool_id: String, title: String, detail: Option<String>) -> ConversationMessage {
    ConversationMessage::ToolCall {
        id: now_message_id("tool-call"),
        tool_id,
        title,
        detail,
        created_at: "刚刚".to_string(),
    }
}

fn conversation_tool_result_message(tool_id: String, title: String, ok: bool, text: String) -> ConversationMessage {
    ConversationMessage::ToolResult {
        id: now_message_id("tool-result"),
        tool_id,
        title,
        ok,
        text,
        created_at: "刚刚".to_string(),
    }
}
```

- [ ] **Step 4: append tool call 和 result messages**

In `desktop_plugin_operations.rs`, before invoking the tool, push
`conversation_tool_call_message(tool_id.clone(), format!("{plugin_id}/{tool_id}"), None)`.

On success, push `conversation_tool_result_message(tool_id.clone(), format!("{plugin_id}/{tool_id}"), true, result_text.clone())`.

On failure, push the same helper with `ok: false` and the error message.

- [ ] **Step 5: 添加 permission message helper**

In `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`, add:

```rust
fn upsert_permission_message(
    desktop_state: &mut DesktopState,
    request_id: &str,
    status: PermissionStatus,
) {
    let detail = match status {
        PermissionStatus::Pending => "等待用户确认".to_string(),
        PermissionStatus::Approved => "已允许一次".to_string(),
        PermissionStatus::Denied => "已拒绝".to_string(),
    };
    if let Some(ConversationMessage::Permission { status: existing_status, detail: existing_detail, .. }) =
        desktop_state.conversation.messages.iter_mut().find(|message| {
            matches!(message, ConversationMessage::Permission { request_id: id, .. } if id == request_id)
        })
    {
        *existing_status = status;
        *existing_detail = detail;
        return;
    }
    desktop_state.conversation.messages.push(ConversationMessage::Permission {
        id: now_message_id("permission"),
        request_id: request_id.to_string(),
        title: "权限审核".to_string(),
        detail,
        status,
        created_at: "刚刚".to_string(),
    });
}
```

Call this from `permission_decision` after assigning
`desktop_state.permission_request`.

- [ ] **Step 6: 运行 focused tests**

Run:

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml gateway_plugin_invocation_records_tool_messages permission
```

Expected: plugin and permission tests pass.

- [ ] **Step 7: 提交**

Run:

```bash
scripts/committer "Desktop: record tool and permission messages" \
  apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs \
  apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_plugin_operations.rs \
  apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_core_routes.rs \
  apps/crawclaw-desktop/src-tauri/tests/gateway_desktop_api_test.rs
```

## Task 6: 渲染真实 Conversation Messages

**Files:**

- Create: `apps/crawclaw-desktop/src/views/conversation-messages.tsx`
- Modify: `apps/crawclaw-desktop/src/views/chat-thread.tsx`
- Modify: `apps/crawclaw-desktop/src/views/chat-workspace.tsx`
- Modify: `apps/crawclaw-desktop/src/api/desktop-initial-state.ts`
- Modify: `apps/crawclaw-desktop/src/app/use-desktop-state.ts`
- Modify: `apps/crawclaw-desktop/src/styles/app.css`

- [ ] **Step 1: 运行当前 renderer build 作为 baseline**

Run:

```bash
pnpm --prefix apps/crawclaw-desktop build
```

Expected: command exits 0 before frontend refactor. If it fails, record the
first actionable error and fix only if related to the touched desktop renderer.

- [ ] **Step 2: 创建 message renderer**

Create `apps/crawclaw-desktop/src/views/conversation-messages.tsx`:

```tsx
import {
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";
import type { ConversationMessage, PermissionRequest } from "../desktop-api";
import { Badge } from "../ui/badge";

type ConversationMessageListProps = {
  messages: ConversationMessage[];
  onDecidePermission: (requestId: string, status: "approved" | "denied") => void;
  permissionRequest: PermissionRequest;
};

export function ConversationMessageList({
  messages,
  onDecidePermission,
  permissionRequest,
}: ConversationMessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="conversation-empty">
        <Sparkles aria-hidden="true" size={18} strokeWidth={2.1} />
        <strong>开始一个本机任务</strong>
        <p>发送任务后，这里会显示模型回复、工具调用、权限确认和执行结果。</p>
      </div>
    );
  }

  return (
    <ol className="chat-thread">
      {messages.map((message) => (
        <li className={`chat-row chat-row--${message.kind}`} key={message.id}>
          <MessageBubble
            message={message}
            onDecidePermission={onDecidePermission}
            permissionRequest={permissionRequest}
          />
        </li>
      ))}
    </ol>
  );
}
```

Add `MessageBubble` in the same file with exhaustive `switch (message.kind)`.
Use `UserRound` for user, `Sparkles` for assistant, `Wrench` for tool messages,
`ShieldCheck` for permission, and `AlertTriangle` for errors.

- [ ] **Step 3: 替换 static `ChatThread` content**

In `apps/crawclaw-desktop/src/views/chat-thread.tsx`, remove static demo list
content and render:

```tsx
<section className="desktop-content" aria-label="对话工作区">
  <ConversationMessageList
    messages={conversation.messages}
    onDecidePermission={onDecidePermission}
    permissionRequest={permissionRequest}
  />
</section>
```

Update `ChatThreadProps` to accept `onDecidePermission` and
`permissionRequest`. Remove media preview props that become unused.

- [ ] **Step 4: 更新 `ChatWorkspace` props**

In `apps/crawclaw-desktop/src/views/chat-workspace.tsx`, pass:

```tsx
<ChatThread
  conversation={conversation}
  onDecidePermission={onDecidePermission}
  permissionRequest={permissionRequest}
/>
```

Remove batch image, video preview, and image preview state if no longer used by
the default thread.

- [ ] **Step 5: 更新 unavailable state 和 operation errors**

In `apps/crawclaw-desktop/src/api/desktop-initial-state.ts`, set:

```ts
conversation: {
  messages: [
    {
      createdAt: '刚刚',
      detail,
      id: 'desktop-api-unavailable',
      kind: 'error',
      code: 'desktop_api_unavailable',
      title: 'Desktop API 不可用',
    },
  ],
  resultItems: [detail],
  ...
}
```

In `apps/crawclaw-desktop/src/app/use-desktop-state.ts`, when an operation
fails, append a structured `error` message instead of replacing only
`resultItems`.

- [ ] **Step 6: 为 structured messages 添加 CSS**

In `apps/crawclaw-desktop/src/styles/app.css`, add classes:

```css
.conversation-empty {
  width: min(620px, 100%);
  margin: auto;
  padding: 24px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--surface-strong);
}

.conversation-message {
  max-width: min(620px, 82%);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--surface-strong);
  padding: 15px 17px;
}

.conversation-message--error {
  border-color: rgba(220, 38, 38, 0.22);
}

.conversation-message__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
```

- [ ] **Step 7: 构建 frontend**

Run:

```bash
pnpm --prefix apps/crawclaw-desktop build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 8: 提交**

Run:

```bash
scripts/committer "Desktop: render task conversation messages" \
  apps/crawclaw-desktop/src/views/conversation-messages.tsx \
  apps/crawclaw-desktop/src/views/chat-thread.tsx \
  apps/crawclaw-desktop/src/views/chat-workspace.tsx \
  apps/crawclaw-desktop/src/api/desktop-initial-state.ts \
  apps/crawclaw-desktop/src/app/use-desktop-state.ts \
  apps/crawclaw-desktop/src/styles/app.css
```

## Task 7: 将 Settings 绑定到 Persisted Preferences

**Files:**

- Modify: `apps/crawclaw-desktop/src/views/settings-workspace.tsx`
- Modify: `apps/crawclaw-desktop/src/App.tsx`
- Modify: `apps/crawclaw-desktop/src/api/desktop-client.ts`
- Modify: `apps/crawclaw-desktop/src/styles/app.css`

- [ ] **Step 1: 运行当前 renderer build 作为 baseline**

Run:

```bash
pnpm --prefix apps/crawclaw-desktop build
```

Expected: build passes before settings refactor.

- [ ] **Step 2: 为 expanded preference patches 建类型**

In `apps/crawclaw-desktop/src/api/desktop-client.ts`, update
`updatePreferences` to accept:

```ts
export async function updatePreferences(patch: Partial<DesktopPreferences>): Promise<DesktopState> {
  return mutateDesktopState("/api/desktop/preferences", {
    body: patch,
    method: "PATCH",
  });
}
```

- [ ] **Step 3: 用 persisted values 替换 local settings state**

In `apps/crawclaw-desktop/src/views/settings-workspace.tsx`, add
`preferences: DesktopPreferences` to props. Read values from
`preferences.taskDefaults`, `preferences.confirmationDefaults`,
`preferences.notificationDefaults`, `preferences.uiDefaults`,
`preferences.memoryDefaults`, `preferences.privacyDefaults`, and
`preferences.advancedDefaults`.

Keep local state only for `isAddingModel` and `modelDraftName`.

- [ ] **Step 4: 添加 row status labels**

Add a helper:

```tsx
function SettingsRowStatus({ status }: { status: "active" | "preview" | "planned" }) {
  const label = status === "active" ? "已接入" : status === "preview" ? "偏好预览" : "计划中";
  return <span className={`settings-row-status is-${status}`}>{label}</span>;
}
```

Use `active` for model, thinking, permission mode, confirmation defaults, and
task notification defaults. Use `preview` for appearance, language, response
speed, memory defaults, and log level. Use `planned` for launch at login, menu
bar behavior, cache cleanup, data export, data deletion, and diagnostics.

- [ ] **Step 5: Patch grouped values**

When a task default changes, call:

```tsx
onPreferenceUpdate({
  selectedModel: nextTaskDefaults.selectedModel,
  selectedThinking: nextTaskDefaults.selectedThinking,
  permissionMode: nextTaskDefaults.permissionMode,
  taskDefaults: nextTaskDefaults,
});
```

When a confirmation default changes, call:

```tsx
onPreferenceUpdate({
  confirmationDefaults: {
    ...preferences.confirmationDefaults,
    confirmCommands: !preferences.confirmationDefaults.confirmCommands,
  },
});
```

Use the same pattern for notification, UI, memory, privacy, and advanced groups.

- [ ] **Step 6: 禁用 planned native actions**

For planned action rows, render disabled buttons with status labels and do not
send preference patches:

```tsx
<button className="settings-action-button" disabled type="button">
  计划中
</button>
```

- [ ] **Step 7: 构建 frontend**

Run:

```bash
pnpm --prefix apps/crawclaw-desktop build
```

Expected: build passes.

- [ ] **Step 8: 提交**

Run:

```bash
scripts/committer "Desktop: bind settings preferences" \
  apps/crawclaw-desktop/src/views/settings-workspace.tsx \
  apps/crawclaw-desktop/src/App.tsx \
  apps/crawclaw-desktop/src/api/desktop-client.ts \
  apps/crawclaw-desktop/src/styles/app.css
```

## Task 8: 最终验证

**Files:**

- Verify changed desktop and runtime surfaces.

- [ ] **Step 1: 运行 focused Rust tests**

Run:

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml \
  desktop_api_contract_generated_types_are_current \
  gateway_expanded_preferences_persist_through_rust_runtime_store \
  gateway_bootstrap_reads_persisted_rust_session_transcripts \
  gateway_send_message_is_rust_backed_and_streams_session_events \
  gateway_send_message_provider_failure_returns_typed_failure \
  gateway_plugin_invocation_records_tool_messages
```

Expected: all named tests pass.

- [ ] **Step 2: 运行 desktop contract check**

Run:

```bash
pnpm desktop:contract:check
```

Expected: command exits 0 with no generated contract diff.

- [ ] **Step 3: 运行 desktop renderer build**

Run:

```bash
pnpm --prefix apps/crawclaw-desktop build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 4: 运行 local repo check**

Run:

```bash
pnpm check
```

Expected: local repo check passes. If it fails in unrelated areas, record the
first unrelated failure and keep the desktop-focused evidence separate.

- [ ] **Step 5: Browser verification**

Run:

```bash
pnpm --prefix apps/crawclaw-desktop dev
```

Open `http://127.0.0.1:1420/` in the in-app browser and verify:

- The default conversation does not show the static demo transcript.
- Empty state explains that task events appear after sending.
- If Desktop API is unavailable, an error bubble appears in the thread.
- Settings sections remain visible.
- Settings rows show `已接入`, `偏好预览`, or `计划中`.
- Planned native actions are visible but disabled.

- [ ] **Step 6: 最终 status check**

Run:

```bash
git status --short
```

Expected: no uncommitted changes except intentional files that still need a
final commit.

- [ ] **Step 7: 处理 unexpected verification changes**

Expected: Step 6 prints no paths. If Step 6 prints any path, do not mark the
plan complete. Inspect the diff for the printed path. If a generated contract or
formatting-only path changed, rerun the command from the task that owns that
file and commit the exact file path listed in that task's commit step. If a
semantic path changed unexpectedly, pause execution and report the diff before
continuing.

## Self-Review

- Spec coverage: Tasks 1, 3, 4, 5, and 6 cover structured conversation messages;
  Tasks 2 and 7 cover full settings visibility and persistence; Task 8 covers
  final verification.
- Type consistency: `ConversationMessage`, grouped preference names, and
  compatibility aliases match between Rust models, TypeScript contract, stores,
  and React props.
- Scope control: The plan does not add TypeScript tests, does not create a new
  plugin SDK surface, and does not implement real operating-system integrations
  for settings marked `planned`.
