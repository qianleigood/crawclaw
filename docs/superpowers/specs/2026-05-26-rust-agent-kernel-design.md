---
title: Rust Agent Kernel Design
summary: Design for evolving CrawClaw's Rust agent runtime across sub-agents, context assembly, compaction, special agents, tools, and skills.
read_when:
  - Changing the Rust agent runtime or context assembly path.
  - Implementing or reviewing sub-agent and special-agent execution.
  - Changing tool discovery, skill loading, or compaction behavior.
---

# Rust Agent Kernel Design

## Summary

CrawClaw should adopt the runtime invariants that make Claude Code's agent loop robust, but it should not copy Claude Code's TypeScript architecture. The current repository already has the right Rust ownership direction: agent runtime entrypoints live under `crates/crawclaw-runtime`, gateway session orchestration lives under `crates/crawclaw-gateway`, and the desktop app consumes context summaries rather than owning model orchestration.

This design is now implemented as a hard cutover to one explicit Rust agent kernel:

- A typed `AgentRunProfile` that describes normal turns, sub-agent turns, special-agent turns, compaction turns, and memory maintenance turns.
- A structured `RuntimeQueryContextBuilder` that produces a model-ready context envelope plus an auditable summary.
- A real sub-agent execution lifecycle instead of split "spawn session" and "spawn then run" behavior.
- Special agents whose definitions drive prompts, tools, parent context, persistence, transcript policy, limits, and result handling.
- Tool and skill registries that use explicit activation state rather than inferring state from model-visible JSON.
- A compaction manager that preserves transcript invariants, summarizes old context, keeps a recent tail, and is verified against tool-use pairing and large outputs.

This design is scoped to the active Rust runtime. It deliberately avoids adding a public JavaScript SDK surface, legacy compatibility shims, or provider-specific shortcuts in core.

## Implemented Code Baseline

The implementation is anchored in these current code paths:

- `crates/crawclaw-channels/src/lib.rs` carries the typed `AgentRunProfileRequest` wire contract.
- `crates/crawclaw-runtime/src/agent_runtime_backend.rs` resolves profiles before context assembly and provider dispatch.
- `crates/crawclaw-runtime/src/agent_context.rs` builds profile-aware `RuntimeModelContext`, explicit tool activation state, skill summaries, memory snippets, and compaction diagnostics.
- `crates/crawclaw-runtime/src/special_agents.rs` defines special-agent prompt, output, persistence, tool, transcript, parent-context, timeout, and max-turn policy.
- `crates/crawclaw-runtime/src/memory.rs` invokes `session-summary` compaction through typed profile requests and records compacted-through, first-kept, and tail-start cursors.
- `crates/crawclaw-runtime/src/core_tools/core_tools_sessions.rs` exposes canonical `subagents_spawn` and no longer exposes child creation as `sessions_spawn`.
- `crates/crawclaw-gateway/src/gateway_sessions.rs` exposes canonical `subagents_spawn` for spawn-only and spawn-and-run behavior.
- `apps/crawclaw-desktop/src/views/chat-thread.tsx` displays profile, parent context, compaction state, activated tools, included tools, deferred tools, skills, and memory snippets.
- `src/agents/**/README.md` documents that the old TypeScript agent surfaces have been removed or demoted to metadata and that Rust owns the active runtime.

The hard-cut replacements are:

- `specialAgent` option metadata is replaced by typed profile requests.
- Transcript JSON scanning for `activatedTools` is replaced by runtime-owned activation state.
- `sessions_spawn` and `subagents.spawnRun` are replaced by canonical `subagents_spawn`.
- Compaction exposes durable compacted-through, first-kept, tail-start, and retained-message diagnostics.
- `discover_skills`, `load_skill`, and context skill summaries share the Rust skill inventory.
- Special-only tools are excluded from the default runtime registry and are only available through explicit allowlisted profiles.

## Goals

- Make normal turns, spawned sub-agents, embedded special agents, compaction, and memory maintenance run through one Rust-native kernel.
- Keep the implementation aligned with the current Rust-first repository direction.
- Replace partial current contracts cleanly instead of preserving legacy option shapes or split runtime semantics.
- Make context assembly deterministic, auditable, and unit-testable.
- Make tool and skill availability explicit per run, not inferred from prior assistant-visible text.
- Preserve provider neutrality: generic inference, context, and tool loop stay in core; provider-specific behavior stays behind provider contracts.
- Keep sub-agents useful for real work: child session creation, run lifecycle, parent context policy, progress events, cancellation, and result announcement.
- Make special agents safe: dedicated prompts, allowlisted tools, parent-context limits, transcript policy, timeout, max-turn, and persistence hooks.
- Make compaction safe enough to enable automatically later without breaking tool-use/tool-result pairing or losing recent task context.

