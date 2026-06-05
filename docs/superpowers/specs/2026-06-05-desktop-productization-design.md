---
title: Desktop Productization Design
summary: Design for making CrawClaw Desktop a productized local task workbench across frontend interaction, desktop gateway state, runtime events, and backend ownership.
read_when:
  - You are implementing or reviewing CrawClaw Desktop product UX.
  - You are changing desktop run events, conversation state, sub-agent display, permissions, plugins, agents, memory, or settings.
  - You need the staged rollout plan for turning the current desktop app into a cohesive task workbench.
---

# Desktop Productization Design

## Summary

CrawClaw Desktop already has many of the right capabilities in place: chat,
attachments, voice input, workflow messages, skills, plugin tools, agents,
memory, permissions, sub-agents, sessions, runtime status, model profiles, and
settings. The product gap is not a lack of pages. The gap is that these
capabilities do not yet resolve into one clear task lifecycle that a user can
understand while work is happening.

The target product should feel like a local task workbench:

- the user starts from active work, not from a static showcase
- every task has a visible lifecycle
- every tool call, permission decision, sub-agent, context summary, artifact,
  failure, retry, and final answer belongs to that lifecycle
- agents and plugins are configured through a capability model that connects
  directly to task execution
- settings explain and repair the local runtime instead of acting as a broad
  control gallery

This design recommends an incremental path: build a task run model and
conversation timeline first, then add a task center, then unify agents, plugins,
skills, memory, and settings around that model. It avoids a full rewrite and
keeps Rust as the owner of runtime execution.

## Current Code Baseline

The active desktop product chain is:

```text
Tauri shell
  -> React renderer
  -> local Desktop Gateway HTTP and SSE
  -> desktop state and stores
  -> Rust runtime, sessions, tools, providers, memory, and native plugins
```

Important current surfaces:

| Area                                    | Current code                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| App shell and workspace routing         | `apps/crawclaw-desktop/src/App.tsx`                                                                              |
| Desktop state bootstrap and SSE reducer | `apps/crawclaw-desktop/src/app/use-desktop-state.ts`                                                             |
| Desktop HTTP client                     | `apps/crawclaw-desktop/src/api/desktop-client.ts`                                                                |
| Desktop SSE subscription                | `apps/crawclaw-desktop/src/api/desktop-events.ts`                                                                |
| Chat and composer interaction           | `apps/crawclaw-desktop/src/views/chat-workspace.tsx`                                                             |
| Conversation rendering                  | `apps/crawclaw-desktop/src/views/chat-thread.tsx`, `apps/crawclaw-desktop/src/views/conversation-messages.tsx`   |
| Agent management                        | `apps/crawclaw-desktop/src/views/agent-workspace.tsx`, `apps/crawclaw-desktop/src/views/agent-create-wizard.tsx` |
| Plugin tools and skills                 | `apps/crawclaw-desktop/src/views/plugins-workspace.tsx`                                                          |
| Memory workspace                        | `apps/crawclaw-desktop/src/views/memory-workspace.tsx`                                                           |
| Settings                                | `apps/crawclaw-desktop/src/views/settings-workspace.tsx`                                                         |
| Desktop API server state                | `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`                                                     |
| Desktop native mutations                | `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_native_operations.rs`                           |
| Desktop session routes                  | `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_session_routes.rs`                              |
| Runtime loop events                     | `crates/crawclaw-runtime/src/agent_runtime_types.rs`                                                             |
| Runtime backend                         | `crates/crawclaw-runtime/src/agent_runtime_backend.rs`                                                           |
| Gateway session ownership               | `crates/crawclaw-gateway/src/gateway_sessions.rs`                                                                |
| Gateway RPC ownership                   | `crates/crawclaw-gateway/src/gateway_rpc.rs`                                                                     |

The renderer already handles bootstrap, runtime status, message deltas, message
finals, tool calls, tool results, permission changes, permission requests,
operation failures, and state snapshots. It does not yet make the event stream a
complete run lifecycle. For example, the backend emits `SessionStarted` during
desktop sends, but the current renderer reducer does not handle that event as a
first-class state transition.

The runtime also exposes richer events than the desktop currently renders.
`AgentLoopEvent` includes context projection, provider blocks, tool execution,
tool progress, permission events, tool use summaries, and hooks. Desktop
currently reduces most of that into generic tool call and tool result messages.

