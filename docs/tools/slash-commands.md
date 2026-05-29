---
summary: "Slash commands: text vs native, config, and supported commands"
read_when:
  - Using or configuring chat commands
  - Debugging command routing or permissions
title: "Slash Commands"
---

# Slash commands

Commands are handled by the Gateway. Most commands must be sent as a **standalone** message that starts with `/`.
The host-only bash chat command uses `! <cmd>` (with `/bash <cmd>` as an alias).

There are two related systems:

- **Commands**: standalone `/...` messages.
- **Directives**: `/think`, `/fast`, `/verbose`, `/reasoning`, `/elevated`, `/exec`, `/model`, `/queue`.
  - Directives are stripped from the message before the model sees it.
  - In normal chat messages (not directive-only), they are treated as “inline hints” and do **not** persist session settings.
  - In directive-only messages (the message contains only directives), they persist to the session and reply with an acknowledgement.
  - Directives are only applied for **authorized senders**. If `commands.allowFrom` is set, it is the only
    allowlist used; otherwise authorization comes from channel allowlists/pairing plus `commands.useAccessGroups`.
    Unauthorized senders see directives treated as plain text.

There are also a few **inline shortcuts** (allowlisted/authorized senders only): `/help`, `/commands`, `/status`, `/whoami` (`/id`).
They run immediately, are stripped before the model sees the message, and the remaining text continues through the normal flow.

## Config

```json5
{
  commands: {
    native: "auto",
    nativeSkills: "auto",
    text: true,
    bash: false,
    bashForegroundMs: 2000,
    config: false,
    mcp: false,
    plugins: false,
    debug: false,
    restart: true, // default; set false to disable manual restart
    allowFrom: {
      "*": ["user1"],
      qqbot: ["user:123"],
    },
    useAccessGroups: true,
  },
}
```

- `commands.text` (default `true`) enables parsing `/...` in chat messages.
  - On surfaces without native commands (Weixin/Signal/Weixin/Feishu/QQBot), text commands still work even if you set this to `false`.
- `commands.native` (default `"auto"`) registers native commands.
  - Auto: on for QQBot/Feishu; off for DingTalk (until you add slash commands); ignored for providers without native support.
  - Set `channels.qqbot.commands.native`, `channels.feishu.commands.native`, or `channels.ddingtalk.commands.native` to override per provider (bool or `"auto"`).
  - `false` clears previously registered commands on QQBot/Feishu at startup. DingTalk commands are managed in the DingTalk app and are not removed automatically.
- `commands.nativeSkills` (default `"auto"`) registers **skill** commands natively when supported.
  - Auto: on for QQBot/Feishu; off for DingTalk (DingTalk requires creating a slash command per skill).
  - Set `channels.qqbot.commands.nativeSkills`, `channels.feishu.commands.nativeSkills`, or `channels.ddingtalk.commands.nativeSkills` to override per provider (bool or `"auto"`).
- `commands.bash` (default `false`) enables `! <cmd>` to run host shell commands (`/bash <cmd>` is an alias; requires `tools.elevated` allowlists).
- `commands.bashForegroundMs` (default `2000`) controls how long bash waits before switching to background mode (`0` backgrounds immediately).
- `commands.config` (default `false`) enables `/config` (reads/writes `crawclaw.json`).
- `commands.mcp` (default `false`) enables `/mcp` (reads/writes CrawClaw-managed MCP config under `mcpServers`).
- `commands.plugins` (default `false`) enables `/plugins` (plugin discovery/status plus install + enable/disable controls).
- `commands.debug` (default `false`) enables `/debug` (runtime-only overrides).
- `commands.allowFrom` (optional) sets a per-provider allowlist for command authorization. When configured, it is the
  only authorization source for commands and directives (channel allowlists/pairing and `commands.useAccessGroups`
  are ignored). Use `"*"` for a global default; provider-specific keys override it.
- `commands.useAccessGroups` (default `true`) enforces allowlists/policies for commands when `commands.allowFrom` is not set.

## Command list

Text + native (when enabled):

- `/help`
- `/commands`
- `/tools [compact|verbose]` (show what the current agent can use right now; `verbose` adds descriptions)

Read-only query commands:

- `/health` (gateway, sessions, and configured-channel summary)
- `/channels` (channel-only detail view from the same health snapshot as `/health`)
- `/sessions` (read-only stored-session list; `/session` changes this chat's settings)
- `/devices` (chat/mobile device pairing summary)
- `/memory` (memory provider access status; `/context` explains prompt inputs)
- `/skills` (list user-invocable skill slash commands; `/skill` runs one)

Action and session commands:

- `/skill <name> [input]` (run a skill by name)
- `/status` (show current status; includes provider usage/quota for the current model provider when available)
- `/tasks` (list background tasks for the current session; shows active and recent task details with agent-local fallback counts)
- `/allowlist` (list/add/remove allowlist entries)
- `/approve <id> <decision>` (resolve exec approval prompts; use the pending approval message for the available decisions)
- `/context [list|detail|json]` (explain “context”; `detail` shows per-file + per-tool + per-skill + system prompt size)
- `/btw <question>` (ask an ephemeral side question about the current session without changing future session context; see [/tools/btw](/tools/btw))
- `/export-session [path]` (alias: `/export`) (export current session to HTML with full system prompt)
- `/whoami` (show your sender id; alias: `/id`)
- `/review [focus]` (run the two-stage review pipeline for the current task, optionally with a review focus)
- `/session idle <duration|off>` (manage inactivity auto-unfocus for focused thread bindings)
- `/session max-age <duration|off>` (manage hard max-age auto-unfocus for focused thread bindings)
- `/subagents list|kill|log|info|send|steer|spawn` (inspect, control, or spawn sub-agent runs for the current session)
- `/acp spawn|cancel|steer|close|status|set-mode|set|cwd|permissions|timeout|model|reset-options|doctor|install|sessions` (inspect and control ACP runtime sessions)
- `/agents` (list thread-bound agents for this session)
- `/focus <target>` (QQBot: bind this thread, or a new thread, to a session/subagent target)
- `/unfocus` (QQBot: remove the current thread binding)
- `/kill <id|#|all>` (immediately abort one or all running sub-agents for this session; no confirmation message)
- `/steer <id|#> <message>` (steer a running sub-agent immediately: in-run when possible, otherwise abort current work and restart on the steer message)
- `/tell <id|#> <message>` (alias for `/steer`)
- `/config show|get|set|unset` (persist config to disk, owner-only; requires `commands.config: true`)
- `/mcp show|get|set|unset` (manage CrawClaw MCP server config, owner-only; requires `commands.mcp: true`)
- `/plugins list|show|get|install|enable|disable` (inspect discovered plugins, install new ones, and toggle enablement; owner-only for writes; requires `commands.plugins: true`)
  - `/plugin` is an alias for `/plugins`.
  - `/plugin install <spec>` accepts the same plugin specs as CrawClaw Desktop or the local Gateway API: local path/archive, npm package, or `clawhub:<pkg>`.
  - Enable/disable writes still reply with a restart hint. On a watched foreground gateway, CrawClaw may perform that restart automatically right after the write.
- `/debug show|set|unset|reset` (runtime overrides, owner-only; requires `commands.debug: true`)
- `/usage off|tokens|full|cost` (per-response usage footer or local cost summary)
- `/tts off|always|inbound|tagged|status|provider|limit|summary|audio` (control TTS; see [/tts](/tools/tts))
  - QQBot: native command is `/voice` (QQBot reserves `/tts`); text `/tts` still works.
- `/stop`
- `/restart`
- `/dock-feishu` (alias: `/dock_feishu`) (switch replies to Feishu)
- `/dock-qqbot` (alias: `/dock_qqbot`) (switch replies to QQBot)
- `/dock-ddingtalk` (alias: `/dock_ddingtalk`) (switch replies to DingTalk)
- `/activation mention|always` (groups only)
- `/send on|off|inherit` (owner-only)
- `/new [model]` (optional model hint; remainder is passed through)
- `/think <off|minimal|low|medium|high|xhigh>` (dynamic choices by model/provider; aliases: `/thinking`, `/t`)
- `/fast status|on|off` (omitting the arg shows the current effective fast-mode state)
- `/verbose on|full|off` (alias: `/v`)
- `/reasoning on|off|stream` (alias: `/reason`; when on, sends a separate message prefixed `Reasoning:`; `stream` = Feishu draft only)
- `/elevated on|off|ask|full` (alias: `/elev`; `full` skips exec approvals)
- `/model <name>` (alias: `/models`; or `/<alias>` from `agents.defaults.models.*.alias`)
- `/queue <mode>` (plus options like `debounce:2s cap:25 drop:summarize`; send `/queue` to see current settings)
- `/bash <command>` (host-only; alias for `! <command>`; requires `commands.bash: true` + `tools.elevated` allowlists)

Text-only:

- `/compact [instructions]` (see [/concepts/compaction](/concepts/compaction))
- `! <command>` (host-only; one at a time; use `!poll` + `!stop` for long-running jobs)
- `!poll` (check output / status; accepts optional `sessionId`; `/bash poll` also works)
- `!stop` (stop the running bash job; accepts optional `sessionId`; `/bash stop` also works)

Notes:

- Commands accept an optional `:` between the command and args (e.g. `/think: high`, `/send: on`, `/help:`).
- `/new <model>` accepts a model alias, `provider/model`, or a provider name (fuzzy match); if no match, the text is treated as the message body.
- `/review` runs a two-stage review pipeline through task-backed special agents.
  - With no argument, it reviews the current task outcome, recent workspace changes, and user-visible behavior for the current session.
  - With an argument, the remainder becomes review focus, for example: `/review check plugin SDK boundary coverage`.
  - Review sessions are read-only by policy: they are restricted to validation tools and cannot recursively start another review run.
  - `/review` is the only user-facing review entry. The internal `review_task` tool flow is not exposed as a public slash command.
- For full provider usage breakdown, use CrawClaw Desktop or the local Gateway API.
- `/allowlist add|remove` requires `commands.config=true` and honors channel `configWrites`.
- In multi-account channels, config-targeted `/allowlist --account <id>` and `/config set channels.<provider>.accounts.<id>...` also honor the target account's `configWrites`.
- `/usage` controls the per-response usage footer; `/usage cost` prints a local cost summary from CrawClaw session logs.
- `/restart` is enabled by default; set `commands.restart: false` to disable it.
- QQBot-only native command: `/vc join|leave|status` controls voice channels (requires `channels.qqbot.voice` and native commands; not available as text).
- QQBot thread-binding commands (`/focus`, `/unfocus`, `/agents`, `/session idle`, `/session max-age`) require effective thread bindings to be enabled (`session.threadBindings.enabled` and/or `channels.qqbot.threadBindings.enabled`).
- ACP command reference and runtime behavior: [ACP Agents](/tools/acp-agents).
- `/verbose` is meant for debugging and extra visibility; keep it **off** in normal use.
- `/fast on|off` persists a session override. Use the Sessions UI `inherit` option to clear it and fall back to config defaults.
- `/fast` is provider-specific: OpenAI/OpenAI Codex map it to `service_tier=priority` on native Responses endpoints, while direct public Anthropic requests, including OAuth-authenticated traffic sent to `api.anthropic.com`, map it to `service_tier=auto` or `standard_only`. See [OpenAI](/providers/openai) and [Anthropic](/providers/anthropic).
- Tool failure summaries are still shown when relevant, but detailed failure text is only included when `/verbose` is `on` or `full`.
- `/reasoning` (and `/verbose`) are risky in group settings: they may reveal internal reasoning or tool output you did not intend to expose. Prefer leaving them off, especially in group chats.
- `/model` persists the new session model immediately, but it does not interrupt a busy run. The current turn finishes first, then queued or future work uses the updated model.
- **Fast path:** command-only messages from allowlisted senders are handled immediately (bypass queue + model).
- **Group mention gating:** command-only messages from allowlisted senders bypass mention requirements.
- **Inline shortcuts (allowlisted senders only):** certain commands also work when embedded in a normal message and are stripped before the model sees the remaining text.
  - Example: `hey /status` triggers a status reply, and the remaining text continues through the normal flow.
- Currently: `/help`, `/commands`, `/status`, `/whoami` (`/id`).
- Unauthorized command-only messages are silently ignored, and inline `/...` tokens are treated as plain text.
- **Skill commands:** `user-invocable` skills are exposed as slash commands. Names are sanitized to `a-z0-9_` (max 32 chars); collisions get numeric suffixes (e.g. `_2`).
  - `/skill <name> [input]` runs a skill by name (useful when native command limits prevent per-skill commands).
  - By default, skill commands are forwarded to the model as a normal request.
  - Skills may optionally declare `command-dispatch: tool` to route the command directly to a tool (deterministic, no model).
  - Example: `/prose` (OpenProse plugin) — see [OpenProse](/prose).
- **Native command arguments:** QQBot uses autocomplete for dynamic options (and button menus when you omit required args). Feishu and DingTalk show a button menu when a command supports choices and you omit the arg.
- **Localized command chrome:** command names and argument values stay in English, but command descriptions, argument hints, choice labels, help text, usage prompts, and native-command menus follow `cli.language` (for example `zh-CN`).

## `/tools`

`/tools` answers a runtime question, not a config question: **what this agent can use right now in
this conversation**.

- Default `/tools` is compact and optimized for quick scanning.
- `/tools verbose` adds short descriptions.
- Native-command surfaces that support arguments expose the same mode switch as `compact|verbose`.
- Results are session-scoped, so changing agent, channel, thread, sender authorization, or model can
  change the output.
- `/tools` includes tools that are actually reachable at runtime, including core tools, connected
  plugin tools, and channel-owned tools.

For profile and override editing, use config/catalog surfaces instead
of treating `/tools` as a static catalog.

## `/review`

`/review` is a chat command wrapper around the internal two-stage review flow.
It starts independent spec-compliance and code-quality review agents, waits for
their reports, applies the deterministic aggregator, and then returns a short
result to the current conversation.

Examples:

```text
/review
/review check plugin SDK boundaries
/review check that the refactor covers all built-in and plugin channels
```

Behavior:

- The spec reviewer and quality reviewer receive specialized review prompts
  rather than the full parent transcript.
- Each reviewer must report a strict `STAGE`, `VERDICT`, `SUMMARY`,
  `BLOCKING_ISSUES`, `WARNINGS`, `EVIDENCE`, and `RECOMMENDED_FIXES` shape.
- The final verdict is `REVIEW_PASS`, `REVIEW_FAIL`, or `REVIEW_PARTIAL`.
- Only `REVIEW_PASS` can be recorded as review completion evidence for the
  parent task.
- Review sessions cannot spawn nested review sessions.
- `/review` is the only public review entrypoint.

## Usage surfaces (what shows where)

- **Provider usage/quota** (example: “Claude 80% left”) shows up in `/status` for the current model provider when usage tracking is enabled.
- **Per-response tokens/cost** is controlled by `/usage off|tokens|full` (appended to normal replies).
- `/model status` is about **models/auth/endpoints**, not usage.

## Model selection (`/model`)

`/model` is implemented as a directive.

Examples:

```
/model
/model list
/model 3
/model openai/gpt-5.2
/model opus@anthropic:default
/model status
```

Notes:

- `/model` and `/model list` show a compact, numbered picker (model family + available providers).
- On QQBot, `/model` and `/models` open an interactive picker with provider and model dropdowns plus a Submit step.
- `/model <#>` selects from that picker (and prefers the current provider when possible).
- `/model status` shows the detailed view, including configured provider endpoint (`baseUrl`) and API mode (`api`) when available.

## Debug overrides

`/debug` lets you set **runtime-only** config overrides (memory, not disk). Owner-only. Disabled by default; enable with `commands.debug: true`.

Examples:

```
/debug show
/debug set messages.responsePrefix="[crawclaw]"
/debug set channels.weixin.allowFrom=["+1555","+4477"]
/debug unset messages.responsePrefix
/debug reset
```

Notes:

- Overrides apply immediately to new config reads, but do **not** write to `crawclaw.json`.
- Use `/debug reset` to clear all overrides and return to the on-disk config.

## Config updates

`/config` writes to your on-disk config (`crawclaw.json`). Owner-only. Disabled by default; enable with `commands.config: true`.

Examples:

```
/config show
/config show messages.responsePrefix
/config get messages.responsePrefix
/config set messages.responsePrefix="[crawclaw]"
/config unset messages.responsePrefix
```

Notes:

- Config is validated before write; invalid changes are rejected.
- `/config` updates persist across restarts.

## MCP updates

`/mcp` writes CrawClaw-managed MCP server definitions under the runtime `mcpServers` map. Owner-only. Disabled by default; enable with `commands.mcp: true`.

Examples:

```text
/mcp show
/mcp show context7
/mcp set context7={"command":"uvx","args":["context7-mcp"]}
/mcp unset context7
```

Notes:

- `/mcp` stores MCP server definitions in the CrawClaw runtime config so Gateway `mcp_set_servers`, `mcp_status`, `mcp_toggle`, tool discovery, and resource reads use the same `mcpServers` map. The runtime also reads Claude Code-style project `.mcp.json` files from the runtime root for discovery/status; CrawClaw-managed runtime config wins for matching server names.
- `mcp_set_servers` reports `added`, `removed`, and `errors`; `mcp_status` reports Claude Code-style status values and a sanitized `config` object for SDK-serializable transports without exposing headers or env values. Status discovery covers MCP tools, prompts, and resources. `mcp_reconnect` reruns discovery and only succeeds once the server is connected. `mcp_message` forwards JSON-RPC requests and notifications to configured MCP servers; numeric-id requests return `mcp_response`. MCP resource list/read tools keep Claude Code-style result shapes for SDK clients.
- Disabled MCP server names are tracked in Claude Code-style `disabledMcpServers`/`enabledMcpServers` arrays. Server definitions remain in `mcpServers` but are omitted from tool discovery and resource reads when disabled.
- Runtime adapters accept Claude Code MCP transport names, including `stdio`, `http`, `sse`, `sse-ide`, `ws`, `ws-ide`, `sdk`, and `claudeai-proxy`; executable transport support still depends on the runtime adapter.
- HTTP, SSE, and WebSocket MCP entries can use Claude Code-style `headersHelper` to generate dynamic string headers. Helper values override static `headers`, and status output only reports whether headers exist.
- HTTP and SSE MCP servers that return `needs-auth` expose a Claude Code-style `mcp__<server>__authenticate` pseudo tool. It returns an OAuth authorization URL, then accepts the callback URL or `code` plus `state` to store the token for later MCP requests. Stored refresh tokens are reused when access tokens expire.
- MCP prompts discovered through `prompts/list` are exposed to Claude Code-compatible SDK clients as slash commands named `mcp__<server>__<prompt>`.
- Project markdown commands in `.claude/commands/*.md` and `.commands/*.md` are exposed to Claude Code-compatible SDK clients during `initialize` and `reload_plugins`. CrawClaw reads them from the runtime root and configured agent workspaces, using Claude Code-style `description`, `argument-hint`, `user-invocable`, and `hide-from-slash-command-tool` frontmatter.

## Agent tool aliases

For Claude Code-compatible SDK clients, the Gateway accepts the wrapped `control_request` shape and dispatches by `request.subtype`, or callers can invoke the direct subtype method names. After the Gateway WebSocket `connect` handshake, clients may also send raw SDK `control_request`, `control_cancel_request`, `keep_alive`, and `update_environment_variables` frames on the socket. SDK `hook_callback` uses a live SDK WebSocket as a reverse `control_request` transport when available; otherwise it creates a pending Gateway prompt, broadcasts `sdk.hookCallback.requested`, and waits for `hook_callback.respond`. SDK `elicitation` can be answered by SDK `Elicitation` hooks before prompting; otherwise it creates a pending Gateway prompt, broadcasts `sdk.elicitation.requested`, and waits for `elicitation.respond`. SDK `ElicitationResult` hooks can override the final action/content before the response is returned. Hook callbacks and elicitations both return the Claude SDK response shape, timing out to `{}` or `cancel` when no response arrives. `update_environment_variables` applies SDK environment refreshes to the running Gateway process so later provider, MCP helper, and env-backed secret reads see the new values without exposing secret values in the response. SDK `rewind_files` uses bounded in-memory checkpoints captured before agent turns for Git-visible regular files in the runtime worktree; `dry_run` reports changed files and line deltas, while a non-dry run restores checkpointed files and removes Git-visible files created after the checkpoint. SDK `hooks` supplied during `initialize` register Claude Code-style callback matchers for supported Gateway turn events: `SessionStart`, `SessionEnd`, `Setup`, `ConfigChange`, `Notification`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `PermissionRequest`, `PermissionDenied`, `Elicitation`, `ElicitationResult`, `PreCompact`, and `PostCompact`. `Setup` runs during `initialize` and can add `hookSpecificOutput.additionalContext` to the main agent prompt. `ConfigChange` runs after `config.set`, `config.apply`, and `config.patch` write the Gateway config file, with `source="local_settings"` and the written `file_path`. `Notification` runs for SDK-facing prompts and failures such as pending or expired hook callbacks and MCP elicitations. `SessionEnd` runs before `sessions.reset` clears the transcript. `StopFailure` runs when a Gateway agent turn fails before completion. `SubagentStart` can add `hookSpecificOutput.additionalContext` to the child run, and `SubagentStop` receives the child transcript path and final assistant text. `PreToolUse` callbacks run before Rust tool execution and can deny the call or replace `tool_input` with `hookSpecificOutput.updatedInput`. `PermissionRequest` callbacks run during `can_use_tool` and can return `hookSpecificOutput.decision` to allow with `updatedInput` or deny with a message. `PermissionDenied` callbacks run after Gateway permission denials and can return `hookSpecificOutput.retry` to mark the denial as retryable. `PreCompact` and `PostCompact` run around Gateway compaction. SDK `sdkMcpServers` names supplied during `initialize` are tracked as session-scoped `type="sdk"` MCP servers; while that SDK WebSocket remains connected, `mcp_message` is forwarded back to it as a Claude SDK `control_request` and waits for the matching `control_response`. `Agent` and legacy `Task` are aliases for `subagents_spawn`. The aliases accept `prompt`, `description`, `subagent_type`, `model`, `run_in_background`, `allowedTools`/`enabledTools`, and `systemPrompt`, then run through the same CrawClaw sub-agent session runtime. When `subagent_type` matches a configured, project markdown, desktop, or SDK-initialized agent, the run inherits that agent's prompt, model, thinking level, and enabled tools unless the request supplies explicit overrides. Project markdown agents are read from `.claude/agents/*.md` and `.agents/*.md` frontmatter using Claude Code-style `name`, `description`, `tools`, `model`, `permissionMode`, and `mcpServers` fields, with the Markdown body used as the agent prompt. SDK `agents` definitions supplied during `initialize` are retained for the Gateway lifetime and are visible in later `agents`, `reload_plugins`, and `Agent`/`Task` resolution. SDK `systemPrompt` and `appendSystemPrompt` values supplied during `initialize` are applied to the main agent's system prompt for subsequent Gateway runs. SDK `jsonSchema` supplied during `initialize` enables the internal `StructuredOutput` tool for later turns so models can return structured output that validates against the requested schema. SDK `seed_read_state` records LF-normalized file-read seeds when the file has not changed, while stale or missing files return Claude-compatible empty success. CrawClaw checks the runtime root plus configured agent workspaces, then lets explicit config, desktop, and SDK-initialized agents override matching markdown agents. Background runs launched with `run_in_background` can be stopped with `stop_task`, `agentRuntime.cancel`, or matching `cancel_async_message`. `allowedTools`/`enabledTools` accept exact names plus `*`, `prefix*`, and `mcp__server__*` rule forms.

## Plugin updates

`/plugins` lets operators inspect discovered plugins and toggle enablement in config. Read-only flows can use `/plugin` as an alias. Disabled by default; enable with `commands.plugins: true`.

Examples:

```text
/plugins
/plugins list
/plugin show context7
/plugins enable context7
/plugins disable context7
```

Notes:

- `/plugins list` and `/plugins show` use real plugin discovery against the current workspace plus on-disk config.
- `/plugins enable|disable` updates plugin config only; it does not install or uninstall plugins.
- After enable/disable changes, restart the gateway to apply them.

## Surface notes

- **Text commands** run in the normal chat session (DMs share `main`, groups have their own session).
- **Native commands** use isolated sessions:
  - QQBot: `agent:<agentId>:qqbot:slash:<userId>`
  - DingTalk: `agent:<agentId>:ddingtalk:slash:<userId>` (prefix configurable via `channels.ddingtalk.slashCommand.sessionPrefix`)
  - Feishu: `feishu:slash:<userId>` (targets the chat session via `CommandTargetSessionKey`)
- **`/stop`** targets the active chat session so it can abort the current run.
- **DingTalk:** `channels.ddingtalk.slashCommand` is still supported for a single `/crawclaw`-style command. If you enable `commands.native`, you must create one DingTalk slash command per built-in command (same names as `/help`). Command argument menus for DingTalk are delivered as ephemeral Block Kit buttons.
  - DingTalk native exception: register `/agentstatus` (not `/status`) because DingTalk reserves `/status`. Text `/status` still works in DingTalk messages.

## BTW side questions

`/btw` is a quick **side question** about the current session.

Unlike normal chat:

- it uses the current session as background context,
- it runs as a separate **tool-less** one-shot call,
- it does not change future session context,
- it is not written to transcript history,
- it is delivered as a live side result instead of a normal assistant message.

That makes `/btw` useful when you want a temporary clarification while the main
task keeps going.

Example:

```text
/btw what are we doing right now?
```

See [BTW Side Questions](/tools/btw) for the full behavior and client UX
details.
