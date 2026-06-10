---
title: Rust Agent Kernel Design
summary: CrawClaw Rust agent runtime 在 sub-agents、context assembly、compaction、special agents、tools 和 skills 方面演进的设计。
x-i18n:
  generated_at: "2026-06-10T12:51:16Z"
  model: codex
  provider: openai
  source_hash: ad2378a7a6415f9967a2a1a36bbf3227d9a66beda8a28646081c813b021a25af
  source_path: superpowers/specs/2026-05-26-rust-agent-kernel-design.md
  workflow: 15
---

# Rust Agent Kernel Design

## Summary

CrawClaw 应采用让 Claude Code agent loop 可靠的 runtime invariants，但不应复制 Claude Code 的 TypeScript 架构。当前仓库已经具备正确的 Rust ownership 方向：agent runtime entrypoints 位于 `crates/crawclaw-runtime`，gateway session orchestration 位于 `crates/crawclaw-gateway`，desktop app 消费 context summaries，而不是拥有 model orchestration。

这个设计现在已作为一条明确 Rust agent kernel 的 hard cutover 落地：

- typed `AgentRunProfile` 描述 normal turns、sub-agent turns、special-agent turns、compaction turns 和 memory maintenance turns。
- structured `RuntimeQueryContextBuilder` 生成 model-ready context envelope 和可审计 summary。
- 真正的 sub-agent execution lifecycle，而不是拆开的 "spawn session" 与 "spawn then run" 行为。
- 由 definitions 驱动 prompts、tools、parent context、persistence、transcript policy、limits 和 result handling 的 special agents。
- Tool 和 skill registries 使用 explicit activation state，而不是从 model-visible JSON 推断状态。
- Compaction manager 保持 transcript invariants，总结旧 context，保留 recent tail，并针对 tool-use pairing 和 large outputs 做验证。

这个设计限定在 active Rust runtime。它刻意避免新增 public JavaScript SDK surface、legacy compatibility shims 或 core 中的 provider-specific shortcuts。

## Implemented Code Baseline

实现锚定在这些当前 code paths：

- `crates/crawclaw-channels/src/lib.rs` 承载 typed `AgentRunProfileRequest` wire contract。
- `crates/crawclaw-runtime/src/agent_runtime_backend.rs` 在 context assembly 和 provider dispatch 之前解析 profiles。
- `crates/crawclaw-runtime/src/agent_context.rs` 构建 profile-aware `RuntimeModelContext`、explicit tool activation state、skill summaries、memory snippets 和 compaction diagnostics。
- `crates/crawclaw-runtime/src/special_agents.rs` 定义 special-agent prompt、output、persistence、tool、transcript、parent-context、timeout 和 max-turn policy。
- `crates/crawclaw-runtime/src/memory.rs` 通过 typed profile requests 调用 `session-summary` compaction，并记录 compacted-through、first-kept 和 tail-start cursors。
- `crates/crawclaw-runtime/src/core_tools/core_tools_sessions.rs` 暴露 canonical `subagents_spawn`，并且不再将 child creation 暴露为 `sessions_spawn`。
- `crates/crawclaw-gateway/src/gateway_sessions.rs` 为 spawn-only 和 spawn-and-run 行为暴露 canonical `subagents_spawn`。
- `apps/crawclaw-desktop/src/views/chat-thread.tsx` 显示 profile、parent context、compaction state、activated tools、included tools、deferred tools、skills 和 memory snippets。
- `src/agents/**/README.md` 说明旧 TypeScript agent surfaces 已被移除或降级为 metadata，active runtime 由 Rust 拥有。

Hard-cut replacements：

- `specialAgent` option metadata 被 typed profile requests 替代。
- 通过扫描 transcript JSON 获取 `activatedTools` 被 runtime-owned activation state 替代。
- `sessions_spawn` 和 `subagents.spawnRun` 被 canonical `subagents_spawn` 替代。
- Compaction 暴露 durable compacted-through、first-kept、tail-start 和 retained-message diagnostics。
- `discover_skills`、`load_skill` 和 context skill summaries 共享 Rust skill inventory。
- Special-only tools 从 default runtime registry 中排除，只能通过 explicit allowlisted profiles 使用。

## Goals

