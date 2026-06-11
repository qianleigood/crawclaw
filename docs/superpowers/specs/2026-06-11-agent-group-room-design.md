---
title: "Agent Group Room Design"
summary: "Design for supervised multi-agent task rooms where several CrawClaw agents collaborate in one conversation"
read_when:
  - You are implementing multi-agent task rooms
  - You are changing agent-to-agent messaging, team manifests, or group chat routing
  - You need the boundary between external group chats and internal agent collaboration
---

# Agent Group Room Design

## Goal

Add an agent group room experience where a user can start one task in a shared
conversation and multiple configured agents can collaborate toward completion.

The first version should feel like a task room, not an uncontrolled chat room:
one lead agent plans, delegates, asks follow-up questions, reviews progress, and
owns the final response. Member agents contribute scoped work into the shared
room transcript.

## Assumptions

- CrawClaw already supports multiple isolated top-level agents through
  `agents.list[]`, per-agent workspaces, per-agent `agentDir`, and per-agent
  sessions. See [Multi-Agent Routing](/concepts/multi-agent).
- External channel group messages already enter the Gateway as normalized
  channel envelopes and are routed through sessions. See
  [Group Messages](/channels/group-messages).
- Runtime session tools already expose `TeamCreate`, `Agent`, `Task`,
  `SendMessage`, broadcast, and session history primitives.
- The first version should reuse existing Rust runtime and session stores.
  TypeScript remains a renderer layer for Desktop.
- Group rooms may be started from Desktop first, then bound to external group
  chats once the runtime path is stable.

## External Patterns Considered

- AutoGen `SelectorGroupChat` uses a shared context, participant descriptions,
  model-based next speaker selection, broadcast, and termination checks:
  https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/selector-group-chat.html
- OpenAI Agents SDK separates manager-owned "agents as tools" from handoffs
  where a specialist becomes active. The first version should use the manager
  pattern because one lead must own the final answer:
  https://openai.github.io/openai-agents-python/multi_agent/
- LangChain subagents keep central control in a supervisor and call specialized
  agents as tools, including parallel execution for independent domains:
  https://docs.langchain.com/oss/python/langchain/multi-agent/subagents
- CrewAI collaboration exposes explicit "delegate work" and "ask question"
  tools. CrawClaw already has equivalent concepts through `Agent`, `Task`, and
  `SendMessage`: https://docs.crewai.com/en/concepts/collaboration
- Magentic-One uses an orchestrator, task ledger, progress ledger, replanning,
  and stall detection. CrawClaw should adopt this ledger shape for observability:
  https://www.microsoft.com/en-us/research/articles/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/
- CAMEL highlights multi-agent failure modes such as role flipping, repeated
  instructions, low-value replies, and infinite loops. CrawClaw should treat
  turn limits, role descriptions, and stop conditions as required runtime
  controls:
  https://proceedings.neurips.cc/paper_files/paper/2023/hash/a3621ee907def47c1b952ade25c67698-Abstract-Conference.html

## Non-Goals

- Do not implement free-form swarm chat in the first version.
- Do not let every member agent directly respond to the external user by
  default.
- Do not create a JavaScript plugin SDK surface for agent rooms.
- Do not bypass `tools.agentToAgent` allowlists for cross-agent communication.
- Do not make public group chats always-on execution surfaces. Mention gating
  and allowlists remain required.
- Do not merge per-agent auth, workspaces, or session stores.
- Do not add TypeScript test suites.
- Do not edit generated `docs/zh-CN/**` pages in this slice.

## Selected Approach

Use a supervised agent group room.

The room has one lead agent and a fixed member list. The lead agent maintains a
task ledger, chooses which member should work next, may run members in parallel,
and creates the user-facing final response. Member agents receive scoped
instructions and write structured contributions back to the room transcript.

This is narrower than selector-based group chat and safer than free swarm chat.
It maps cleanly onto CrawClaw's existing runtime tools and keeps the first
implementation testable.

## Data Model

Add an `agentGroups.list[]` config section:

```json5
{
  agentGroups: {
    list: [
      {
        id: "launch-room",
        title: "Launch Room",
        mode: "supervised",
        leadAgentId: "pm",
        memberAgentIds: ["researcher", "coder", "reviewer"],
        defaultSource: "desktop",
        policy: {
          maxTurns: 12,
          maxParallelAgents: 3,
          requireLeadFinalAnswer: true,
          allowDirectAgentReplyToUser: false,
        },
      },
    ],
  },
}
```

