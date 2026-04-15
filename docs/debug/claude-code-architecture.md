---
summary: "Learning-oriented architecture notes for the local Claude Code source tree"
read_when:
  - You want a source-map for Claude Code
  - You are comparing CrawClaw with Claude Code's runtime design
  - You want a guided reading order for `/Users/qianleilei/src`
title: "Claude Code Architecture Notes"
---

# Claude Code architecture notes

This page is a learning-oriented source map for the local Claude Code checkout at:

```text
/Users/qianleilei/src
```

It is not product documentation from Anthropic. It is a technical reading guide
based on the current local source snapshot.

## One-sentence model

Claude Code is best understood as a **thick interactive runtime**:

- a multi-entrypoint product shell
- a long-lived conversation engine
- a loop-driven tool orchestrator
- a layered permission system
- a strong shared app state
- MCP, remote-control, and agent/task systems built into the same runtime

It is not "just a CLI wrapper around one LLM call."

## Recommended reading order

If you want to learn it efficiently, read in this order:

1. `src/entrypoints/cli.tsx`
2. `src/main.tsx`
3. `src/QueryEngine.ts`
4. `src/query.ts`
5. `src/Tool.ts`
6. `src/tools.ts`
7. `src/utils/permissions/permissionSetup.ts`
8. `src/utils/permissions/permissions.ts`
9. `src/state/AppStateStore.ts`
10. `src/tools/AgentTool/AgentTool.tsx`
11. `src/tools/AgentTool/runAgent.ts`
12. `src/utils/forkedAgent.ts`
13. `src/services/mcp/client.ts`
14. `src/remote/RemoteSessionManager.ts`
15. `src/bridge/bridgeMain.ts`
16. `src/services/vcr.ts`

That order mirrors the actual architecture:

- entry
- bootstrap
- session engine
- loop
- tool contract
- permission contract
- state model
- sub-agent runtime
- extension/remote planes
- regression infrastructure

## Layer-by-layer breakdown

### 1. Product shell and startup

Core files:

- `src/entrypoints/cli.tsx`
- `src/main.tsx`

What to notice:

- `cli.tsx` does aggressive fast-path routing before loading the full app.
- It special-cases version, dump-system-prompt, bridge, daemon, background
  sessions, and MCP/server modes.
- `main.tsx` is the real runtime bootstrap: settings, telemetry, auth, MDM,
  keychain prefetch, MCP, plugins, skills, remote session support, REPL, and
  policy limits all converge there.

Design lesson:

- Claude Code treats startup as a **product orchestration problem**, not a small
  CLI `main()` function.

### 2. Conversation engine

Core file:

- `src/QueryEngine.ts`

What it does:

- owns conversation state for one session
- persists messages across turns
- wraps permission denials and usage accounting
- builds SDK-compatible init/status/result messages
- bridges the higher-level app runtime into the lower-level query loop

Design lesson:

- Claude Code has a real **session object** (`QueryEngine`), not just a helper
  that calls `query()` once.

### 3. Query loop state machine

Core file:

- `src/query.ts`

This is the architectural center.

Important patterns:

- explicit mutable loop `State`
- `while (true)` conversation loop
- stream model output, detect `tool_use`, run tools, append tool results, and
  recurse
- several built-in recovery paths:
  - proactive compact
  - reactive compact
  - context collapse
  - max-output-tokens recovery
  - stop-hook retry
  - token-budget continuation
- hard turn stopping via `maxTurns`

Important detail:

- the loop does not primarily rely on a separate generic "tool loop detector"
  the way CrawClaw now does
- instead it treats most bad states as **recovery branches inside the main loop**

Design lesson:

- Claude Code's control philosophy is: **keep the state machine in charge**.

### 4. Tool runtime

Core files:

- `src/Tool.ts`
- `src/tools.ts`
- `src/services/tools/toolOrchestration.ts`

What to notice:

- `Tool.ts` defines a very large `ToolUseContext`
- the context carries:
  - commands
  - tools
  - MCP clients/resources
  - app state accessors
  - permission context
  - file state
  - notifications
  - message lists
  - attribution/file-history/session metadata
- `tools.ts` is the exhaustive tool registry and feature-gated capability map
- `toolOrchestration.ts` runs read-only/concurrency-safe tools in batches and
  serializes mutating tools

Design lesson:

- tools are not a thin plugin API
- they are first-class runtime actors inside a shared execution environment

### 5. Guard and permissions

Core files:

- `src/utils/permissions/permissionSetup.ts`
- `src/utils/permissions/permissions.ts`

What to notice:

- Claude Code does not have one monolithic "guard" function
- it has layered permission handling:
  - mode selection
  - rule loading/merging
  - dangerous-rule stripping for auto mode
  - tool-level checks
  - hook/classifier integration
  - dialog prompting
- `permissionSetup.ts` explicitly treats broad Bash/PowerShell/Agent rules as
  dangerous in auto mode
