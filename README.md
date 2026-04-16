# 🦞 CrawClaw

<p align="center">
  <img src="https://raw.githubusercontent.com/qianleigood/crawclaw/main/docs/assets/crawclaw-logo-badge.png" alt="CrawClaw logo" width="360">
</p>

<p align="center">
  English · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/qianleigood/crawclaw/actions/workflows/ci.yml?branch=main"><img src="https://img.shields.io/github/actions/workflow/status/qianleigood/crawclaw/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="https://github.com/qianleigood/crawclaw/releases"><img src="https://img.shields.io/github/v/release/qianleigood/crawclaw?include_prereleases&style=for-the-badge" alt="GitHub release"></a>
  <a href="https://www.npmjs.com/package/crawclaw"><img src="https://img.shields.io/npm/v/crawclaw?style=for-the-badge" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

**CrawClaw** is a local-first assistant runtime with one control plane for chat,
memory, workflows, browser automation, host tools, and a web control UI.

This README only covers five things:

- the project design
- memory design
- workflow design
- the tool substrate
- installation through npm and Docker

For the wider product docs, see [docs.crawclaw.ai](https://docs.crawclaw.ai).

## Project Design

CrawClaw is built around a **Gateway-first architecture**.

- The **Gateway** is the system control plane. It owns sessions, auth, config,
  web UI, agent calls, events, and tool invocation surfaces.
- The **agent runtime** sits behind that gateway and executes model calls,
  tool calls, subagents, streaming, and safety policy.
- The **memory runtime** is not a side note; it is part of prompt assembly,
  compaction, durable recall, and long-running assistant behavior.
- The **workflow layer** is not a second assistant runtime. It turns successful
  runs into deployable workflows and uses n8n as the execution engine.
- The **tool layer** is typed and policy-controlled. Tools are the substrate;
  skills and plugins sit above that substrate to teach or extend behavior.

At the repository level, the system is split roughly like this:

- [src/gateway](/Users/qianlei/crawclaw/src/gateway): control plane, protocol,
  auth, methods, UI integration
- [src/agents](/Users/qianlei/crawclaw/src/agents): agent runtime, tool
  registration, sandboxing, provider integration, subagents
- [src/memory](/Users/qianlei/crawclaw/src/memory): memory engine, extraction,
  durable storage, orchestration, prompt assembly
- [src/workflows](/Users/qianlei/crawclaw/src/workflows): workflow registry,
  versioning, n8n compilation and execution bridge
- [ui](/Users/qianlei/crawclaw/ui): Control UI that talks to the gateway over a
  single RPC-style client
- [extensions](/Users/qianlei/crawclaw/extensions): plugin-style capability
  packages for channels, providers, browser backends, and more

## Memory Design

The memory system is designed as a **runtime service**, not just a vector search
adapter.

Core entrypoints:

- [src/memory/index.ts](/Users/qianlei/crawclaw/src/memory/index.ts:1)
- [src/memory/engine/memory-runtime.ts](/Users/qianlei/crawclaw/src/memory/engine/memory-runtime.ts:1)
- [src/memory/orchestration/context-assembler.ts](/Users/qianlei/crawclaw/src/memory/orchestration/context-assembler.ts:1)

The design has four layers:

1. **Ingest and extraction**
   - CrawClaw extracts candidate memories from transcripts, files, and runtime
     signals.
   - Promotion paths exist for session summaries, durable memory, and
     knowledge-like notes.
   - Relevant modules live under
     [src/memory/extraction](/Users/qianlei/crawclaw/src/memory/extraction) and
     [src/memory/promotion](/Users/qianlei/crawclaw/src/memory/promotion).

2. **Storage**
   - The built-in engine is local-first and SQLite-backed.
   - Durable memory, summaries, and assembly audit data are stored in local
     runtime stores rather than outsourced to a remote-only service.
   - Relevant modules:
     [src/memory/runtime](/Users/qianlei/crawclaw/src/memory/runtime) and
     [src/memory/durable](/Users/qianlei/crawclaw/src/memory/durable).

3. **Recall and ranking**
   - Recall is hybrid by design: vector search, text search, reranking, and
     freshness all participate.
   - The system distinguishes durable memory, knowledge layers, session memory,
     and runtime signals instead of flattening everything into one top-k list.
   - Relevant modules:
     [src/memory/orchestration](/Users/qianlei/crawclaw/src/memory/orchestration),
     [src/memory/search](/Users/qianlei/crawclaw/src/memory/search), and
     [src/memory/recall](/Users/qianlei/crawclaw/src/memory/recall).

4. **Prompt assembly and compaction**
   - Memory is assembled into structured prompt sections with token budgets.
   - Session summaries and durable recall are explicitly budgeted and rendered
     as separate prompt sections.
   - Compaction is treated as a first-class maintenance path, not an emergency
     fallback.
   - Relevant modules:
     [src/memory/context](/Users/qianlei/crawclaw/src/memory/context) and
     [src/memory/session-summary](/Users/qianlei/crawclaw/src/memory/session-summary).

Practical design takeaway:

- CrawClaw memory is meant to preserve assistant continuity over time.
- It is designed to be local-first, query-aware, and layered.
- It is not just “embed everything and stuff the nearest chunks back in”.

Configuration reference:

- [docs/reference/memory-config.md](/Users/qianlei/crawclaw/docs/reference/memory-config.md)

## Workflow Design

The workflow system is designed around a hard boundary:

- **CrawClaw designs and controls workflows**
- **n8n executes workflows**

This is already reflected in code:

- [src/workflows/api.ts](/Users/qianlei/crawclaw/src/workflows/api.ts:1)
- [src/workflows/n8n-client.ts](/Users/qianlei/crawclaw/src/workflows/n8n-client.ts:1)
- [src/agents/tools/workflow-tool.ts](/Users/qianlei/crawclaw/src/agents/tools/workflow-tool.ts:1)

The workflow model works like this:

1. A user task is first completed normally by the agent runtime.
2. When the user explicitly wants repeatability, CrawClaw derives a workflow
   spec from that successful execution path.
3. CrawClaw stores the workflow spec locally, versions it, diffs it, and
   exposes it through registry operations.
4. CrawClaw compiles that spec to n8n workflow JSON.
5. n8n becomes the execution plane for triggers, waits, retries, branching,
   and external integration.
6. High-intelligence steps can call back into CrawClaw through dedicated
   workflow-step agent surfaces instead of embedding all reasoning inside n8n.

This means the workflow design is intentionally split into three concerns:

- **Registry and lifecycle**
  - list, describe, diff, versions, update, republish, rollback, archive
  - implemented in
    [src/workflows](/Users/qianlei/crawclaw/src/workflows)

- **Compilation and execution bridge**
  - compile workflow spec to n8n
  - push to n8n
  - map execution IDs and statuses back into CrawClaw
  - implemented through `n8n-client`, compiler, and execution sync helpers

- **Agent step execution**
  - workflow steps that still need model reasoning call back into CrawClaw
  - this avoids turning n8n into a prompt-heavy agent host

Practical design takeaway:

- CrawClaw does not try to become a second general-purpose workflow engine.
- It owns the authoring, versioning, and assistant-facing side.
- n8n owns the durable workflow execution side.

Reference:

- [docs/reference/n8n-workflow-architecture.md](/Users/qianlei/crawclaw/docs/reference/n8n-workflow-architecture.md)

## Tool Substrate

The agent runtime is built on a **typed tool layer**. Everything beyond plain
text generation goes through tools.

Tool-facing docs:

- [docs/tools/index.md](/Users/qianlei/crawclaw/docs/tools/index.md)

Runtime entrypoints:

- [src/agents/crawclaw-tools.runtime.ts](/Users/qianlei/crawclaw/src/agents/crawclaw-tools.runtime.ts:1)
- [src/agents/bash-tools.ts](/Users/qianlei/crawclaw/src/agents/bash-tools.ts:1)
- [src/agents/tools/gateway.ts](/Users/qianlei/crawclaw/src/agents/tools/gateway.ts:1)

The substrate is layered like this:

1. **Built-in tools**
   - file IO, patching, shell/process execution, browser, web, PDF, image,
     messaging, sessions, cron, nodes, gateway operations

2. **Skills**
   - markdown instructions that teach the model when and how to use tools
   - skills are not tools themselves; they are behavior overlays

3. **Plugins**
   - packages that can register tools, channels, model providers, skills,
     browser capabilities, and other runtime extensions

4. **Policy and scoping**
   - tool profiles, allow/deny rules, provider-specific restrictions,
     sandbox/elevation gates, and gateway auth scopes sit between the model and
     execution

The important design choice here is that CrawClaw does not treat tools as an
afterthought.

- Tool definitions are typed
- tool surfaces are grouped and policy-controlled
- gateway calls are explicit and scope-aware
- shell access is modeled separately from higher-level control surfaces

Practical design takeaway:

- The tool layer is the real execution substrate.
- Skills explain behavior.
- Plugins extend the substrate.
- Gateway auth and sandbox policy decide what actually gets executed.

## Install With npm

Reference:

- [docs/install/node.md](/Users/qianlei/crawclaw/docs/install/node.md)

Requirements:

- Node **24** recommended
- Node **22.14+** supported

Install globally from npm:

```bash
npm install -g crawclaw@latest
```

Then run onboarding:

```bash
crawclaw onboard --install-daemon
```

Useful follow-up commands:

```bash
crawclaw gateway --port 18789 --verbose
crawclaw doctor
```

If `crawclaw` is not found after install, check your global npm bin path:

```bash
npm prefix -g
```

## Install With Docker

Reference:

- [docs/install/docker.md](/Users/qianlei/crawclaw/docs/install/docker.md)

Docker is the containerized gateway path. It is useful when you want the
gateway isolated from the host runtime.

Quick path from the repo root:

```bash
./scripts/docker/setup.sh
```

That flow will:

- build the image locally, or use `CRAWCLAW_IMAGE` if you point it at GHCR
- run onboarding
- write config and token state
- start the gateway with Docker Compose

If you want to use the published image:

```bash
export CRAWCLAW_IMAGE="ghcr.io/qianleigood/crawclaw:latest"
./scripts/docker/setup.sh
```

Open the Control UI after setup:

```bash
http://127.0.0.1:18789/
```

Manual Docker path:

```bash
docker build -t crawclaw:local -f Dockerfile .
docker compose up -d crawclaw-gateway
```

Health endpoints:

```bash
curl -fsS http://127.0.0.1:18789/healthz
curl -fsS http://127.0.0.1:18789/readyz
```

## Repo Pointers

- Gateway: [src/gateway](/Users/qianlei/crawclaw/src/gateway)
- Memory: [src/memory](/Users/qianlei/crawclaw/src/memory)
- Workflows: [src/workflows](/Users/qianlei/crawclaw/src/workflows)
- Agent runtime and tools: [src/agents](/Users/qianlei/crawclaw/src/agents)
- Control UI: [ui](/Users/qianlei/crawclaw/ui)
- Browser subsystem and plugins: [extensions](/Users/qianlei/crawclaw/extensions)

## Repository Layout

The monorepo currently carries several layers at once:

- runtime core in `src/`
- interface code in `ui/`
- capability ecosystem packages in `extensions/`
- support packages in `packages/`
- optional skill catalog content in `skills-optional/`
- sidecar code in `Swabble/`
- shared test infrastructure in `test/`
- build output in `dist/`

Maintainer structure notes:

- [docs/maintainers/repo-structure.md](/Users/qianlei/crawclaw/docs/maintainers/repo-structure.md)