Field rules:

- `id`: stable room template id.
- `title`: user-facing label.
- `mode`: initially only `supervised`.
- `leadAgentId`: configured top-level agent id that owns planning and final
  response.
- `memberAgentIds`: configured top-level agent ids available to the lead.
- `defaultSource`: `desktop` for the first slice, later channel ids.
- `policy.maxTurns`: maximum lead/member exchange turns for one task.
- `policy.maxParallelAgents`: upper bound for concurrent member runs.
- `policy.requireLeadFinalAnswer`: default `true`.
- `policy.allowDirectAgentReplyToUser`: default `false`.

Add a persisted room task record under the lead agent state:

```json
{
  "roomRunId": "room-run-...",
  "groupId": "launch-room",
  "leadAgentId": "pm",
  "source": {
    "channel": "desktop",
    "accountId": "default",
    "peer": { "kind": "direct", "id": "desktop" }
  },
  "sessionKey": "group:launch-room:...",
  "status": "running",
  "taskLedger": {
    "goal": "",
    "acceptanceCriteria": [],
    "knownFacts": [],
    "missingFacts": [],
    "plan": []
  },
  "progressLedger": {
    "turns": 0,
    "lastSpeakerAgentId": null,
    "completed": false,
    "stalledTurns": 0,
    "openQuestions": []
  },
  "members": [{ "agentId": "researcher", "role": "research", "status": "idle" }]
}
```

The room transcript remains JSONL like current sessions, but each room message
gets speaker metadata:

```json
{
  "type": "agentGroup.message",
  "roomRunId": "room-run-...",
  "speakerAgentId": "researcher",
  "speakerRole": "member",
  "visibility": "room",
  "body": "..."
}
```

## Runtime Flow

1. User starts a group task from Desktop or a bound external group chat.
2. Gateway resolves the configured `agentGroup` and creates a room run owned by
   the lead agent.
3. Runtime creates or loads the room session and writes the user request.
4. Lead agent receives a prompt with:
   - user request
   - group member descriptions
   - task ledger schema
   - progress ledger schema
   - room policy limits
5. Lead agent creates the first task ledger and selects one of:
   - ask the user a clarifying question
   - delegate a bounded task to one member
   - delegate independent tasks to multiple members, capped by policy
   - produce the final response
6. Member runs execute as top-level agent runs with scoped context:
   - room goal
   - the assigned subtask
   - relevant transcript excerpts
   - member agent workspace and auth
   - member tool policy
7. Member outputs are appended to the room transcript and summarized into the
   progress ledger.
8. Lead agent evaluates completion, stall state, and next speaker.
9. Runtime stops when completion is true, max turns is reached, the user stops
   the room, or a policy guard blocks further delegation.
10. Lead agent produces the final user-facing response unless policy explicitly
    allows direct member replies.

## Speaker Selection

The first version should use lead-owned selection, not an autonomous selector
agent.

The lead selects members through structured decisions:

```json
{
  "action": "delegate",
  "targets": [
    {
      "agentId": "researcher",
      "summary": "Find current constraints",
      "prompt": "Research the deployment constraints and return citations."
    }
  ]
}
```

Runtime validates:

- every target is in `memberAgentIds`
- target count does not exceed `maxParallelAgents`
- the same member is not selected repeatedly without new evidence
- `maxTurns` and `session.agentToAgent.maxPingPongTurns` are respected

Future versions can add `mode: "selector"` with model-based speaker selection,
but only after the supervised path is stable.

## Relationship To Existing Tools

The first implementation should reuse existing tool semantics:

- `TeamCreate`: can seed the lead and member manifest for one room run.
- `Agent` or `Task`: can launch member runs with a role and prompt.
- `SendMessage`: can send follow-up questions to a member or broadcast to all
  members.
- `sessions_history`: can inspect room and member transcripts under policy.
- `sessions_yield`: can let the lead wait for background member results.

The likely implementation change is not a new public tool first. It is a
Rust-owned `agent_group_room` runtime helper that composes these primitives with
strong policy validation and trace events.

## Gateway Routing

Add an optional binding type for external rooms:

```json5
{
  bindings: [
    {
      type: "agentGroup",
      groupId: "launch-room",
      match: {
        channel: "weixin",
        peer: { kind: "group", id: "chat_id:..." },
      },
    },
  ],
}
```