- 让 normal turns、spawned sub-agents、embedded special agents、compaction 和 memory maintenance 都通过一个 Rust-native kernel 运行。
- 保持实现与当前 Rust-first repository 方向一致。
- 清理式替换 partial current contracts，而不是保留 legacy option shapes 或 split runtime semantics。
- 让 context assembly deterministic、auditable 且 unit-testable。
- 让 tool 和 skill availability 按 run 显式表达，而不是从先前 assistant-visible text 推断。
- 保持 provider neutrality：generic inference、context 和 tool loop 留在 core；provider-specific behavior 留在 provider contracts 后面。
- 让 sub-agents 对真实工作有用：child session creation、run lifecycle、parent context policy、progress events、cancellation 和 result announcement。
- 让 special agents 安全：dedicated prompts、allowlisted tools、parent-context limits、transcript policy、timeout、max-turn 和 persistence hooks。
- 让 compaction 足够安全，以便后续自动启用时不会破坏 tool-use/tool-result pairing，也不会丢失 recent task context。

## Non-Goals

- 不直接移植 Claude Code 的 TypeScript 实现。
- 不为兼容性保留旧 agent APIs、旧 option JSON shapes 或旧 sub-agent semantics。当前 callers 应在同一阶段更新到新 contract。
- 不添加新的 public JavaScript plugin SDK exports 或 TypeScript runtime plugin seams。
- 不在这项工作中重设计 provider plugins 或 vendor-specific configuration。
- 不修改 `docs/zh-CN/**`；这些文件是 generated。
- 除非 owner 明确请求，不触碰 security-restricted `CODEOWNERS` paths。
- 不把完整 semantic memory system 作为第一版实现的前提。第一版应使用 explicit contracts 和 simple ranking，然后允许 semantic ranking 位于 trait 后面。
- 不把 automatic context collapse 作为第一个 milestone。从 explicit compact boundaries 和 safe tail retention 开始。

## Compatibility Stance

这项工作应该是 active code path 的 hard cleanup，而不是 compatibility migration。现有代码可作为当前行为的证据，但旧行为不是设计要求。

Practical rules：

- 如果当前 field 只是传递 inert metadata，用 typed profile field 替代，并更新所有 repo 内 callers。
- 如果两个当前 APIs 用不同方式表达同一概念，保留一个 canonical API，并从 model-visible tools 中移除或隐藏另一个。
- 如果 tests 断言的 legacy behavior 与新的 runtime contract 冲突，重写 tests 以断言新 contract。
- 除非单个 PR 无法编译，否则不要添加 "temporary" dual paths。任何 temporary bridge 必须是 internal、short-lived，并在该阶段被视为 complete 前移除。
- 不支持已移除的 TypeScript agent runtime surface。

## Design Principles

1. Rust owns execution.
   Runtime orchestration、context assembly、tool activation、compaction 和 special-agent policy 应位于 `crates/crawclaw-runtime` 或 gateway Rust surfaces。Desktop 应展示 state 并调用 APIs，而不是拥有 model-loop rules。

2. Profiles beat flags.
   `AgentRuntimeSendOptions` 和 ad hoc option JSON 不应描述 run modes。typed `AgentRunProfile` 应承载 normal turns、sub-agents、special agents 和 compaction 的 policy。

3. Context is an artifact.
   Context assembly 应生成 structured envelope、estimated token report、debug summary，以及已 included 或 deferred 内容的 stable IDs。

4. Tool state is runtime state.
   Tool search result 可以展示给 model，但 activation 必须记录在 run-scoped state object 中。下一次 provider request 应读取该 state，而不是解析先前 tool output JSON。

5. Special agents are policy objects.
   Special agent definition 应完整定义 run 行为：prompt、tools、parent context、transcript、persistence、output expectations 和 limits。

6. Compaction must preserve protocol invariants.
   Compaction 不能丢失 required tool results，不能错误拆分 paired tool-use/tool-result blocks，也不能擦除继续任务所需的 immediate task tail。

7. Observability is part of the feature.
   每个 run 应暴露足够的 summary data，让 desktop、gateway logs 和 tests 可以在不检查 private provider payloads 的情况下解释发生了什么。

## Proposed Architecture

```text
Inbound request
  -> AgentRunProfileResolver
  -> RuntimeQueryContextBuilder
       -> TranscriptWindow
       -> CompactionState
       -> ParentContextAdapter
       -> ToolRegistry
       -> ToolActivationState
       -> SkillRegistry
       -> MemoryRecall
  -> ProviderRuntimeBackend
  -> ToolLoop
       -> ToolExecutor
       -> ToolResultBudget
       -> ToolActivationState updates
  -> PersistenceHandlers
       -> transcript
       -> memory
       -> session summary
       -> special-agent output
  -> RuntimeRunSummary
```