## Non-Goals

- Do not port Claude Code's TypeScript implementation directly.
- Do not preserve old agent APIs, old option JSON shapes, or old sub-agent semantics for compatibility. Current callers should be updated to the new contract in the same phase.
- Do not add new public JavaScript plugin SDK exports or TypeScript runtime plugin seams.
- Do not redesign provider plugins or vendor-specific configuration in this work.
- Do not change `docs/zh-CN/**`; those files are generated.
- Do not touch security-restricted `CODEOWNERS` paths unless an owner explicitly requests that work.
- Do not make a full semantic memory system a prerequisite for the first implementation. The first version should use explicit contracts and simple ranking, then allow semantic ranking behind a trait.
- Do not make automatic context collapse the first milestone. Start with explicit compact boundaries and safe tail retention.

## Compatibility Stance

This work should be a hard cleanup of the active code path, not a compatibility migration. Existing code is useful as evidence of current behavior, but old behavior is not a design requirement.

Practical rules:

- If a current field exists only to pass inert metadata, replace it with a typed profile field and update every in-repo caller.
- If two current APIs express the same concept differently, keep one canonical API and remove or hide the other from model-visible tools.
- If tests assert legacy behavior that conflicts with the new runtime contract, rewrite the tests to assert the new contract.
- Do not add "temporary" dual paths unless a single PR cannot compile without them. Any temporary bridge must be internal, short-lived, and removed before the phase is considered complete.
- Do not support the removed TypeScript agent runtime surface.

## Design Principles

1. Rust owns execution.
   Runtime orchestration, context assembly, tool activation, compaction, and special-agent policy should live in `crates/crawclaw-runtime` or gateway Rust surfaces. Desktop should display state and invoke APIs, not own model-loop rules.

2. Profiles beat flags.
   `AgentRuntimeSendOptions` and ad hoc option JSON should not describe run modes. A typed `AgentRunProfile` should carry the policy for normal turns, sub-agents, special agents, and compaction.

3. Context is an artifact.
   Context assembly should produce a structured envelope, an estimated token report, a debug summary, and stable IDs for what was included or deferred.

4. Tool state is runtime state.
   A tool search result can be shown to the model, but activation must be recorded in a run-scoped state object. The next provider request should read that state, not parse previous tool output JSON.

5. Special agents are policy objects.
   A special agent definition should fully define how the run behaves: prompt, tools, parent context, transcript, persistence, output expectations, and limits.

6. Compaction must preserve protocol invariants.
   Compaction cannot drop required tool results, split paired tool-use/tool-result blocks incorrectly, or erase the immediate task tail needed to continue.

7. Observability is part of the feature.
   Every run should expose enough summary data for desktop, gateway logs, and tests to explain what happened without inspecting private provider payloads.

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

The kernel should stay inside `crates/crawclaw-runtime`. Gateway should call it for agent runs and expose session/sub-agent RPCs. Desktop should keep using summaries and should not duplicate runtime policy.

## AgentRunProfile Contract

Introduce a typed profile that is derived before context assembly:

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

Expected mappings:

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

The immediate fix is to make `AgentRuntime::run_turn` resolve and consume this profile before calling `send_message_with_options_inner`. The current `specialAgent` option JSON should not remain as a compatibility input. Current callers such as compaction and review-task paths should pass a typed special-agent selector or profile request, and the inert metadata path should be deleted.

## Context Assembly Design

Replace the current single `build_runtime_model_context` function with a small set of focused stages. The public behavior can remain exposed as one builder call.

Stages:

1. Load transcript state.
   Read the active session history and any compaction state. Keep a stable message ID list for diagnostics.

2. Apply parent context policy.
   For sub-agents and special agents, decide whether the run sees no parent context, forked messages, or a full envelope. This should be profile-driven.

3. Apply compaction window.
   If the session has a compact summary, include the summary plus a recent tail. If no compaction exists, include the bounded original history.

4. Recall memory.
   Keep the current simple term scoring over the runtime memory inventory for the first version. Recall, after-turn ingestion, and maintenance writes are separate `MemoryPolicy` bits so BTW and memory-maintenance profiles can opt out of normal recall.

5. Recall skills.
   Surface skill summaries first. Load full skill contents only when the model invokes `load_skill` or when a run profile explicitly preloads a required skill.

6. Plan tool availability.
   Include always-load tools, previously activated deferred tools from run state, and profile-required tools. Defer everything else that is allowed by the profile.

