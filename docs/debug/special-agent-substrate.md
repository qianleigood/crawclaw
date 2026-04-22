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
- review-spec
  - `src/agents/review-agent.ts`
  - definition: `REVIEW_SPEC_AGENT_DEFINITION`
- review-quality
  - `src/agents/review-agent.ts`
  - definition: `REVIEW_QUALITY_AGENT_DEFINITION`

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
- review

The prompts, tool contracts, and result schemas remain specialized.

## Claude Alignment

This is now close to Claude Code at the substrate-design level:

- shared lifecycle spine
- shared special-agent runtime
- explicit transcript isolation for maintenance agents
- explicit tool policy per special agent, with runtime deny instead of prompt-time tool inventory shrinking
- explicit provider-level cache policy per special agent
- shared event/history/usage hooks in the runner

CrawClaw now carries only the cache pieces used by the current memory special
agents:

- memory-oriented special agents declare cache policy in `SpecialAgentDefinition`
- the shared runner translates those policies into provider request params
  such as short retention and cache-write suppression
- parent runs build a lifecycle `parentForkContext` from the final parent
  prompt assembly, so `session_summary` receives the parent prompt envelope and
  model-visible messages as one captured fork object
- embedded forks receive an explicit parent prompt envelope when the lifecycle
  captured one; otherwise they run from their own prompt assembly
- the parent fork context separates:
  - a canonical `CacheEnvelope` for the model-visible shared prefix
  - debug context fields for run/session metadata that should not affect cache identity
- the canonical `CacheEnvelope` now only covers:
  - `systemPromptText`
  - tool prompt payload + tool-inventory digest
  - thinking config
  - fork-context messages
- provider-specific request patching now only consumes direct cache hints; it no
  longer derives a parent prompt-cache key from the parent envelope
- the substrate now supports an explicit `embedded_fork` execution mode, so special agents no longer need to be modeled only as child sessions
- session-summary special runs consume the lifecycle `parentForkContext` as the
  automatic parent handoff
- that parent fork context carries the full current model-visible
  fork-context messages, matching Claude Code's session-memory update shape
  without a recent-message excerpt fallback
- lifecycle updates with missing fork context are skipped, while explicit
  CLI/gateway refresh builds a bounded manual parent fork context from persisted
  model-visible rows
- when that parent envelope is available, the summary-specific instructions
  stay in the appended task prompt instead of being appended to the parent
  system prompt
- other embedded memory special agents do not attach the parent run's captured
  prompt envelope
- durable extraction and dream special runs still keep cache-write suppression
  and short retention
- session-summary keeps short retention but does not reuse a parent
  prompt-cache key
- session-summary-backed compaction now stores the rendered compact view in
  compaction state, and prompt assembly prepends it as a compact summary message
  before the preserved tail
- stale `summaryInProgress` leases are cleared during compaction rather than
  blocking on a dead summary run
- embedded memory special runs now record shared agent-event / history / usage observations into Context Archive without depending on child-session transcript state
- the same embedded memory runs now surface usage, including `cacheRead` / `cacheWrite`, back into their Action Feed completion details
- embedded memory special agents now declare explicit cache-write suppression on the substrate, which maps to provider-supported "do not create new cache entries" controls while preserving prompt-cache reads when possible
- review stage agents are intentionally explicit about staying on `spawned_session`; they use the shared substrate contract, but they are not treated as fire-and-forget maintenance forks

At the current CrawClaw runtime layer, this closes most of the substrate-level design gap that was still open after the first embedded-fork rollout while also simplifying ownership:

- `parent-fork-context.ts` owns canonical cache identity and parent fork context
  construction
- `cache-plan.ts` owns direct special-agent cache hints
- `extra-params.ts` translates cache hints into provider payloads

The main remaining difference from Claude Code is that CrawClaw still does not replay the parent query loop as a live in-process clone. The explicit parent fork context is the supported handoff for session-summary history, while request building remains adapter-shaped and cache controls stay as direct special-agent hints.

Future task-specific special agents should continue to opt in case-by-case:

- maintenance-style, fire-and-forget background agents should prefer `embedded_fork`
- user-invoked or session-bearing task agents should remain `spawned_session` unless they explicitly need a parent fork context more than child-session state