Kernel 应留在 `crates/crawclaw-runtime` 内。Gateway 应调用它执行 agent runs 并暴露 session/sub-agent RPCs。Desktop 应继续使用 summaries，且不重复实现 runtime policy。

## AgentRunProfile Contract

引入在 context assembly 前派生的 typed profile：

```rust
pub(crate) struct AgentRunProfile {
    pub(crate) kind: AgentRunKind,
    pub(crate) execution_mode: AgentExecutionMode,
    pub(crate) transcript_policy: TranscriptPolicy,
    pub(crate) parent_context_policy: ParentContextPolicy,
    pub(crate) parent_session_key: Option<String>,
    pub(crate) tool_policy: ToolPolicy,
    pub(crate) skill_policy: SkillPolicy,
    pub(crate) memory_policy: MemoryPolicy,
    pub(crate) compaction_policy: CompactionPolicy,
    pub(crate) limits: AgentRunLimits,
    pub(crate) result_policy: AgentResultPolicy,
}

pub(crate) struct MemoryPolicy {
    pub(crate) recall: bool,
    pub(crate) after_turn: bool,
    pub(crate) maintenance_write: bool,
}
```

Expected mappings：

| Run type             | Profile source                               | Execution mode  | Context policy                | Tool policy                            | Persistence                           |
| -------------------- | -------------------------------------------- | --------------- | ----------------------------- | -------------------------------------- | ------------------------------------- |
| Normal chat          | default runtime request                      | thread-bound    | current session history       | default tools plus deferred activation | transcript plus memory-after-turn     |
| BTW                  | typed `AgentRunKind::Btw`                    | ephemeral       | current user question only    | no tools                               | no transcript append                  |
| Spawned sub-agent    | canonical `subagents_spawn` request          | spawned session | parent policy plus child task | allowlist or default by task           | child transcript, parent announcement |
| Review special agent | `review-spec` or `review-quality` definition | spawned session | fork messages only            | review allowlist                       | isolated child transcript             |
| Session summary      | `session-summary` definition                 | embedded fork   | full envelope                 | summary allowlist                      | summary store and compaction state    |
| Durable memory       | `durable-memory` definition                  | embedded fork   | fork messages only            | memory maintenance allowlist           | memory notes                          |
| Dream                | `dream` definition                           | embedded fork   | none                          | memory and summary allowlist           | dream store or memory notes           |
| Experience           | `experience` definition                      | embedded fork   | none                          | experience allowlist                   | experience notes                      |

Immediate fix 是让 `AgentRuntime::run_turn` 在调用 `send_message_with_options_inner` 前解析并消费这个 profile。当前 `specialAgent` option JSON 不应继续作为 compatibility input。Compaction 和 review-task paths 等当前 callers 应传 typed special-agent selector 或 profile request，并删除 inert metadata path。

## Context Assembly Design

将当前单一 `build_runtime_model_context` function 替换为一组 focused stages。Public behavior 仍可以作为一个 builder call 暴露。

Stages：

1. Load transcript state.
   读取 active session history 和任何 compaction state。保留 stable message ID list 用于 diagnostics。

2. Apply parent context policy.
   对 sub-agents 和 special agents，决定 run 看不到 parent context、看到 forked messages，还是看到 full envelope。这应由 profile 驱动。

3. Apply compaction window.
   如果 session 有 compact summary，则 include summary 加 recent tail。如果没有 compaction，则 include bounded original history。

4. Recall memory.
   第一版保留当前针对 runtime memory inventory 的 simple term scoring。Recall、after-turn ingestion 和 maintenance writes 是分离的 `MemoryPolicy` bits，这样 BTW 和 memory-maintenance profiles 可以 opt out normal recall。

5. Recall skills.
   先 surface skill summaries。只有当 model 调用 `load_skill` 或某个 run profile 显式 preload required skill 时，才加载 full skill contents。

6. Plan tool availability.
   Include always-load tools、来自 run state 的 previously activated deferred tools，以及 profile-required tools。Defer 该 profile 允许的其余内容。

7. Build system sections.
   以 deterministic order 组合 product/runtime guidance、profile prompt、context disclosure、memory snippets、skill summaries 和 tool disclosure。