7. Build system sections.
   Combine product/runtime guidance, profile prompt, context disclosure, memory snippets, skill summaries, and tool disclosure in a deterministic order.

8. Emit diagnostics.
   Return the model envelope and a `RuntimeContextSummary` with included tools, deferred tools, surfaced skills, loaded skills, memory snippets, message count, estimated tokens, compaction state, and profile kind.

The context builder does not scan transcript text for `activatedTools`. Tool activation is represented as runtime-owned state:

```rust
pub(crate) struct ToolActivationState {
    pub(crate) run_id: String,
    pub(crate) activated_for_next_request: BTreeSet<String>,
    pub(crate) activated_for_session: BTreeSet<String>,
}
```

`tool_search` updates this state through the tool loop, and the next provider request includes those schemas. After provider dispatch, the next-request activation state is cleared.

## Sub-Agent Design

The pre-cutover code had two related surfaces:

- `sessions_spawn` in `crates/crawclaw-runtime/src/core_tools/core_tools_sessions.rs` creates a child session and returns status.
- `subagents.spawnRun` in `crates/crawclaw-gateway/src/gateway_sessions.rs` can create a child session and immediately call `execute_agent_run_turn`.

The implementation replaces this split with one Rust runtime operation:

```rust
pub(crate) struct SubagentRunRequest {
    pub(crate) parent_session_key: String,
    pub(crate) task: String,
    pub(crate) label: Option<String>,
    pub(crate) run_immediately: bool,
    pub(crate) profile: AgentRunProfile,
}
```

Behavior:

- Use one canonical model-visible sub-agent tool/API: `subagents_spawn` with an explicit `run` boolean.
- Remove the old split tool surface from model-visible descriptors.
- The canonical operation creates one child session metadata shape regardless of whether it runs immediately.
- Parent context policy must be explicit: none, fork messages only, summary plus tail, or full envelope.
- Child run lifecycle should emit started, progress/tool events, completed, failed, and cancelled states.
- A parent announcement should be a controlled persistence step, not an implicit model side effect.
- Cancellation should update child state and prevent late parent announcements.

Sub-agents should not inherit all parent tools by default. A profile should choose between read-only default, explicit allowlist, or normal default tools.

Decision: `subagents_spawn` is the canonical model-visible tool name. `sessions_list`, `sessions_history`, and `sessions_status` remain session inspection tools; child creation is no longer exposed as `sessions_spawn`.

## Special-Agent Design

The existing `SpecialAgentDefinition` is a good starting point, but it should become authoritative. Add fields for prompt and output handling:

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

Prompt text should live in Rust-owned prompt renderers or static prompt files loaded by Rust. The definition must select the prompt. Runtime callers should not hand-write the complete prompt for session summaries, durable memory, or review tasks.

Expected special-agent contracts:

| Agent             | Prompt responsibility                                                                   | Output contract                              | Persistence                                |
| ----------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------ |
| `session-summary` | Summarize older transcript while preserving current task state and unresolved questions | plain text or structured summary envelope    | `SessionSummaryStore` and compaction state |
| `durable-memory`  | Update durable memory notes from thread facts                                           | structured memory operations or final report | memory note tools                          |
| `dream`           | Background consolidation from summaries and memories                                    | structured note/report                       | dream store or memory notes                |
| `experience`      | Extract reusable lessons                                                                | structured experience note                   | experience store                           |
| `review-spec`     | Review a design/spec against requirements                                               | findings list                                | child transcript and parent announcement   |
| `review-quality`  | Review implementation quality                                                           | findings list                                | child transcript and parent announcement   |

Special-only tools must be denied outside matching profiles. The current guard model can be extended so runtime tool execution validates both the tool allowlist and the active special-agent guard.

## Compaction Design

The first safe compaction milestone should be simpler than Claude Code's full context collapse. It should still adopt the important invariants.

Phase 1 behavior:

- Trigger only through explicit command/API or existing threshold logic.
- Build a compact input from older messages, not necessarily all messages.
- Keep a recent tail un-compacted.
- Preserve tool-use/tool-result pairing in the retained tail.
- Write a summary through the `session-summary` special agent.
- Store `compacted_through_message_id` or equivalent, not only message count.
- Context assembly reads summary plus tail on later turns.

Phase 2 behavior:

- Add a tool-result budget.
- Summarize or omit large tool outputs using tool-provided `max_result_chars` or equivalent metadata.
- Preserve small recent outputs directly when they are needed for the current task.
- Add regression tests for tool-use/tool-result pairing.

Phase 3 behavior:

- Add reactive compaction when provider context limits are hit.
- Retry once with compacted context.
- Expose a run event that compaction happened.