- `permissions.ts` merges allow/deny/ask semantics across settings, CLI, command
  scope, and session scope

Design lesson:

- this is a **governance system**, not just a pre-tool hook

### 6. Shared app state

Core file:

- `src/state/AppStateStore.ts`

What to notice:

- state is large and deliberate
- it includes:
  - settings
  - tool permission context
  - runtime task state
  - MCP clients/tools/resources
  - plugins
  - agent definitions
  - file history
  - attribution
  - todos
  - notifications
  - elicitation queues
  - bridge/remote indicators

Design lesson:

- Claude Code centralizes complexity in a **strong application state model**
  rather than scattering it across many tiny services

### 7. Agent runtime

Core files:

- `src/tools/AgentTool/AgentTool.tsx`
- `src/tools/AgentTool/runAgent.ts`
- `src/utils/forkedAgent.ts`
- `src/utils/agentContext.ts`
- `src/tasks/LocalAgentTask/LocalAgentTask.tsx`

What to notice:

- agents are treated as managed tasks, not just nested LLM calls
- `AgentTool.tsx` is effectively a sub-runtime with:
  - input schema
  - async/background handling
  - model selection
  - progress tracking
  - worktree/remote isolation modes
- `runAgent.ts` builds the worker's effective tool pool, MCP clients, prompt,
  metadata, and transcript handling
- `forkedAgent.ts` exists specifically to preserve parent/fork cache safety
  while isolating mutable state
- `agentContext.ts` uses `AsyncLocalStorage` to attribute concurrent agent work
  correctly
- `LocalAgentTask.tsx` turns agent runs into inspectable lifecycle objects with
  progress, notifications, and retained transcript state

Design lesson:

- Claude Code's agent story is really a **task runtime** story

### 8. MCP and remote-control planes

Core files:

- `src/services/mcp/client.ts`
- `src/remote/RemoteSessionManager.ts`
- `src/bridge/bridgeMain.ts`
- `src/utils/messages/systemInit.ts`

What to notice:

- MCP is deeply integrated, not bolted on
- the MCP client layer handles transport variety, auth refresh, tool/result
  shaping, persistence, elicitation, and media handling
- `RemoteSessionManager.ts` manages an SDK/control dual stream for remote
  sessions
- `bridgeMain.ts` is a full remote-control supervisor, not a toy tunnel
- `systemInit.ts` shows that remote/SDK consumers get a structured runtime
  snapshot: tools, MCP servers, agents, skills, plugins, cwd, model,
  permission mode

Design lesson:

- Claude Code designs extension and remoting as **core product surfaces**

### 9. Memory and background augmentation

Core files:

- `src/services/SessionMemory/sessionMemory.ts`
- `src/query/stopHooks.ts`

What to notice:

- memory maintenance is not only prompt-time
- Claude Code runs background helpers such as session memory extraction,
  prompt suggestion, and auto-dream scheduling at turn boundaries
- stop hooks are therefore not only about "stopping"; they also act as a
  post-turn coordination seam

Design lesson:

- Claude Code uses the turn boundary as an **augmentation seam** for side work

### 10. Regression and determinism infrastructure

Core file:

- `src/services/vcr.ts`

What to notice:

- they record real API interactions into fixtures
- tests in CI fail if fixtures are missing and recording is not enabled
- this is not a simple mock-only strategy

Design lesson:

- Claude Code treats regression safety as an **infrastructure capability**

## Why the design feels coherent

The codebase is large, but it has a strong internal logic:

- `main.tsx` owns startup orchestration
- `QueryEngine.ts` owns session lifecycle
- `query.ts` owns the turn loop
- `Tool.ts` owns the execution contract
- `AppStateStore.ts` owns shared UI/runtime state
- `permissions/*` owns governance
- `AgentTool/*` owns delegated work
- `services/mcp/*` and `bridge/*` own extension/remoting planes

That separation is not "clean architecture" in the academic sense, but it is
very pragmatic and consistent.

## Main tradeoffs

Strengths:

- cohesive runtime model
- strong operational surfaces
- agent/task lifecycle is explicit
- permissions are layered and intentional
- many recovery paths live inside the main loop

Costs:

- very thick startup/runtime
- large shared state surface
- several central files are heavy (`main.tsx`, `query.ts`, `AgentTool.tsx`,
  `client.ts`)
- feature flags and product modes add a lot of branching

## What is worth learning from it

If you are studying Claude Code to improve CrawClaw, the best takeaways are:

1. Treat agents as task-backed runtime units.
2. Keep recovery logic inside the main loop where possible.
3. Make permission/guard behavior layered and explicit.
4. Build operational inspection surfaces early.
5. Treat replay/regression as first-class infrastructure.

The most important architectural insight is this:

> Claude Code is not organized around prompts. It is organized around a
> long-lived runtime.

