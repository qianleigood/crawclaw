# Special-Agent Substrate

CrawClaw now has a shared special-agent substrate for background maintenance agents that run on top of the run-loop lifecycle spine.

## Scope

This substrate intentionally unifies only the runtime layer:

- spawn metadata
- `spawnSource`
- explicit transcript policy
- explicit tool policy / allowlist enforcement
- explicit cache policy
- default `maxTurns`
- default `runTimeoutSeconds`
- transcript/session spawn context wiring
- `agent.wait`
- completion reply capture
- shared lifecycle subscriber wiring
- shared agent-event / history / usage hooks

It does **not** try to unify:

- prompts
- tool surfaces
- result schemas
- persistence behavior
- lifecycle gate logic

That follows the Claude Code pattern: shared forked-agent runtime, specialized agents on top.

## Shared Runtime

The shared runtime lives in:

- `src/agents/special/runtime/types.ts`
- `src/agents/special/runtime/run-once.ts`

Core concepts:

- `SpecialAgentDefinition`
  Declares the stable runtime contract for one special agent, including
  `executionMode: "spawned_session" | "embedded_fork"`.
- `registry.ts`
  Resolves registered special-agent definitions and tool policies by `spawnSource`.
- `runSpecialAgentToCompletion(...)`
  Dispatches to the correct substrate, then handles completion capture,
  transcript-policy enforcement, and optional event/history/usage hooks.
- `embedded-run-once.ts`
  Hosts the new embedded-fork substrate path.
- `createRunLoopLifecycleRegistration(...)`
  Handles shared lifecycle phase registration for special-agent subscribers.
- `createSharedLifecycleSubscriberAccessor(...)`
  Handles shared singleton-style subscriber reuse and reset behavior.

## Landed Agents

The shared substrate is now used by:

- session summary
  - `src/memory/session-summary/agent-runner.ts`
  - definition: `SESSION_SUMMARY_AGENT_DEFINITION`
- durable memory extraction
  - `src/memory/durable/agent-runner.ts`
  - definition: `MEMORY_EXTRACTION_AGENT_DEFINITION`
- dream
  - `src/memory/dreaming/agent-runner.ts`
  - definition: `DREAM_AGENT_DEFINITION`
- verification
  - `src/agents/verification-agent.ts`
  - definition: `VERIFICATION_AGENT_DEFINITION`

These pilots keep their existing:

- prompt builders
- lifecycle subscribers
- scheduler / worker-manager logic
- result parsing
- action-feed titles and summaries

Only the runtime substrate is shared.

## Why This Shape

The goal is to unify the cross-cutting mechanics without flattening specialized agent behavior into one contract.

That means:

- lifecycle spine stays the single owner of phase timing
- special agents share one runtime substrate
- each agent still owns its own mission, tools, and outputs

That gives the shared runtime coverage across:

- session-summary maintenance
- durable memory extraction
- dream / auto-dream
- verification

The prompts, tool contracts, and result schemas remain specialized.

## Claude Alignment

This is now close to Claude Code at the substrate-design level:

- shared lifecycle spine
- shared special-agent runtime
- explicit transcript isolation for maintenance agents
- explicit tool policy per special agent, with Claude-style runtime deny instead of prompt-time tool inventory shrinking
- explicit provider-level cache policy per special agent
- shared event/history/usage hooks in the runner

CrawClaw now also carries the directly portable part of Claude's cache design:

- memory-oriented special agents declare cache policy in `SpecialAgentDefinition`
- the shared runner now derives stable prompt-cache keys from a canonical parent cache-envelope identity, using the parent session only as a compatibility fallback
- those policies flow through the shared spawn path into provider request params
- parent runs now persist cache-safe snapshot state keyed by `runId`, so special agents can start resolving cache inheritance from the final parent prompt assembly instead of only from session keys
- those cache-safe snapshots now separate:
  - a canonical `CacheEnvelope` for the model-visible shared prefix
  - debug context fields for run/session metadata that should not affect cache identity
- the canonical `CacheEnvelope` now only covers:
  - `systemPromptText`
  - tool prompt payload + tool-inventory digest
  - thinking config
  - fork-context messages
- the substrate now computes reuse/drift through an explicit fork-cache plan instead of scattering cache rules across snapshot persistence, embedded attempts, and provider patching
- provider-specific request patching now only consumes the derived cache hints; it no longer defines cache identity itself
- the substrate now supports an explicit `embedded_fork` execution mode, so special agents no longer need to be modeled only as child sessions
- embedded memory special agents intentionally run without inheriting the parent run's captured prompt envelope
- embedded memory special runs still keep cache-write suppression and short retention, but they do not reuse a parent prompt-cache key or parent fork envelope
- embedded memory special runs now record shared agent-event / history / usage observations into Context Archive without depending on child-session transcript state
- the same embedded memory runs now surface usage, including `cacheRead` / `cacheWrite`, back into their Action Feed completion details
- embedded memory special agents now declare explicit cache-write suppression on the substrate, which maps to provider-supported "do not create new cache entries" controls while preserving prompt-cache reads when possible
- verification is intentionally explicit about staying on `spawned_session`; it uses the shared substrate contract, but it is not treated as a fire-and-forget maintenance fork

At the current CrawClaw runtime layer, this closes most of the substrate-level design gap that was still open after the first embedded-fork rollout while also simplifying ownership:

- `cache-safe-params.ts` owns canonical cache identity and snapshot persistence
- `cache-plan.ts` owns parent-prefix reuse and drift decisions
- `extra-params.ts` only translates cache hints into provider payloads

The main remaining difference from Claude Code is that CrawClaw still does not replay a full in-process forked query-loop identity. The inherited envelope is now canonical enough to carry a stable cache identity and drift protection, but request reconstruction is still adapter-shaped rather than a direct reuse of Claude's exact `CacheSafeParams` object model.

Future task-specific special agents should continue to opt in case-by-case:

- maintenance-style, fire-and-forget background agents should prefer `embedded_fork`
- user-invoked or session-bearing task agents should remain `spawned_session` unless they need parent-run cache inheritance more than child-session state
