# Agent Group Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for parallelizable implementation work, or `superpowers:executing-plans` for a single inline worker. Track progress with the checkboxes below and run the verification command listed for each task before checking it off.

**Goal:** Build the first production slice of agent group rooms in CrawClaw Desktop: a user starts one supervised room, selects a lead agent and member agents, the room records a shared transcript, member agents contribute bounded responses, and the lead agent posts the final answer back into the conversation.

**Scope:** This plan implements Phase 1 from `docs/superpowers/specs/2026-06-11-agent-group-room-design.md`. It is Desktop-only. It does not add external chat binding, public always-on group execution, a JavaScript plugin SDK, or a model-chosen speaker selector.

**Architecture:** Add an `agentGroups` workspace slice to `DesktopState`, add an `agentGroup` conversation message kind for room events, expose a Desktop API endpoint that validates and starts a group run, persist the room transcript through the existing desktop session store, execute member turns through the existing Rust `AgentRuntime`, then execute the lead summary turn with member outputs as structured context.

**Tech Stack:** Rust, Tauri, Axum, serde, React, TypeScript, Vite, existing desktop contract generator, existing Rust gateway tests.

---

### Task 1: Add the Desktop State and Contract Shape

**Files:**

- `apps/crawclaw-desktop/src-tauri/src/models.rs`
- `apps/crawclaw-desktop/src-tauri/src/desktop_contract.rs`
- `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_state.rs`
- `apps/crawclaw-desktop/src-tauri/tests/desktop_contract_test.rs`
- `apps/crawclaw-desktop/src/generated/desktop-api-contract.generated.ts`
- `apps/crawclaw-desktop/src/api/desktop-initial-state.ts`
- `apps/crawclaw-desktop/src/desktop-api.ts`

**Changes:**

- [ ] Add `pub agent_groups: AgentGroupWorkspaceState` to `DesktopState` immediately after `agent_workspace` so desktop agent features stay grouped.
- [ ] Add these serializable model types with `#[serde(rename_all = "camelCase")]`:

```rust
pub struct AgentGroupWorkspaceState {
    pub selected_group_id: String,
    pub groups: Vec<AgentGroupRoomSummary>,
    pub active_run: Option<AgentGroupRunState>,
}

pub struct AgentGroupRoomSummary {
    pub id: String,
    pub title: String,
    pub lead_agent_id: String,
    pub member_agent_ids: Vec<String>,
    pub status: String,
    pub last_activity_at: String,
}

pub struct AgentGroupRunState {
    pub id: String,
    pub group_id: String,
    pub thread_id: String,
    pub task: String,
    pub lead_agent_id: String,
    pub member_runs: Vec<AgentGroupMemberRunState>,
    pub status: String,
    pub created_at: String,
    pub completed_at: Option<String>,
}

pub struct AgentGroupMemberRunState {
    pub agent_id: String,
    pub status: String,
    pub run_id: Option<String>,
    pub summary: Option<String>,
    pub error_code: Option<String>,
}
```

- [ ] Add a `ConversationMessage::AgentGroup` variant with fields `id`, `group_id`, `room_run_id`, `title`, `detail`, `stage`, `lead_agent_id`, `member_agent_ids`, `active_agent_id: Option<String>`, `status`, and `created_at`.
- [ ] Initialize `agent_groups` in `initial_desktop_state` with no groups and no active run.
- [ ] Update the generated TypeScript contract source in `desktop_contract.rs`, regenerate `desktop-api-contract.generated.ts`, and add the matching fallback object in `desktop-initial-state.ts`.
- [ ] Re-export the new generated types from `desktop-api.ts` only through the existing generated contract export pattern.
- [ ] Add contract tests:
  - `desktop_api_contract_exposes_agent_group_room_state`
  - extend `desktop_api_contract_conversation_message_wire_shape_is_camel_case` or add a new test proving `roomRunId` and `leadAgentId` serialize in camelCase.

