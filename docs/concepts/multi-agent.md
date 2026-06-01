---
summary: "Multi-agent routing: isolated agents, channel accounts, and bindings"
title: Multi-Agent Routing
read_when: "You want multiple isolated agents (workspaces + auth) in one gateway process."
status: active
---

# Multi-Agent Routing

Goal: multiple _isolated_ agents (separate workspace + `agentDir` + sessions), plus multiple channel accounts (e.g. two Weixins) in one running Gateway. Inbound is routed to an agent via bindings.

## What is "one agent"?

An **agent** is a fully scoped brain with its own:

- **Workspace** (files, AGENTS.md/SOUL.md/USER.md, local notes, persona rules).
- **State directory** (`agentDir`) for auth profiles, model registry, and per-agent config.
- **Session store** (chat history + routing state) under `~/.crawclaw/agents/<agentId>/sessions`.

Auth profiles are **per-agent**. Each agent reads from its own:

```text
~/.crawclaw/agents/<agentId>/agent/auth-profiles.json
```

Main agent credentials are **not** shared automatically. Never reuse `agentDir`
across agents (it causes auth/session collisions). If you want to share creds,
copy `auth-profiles.json` into the other agent's `agentDir`.

Skills are per-agent via each workspace’s `skills/` folder, with shared skills
available from `~/.crawclaw/skills`. See [Skills: per-agent vs shared](/tools/skills#per-agent-vs-shared-skills).

The Gateway can host **one agent** (default) or **many agents** side-by-side.

**Workspace note:** each agent’s workspace is the **default cwd**, not a hard
[Security](/gateway/security).

## Paths (quick map)

- Config: `~/.crawclaw/crawclaw.json` (or `CRAWCLAW_CONFIG_PATH`)
- State dir: `~/.crawclaw` (or `CRAWCLAW_STATE_DIR`)
- Workspace: `~/.crawclaw/workspace` (or `~/.crawclaw/workspace-<agentId>`)
- Agent dir: `~/.crawclaw/agents/<agentId>/agent` (or `agents.list[].agentDir`)
- Sessions: `~/.crawclaw/agents/<agentId>/sessions`

### Single-agent mode (default)

If you do nothing, CrawClaw runs a single agent:

- `agentId` defaults to **`main`**.
- Sessions are keyed as `agent:main:<mainKey>`.
- Workspace defaults to `~/.crawclaw/workspace` (or `~/.crawclaw/workspace-<profile>` when `CRAWCLAW_PROFILE` is set).
- State defaults to `~/.crawclaw/agents/main/agent`.

## Agent helper

Use the agent wizard to add a new isolated agent:

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

Then add `bindings` (or let the wizard do it) to route inbound messages.

Verify with:

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

## Quick start

<Steps>
  <Step title="Create each agent workspace">

Use the wizard or create workspaces manually:

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

Each agent gets its own workspace with `SOUL.md`, `AGENTS.md`, and optional `USER.md`, plus a dedicated `agentDir` and session store under `~/.crawclaw/agents/<agentId>`.

  </Step>

  <Step title="Create channel accounts">

Create one account per agent on your preferred channels:

- QQBot: one bot per agent, enable Message Content Intent, copy each token.
- Feishu: one bot per agent via BotFather, copy each token.
- Weixin: link each phone number per account.

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

See channel guides: [QQBot](/channels/index), [Feishu](/channels/index), [Weixin](/channels/index).

  </Step>

  <Step title="Add agents, accounts, and bindings">

Add agents under `agents.list`, channel accounts under `channels.<channel>.accounts`, and connect them with `bindings` (examples below).

  </Step>

  <Step title="Restart and verify">

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

  </Step>
</Steps>

## Multiple agents = multiple people, multiple personalities

With **multiple agents**, each `agentId` becomes a **fully isolated persona**:

- **Different phone numbers/accounts** (per channel `accountId`).
- **Different personalities** (per-agent workspace files like `AGENTS.md` and `SOUL.md`).
- **Separate auth + sessions** (no cross-talk unless explicitly enabled).

This lets **multiple people** share one Gateway server while keeping their AI “brains” and data isolated.

## Cross-agent memory

Agents keep separate workspaces, sessions, durable memory, and auth by default.
If you need shared long-term context, keep it in explicit shared project docs or
shared durable notes and reference that boundary in each agent's `AGENTS.md`.
Do not rely on hidden cross-agent transcript search.

## One Weixin number, multiple people (DM split)

You can route **different Weixin DMs** to different agents while staying on **one Weixin account**. Match on sender E.164 (like `+15551234567`) with `peer.kind: "direct"`. Replies still come from the same Weixin number (no per‑agent sender identity).

Important detail: direct chats collapse to the agent’s **main session key**, so true isolation requires **one agent per person**.

Example:

```json5
{
  agents: {
    list: [
      { id: "alex", workspace: "~/.crawclaw/workspace-alex" },
      { id: "mia", workspace: "~/.crawclaw/workspace-mia" },
    ],
  },
  bindings: [
    {
      agentId: "alex",
      match: { channel: "weixin", peer: { kind: "direct", id: "+15551230001" } },
    },
    {
      agentId: "mia",
      match: { channel: "weixin", peer: { kind: "direct", id: "+15551230002" } },
    },
  ],
  channels: {
    weixin: {
      dmPolicy: "allowlist",
      allowFrom: ["+15551230001", "+15551230002"],
    },
  },
}
```

Notes:

- DM access control is **global per Weixin account** (pairing/allowlist), not per agent.
- For shared groups, bind the group to one agent or use [Broadcast groups](/channels/broadcast-groups).

## Routing rules (how messages pick an agent)

Bindings are **deterministic** and **most-specific wins**:

1. `peer` match (exact DM/group/channel id)
2. `parentPeer` match (thread inheritance)
3. `guildId + roles` (QQBot role routing)
4. `guildId` (QQBot)
5. `teamId` (DingTalk)
6. `accountId` match for a channel
7. channel-level match (`accountId: "*"`)
8. fallback to default agent (`agents.list[].default`, else first list entry, default: `main`)

If multiple bindings match in the same tier, the first one in config order wins.
If a binding sets multiple match fields (for example `peer` + `guildId`), all specified fields are required (`AND` semantics).

Important account-scope detail:

- A binding that omits `accountId` matches the default account only.
- Use `accountId: "*"` for a channel-wide fallback across all accounts.
- If you later add the same binding for the same agent with an explicit account id, CrawClaw upgrades the existing channel-only binding to account-scoped instead of duplicating it.

## Multiple accounts / phone numbers

Channels that support **multiple accounts** (e.g. Weixin) use `accountId` to identify
each login. Each `accountId` can be routed to a different agent, so one server can host
multiple phone numbers without mixing sessions.

If you want a channel-wide default account when `accountId` is omitted, set
`channels.<channel>.defaultAccount` (optional). When unset, CrawClaw falls back
to `default` if present, otherwise the first configured account id (sorted).

Common channels supporting this pattern include:

- `weixin`, `feishu`, `qqbot`, `ddingtalk`, and `esp32`

## Concepts

- `agentId`: one “brain” (workspace, per-agent auth, per-agent session store).
- `accountId`: one channel account instance (e.g. Weixin account `"personal"` vs `"biz"`).
- `binding`: routes inbound messages to an `agentId` by `(channel, accountId, peer)` and optionally guild/team ids.
- Direct chats collapse to `agent:<agentId>:<mainKey>` (per-agent “main”; `session.mainKey`).

## Platform examples

### QQBot bots per agent

Each QQBot bot account maps to a unique `accountId`. Bind each account to an agent and keep allowlists per bot.

```json5
{
  agents: {
    list: [
      { id: "main", workspace: "~/.crawclaw/workspace-main" },
      { id: "coding", workspace: "~/.crawclaw/workspace-coding" },
    ],
  },
  bindings: [
    { agentId: "main", match: { channel: "qqbot", accountId: "default" } },
    { agentId: "coding", match: { channel: "qqbot", accountId: "coding" } },
  ],
  channels: {
    qqbot: {
      groupPolicy: "allowlist",
      accounts: {
        default: {
          token: "DISCORD_BOT_TOKEN_MAIN",
          guilds: {
            "123456789012345678": {
              channels: {
                "222222222222222222": { allow: true, requireMention: false },
              },
            },
          },
        },
        coding: {
          token: "DISCORD_BOT_TOKEN_CODING",
          guilds: {
            "123456789012345678": {
              channels: {
                "333333333333333333": { allow: true, requireMention: false },
              },
            },
          },
        },
      },
    },
  },
}
```

Notes:

- Invite each bot to the guild and enable Message Content Intent.
- Tokens live in `channels.qqbot.accounts.<id>.token` (default account can use `DISCORD_BOT_TOKEN`).

### Feishu bots per agent

```json5
{
  agents: {
    list: [
      { id: "main", workspace: "~/.crawclaw/workspace-main" },
      { id: "alerts", workspace: "~/.crawclaw/workspace-alerts" },
    ],
  },
  bindings: [
    { agentId: "main", match: { channel: "feishu", accountId: "default" } },
    { agentId: "alerts", match: { channel: "feishu", accountId: "alerts" } },
  ],
  channels: {
    feishu: {
      accounts: {
        default: {
          botToken: "123456:ABC...",
          dmPolicy: "pairing",
        },
        alerts: {
          botToken: "987654:XYZ...",
          dmPolicy: "allowlist",
          allowFrom: ["tg:123456789"],
        },
      },
    },
  },
}
```

Notes:

- Create one bot per agent with BotFather and copy each token.
- Tokens live in `channels.feishu.accounts.<id>.botToken` (default account can use `TELEGRAM_BOT_TOKEN`).

### Weixin numbers per agent

Link each account before starting the gateway:

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

`~/.crawclaw/crawclaw.json` (JSON5):

```js
{
  agents: {
    list: [
      {
        id: "home",
        default: true,
        name: "Home",
        workspace: "~/.crawclaw/workspace-home",
        agentDir: "~/.crawclaw/agents/home/agent",
      },
      {
        id: "work",
        name: "Work",
        workspace: "~/.crawclaw/workspace-work",
        agentDir: "~/.crawclaw/agents/work/agent",
      },
    ],
  },

  // Deterministic routing: first match wins (most-specific first).
  bindings: [
    { agentId: "home", match: { channel: "weixin", accountId: "personal" } },
    { agentId: "work", match: { channel: "weixin", accountId: "biz" } },

    // Optional per-peer override (example: send a specific group to work agent).
    {
      agentId: "work",
      match: {
        channel: "weixin",
        accountId: "personal",
        peer: { kind: "group", id: "1203630...@g.us" },
      },
    },
  ],

  // Off by default: agent-to-agent messaging must be explicitly enabled + allowlisted.
  tools: {
    agentToAgent: {
      enabled: false,
      allow: ["home", "work"],
    },
  },

  channels: {
    weixin: {
      accounts: {
        personal: {
          // Optional override. Default: ~/.crawclaw/credentials/weixin/personal
          // authDir: "~/.crawclaw/credentials/weixin/personal",
        },
        biz: {
          // Optional override. Default: ~/.crawclaw/credentials/weixin/biz
          // authDir: "~/.crawclaw/credentials/weixin/biz",
        },
      },
    },
  },
}
```

## Example: Weixin daily chat + Feishu deep work

Split by channel: route Weixin to a fast everyday agent and Feishu to an Opus agent.

```json5
{
  agents: {
    list: [
      {
        id: "chat",
        name: "Everyday",
        workspace: "~/.crawclaw/workspace-chat",
        model: "anthropic/claude-sonnet-4-6",
      },
      {
        id: "opus",
        name: "Deep Work",
        workspace: "~/.crawclaw/workspace-opus",
        model: "anthropic/claude-opus-4-6",
      },
    ],
  },
  bindings: [
    { agentId: "chat", match: { channel: "weixin" } },
    { agentId: "opus", match: { channel: "feishu" } },
  ],
}
```

Notes:

- If you have multiple accounts for a channel, add `accountId` to the binding (for example `{ channel: "weixin", accountId: "personal" }`).
- To route a single DM/group to Opus while keeping the rest on chat, add a `match.peer` binding for that peer; peer matches always win over channel-wide rules.

## Example: same channel, one peer to Opus

Keep Weixin on the fast agent, but route one DM to Opus:

```json5
{
  agents: {
    list: [
      {
        id: "chat",
        name: "Everyday",
        workspace: "~/.crawclaw/workspace-chat",
        model: "anthropic/claude-sonnet-4-6",
      },
      {
        id: "opus",
        name: "Deep Work",
        workspace: "~/.crawclaw/workspace-opus",
        model: "anthropic/claude-opus-4-6",
      },
    ],
  },
  bindings: [
    {
      agentId: "opus",
      match: { channel: "weixin", peer: { kind: "direct", id: "+15551234567" } },
    },
    { agentId: "chat", match: { channel: "weixin" } },
  ],
}
```

Peer bindings always win, so keep them above the channel-wide rule.

## Family agent bound to a Weixin group

Bind a dedicated family agent to a single Weixin group, with mention gating
and a tighter tool policy:

```json5
{
  agents: {
    list: [
      {
        id: "family",
        name: "Family",
        workspace: "~/.crawclaw/workspace-family",
        identity: { name: "Family Bot" },
        groupChat: {
          mentionPatterns: ["@family", "@familybot", "@Family Bot"],
        },
          mode: "all",
          scope: "agent",
        },
        tools: {
          allow: [
            "exec",
            "read",
            "sessions_list",
            "sessions_history",
            "sessions_send",
            "sessions_spawn",
            "session_status",
          ],
          deny: ["write", "edit", "apply_patch", "browser", "canvas", "cron"],
        },
      },
    ],
  },
  bindings: [
    {
      agentId: "family",
      match: {
        channel: "weixin",
        peer: { kind: "group", id: "120363999999999999@g.us" },
      },
    },
  ],
}
```

Notes:

- Tool allow/deny lists are **tools**, not skills. If a skill needs to run a
- For stricter gating, set `agents.list[].groupChat.mentionPatterns` and keep
  group allowlists enabled for the channel.

```js
{
  agents: {
    list: [
      {
        id: "personal",
        workspace: "~/.crawclaw/workspace-personal",
        },
        // No tool restrictions - all tools available
      },
      {
        id: "family",
        workspace: "~/.crawclaw/workspace-family",
          scope: "agent",  // One runtime per agent
          backend: "ssh",
          ssh: {
            target: "user@gateway-host:22",
            workspaceRoot: "/tmp/crawclaw-family",
          },
        },
        tools: {
          allow: ["read"],                    // Only read tool
          deny: ["exec", "write", "edit", "apply_patch"],    // Deny others
        },
      },
    ],
  },
}
```

**Benefits:**

- **Security isolation**: Restrict tools for untrusted agents
- **Flexible policies**: Different permissions per agent

Note: `tools.elevated` is **global** and sender-based; it is not configurable per agent.
If you need per-agent boundaries, use `agents.list[].tools` to deny `exec`.
For group targeting, use `agents.list[].groupChat.mentionPatterns` so @mentions map cleanly to the intended agent.

See [Subagents](/tools/subagents) for detailed examples.

## Related

- [Channel Routing](/channels/channel-routing) — how messages route to agents
- [Sub-Agents](/tools/subagents) — spawning background agent runs
- [ACP Agents](/tools/acp-agents) — running external coding harnesses
- [Presence](/concepts/presence) — agent presence and availability
- [Session](/concepts/session) — session isolation and routing