## Product Problem

The current app has a breadth problem and a lifecycle problem.

The breadth problem: users see chat, agents, plugins, memory, automation, and
settings as separate rooms. That makes the app look capable, but the connection
between "configure a capability" and "use it in a real task" is not always
obvious.

The lifecycle problem: once a user sends a task, the app does not yet show the
full execution story. It can stream an assistant message, show generic tool
events, and ask for permission, but it does not consistently show:

- what context was used
- which agent profile owned the run
- which tools were available
- which tools ran and why
- what progress each tool reported
- which permission decisions were made
- which sub-agents were spawned
- which artifacts were created
- why a failure happened
- what the user can do next

The product should make those answers visible without forcing the user to read
logs or understand runtime internals.

## Goals

- Make the desktop default screen an active task workbench.
- Make every user task produce a structured run with visible state.
- Render a chronological task timeline inside the conversation.
- Show tool calls, progress, permission requests, sub-agent activity, artifacts,
  failures, retries, and final answers as one coherent interaction.
- Connect agent, plugin, skill, memory, and settings pages to actual task
  execution.
- Keep Rust as the owner of runtime policy, provider calls, tool execution,
  session state, memory, and permissions.
- Keep React as a renderer and local interaction controller.
- Use the existing Desktop Gateway as the product API rather than adding a new
  TypeScript runtime seam.
- Keep implementation staged enough that each phase can be tested and shipped.

## Non Goals

- Do not rewrite the whole desktop app.
- Do not add a public JavaScript plugin SDK.
- Do not move runtime orchestration into React.
- Do not replace the Rust runtime loop.
- Do not make remote gateway parity a prerequisite for the desktop product.
- Do not implement every settings control as a platform integration in the
  first phase.
- Do not change generated `docs/zh-CN/**` files for this design.
- Do not touch security-restricted surfaces for unrelated cleanup.

## Assumptions

- CrawClaw Desktop remains the supported local-first product entrypoint.
- The local Desktop Gateway remains loopback-bound and token-protected.
- The desktop app continues to consume `/api/desktop/bootstrap`,
  `/api/desktop/state`, `/api/desktop/events`, and matching mutation routes.
- Session transcripts remain the durable history source.
- Runtime execution remains Rust-owned.
- The desktop renderer can show richer run state without becoming the owner of
  run policy.
- Some current files are larger than ideal. The design includes targeted splits
  only where they support the product work.

## Design Principles

1. Tasks are the primary object.
   A conversation is important because it contains task runs. A plugin is
   important because it can be used in a task. A setting is important because it
   changes task behavior, safety, or repair.

2. Running work must be observable.
   The user should always know whether CrawClaw is thinking, using context,
   waiting for permission, running a tool, spawning a sub-agent, writing an
   artifact, retrying, or finished.

3. Capability configuration must lead to usage.
   Agent, plugin, tool, skill, and memory configuration should show where the
   capability will be used and how it affects tasks.

4. Advanced controls should stay reachable but quiet.
   The composer should expose current agent, model, thinking, permission mode,
   attachments, and command entry. Less frequent settings should live in menus,
   drawers, or workspace pages.

5. Failed states need recovery actions.
   A failed runtime check, provider setup, tool call, memory sync, or permission
   decision should offer the next useful action.

6. Rust emits facts. React renders decisions.
   Rust should emit structured run events and state snapshots. React should
   render them, keep temporary UI state, and ask for user decisions.

## Recommended Product Shape

### Primary Information Architecture

The app should keep the current workspace model, but reorder it around user
work:

| Product area  | Purpose                                                      | Current source                             |
| ------------- | ------------------------------------------------------------ | ------------------------------------------ |
| Task Center   | Default entrypoint for active and recent work                | new workspace composed from existing state |
| Conversations | Threaded task timelines and composer                         | `ChatWorkspace`                            |
| Agents        | Worker profiles, tools, skills, model, permission defaults   | `AgentWorkspace`                           |
| Capabilities  | Plugins, tools, skills, installs, and test runs              | `PluginsWorkspace`                         |
| Memory        | Local and Hindsight memory activity, search, repair          | `MemoryWorkspace`                          |
| Automations   | Scheduled or recurring work                                  | existing nav item, future workspace        |
| Settings      | Runtime, providers, safety, privacy, notifications, advanced | `SettingsWorkspace`                        |