**Verify:**

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml desktop_api_contract_exposes_agent_group_room_state
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml desktop_api_contract_conversation_message_wire_shape_is_camel_case
```

---

### Task 2: Build Agent Group Validation and Workspace Defaults

**Files:**

- `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_agent_group_routes.rs`
- `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`
- `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_state.rs`

**Changes:**

- [ ] Add `mod desktop_agent_group_routes;` next to the other desktop API submodules.
- [ ] Add `StartAgentGroupRunRequest`:

```rust
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StartAgentGroupRunRequest {
    pub task: String,
    pub lead_agent_id: String,
    pub member_agent_ids: Vec<String>,
    pub max_turns: Option<u8>,
    pub max_parallel_agents: Option<u8>,
}
```

- [ ] Add `ValidatedAgentGroupRun` with resolved lead and member `AgentDefinition` values plus normalized `max_turns` and `max_parallel_agents`.
- [ ] Implement `validate_agent_group_run_request(request, agents)`:
  - `task.trim()` must be non-empty.
  - `lead_agent_id` must match an existing agent.
  - `member_agent_ids` must contain at least one existing agent.
  - `member_agent_ids` must not contain duplicates.
  - `member_agent_ids` must not contain the lead agent.
  - `max_turns` defaults to `4` and accepts only `1..=12`.
  - `max_parallel_agents` defaults to `3` and accepts only `1..=3`.
- [ ] Return `(StatusCode, ConversationMessage)` for validation failures so the route can both respond and record a user-visible error.
- [ ] Add a workspace sync helper that creates one suggested group when at least two desktop agents exist:
  - group id: `default-supervised-room`
  - title: `任务群`
  - lead agent: currently selected agent when present, otherwise the first agent
  - members: all other agents, capped to three
- [ ] Call the sync helper after `merge_persisted_agents` so bootstrap and state refresh have stable group defaults.
- [ ] Add unit tests inside `desktop_agent_group_routes.rs` for duplicate members, missing lead, lead included as member, and default group derivation.

**Verify:**

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml desktop_agent_group_routes
```

---

### Task 3: Add the Start Route and Persist the Room Transcript

**Files:**

- `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`
- `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_agent_group_routes.rs`
- `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_native_operations.rs`
- `apps/crawclaw-desktop/src-tauri/tests/gateway_desktop_api_test.rs`

**Changes:**

- [ ] Register `POST /api/desktop/agent-groups/runs` in the Desktop API router with the same session-token middleware behavior as other mutation routes.
- [ ] In the route handler:
  - read the current `agent_workspace.agents`,
  - validate with `validate_agent_group_run_request`,
  - create `room_run_id = "group-run-" + Uuid::new_v4().simple()`,
  - create `thread_id = "group-" + Uuid::new_v4().simple()`,
  - create a session with `DesktopSessionStore::create_session(&thread_id, Some("任务群"), None)`,
  - set the new group thread active in `sidebar.threads`,
  - set `conversation.messages` to the group thread transcript,
  - write one user message and one `agentGroup` status message through `append_and_persist_conversation_message_with_emit`,
  - set `agent_groups.active_run.status = "running"`,
  - return the updated `DesktopState`.
- [ ] Update `conversation_message_title` and `conversation_message_content` in `desktop_native_operations.rs` so `agentGroup` messages persist with useful labels and text.
- [ ] Add gateway tests:
  - `gateway_agent_group_room_rejects_unknown_members`
  - `gateway_agent_group_room_start_creates_room_thread`
- [ ] The start test should assert the response contains `agentGroups.activeRun.threadId`, the active thread id starts with `group-`, and the conversation contains an `agentGroup` message with `roomRunId`.

**Verify:**

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml gateway_agent_group_room_rejects_unknown_members
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml gateway_agent_group_room_start_creates_room_thread
```

---

### Task 4: Execute Member Turns and the Lead Summary

**Files:**

- `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_agent_group_routes.rs`
- `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_native_operations.rs`
- `crates/crawclaw-runtime/src/desktop_runtime_stores.rs`
- `apps/crawclaw-desktop/src-tauri/tests/gateway_desktop_api_test.rs`

**Changes:**

- [ ] Spawn one background task from the start route after the synchronous state update succeeds.
- [ ] Run member turns sequentially in v1 for deterministic transcript ordering. Enforce `max_parallel_agents` as a member-count cap in validation for this slice.
- [ ] For each member:
  - update `agent_groups.active_run.member_runs[n].status` to `running`,
  - append an `agentGroup` message with `stage = "memberRunning"` and `activeAgentId`,
  - call `AgentRuntime::run_turn` with the member agent id, member model selection, member tool selection, member system prompt, and a room-scoped `session_key`,
  - append loop events through `conversation_messages_for_loop_events`,
  - store `assistant_text` as the member summary,
  - set status to `completed` or `failed`.
- [ ] Make the existing helper functions in `desktop_native_operations.rs` visible to the sibling module when needed:
  - `model_selection_from_agent`
  - `tool_selection_from_agent`
  - `system_prompt_from_agent`
  - `conversation_messages_for_loop_events`
- [ ] Build member prompts with this structure:

```text
You are participating in a CrawClaw supervised agent group room.
Lead agent: {lead_name}
Your role: {member_name}