8. Emit diagnostics.
   返回 model envelope 和 `RuntimeContextSummary`，包含 included tools、deferred tools、surfaced skills、loaded skills、memory snippets、message count、estimated tokens、compaction state 和 profile kind。

Context builder 不扫描 transcript text 查找 `activatedTools`。Tool activation 表示为 runtime-owned state：

```rust
pub(crate) struct ToolActivationState {
    pub(crate) run_id: String,
    pub(crate) activated_for_next_request: BTreeSet<String>,
    pub(crate) activated_for_session: BTreeSet<String>,
}
```

`tool_search` 通过 tool loop 更新该 state，下一次 provider request include 这些 schemas。Provider dispatch 后，next-request activation state 会清空。

## Sub-Agent Design

Pre-cutover code 有两个相关 surfaces：

- `crates/crawclaw-runtime/src/core_tools/core_tools_sessions.rs` 中的 `sessions_spawn` 创建 child session 并返回 status。
- `crates/crawclaw-gateway/src/gateway_sessions.rs` 中的 `subagents.spawnRun` 可以创建 child session 并立即调用 `execute_agent_run_turn`。

实现用一个 Rust runtime operation 替换这条 split：

```rust
pub(crate) struct SubagentRunRequest {
    pub(crate) parent_session_key: String,
    pub(crate) task: String,
    pub(crate) label: Option<String>,
    pub(crate) run_immediately: bool,
    pub(crate) profile: AgentRunProfile,
}
```

Behavior：

- 使用一个 canonical model-visible sub-agent tool/API：带 explicit `run` boolean 的 `subagents_spawn`。
- 从 model-visible descriptors 中移除旧的 split tool surface。
- Canonical operation 创建一种 child session metadata shape，不管它是否立即运行。
- Parent context policy 必须显式：none、fork messages only、summary plus tail 或 full envelope。
- Child run lifecycle 应 emit started、progress/tool events、completed、failed 和 cancelled states。
- Parent announcement 应是 controlled persistence step，而不是 implicit model side effect。
- Cancellation 应更新 child state，并阻止 late parent announcements。

Sub-agents 默认不应继承所有 parent tools。Profile 应在 read-only default、explicit allowlist 或 normal default tools 之间选择。

Decision：`subagents_spawn` 是 canonical model-visible tool name。`sessions_list`、`sessions_history` 和 `sessions_status` 保持为 session inspection tools；child creation 不再作为 `sessions_spawn` 暴露。

## Special-Agent Design

现有 `SpecialAgentDefinition` 是好的起点，但应成为 authoritative。为 prompt 和 output handling 添加字段：

```rust
pub struct SpecialAgentDefinition {
    pub id: &'static str,
    pub label: &'static str,
    pub spawn_source: &'static str,
    pub execution_mode: SpecialAgentExecutionMode,
    pub transcript_policy: SpecialAgentTranscriptPolicy,
    pub parent_context_policy: SpecialAgentParentContextPolicy,
    pub tool_allowlist: &'static [&'static str],
    pub guard: Option<SpecialAgentToolGuard>,
    pub timeout_seconds: u64,
    pub max_turns: u32,
    pub prompt_id: &'static str,
    pub output_contract: SpecialAgentOutputContract,
    pub persistence_handler: SpecialAgentPersistenceHandler,
}
```

Prompt text 应位于 Rust-owned prompt renderers 或 Rust 加载的 static prompt files 中。Definition 必须选择 prompt。Runtime callers 不应为 session summaries、durable memory 或 review tasks 手写完整 prompt。

Expected special-agent contracts：

| Agent             | Prompt responsibility                                                                   | Output contract                              | Persistence                                |
| ----------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------ |
| `session-summary` | Summarize older transcript while preserving current task state and unresolved questions | plain text or structured summary envelope    | `SessionSummaryStore` and compaction state |
| `durable-memory`  | Update durable memory notes from thread facts                                           | structured memory operations or final report | memory note tools                          |
| `dream`           | Background consolidation from summaries and memories                                    | structured note/report                       | dream store or memory notes                |
| `experience`      | Extract reusable lessons                                                                | structured experience note                   | experience store                           |
| `review-spec`     | Review a design/spec against requirements                                               | findings list                                | child transcript and parent announcement   |
| `review-quality`  | Review implementation quality                                                           | findings list                                | child transcript and parent announcement   |