Do not implement prompt-cache control or Claude-style context-collapse projection first. Those are later optimizations after CrawClaw has explicit compact boundaries and tests.

## Tool Design

The runtime should treat tools as descriptors plus execution policy. A tool descriptor should include:

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

Immediate changes:

- Keep `tool_search`, `discover_skills`, and `load_skill` as always-load tools.
- Move deferred activation from transcript JSON scanning to `ToolActivationState`.
- Ensure tool execution checks active profile before executing special-only tools.
- Add result envelopes that distinguish user-visible text, structured data, truncation, error state, and activation updates.
- Keep tool schemas provider-neutral and avoid `anyOf`/`oneOf`/`allOf` in tool input schemas.

The tool registry should live close to `runtime_tool_catalog.rs` and the native tool executor. It should be the only source of truth for runtime-visible tool metadata.

## Skill Design

The current skill implementation is useful but shallow: it scans `skills/*/SKILL.md`, parses frontmatter, and ranks with term matching. The design should keep that simple path while making it a real registry.

Skill registry responsibilities:

- Inventory installed skills from the runtime skills root.
- Parse frontmatter fields: name, description, model, effort, allowed tools, context policy, and user-invocable flag when present.
- Return summaries for context disclosure.
- Load full skill content only on explicit `load_skill` or profile preload.
- Track which full skills were loaded this turn.
- Support a future semantic scorer without changing tool contracts.
- Avoid over-injecting full skill contents into every turn.

Skill context policy should matter:

- `main`: surfaced in normal runs when relevant.
- `fork`: available to sub-agents or special agents when their profile allows it.
- `special`: only preload for matching special-agent profiles.

For the first implementation, term scoring is acceptable if the registry contract is stable and tested. A later pass can add embeddings or a reranker behind the same trait.

## Context Summary And UI

Desktop already renders a useful context summary. Expand the summary rather than moving logic into the UI.

Add fields over time:

- `profileKind`
- `compaction`
- `activatedTools`
- `toolActivationScope`
- `loadedSkills`
- `parentContextPolicy`
- `memoryPolicy`
- `warnings`

The UI should remain a consumer. It can display why a tool was included, which skills were surfaced, and whether compaction was active, but it should not decide those policies.

Gateway and desktop APIs should expose the same summary shape so tests can assert runtime behavior without parsing provider prompts.

## Rollout Plan

### Phase 0: Baseline inventory and replacement targets

Document the current runtime paths and mark what will be replaced before moving code:

- `preview_message_context` includes always-load tools and defers other tools.
- `tool_search` returns activation data but activation is inferred later by scanning transcript JSON.
- `session-summary` compaction goes through `AgentRuntime::run_turn`, but special-agent options are inert metadata.
- `review_task` routes through native runtime, but special-agent definitions do not fully drive the run.
- `sessions_spawn` and `subagents.spawnRun` both describe child-session creation and must be collapsed into `subagents_spawn`.

Success check: the implementation plan has an explicit replacement target for each current gap, and no phase promises legacy behavior preservation.

### Phase 1: AgentRunProfile and context builder split

Add typed profile resolution and split `agent_context.rs` into focused units. Do not preserve external behavior that conflicts with the new profile contract; update in-repo callers and tests with the profile change.

Success check: normal chat, BTW, preview context, and existing desktop summary tests still pass. New tests prove profiles control tools, system prompt, memory policy, and parent context policy.

### Phase 2: Special-agent hardening

Make `SpecialAgentDefinition` drive prompt selection, tool allowlist, guard, limits, transcript policy, and persistence. Remove hand-written special-agent prompts from callers where practical.

Success check: `session-summary`, `durable-memory`, and review agents have tests proving the resolved profile and prompt are applied. Special-only tools fail outside matching profiles.

### Phase 3: Sub-agent lifecycle

Replace `sessions_spawn` and `subagents.spawnRun` with the canonical `subagents_spawn` lifecycle. Add status, cancellation, parent announcement, and parent-context policy tests.

Success check: a child can be spawned without running, spawned and run, cancelled, inspected, and announced back to the parent through one canonical lifecycle.

### Phase 4: Safe compaction

Add compact boundary state, summary plus tail context assembly, and pairing-safe retention. Keep automatic compaction conservative.

Success check: tests prove old messages are summarized, the recent tail remains, tool-use/tool-result pairs are not split, and follow-up context includes the summary.

### Phase 5: Tool and skill registry cleanup

Move tool activation into runtime state. Convert skill discovery to a registry with explicit summary/load/preload behavior.

Success check: `tool_search` activates schemas for the next provider request without transcript JSON scanning. `discover_skills` and `load_skill` share the same inventory source as context assembly.