Task:
{task}

Return the contribution that the lead agent should consider. Do not address the user directly unless the task asks for a draft user-facing answer.
```

- [ ] After member turns finish, call `AgentRuntime::run_turn` for the lead agent with a lead prompt containing the original task and one fenced section per member output.
- [ ] Append the lead answer as a normal `ConversationMessage::Assistant` with `run_id = room_run_id` so the existing chat surface and session persistence keep working.
- [ ] Mark `agent_groups.active_run.status` as `completed` only after the lead answer is persisted. Mark it `failed` when the lead turn fails.
- [ ] Add tests for pure prompt builders and state reducers:
  - `agent_group_member_prompt_contains_task_and_role`
  - `agent_group_lead_prompt_contains_member_outputs`
  - `agent_group_state_marks_failed_member_without_stopping_room`

**Verify:**

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml agent_group_member_prompt_contains_task_and_role
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml agent_group_lead_prompt_contains_member_outputs
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml agent_group_state_marks_failed_member_without_stopping_room
```

---

### Task 5: Add Desktop Client and UI Controls

**Files:**

- `apps/crawclaw-desktop/src/api/desktop-client.ts`
- `apps/crawclaw-desktop/src/desktop-api.ts`
- `apps/crawclaw-desktop/src/App.tsx`
- `apps/crawclaw-desktop/src/views/chat-workspace.tsx`
- `apps/crawclaw-desktop/src/views/conversation-messages.tsx`
- `apps/crawclaw-desktop/src/styles.css`

**Changes:**

- [ ] Add `startAgentGroupRun(input)` to `desktop-client.ts` using `postDesktopState('/api/desktop/agent-groups/runs', input)`.
- [ ] Export the request function from `desktop-api.ts`.
- [ ] Pass `agentGroups` and `onStartAgentGroupRun` from `App.tsx` into `ChatWorkspace`.
- [ ] In `ChatWorkspace`, add a compact mode switch near the existing send controls:
  - `单 agent`
  - `任务群`
- [ ] In `任务群` mode, show:
  - lead agent select,
  - member agent checklist,
  - disabled submit state when fewer than two agents exist or no member is selected.
- [ ] Reuse the current chat draft text as the group task. Do not add a second task text area.
- [ ] Render `ConversationMessage.kind === 'agentGroup'` in `conversation-messages.tsx` as a compact system event with lead/member labels and status.
- [ ] Keep the default mode as `单 agent` to avoid changing existing chat behavior.
- [ ] Add CSS with stable dimensions for the mode switch and member checklist so the composer height does not jump while toggling checkboxes.

**Verify:**

```bash
pnpm tsgo
pnpm check
```

---

### Task 6: Regenerate Contracts and Run Landing Verification

**Files:**

- `apps/crawclaw-desktop/src-tauri/src/desktop_contract.rs`
- `apps/crawclaw-desktop/src/generated/desktop-api-contract.generated.ts`
- all files changed by Tasks 1-5

**Changes:**

- [ ] Run the desktop contract generator after Rust model changes:

```bash
cargo run --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml -- emit-desktop-api-contract --output apps/crawclaw-desktop/src/generated/desktop-api-contract.generated.ts
```

- [ ] Run the contract check:

```bash
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml desktop_api_contract_generated_types_are_current
```

- [ ] Run the focused Rust tests added above.
- [ ] Run the local dev gate:

```bash
pnpm check
```

- [ ] Run the hard build gate because this changes Desktop API, generated frontend contract, and UI code:

```bash
pnpm build
```

- [ ] Review `git diff --check`.
- [ ] Commit only the files touched for this feature with:

```bash
scripts/committer "Desktop: add agent group rooms" <changed feature files>
```

**Verify:**

```bash
git diff --check
git status --short
```