Special-only tools 必须在 matching profiles 外被 deny。当前 guard model 可以扩展，使 runtime tool execution 同时验证 tool allowlist 和 active special-agent guard。

## Compaction Design

第一个安全 compaction milestone 应比 Claude Code 的 full context collapse 更简单，但仍应采用重要 invariants。

Phase 1 behavior：

- 只通过 explicit command/API 或 existing threshold logic 触发。
- 从 older messages 构建 compact input，不一定使用全部 messages。
- 保留 recent tail 不压缩。
- 在 retained tail 中保留 tool-use/tool-result pairing。
- 通过 `session-summary` special agent 写 summary。
- 存储 `compacted_through_message_id` 或等价物，而不只是 message count。
- 后续 turns 的 context assembly 读取 summary plus tail。

Phase 2 behavior：

- 添加 tool-result budget。
- 使用 tool-provided `max_result_chars` 或等价 metadata summarize 或 omit large tool outputs。
- 当 small recent outputs 对当前任务有必要时，直接保留它们。
- 添加 tool-use/tool-result pairing regression tests。

Phase 3 behavior：

- 当 provider context limits 命中时添加 reactive compaction。
- 使用 compacted context retry 一次。
- 暴露 run event 表示发生了 compaction。

不要先实现 prompt-cache control 或 Claude-style context-collapse projection。这些是在 CrawClaw 拥有 explicit compact boundaries 和 tests 后的 later optimizations。

## Tool Design

Runtime 应将 tools 视为 descriptors 加 execution policy。Tool descriptor 应包含：

- `name`
- `label`
- `description`
- input schema
- output contract
- read-only flag
- destructive flag
- profile visibility
- special-agent guard, if any
- result budget policy
- deferred loading policy

Immediate changes：

- 保持 `tool_search`、`discover_skills` 和 `load_skill` 为 always-load tools。
- 将 deferred activation 从 transcript JSON scanning 移到 `ToolActivationState`。
- 确保 tool execution 在执行 special-only tools 前检查 active profile。
- 添加 result envelopes，区分 user-visible text、structured data、truncation、error state 和 activation updates。
- 保持 tool schemas provider-neutral，并避免在 tool input schemas 中使用 `anyOf`/`oneOf`/`allOf`。

Tool registry 应靠近 `runtime_tool_catalog.rs` 和 native tool executor。它应是 runtime-visible tool metadata 的唯一事实来源。

## Skill Design

当前 skill 实现有用但较浅：它扫描 `skills/*/SKILL.md`、解析 frontmatter，并使用 term matching ranking。设计应保留这条简单路径，同时把它做成真正的 registry。

Skill registry responsibilities：

- 从 runtime skills root inventory installed skills。
- 解析 frontmatter fields：name、description、model、effort、allowed tools、context policy 和 user-invocable flag（存在时）。
- 返回 summaries 用于 context disclosure。
- 仅在 explicit `load_skill` 或 profile preload 时加载 full skill content。
- 跟踪本 turn 加载了哪些 full skills。
- 支持未来 semantic scorer，而不改变 tool contracts。
- 避免每个 turn 都过度注入 full skill contents。

Skill context policy 应有实际意义：

- `main`: 在 normal runs 中 relevant 时 surfaced。
- `fork`: 当 profile 允许时，对 sub-agents 或 special agents 可用。
- `special`: 只为 matching special-agent profiles preload。

第一版中，term scoring 可以接受，只要 registry contract stable 且经过测试。后续 pass 可以在同一个 trait 后添加 embeddings 或 reranker。

## Context Summary And UI

Desktop 已经渲染有用的 context summary。应扩展 summary，而不是把逻辑移到 UI。

逐步添加字段：

- `profileKind`
- `compaction`
- `activatedTools`
- `toolActivationScope`
- `loadedSkills`
- `parentContextPolicy`
- `memoryPolicy`
- `warnings`

UI 应保持 consumer 角色。它可以显示某个 tool 为什么被 include、哪些 skills 被 surfaced、compaction 是否 active，但不应决定这些 policies。

Gateway 和 desktop APIs 应暴露相同的 summary shape，让 tests 可以断言 runtime behavior，而无需解析 provider prompts。

## Rollout Plan

### Phase 0: Baseline inventory and replacement targets

移动代码前，记录当前 runtime paths，并标记将被替换的内容：