Routing rules:

- `type: "route"` keeps current single-agent behavior.
- `type: "agentGroup"` routes inbound messages to a room run.
- Mention gating and room allowlists are evaluated before group routing.
- External group history is treated as context, not automatic permission to
  expose private agent transcripts.
- If a room run is active, channel queue mode decides whether new messages steer
  the lead, queue as follow-up, or interrupt.

## Desktop Experience

Desktop should start with a focused task-room view:

- room selector
- member list with status
- lead agent indicator
- shared transcript
- task ledger panel
- progress ledger panel
- active member runs
- stop, continue, and summarize controls

The UI should not market the feature with a landing page. The first screen
should be the usable room.

Message rendering should distinguish:

- user request
- lead plan
- delegation
- member result
- lead review
- final response
- policy stop
- failure

The existing conversation message renderer can be extended with group-room
metadata instead of creating an unrelated chat renderer.

## Safety And Permissions

Defaults:

- `tools.agentToAgent.enabled` remains `false`.
- Agent group room creation should fail clearly unless all cross-agent targets
  are explicitly allowed or the room uses only subagent sessions under one lead.
- `allowDirectAgentReplyToUser` defaults to `false`.
- External group chat routing requires channel allowlist and mention gating.
- Member agents inherit their own configured tool policies.
- The lead cannot grant a member broader tools than the member config allows.
- Room transcript excerpts passed to members should be bounded and explicit.
- Sensitive outputs should follow existing tool projection and transcript
  policies.

Loop controls:

- `policy.maxTurns`
- `policy.maxParallelAgents`
- `session.agentToAgent.maxPingPongTurns`
- stall counter in `progressLedger`
- no repeated same-speaker delegation without new input
- manual stop from Desktop or chat command

## Context Rules

Each member run should receive only the context required for its task:

- the room goal
- assigned prompt
- the current task ledger
- relevant transcript excerpts
- known constraints and acceptance criteria

Members should not receive:

- full transcripts from unrelated agents
- private auth or profile details
- unrelated Desktop session state
- raw external group history beyond the configured history limit

The lead receives the room transcript and member result summaries. It does not
need every raw tool result unless the user asks for audit details or the lead is
performing validation.

## Testing

Scoped Rust tests should cover:

- parsing `agentGroups.list[]`
- rejecting unknown lead or member agent ids
- rejecting duplicate or empty member lists
- resolving a Desktop-started group room
- resolving a channel binding with `type: "agentGroup"`
- enforcing mention gating before group routing
- creating a room run and transcript entry
- validating structured lead delegation targets
- blocking targets not in `memberAgentIds`
- enforcing `maxParallelAgents`
- enforcing `maxTurns`
- stopping on stall count
- ensuring member final text does not become user-facing output when
  `allowDirectAgentReplyToUser=false`
- preserving per-agent workspace and `agentDir` isolation

Desktop verification should cover:

- room list renders configured groups
- user can start a room task
- member status changes are visible
- ledger panels update without overlapping the transcript
- stop and continue actions produce state changes

Full gates before landing implementation:

- scoped Rust tests for runtime and config behavior
- `pnpm check`
- `pnpm test` when runtime logic changes
- `pnpm build` when Desktop API contracts or renderer types change

## Rollout Plan

Phase 1: Desktop-only supervised rooms.

- Add config schema and runtime data types.
- Add room run helper using existing session and task primitives.
- Add Desktop state and renderer support.
- Add tests around policy, ledger, and transcript behavior.

Phase 2: External group binding.

- Add `bindings[].type="agentGroup"`.
- Route allowed and mentioned group messages into configured rooms.
- Add channel-specific docs and troubleshooting.

Phase 3: Advanced selection.

- Add optional selector mode after supervised mode is stable.
- Add candidate filtering and repeated-speaker controls.
- Add richer evaluation metrics for stuck or looping rooms.

## Open Decisions

The first implementation should choose these defaults unless implementation
evidence argues otherwise:

- Default mode: `supervised`.
- Default source: Desktop.
- Default `maxTurns`: `12`.
- Default `maxParallelAgents`: `3`.
- Default final answer owner: lead agent.
- Default external group behavior: mention-gated and allowlisted.
- Default transcript policy: room-visible summaries plus bounded excerpts for
  member prompts.

No unresolved product decision blocks the first spec-to-plan transition.