### Phase 6: Observability and UI polish

Expand runtime summaries and desktop rendering. Add gateway logs/events for profile, compaction, tool activation, and special-agent execution.

Success check: a developer can explain a run from the context summary and run events without inspecting raw provider payloads.

## Claude Code Capability-Parity Update

The kernel now treats Claude Code as a capability target, not as a source or prompt
clone. The shipped contract focuses on equivalent runtime behavior:

- `AgentRunResult` includes the actual `contextSummary` used by the provider call.
- Runtime events include `contextProjected` and `providerBlock` so gateway and desktop clients can follow the agent loop without raw provider payload inspection.
- Rust agent backend loop events are converted into the same runtime event stream for provider blocks, tool calls, tool progress, and completed tool execution.
- `AgentRuntimeContextSummary` includes an agent definition id, projection counts, budget state, loaded skills, memory snippets, activated tools, warnings, and stable compaction cursors.
- Normal, BTW, and sub-agent turns receive Rust-owned prompt catalog entries. Special agents continue to use their typed definitions.
- `ToolExecutionRuntime` and `execute_rust_core_tool_for_profile` enforce the same special-only tool guard while allowing matching special-agent profiles to execute memory/session-summary tools.
- Fresh sub-agents default to no parent transcript. Forked sub-agents must opt in through `fork=true` or `parentContextPolicy=fork_messages_only`.
- Gateway protocol metadata exposes agent loop topics for context projection, provider blocks, tool progress, permission requests, hook decisions, sub-agent lifecycle, and MCP elicitation.
- Desktop context summaries show profile, parent policy, agent definition, projection count, budget state, compaction boundary, activated tools, loaded skills, memory, and warnings.

The remaining deeper parity work is additive on this contract: real-time gateway
delivery while provider/tool blocks are still in flight, hook mutation/blocking,
MCP transport orchestration, and automatic context-collapse retry should emit the
same typed event and summary shapes instead of adding a second execution path.

## Testing Strategy

Use focused Rust tests first, then repo gates when code changes touch broader surfaces.

Targeted tests:

- `crates/crawclaw-runtime/src/tests.rs`: profile resolution, context assembly, tool activation state, skill summary/load behavior, special-agent guard enforcement, compaction window.
- `crates/crawclaw-gateway/src/tests.rs`: `subagents_spawn`, status, cancellation, parent announcement, and gateway summary payloads.
- `apps/crawclaw-desktop/src-tauri/tests/gateway_desktop_api_test.rs`: desktop API summary shape and preview/send behavior.

Verification commands by phase:

- Runtime-only changes: run the narrow `cargo test -p crawclaw-runtime <filter>` command first, then `pnpm test` when touching shared runtime behavior.
- Gateway changes: run targeted gateway tests plus `pnpm test`.
- Desktop contract changes: run the relevant desktop Tauri tests and `pnpm build` if generated contract or packaged output can change.
- Tool/schema changes: run schema or contract tests that cover the affected tool descriptors.
- Final landing for runtime or published behavior: run `pnpm check`, `pnpm test`, and `pnpm build` when build output, lazy loading, packaging, or public contracts are affected.

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

These decisions describe the implemented v1 behavior:

1. General sub-agents use `ForkMessagesOnly` when spawned as a forked run. Fresh spawn-only child sessions do not receive parent transcript by default; the parent must include required background in the task.
2. Skill and memory recall use registry-backed term scoring in v1. Embeddings are not part of the completion criteria.
3. Compaction is profile-driven and explicit. A later automatic retry/compaction trigger must keep the same summary plus safe-tail cursor contract.
4. Child session retention follows the existing desktop session store lifecycle. No new pruning policy is introduced by this kernel cutover.

## Acceptance Criteria

The design is complete when these statements are true:

- Normal turns, sub-agent turns, special-agent turns, and compaction turns resolve through an `AgentRunProfile`.
- Context assembly is deterministic and produces both provider context and a runtime summary.
- Tool activation is explicit runtime state, not transcript text parsing.
- Special-agent definitions drive prompts, tools, parent context, transcript policy, limits, and persistence.
- Sub-agent spawn, run, status, cancellation, and announcement share one lifecycle.
- Compaction stores a durable boundary, includes summary plus tail on later turns, and preserves tool-use/tool-result invariants.
- Skill discovery, skill loading, and context skill summaries read from one registry.
- Desktop and gateway expose enough summary data to inspect what the runtime did.
- Tests cover profile resolution, context assembly, tool activation, special-agent policy, sub-agent lifecycle, compaction, and skill registry behavior.