The left sidebar can keep conversations visible, but the nav should make active
task status visible. The user should not need to enter each workspace to know
that a task is running, permission is pending, or a tool failed.

### Task Center

Task Center is the product home. It should show:

- running tasks
- permission requests
- failed tasks with recovery actions
- recent completed tasks
- recent artifacts
- running sub-agents
- memory sync state
- runtime health
- setup gaps that block useful work

The first version can be built from existing conversation state, session state,
permission state, runtime checks, memory workspace state, and sub-agent
summaries. It does not need a new durable task database in the first phase if
the run model is introduced in conversation state.

### Conversations

Conversation remains the main work surface. The layout should be:

```text
Header
  current thread, agent, model, runtime status, task actions

Timeline
  user message
  run card
  context summary
  tool and permission events
  sub-agent events
  assistant answer
  artifacts and follow-up actions

Composer
  attachment menu, agent selector, thinking selector, model selector,
  permission mode, text input, voice input, send or stop
```

The existing composer already has many of these controls. The design goal is not
to add more controls. The goal is to make their effect clear before and after a
task is sent.

### Agents

Agents should be presented as reusable task profiles:

- identity and purpose
- model and thinking defaults
- permission default
- enabled tools
- enabled skills
- memory behavior
- channel behavior
- last used tasks
- setup or validation status

The create wizard should end with a usable "test this agent" action. The agent
detail page should show what a task will inherit from the agent and which
settings are overridden by the active conversation.

### Capabilities

Plugins, tools, and skills should be grouped as capabilities:

- installed plugins
- available tools
- available skills
- permission category
- read-only or write-capable status
- owning plugin or runtime source
- required configuration
- recent usage
- attach to agent action
- test run action where safe

This keeps `PluginsWorkspace` from acting like an isolated marketplace. It
becomes the place where users understand what CrawClaw can do and how those
abilities enter a task.

### Memory

Memory should show both content and operational state:

- memory records
- active filters and search
- Hindsight status
- worker status
- outbox state
- last sync
- sync failures
- repair actions
- task runs that wrote or used memory

The user should be able to answer two questions quickly: "what does CrawClaw
remember?" and "is memory healthy?"

### Settings

Settings should become a repair and defaults surface:

- General and appearance
- Provider and model setup
- Task defaults
- Permission defaults
- Memory defaults
- Notifications
- Privacy and data
- Runtime diagnostics
- Advanced controls

Every setting row should have an honest state:

- Active: persisted and affects current task behavior.
- Preview: persisted or displayed, but not connected to a platform effect yet.
- Needs setup: blocked by missing provider, runtime, plugin, permission, or
  operating-system capability.

## Task Run Lifecycle

### State Machine

Each user task should have one run state:

```text
draft
  -> submitted
  -> context_ready
  -> running
  -> waiting_for_permission
  -> running
  -> streaming
  -> completed

Any non-final state may transition to:
  -> failed
  -> cancelled
```

Sub-agents and tools are child activities inside the run. They should not create
unrelated top-level state unless they outlive the parent visibly.

### Run Phases

| Phase                    | User sees                                                          | Data source                             |
| ------------------------ | ------------------------------------------------------------------ | --------------------------------------- |
| `draft`                  | Composer text, selected agent, model, permission mode, attachments | local React state                       |
| `submitted`              | User message and pending run card                                  | optimistic UI plus Desktop Gateway send |
| `context_ready`          | context summary, selected tools, memory snippets, token estimate   | runtime context summary                 |
| `running`                | thinking or tool activity                                          | runtime loop event                      |
| `waiting_for_permission` | global permission tray and timeline permission node                | desktop permission request              |
| `tool_running`           | tool card with arguments summary and progress                      | tool execution events                   |
| `subagent_running`       | child task card and link to child transcript                       | session events                          |
| `streaming`              | assistant output stream                                            | message delta events                    |
| `completed`              | final answer, artifacts, follow-up actions                         | message final plus run summary          |
| `failed`                 | error code, detail, retry, diagnostics, settings link              | operation failed or run error           |
| `cancelled`              | cancellation marker and optional retry                             | abort action                            |

### Run Model

Introduce a desktop run model. It can start as part of `ConversationState` and
later move into a separate `TaskRunsState` if Task Center needs stronger
durability.