- `preview_message_context` includes always-load tools and defers other tools。
- `tool_search` returns activation data but activation is inferred later by scanning transcript JSON。
- `session-summary` compaction goes through `AgentRuntime::run_turn`, but special-agent options are inert metadata。
- `review_task` routes through native runtime, but special-agent definitions do not fully drive the run。
- `sessions_spawn` and `subagents.spawnRun` both describe child-session creation and must be collapsed into `subagents_spawn`。

Success check：implementation plan 对每个 current gap 都有 explicit replacement target，且没有 phase 承诺 legacy behavior preservation。

### Phase 1: AgentRunProfile and context builder split

添加 typed profile resolution，并将 `agent_context.rs` 拆分为 focused units。不要保留与 new profile contract 冲突的 external behavior；随 profile change 更新 in-repo callers 和 tests。

Success check：normal chat、BTW、preview context 和现有 desktop summary tests 仍通过。新 tests 证明 profiles 控制 tools、system prompt、memory policy 和 parent context policy。

### Phase 2: Special-agent hardening

让 `SpecialAgentDefinition` 驱动 prompt selection、tool allowlist、guard、limits、transcript policy 和 persistence。在可行处从 callers 中移除手写 special-agent prompts。

Success check：`session-summary`、`durable-memory` 和 review agents 有 tests 证明 resolved profile 和 prompt 被应用。Special-only tools 在 matching profiles 外失败。

### Phase 3: Sub-agent lifecycle

用 canonical `subagents_spawn` lifecycle 替换 `sessions_spawn` 和 `subagents.spawnRun`。添加 status、cancellation、parent announcement 和 parent-context policy tests。

Success check：child 可以通过一个 canonical lifecycle 被 spawned without running、spawned and run、cancelled、inspected，并 announced back to parent。

### Phase 4: Safe compaction

添加 compact boundary state、summary plus tail context assembly 和 pairing-safe retention。保持 automatic compaction 保守。

Success check：tests 证明 old messages 被 summarized、recent tail 保留、tool-use/tool-result pairs 不被拆分、follow-up context 包含 summary。

### Phase 5: Tool and skill registry cleanup

将 tool activation 移到 runtime state。将 skill discovery 转为具有 explicit summary/load/preload behavior 的 registry。

Success check：`tool_search` 不扫描 transcript JSON，也能为下一次 provider request activate schemas。`discover_skills` 和 `load_skill` 与 context assembly 共享同一个 inventory source。

### Phase 6: Observability and UI polish

扩展 runtime summaries 和 desktop rendering。为 profile、compaction、tool activation 和 special-agent execution 添加 gateway logs/events。

Success check：developer 可以通过 context summary 和 run events 解释一次 run，而无需查看 raw provider payloads。

## Claude Code Capability-Parity Update

Kernel 现在将 Claude Code 视为 capability target，而不是 source 或 prompt clone。已发布 contract 聚焦等效 runtime behavior：

- `AgentRunResult` 包含 provider call 实际使用的 `contextSummary`。
- Runtime events 包含 `contextProjected` 和 `providerBlock`，让 gateway 和 desktop clients 无需 raw provider payload inspection 即可跟随 agent loop。
- Rust agent backend loop events 被转换为同一个 runtime event stream，用于 provider blocks、tool calls、tool progress 和 completed tool execution。
- `AgentRuntimeContextSummary` 包含 agent definition id、projection counts、budget state、loaded skills、memory snippets、activated tools、warnings 和 stable compaction cursors。
- Normal、BTW 和 sub-agent turns 接收 Rust-owned prompt catalog entries。Special agents 继续使用 typed definitions。
- `ToolExecutionRuntime` 和 `execute_rust_core_tool_for_profile` 执行同样的 special-only tool guard，同时允许 matching special-agent profiles 执行 memory/session-summary tools。
- Fresh sub-agents 默认没有 parent transcript。Forked sub-agents 必须通过 `fork=true` 或 `parentContextPolicy=fork_messages_only` opt in。
- Gateway protocol metadata 暴露 agent loop topics，用于 context projection、provider blocks、tool progress、permission requests、hook decisions、sub-agent lifecycle 和 MCP elicitation。
- Desktop context summaries 显示 profile、parent policy、agent definition、projection count、budget state、compaction boundary、activated tools、loaded skills、memory 和 warnings。