```ts
type DesktopTaskRun = {
  id: string;
  threadId: string;
  parentRunId?: string;
  status:
    | "submitted"
    | "contextReady"
    | "running"
    | "waitingForPermission"
    | "streaming"
    | "completed"
    | "failed"
    | "cancelled";
  title: string;
  userText: string;
  agentId?: string;
  agentName?: string;
  model: string;
  thinking?: string;
  permissionMode: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  contextSummary?: ConversationContextSummary;
  activities: DesktopTaskActivity[];
  artifacts: DesktopTaskArtifact[];
  error?: DesktopTaskError;
};
```

Activities should represent tools, permissions, sub-agents, hooks, memory,
provider blocks, and status updates.

```ts
type DesktopTaskActivity =
  | DesktopToolActivity
  | DesktopPermissionActivity
  | DesktopSubagentActivity
  | DesktopMemoryActivity
  | DesktopProviderActivity
  | DesktopStatusActivity;
```

The first implementation can keep rendering existing `ConversationMessage`
kinds while adding `taskRuns`. Long term, messages and task run activities
should be derived from the same event source so they do not drift.

## Frontend Interaction Design

### Composer

The composer should show the current execution contract before send:

- selected agent or local default
- selected model
- selected thinking level when supported
- permission mode
- attachment and workflow drafts
- skill command draft
- voice input state
- send or stop action

Interaction rules:

- Enter sends only when the draft is non-empty and no current run blocks send.
- Stop cancels the active run.
- Follow-up text can queue while a run is active only when the backend supports
  queued follow-ups for the active run.
- Attachment and workflow drafts should be visible before send and convertible
  into timeline activities after send.
- Agent-owned settings should be shown as locked or inherited when an agent is
  selected.
- Permission mode should be visible before send because it changes risk.

### Timeline

The timeline should be the source of truth for task execution. It should render:

- user prompt
- run card
- context summary
- tool cards
- permission cards
- sub-agent cards
- memory cards
- status cards
- assistant response
- artifact cards
- failure cards

Tool cards should show:

- tool name
- short argument summary
- progress message
- status
- duration
- output summary
- read-only or write-capable badge
- action buttons for opening artifacts when present

Permission cards should show:

- request title
- detail
- category
- requested tool
- approve or deny actions
- decision outcome
- timestamp

Sub-agent cards should show:

- child session title
- status
- parent task relation
- last update
- open transcript action
- cancel action when supported

Failure cards should show:

- code
- explanation
- retry same context
- copy diagnostics
- open relevant settings

### Global Pending Tray

Permission requests and active runs should have a small persistent tray. This is
especially important if the user navigates away from the conversation.

Tray contents:

- active run count
- pending permission count
- most recent blocked action
- click to return to the relevant timeline node

The tray should not duplicate the whole timeline. It is a navigation and
awareness aid.

### Search and Navigation

Search should route to all product objects:

- thread
- task run
- agent
- plugin
- tool
- skill
- memory record
- settings section
- artifact when available

The current search result routing handles only a subset of these objects. The
new route target shape should allow each workspace to define a selection action
without expanding `App.tsx` with more special cases.

### Empty and Unavailable States

The app should avoid fake product content in runtime unavailable mode. It should
show:

- what failed
- what is available without the runtime
- what can be repaired
- direct actions such as refresh runtime, open logs, open settings, or export
  diagnostics

The fallback state can still be useful for local UI development, but the
product runtime should make unavailable mode explicit.

## Backend And Event Design

### Desktop Event Model

The current Desktop API can keep existing events for compatibility, but richer
task rendering should converge on a run event.

```ts
type DesktopRunEvent = {
  type: "runEvent";
  runId: string;
  threadId: string;
  sequence: number;
  occurredAt: string;
  event:
    | { type: "started"; userText: string; agentId?: string; model: string }
    | { type: "contextReady"; summary: ConversationContextSummary }
    | { type: "providerBlock"; blockType: string; text?: string; metadata: JsonValue }
    | { type: "toolStarted"; callId: string; toolName: string; arguments: JsonValue }
    | { type: "toolProgress"; callId: string; toolName: string; status: string; message?: string }
    | { type: "permissionRequested"; requestId: string; toolName: string; reason: string }
    | { type: "permissionDecided"; requestId: string; toolName: string; decision: string }
    | { type: "toolCompleted"; callId: string; toolName: string; ok: boolean; output?: string }
    | {
        type: "toolSummary";
        callId: string;
        toolName: string;
        durationMs: number;
        omittedChars: number;
      }
    | { type: "subagentStarted"; childSessionId: string; title: string }
    | { type: "subagentUpdated"; childSessionId: string; status: string; detail?: string }
    | { type: "memoryUsed"; recordIds: string[]; summary: string }
    | { type: "memoryWritten"; recordIds: string[]; summary: string }
    | { type: "messageDelta"; text: string }
    | { type: "messageFinal"; role: "assistant" | "user"; text: string }
    | { type: "failed"; code: string; message: string }
    | { type: "cancelled"; reason?: string }
    | { type: "completed"; summary?: string };
};
```

Rules:

- Events must include `runId` and `threadId`.
- Events must be ordered per run by `sequence`.
- Events should contain summaries and refs, not full private payloads.
- Large artifacts should be represented by asset IDs or persisted paths.
- The backend should continue to send `StateChanged` snapshots for recovery.
- The renderer should be able to rebuild visible run state from either a
  snapshot or an event stream.

### Mapping Runtime Events

Runtime loop events already provide much of the required information:

| Runtime event                        | Desktop event                      |
| ------------------------------------ | ---------------------------------- |
| `ContextProjected`                   | `contextReady`                     |
| `ProviderBlock`                      | `providerBlock` or timeline status |
| `ToolExecution::Started`             | `toolStarted`                      |
| `ToolExecution::Progress`            | `toolProgress`                     |
| `ToolExecution::PermissionRequested` | `permissionRequested`              |
| `ToolExecution::PermissionDecision`  | `permissionDecided`                |
| `ToolExecution::Completed`           | `toolCompleted`                    |
| `ToolUseSummary`                     | `toolSummary`                      |
| `Hook`                               | status or hook activity            |

The desktop bridge should not drop progress or permission events. It can still
derive simple `ConversationMessage` records for compatibility.

### Desktop State Shape

Keep a single bootstrap payload, but separate domains in the type model:

```ts
type DesktopState = {
  activeNavId: string;
  sidebar: DesktopSidebarState;
  conversation: ConversationState;
  taskRuns: TaskRunsState;
  agentWorkspace: AgentWorkspaceState;
  capabilitiesWorkspace: CapabilitiesWorkspaceState;
  memoryWorkspace: MemoryWorkspaceState;
  preferences: DesktopPreferences;
  permissionRequest: PermissionRequest;
  searchSuggestions: SearchSuggestion[];
};
```

`pluginsWorkspace` can be renamed to `capabilitiesWorkspace` only after the
product copy and compatibility migration are planned. The first implementation
can keep the old field and add selectors that present it as capabilities.

### Backend Ownership

Rust owns:

- run IDs and run lifecycle emission
- session selection and transcript persistence
- provider calls
- tool execution
- tool progress
- permission requests and decisions
- sub-agent session creation and updates
- memory reads and writes
- plugin and native tool descriptors
- runtime health

React owns:

- transient draft state
- popovers and menus
- visible selection state
- optimistic UI pending server acknowledgement
- local rendering reducers
- user-triggered navigation

This split keeps the renderer product-focused and prevents a second runtime
policy layer from growing in TypeScript.

## Capability Model

Capabilities should be represented as one normalized product concept even if
they come from different runtime sources.

```ts
type DesktopCapability = {
  id: string;
  kind: "tool" | "skill" | "plugin" | "agent";
  ownerId?: string;
  name: string;
  description: string;
  source: "runtime" | "nativePlugin" | "bundledPlugin" | "user";
  status: "available" | "disabled" | "needsSetup" | "unavailable";
  permissionCategory?: string;
  readOnly?: boolean;
  enabledByDefault?: boolean;
  recentUsage?: CapabilityUsageSummary;
};
```

This does not require a new public SDK. It is a desktop product projection over
existing runtime descriptors, plugin manifests, and agent state.

## File Decomposition Plan

The first implementation should not stop for a broad refactor. These splits are
recommended where they directly support the new feature.

### Renderer