剩余更深的 parity work 是这个 contract 上的 additive 工作：当 provider/tool blocks 仍在执行时的 real-time gateway delivery、hook mutation/blocking、MCP transport orchestration，以及 automatic context-collapse retry 都应 emit 同样的 typed event 和 summary shapes，而不是添加第二条 execution path。

## Testing Strategy

先使用 focused Rust tests；当 code changes 触及更宽 surfaces 时，再运行 repo gates。

Targeted tests：

- `crates/crawclaw-runtime/src/tests.rs`: profile resolution、context assembly、tool activation state、skill summary/load behavior、special-agent guard enforcement、compaction window。
- `crates/crawclaw-gateway/src/tests.rs`: `subagents_spawn`、status、cancellation、parent announcement 和 gateway summary payloads。
- `apps/crawclaw-desktop/src-tauri/tests/gateway_desktop_api_test.rs`: desktop API summary shape 和 preview/send behavior。

Verification commands by phase：

- Runtime-only changes：先运行 narrow `cargo test -p crawclaw-runtime <filter>`，触及 shared runtime behavior 时再运行 `pnpm test`。
- Gateway changes：运行 targeted gateway tests 加 `pnpm test`。
- Desktop contract changes：运行相关 desktop Tauri tests；如果 generated contract 或 packaged output 可能变化，运行 `pnpm build`。
- Tool/schema changes：运行覆盖受影响 tool descriptors 的 schema 或 contract tests。
- Runtime 或 published behavior 的 final landing：当 build output、lazy loading、packaging 或 public contracts 受影响时，运行 `pnpm check`、`pnpm test` 和 `pnpm build`。

## Risks And Mitigations

| Risk                                 | Why it matters                                                | Mitigation                                                                  |
| ------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `specialAgent` remains metadata-only | Special agents appear configured but run like normal turns    | Resolve profile before context assembly and test applied prompt/tool policy |
| Tool activation inferred from JSON   | Model-visible text becomes runtime state                      | Add `ToolActivationState` and remove transcript JSON scanning               |
| Sub-agent paths diverge              | Desktop, gateway, and tools disagree on lifecycle             | Use one child-session operation under both APIs                             |
| Compaction drops paired tool results | Provider protocols can fail or lose task state                | Pairing-aware retention tests before automatic compaction                   |
| Skill over-injection bloats context  | Every turn becomes expensive and noisy                        | Surface summaries by default, load full content only on demand              |
| Special-only tools leak              | Memory/session tools become reachable from normal chat        | Profile-aware execution guard                                               |
| Provider-specific fixes enter core   | Plugin/provider boundary erodes                               | Keep provider behavior behind provider contracts                            |
| Dirty local tree hides interactions  | Existing uncommitted runtime edits may overlap with this work | Implement in small phases with targeted tests and scoped commits            |

## Implementation Decisions

这些 decisions 描述 implemented v1 behavior：

1. General sub-agents 在作为 forked run spawn 时使用 `ForkMessagesOnly`。Fresh spawn-only child sessions 默认不接收 parent transcript；parent 必须在 task 中包含必要背景。
2. Skill 和 memory recall 在 v1 使用 registry-backed term scoring。Embeddings 不属于 completion criteria。
3. Compaction 是 profile-driven 且 explicit 的。后续 automatic retry/compaction trigger 必须保持同样的 summary plus safe-tail cursor contract。
4. Child session retention 遵循现有 desktop session store lifecycle。这个 kernel cutover 不引入新的 pruning policy。

## Acceptance Criteria

当这些陈述为真时，设计完成：

- Normal turns、sub-agent turns、special-agent turns 和 compaction turns 通过 `AgentRunProfile` 解析。
- Context assembly 是 deterministic，并同时生成 provider context 和 runtime summary。
- Tool activation 是 explicit runtime state，而不是 transcript text parsing。
- Special-agent definitions 驱动 prompts、tools、parent context、transcript policy、limits 和 persistence。
- Sub-agent spawn、run、status、cancellation 和 announcement 共享一个 lifecycle。
- Compaction 存储 durable boundary，在后续 turns 中包含 summary plus tail，并保持 tool-use/tool-result invariants。
- Skill discovery、skill loading 和 context skill summaries 读取同一个 registry。
- Desktop 和 gateway 暴露足够 summary data，以 inspect runtime 做了什么。
- Tests 覆盖 profile resolution、context assembly、tool activation、special-agent policy、sub-agent lifecycle、compaction 和 skill registry behavior。