| Current file                                             | Problem                                                                                      | Target split                                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `apps/crawclaw-desktop/src/App.tsx`                      | routing, state wiring, session polling, preference updates, plugin mutations, search routing | keep app shell, extract workspace router, session panel controller, preference actions, search route handler |
| `apps/crawclaw-desktop/src/app/use-desktop-state.ts`     | bootstrap, SSE subscription, event reduction, optimistic messages                            | split event subscription from event reducers, add exhaustive run event reducer                               |
| `apps/crawclaw-desktop/src/views/chat-workspace.tsx`     | composer state, command menus, attachment actions, selectors, timeline props                 | extract composer controller, run tray, command menu, attachment menu                                         |
| `apps/crawclaw-desktop/src/views/plugins-workspace.tsx`  | large component with display catalogs, install flows, dialogs, invocation                    | move display metadata to data or generated descriptors, split installed plugins, tools, skills, dialogs      |
| `apps/crawclaw-desktop/src/views/settings-workspace.tsx` | provider setup, model defaults, privacy, memory, notifications, advanced all in one surface  | split provider setup, model defaults, memory, privacy, diagnostics sections                                  |

### Tauri Desktop Gateway

| Current file                                                                           | Problem                                                                                    | Target split                                                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`                           | server setup, state construction, routing, tests, helpers                                  | split server, bootstrap, events, permission requester, state builder                 |
| `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_native_operations.rs` | message generation, attachments, workflows, agents, memory, plugins, capability resolution | split messages, assets, workflows, agents, memory, plugins, capabilities, run events |
| `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_session_routes.rs`    | session routes are useful but not fully connected to renderer events                       | add session changed and sub-agent run event integration                              |

These splits should be done near the feature work that needs them. Avoid moving
large code blocks just to make files smaller.

## Implementation Phases

### Phase 0: Contract And Reducer Foundation

Goal: make the event model reliable before UI work spreads.

Deliverables:

- add `DesktopRunEvent` or equivalent typed event
- include `runId`, `threadId`, `sequence`, and event payload
- handle `sessionStarted` in the renderer
- add a run event reducer in `use-desktop-state`
- preserve compatibility with existing `ConversationMessage` rendering
- update generated desktop API contract
- add Rust tests for event emission
- add renderer smoke coverage for run state where feasible

Verification:

- `cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml --test gateway_desktop_api_test`
- `pnpm desktop:contract:check`
- `pnpm desktop:e2e:smoke`

### Phase 1: Conversation Run Timeline

Goal: make one task understandable from send to completion.

Deliverables:

- run card after send
- context summary timeline node
- tool cards with arguments summary, progress, output, and result status
- permission cards with approve or deny actions
- failure cards with retry, copy diagnostics, and open settings actions
- completed run summary
- stop and queued follow-up behavior reflected in the timeline

Verification:

- targeted Rust tests for tool progress, permission, failure, and final event
  emission
- e2e smoke for send, stop, permission, tool event rendering, and failure card
- `pnpm build` if the work touches lazy loading or build output

### Phase 2: Task Center

Goal: make active work visible before entering a thread.

Deliverables:

- Task Center workspace
- active run list
- pending permission list
- failed task list
- recent completed tasks
- running sub-agent list
- memory health summary
- runtime health summary
- click-through navigation to timeline nodes

Verification:

- e2e smoke for default entrypoint and navigation
- reducer tests or runtime tests for state snapshots that include active runs
- accessibility pass for tray and list keyboard navigation

### Phase 3: Capability Center

Goal: connect plugins, tools, skills, and agents to real task usage.

Deliverables:

- normalized capability projection
- capability detail panel
- attach capability to agent
- safe test invocation where supported
- recent usage summary
- needs setup state
- permission category display

Verification:

- Rust tests for descriptor projection and disablement semantics
- e2e smoke for plugin, tool, skill, agent capability flows
- no new JavaScript SDK public subpaths

### Phase 4: Settings And Repair

Goal: turn settings into a product support surface.

Deliverables:

- provider setup status and test action
- runtime diagnostic card
- memory repair actions
- permission defaults with clear effect
- notification defaults with honest platform status
- unavailable mode repair flow
- export diagnostics action

Verification:

- Rust tests for preference persistence and diagnostic outputs
- e2e smoke for provider setup and runtime unavailable mode
- manual check on macOS desktop app when platform integration is touched

### Phase 5: Maintainability Cleanup

Goal: reduce future risk after the product behavior is stable.

Deliverables:

- targeted renderer file splits
- targeted Tauri module splits
- event reducer exhaustive handling
- generated or backend-owned display metadata where appropriate
- stale static showcase content removed from product runtime paths

Verification:

- `pnpm check`
- `pnpm test` when logic changed
- `pnpm build` when build output, lazy loading, or published surfaces changed
- `git diff --check`

## UX Acceptance Criteria

A task run is productized when a user can answer these questions from the UI:

- What did I ask CrawClaw to do?
- Which agent or default profile is handling it?
- Which model and permission mode are active?
- What context was included?
- Is CrawClaw running, waiting, failed, cancelled, or done?
- Which tools ran?
- What progress did those tools report?
- Did CrawClaw ask for permission?
- What did I approve or deny?
- Did a sub-agent run?
- Did the task create an artifact?
- Why did the task fail?
- What is the next useful action?

The UI should pass this test without requiring logs or developer tools.

## Technical Acceptance Criteria

- Every run event carries a stable `runId`.
- Run events are ordered per run.
- Renderer reducers can rebuild visible task state from events.
- State snapshots can recover from missed events.
- Permission requests appear in both the timeline and global pending tray.
- Tool progress is not dropped by the desktop bridge.
- Sub-agent start and update events update visible UI without relying only on
  polling.
- Runtime unavailable mode is explicit and actionable.
- Agent, plugin, skill, and memory pages can link back to related task runs.
- Contract generation stays aligned with Rust and TypeScript types.
- Tests cover the touched event and rendering behavior.

## Risks And Mitigations

| Risk                                    | Mitigation                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| Event model grows too broad             | Keep `DesktopRunEvent` small and summarize large payloads with refs          |
| Renderer becomes a runtime policy owner | Keep all run decisions and execution in Rust                                 |
| State snapshots and events drift        | Derive both from the same run state where possible, add contract tests       |
| UI becomes visually noisy               | Keep global tray compact and put details inside expandable timeline cards    |
| Existing workspaces become inconsistent | Add route targets and related task links, avoid duplicating capability state |
| Large file cleanup delays product work  | Split only around touched feature boundaries                                 |
| Runtime unavailable fallback feels fake | Make fallback a repair mode, not a pretend running product                   |

## Testing Strategy

Use the smallest test that proves the changed behavior, then run broader gates
when the touched surface justifies it.

Recommended targeted tests:

- Rust Desktop API tests for run event emission.
- Rust Desktop API tests for permission request and decision lifecycle.
- Rust Desktop API tests for tool progress and tool summary projection.
- Desktop e2e smoke for initial ready, send, run card, timeline updates,
  permission tray, sub-agent activity, failure recovery, and settings routing.
- Contract generation and check after changing Desktop API models.

Recommended landing gates:

- `pnpm check` for normal local validation.
- `pnpm test` when runtime or gateway logic changes.
- `pnpm build` when lazy loading, build output, packaging, generated contracts,
  or published surfaces can be affected.
- `git diff --check` before committing.

## Rollout Order

The recommended first implementation unit is Phase 0 plus the smallest useful
slice of Phase 1:

1. Add the run event contract.
2. Emit run started, context ready, tool started, tool progress, tool completed,
   permission requested, permission decided, message final, failed, and
   completed events.
3. Add the renderer reducer.
4. Render a basic run card and tool or permission timeline nodes.
5. Keep existing conversation messages working.
6. Add targeted tests.

This produces immediate product value and creates the foundation for Task
Center, Capability Center, and settings repair work.

## Open Decisions

These decisions should be made before implementation planning:

- Whether `taskRuns` should be persisted immediately or derived from session
  transcripts plus recent run events in the first phase.
- Whether Task Center should become the default nav item immediately or after
  the timeline is stable.
- Whether `pluginsWorkspace` should be renamed in code during this work or only
  presented as Capabilities in product copy.
- How much provider setup detail should be exposed from the backend descriptor
  model in the first settings pass.

The recommended answers are:

- derive `taskRuns` first, persist later when history UX needs it
- keep Conversations as the initial route until Phase 1 is stable, then make
  Task Center default
- keep `pluginsWorkspace` in code for the first pass and use selectors or copy
  to present capabilities
- expose provider setup status only, not provider-specific secret forms beyond
  current supported settings
