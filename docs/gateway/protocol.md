---
summary: "Gateway WebSocket protocol: handshake, frames, versioning"
read_when:
  - Implementing or updating gateway WS clients
  - Debugging protocol mismatches or connect failures
  - Regenerating protocol schema/models
title: "Gateway Protocol"
---

# Gateway protocol (WebSocket)

The Gateway WS protocol is the **single control plane** for CrawClaw. Clients
(CLI, browser-authenticated clients, and automation) connect over WebSocket and declare their **role** + **scope**
at handshake time.

## Transport

- WebSocket, text frames with JSON payloads.
- First frame **must** be a `connect` request.

## Handshake (connect)

Client → Gateway:

```json
{
  "type": "req",
  "id": "…",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "cli",
      "version": "1.2.3",
      "platform": "macos",
      "mode": "operator"
    },
    "role": "operator",
    "scopes": ["operator.read", "operator.write"],
    "caps": [],
    "commands": [],
    "permissions": {},
    "auth": { "token": "…" },
    "locale": "en-US",
    "userAgent": "crawclaw-desktop/2026.5.3",
    "device": {
      "id": "device_fingerprint",
      "publicKey": "…",
      "signature": "…",
      "signedAt": 1737264000000,
      "nonce": "…"
    }
  }
}
```

Gateway → Client:

```json
{
  "type": "res",
  "id": "…",
  "ok": true,
  "payload": { "type": "hello-ok", "protocol": 3, "policy": { "tickIntervalMs": 15000 } }
}
```

### Node example

```json
{
  "type": "req",
  "id": "…",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "macos-node",
      "version": "1.2.3",
      "platform": "macos",
      "mode": "node"
    },
    "role": "node",
    "scopes": [],
    "caps": ["camera", "canvas", "screen", "location", "voice"],
    "commands": ["camera.snap", "canvas.navigate", "screen.record", "location.get"],
    "permissions": { "camera.capture": true, "screen.record": false },
    "auth": { "token": "…" },
    "locale": "en-US",
    "userAgent": "crawclaw-macos/1.2.3",
    "device": {
      "id": "device_fingerprint",
      "publicKey": "…",
      "signature": "…",
      "signedAt": 1737264000000,
      "nonce": "…"
    }
  }
}
```

## Framing

- **Request**: `{type:"req", id, method, params}`
- **Response**: `{type:"res", id, ok, payload|error}`
- **Event**: `{type:"event", event, payload, seq?, stateVersion?}`

Side-effecting methods require **idempotency keys** (see schema).

## Roles + scopes

### Roles

- `operator` = control plane client (CLI/UI/automation).
- `node` = capability host (camera/screen/canvas/system.run).

### Scopes (operator)

Common scopes:

- `operator.read`
- `operator.write`
- `operator.admin`
- `operator.approvals`
- `operator.pairing`

Method scope is only the first gate. Some slash commands reached through
`chat.send` apply stricter command-level checks on top. For example, persistent
`/config set` and `/config unset` writes require `operator.admin`.

## Presence

- `system-presence` returns entries keyed by client instance when available.
- Presence entries include `deviceId` for compatibility, plus `roles` and `scopes` so UIs can show a single row per client instance.

### Operator helper methods

- Operators may call `tools.catalog` (`operator.read`) to fetch the runtime tool catalog for an
  agent. The response includes grouped tools and provenance metadata:
  - `source`: `core`, `mcp`, or `native-plugin`
  - `pluginId`: plugin owner when `source="native-plugin"`
  - `optional`: whether a plugin tool is optional
- Operators may call `tools.effective` (`operator.read`) to fetch the runtime-effective tool
  inventory for a session.
  - `sessionKey` is required.
  - The gateway derives trusted runtime context from the session server-side instead of accepting
    caller-supplied auth or delivery context.
  - The response is session-scoped and reflects what the active conversation can use right now,
    including core, plugin, and channel tools.
- Operators may call `mcp_set_servers` (`operator.admin`) with a `servers` object to replace the
  CrawClaw-managed runtime `mcpServers` map. The response follows the Claude Code control shape
  with `added`, `removed`, and `errors`. Gateway runtime snapshots include a sanitized
  `mcpServers` summary with server names, transport types, `enabled`, and boolean `has*` fields
  only. Claude Code-style project `.mcp.json` files under the runtime root are also read for
  discovery and status; CrawClaw-managed runtime config overrides matching project server names.
- Operators may call Claude Code-compatible control method names when bridging SDK-style clients:
  - `control_request` and `sdk.control_request` accept the SDK wrapper shape
    `{type, request_id, request: {subtype, ...}}`, dispatch by `request.subtype`, and return a
    Claude SDK-style `control_response`. The direct method names below remain available for callers
    that already unwrap the control request.
  - After the normal Gateway WebSocket `connect` handshake, clients may also send raw Claude SDK
    control frames directly on the socket. `control_request` frames receive raw
    `control_response` frames, `control_cancel_request` cancels a matching in-flight task when
    possible, `keep_alive` is ignored, and `update_environment_variables` applies the same runtime
    environment refresh described below.
  - `elicitation` creates a pending SDK elicitation request and broadcasts
    `sdk.elicitation.requested` with the prompt payload. A connected operator client can inspect
    pending prompts with `elicitation.list` and complete one with `elicitation.respond` using
    `action="accept"`, `action="decline"`, or `action="cancel"` plus optional object `content`.
    SDK `Elicitation` hooks can return `hookSpecificOutput.action` and `content` before the prompt
    is shown; SDK `ElicitationResult` hooks can override the final response before it is returned.
    The original `elicitation` control request waits for the resulting response and returns the
    Claude SDK response shape; if no response arrives before `timeoutMs` (default 60 seconds), it
    returns `{"action":"cancel"}`.
  - `hook_callback` sends a Claude SDK-style reverse `control_request` back to the live SDK
    WebSocket when one is attached. Without a live SDK control transport, it creates a pending SDK
    hook callback request and broadcasts `sdk.hookCallback.requested` with the hook input payload.
    A connected operator client can inspect pending callbacks with `hook_callback.list` and
    complete one with `hook_callback.respond` using a `response` object matching Claude Code
    HookJSONOutput. The original `hook_callback` control request waits for that response; if no
    response arrives before `timeoutMs` (default 60 seconds), it returns `{}`.
  - `update_environment_variables` and `sdk.update_environment_variables` accept
    `{variables: {"NAME": "value"}}` and apply the updates to the running Gateway process so later
    provider, MCP helper, and env-backed secret reads see refreshed values. The response lists only
    updated variable names. `keep_alive` and `sdk.keep_alive` return an empty success payload.
  - `initialize` returns SDK session metadata: commands, agents, output styles, models, account,
    process ID, and `fast_mode_state`. MCP prompts discovered through `prompts/list` are exposed as SDK slash-command
    entries with `mcp__<server>__<prompt>` names. SDK `agents` definitions supplied during
    `initialize` are retained for the Gateway lifetime and are visible in later `agents`,
    `reload_plugins`, and `Agent`/`Task` resolution. SDK `systemPrompt` and
    `appendSystemPrompt` values supplied during `initialize` are applied to the main agent's
    system prompt for subsequent Gateway runs. SDK `jsonSchema` supplied during `initialize`
    enables the internal `StructuredOutput` tool for later turns so models can return structured
    output that validates against the requested schema. SDK `hooks` supplied during `initialize`
    register Claude Code-style callback matchers for supported Gateway turn events:
    `SessionStart`, `SessionEnd`, `Setup`, `ConfigChange`, `Notification`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
    `PostToolUseFailure`, and `Stop`, plus `SubagentStart`/`SubagentStop` around `Agent`/`Task` child runs,
    `PermissionRequest` during `can_use_tool`, `PermissionDenied` after Gateway permission denials,
    `Elicitation`/`ElicitationResult` around SDK elicitation, `PreCompact`/`PostCompact` around
    Gateway compaction, and `StopFailure` when a Gateway agent turn fails before completion.
    `PreToolUse` callbacks run before Rust tool
    execution and can deny the call or replace `tool_input` with `hookSpecificOutput.updatedInput`.
    `SubagentStart` callbacks can add `hookSpecificOutput.additionalContext` to the child run.
    `PermissionRequest` callbacks can return `hookSpecificOutput.decision` to allow with
    `updatedInput` or deny with a message. `PermissionDenied` callbacks can return
    `hookSpecificOutput.retry` to mark the denial as retryable. `PostToolUse` callbacks run
    immediately after tool execution and can replace MCP tool output with
    `hookSpecificOutput.updatedMCPToolOutput` before the result returns to the model.
    `PreToolUse`, `PostToolUse`, and `PostToolUseFailure` callbacks can return
    `hookSpecificOutput.additionalContext`, which is returned to the model as a system reminder
    with the related tool result. `Setup` runs during
    `initialize` and can add `hookSpecificOutput.additionalContext` to the main agent prompt.
    `ConfigChange` runs after `config.set`, `config.apply`, and `config.patch` write the Gateway
    config file, with `source="local_settings"` and the written `file_path`.
    `Notification` runs for SDK-facing prompts and failures such as pending or expired hook
    callbacks and MCP elicitations.
    `SessionEnd` runs before `sessions.reset` clears the transcript. SDK `sdkMcpServers` names supplied during `initialize`
    are tracked as session-scoped `type="sdk"` MCP servers. When the initializing SDK WebSocket
    remains connected, those servers are surfaced as `connected`; after disconnect, they remain
    listed but return to `pending`.
  - `get_settings` returns the SDK settings shape: `effective`, ordered `sources`, and `applied`
    runtime model and effort values.
  - `get_context_usage` returns SDK context-usage fields with CrawClaw session-history token
    estimates.
  - `set_model`, `set_max_thinking_tokens`, and `apply_flag_settings` update CrawClaw runtime
    control settings and return an empty success payload, matching Claude Code SDK control
    responses. `set_permission_mode` returns the normalized mode. The runtime `Config` tool accepts
    the same Claude Code setting keys for theme, verbosity, memory, thinking, language, teammate,
    notification, and remote-control preferences, storing them under the CrawClaw runtime config's
    Claude Code namespace. Boolean settings accept string `true`/`false` values, fixed-option
    settings reject unsupported values, and `remoteControlAtStartup="default"` unsets the stored
    preference so the runtime falls back to its default. Successful `Config` calls return
    Claude Code-style model-visible result text such as `theme = "dark"` or `Set theme to "dark"`.
  - `mcp_status`, `mcp_reconnect`, `mcp_toggle`, and `mcp_set_servers` manage CrawClaw-managed MCP
    server state. The runtime also reads project `.mcp.json` server definitions from the runtime
    root so Claude Code project MCP files participate in tool discovery, resource reads, prompt
    commands, and status output. `mcp_toggle` tracks names in Claude Code-style
    `disabledMcpServers` and `enabledMcpServers` arrays while server definitions remain under
    `mcpServers`. `mcp_status` returns `mcpServers` entries with Claude Code status values such as
    `connected`, `needs-auth`, `failed`, `pending`, and `disabled`,
    plus a sanitized `config` object for SDK-serializable transports that omits headers and env
    values.
    MCP config accepts Claude Code transport names including `sse-ide`, `ws-ide`, and
    `claudeai-proxy`; executable support depends on the runtime adapter. HTTP, SSE, and WebSocket
    MCP configs may use Claude Code-style `headersHelper`; CrawClaw runs the helper to merge
    dynamic string headers over static `headers` without exposing either value in status output.
    HTTP/SSE servers that report `needs-auth` expose `mcp__<server>__authenticate` with Claude
    Code's empty input shape; it starts OAuth URL generation, and stored refresh tokens are reused
    when access tokens expire.
  - `mcp_reconnect` reruns MCP discovery for the requested server and returns success only when the
    server reaches `connected`; auth, disabled, and failed states surface as control errors.
  - `mcp_message` forwards JSON-RPC requests and notifications to CrawClaw-configured MCP servers.
    Requests with numeric `id` values return `mcp_response`; notification-only messages return an
    empty success payload after delivery. For SDK MCP servers registered through `sdkMcpServers`,
    the Gateway sends a Claude SDK `control_request` with subtype `mcp_message` back to the live
    SDK WebSocket and waits for the matching `control_response`. If that WebSocket is gone, the
    call fails instead of pretending the SDK server is reachable.
  - `ListMcpResourcesTool` skips over individual MCP resource-list failures while preserving the
    Claude Code array result shape, compact JSON result text, and empty-resource message.
    `ReadMcpResourceTool` returns a Claude Code-style top-level `contents` object as compact JSON
    result text and persists binary `blob` resources to runtime tool-result files with
    `blobSavedTo`.
  - `crawclaw-runtime mcp-server` exposes the Rust tool pool over stdio MCP for clients that expect
    Claude Code-style internal tools as an MCP server. It supports `initialize`, `tools/list`,
    `tools/call`, and empty `resources/list` and `prompts/list` responses. Claude Code aliases
    expose Claude-style `Read`, `Write`, `Edit`, and `Grep` descriptions and schemas; `Write` and `Edit`
    include Claude Code-style usage guidance for read-before-write, diffs, docs files, exact indentation, and `replace_all`; `Read`, `Write`, and `Edit`
    use Claude Code-style parameter descriptions and strict top-level input shapes and translate `file_path`, `old_string`, and `new_string` into the Rust tool backend, text `Read` calls record range-aware file freshness and return a `file_unchanged` stub for unchanged repeated reads so
    `Write` on existing files and `Edit` reject missing or stale prior reads while tolerating unchanged content after timestamp-only drift, missing `Read`/`Edit` paths use Claude Code-style current-working-directory and did-you-mean guidance, `Read` rejects Claude Code-style binary extensions and blocking device files, and routes
    PDF files and `pages` ranges through Rust PDF text extraction, image reads return Claude-style
    `type="image"` file details and image blocks, `Read.offset`/`limit` accept
    Claude Code semantic string values while rejecting empty strings, text reads return Claude-style `type="text"` file details,
    large-file size validation text, UTF-8 BOM stripping, trailing-newline line accounting, and line-numbered model output, `Write`/`Edit` return Claude-style file result details and
    strip non-Markdown trailing line whitespace like Claude Code, `Edit` applies Claude Code's
    sanitized-token and quote-style match normalization before replacing text, and
    `Edit` rejects identical old/new strings before the empty-file creation path, rejects over-1GiB target files before reading them, returns Claude Code-style text for missing or non-unique replacement strings, and can create or fill missing/empty files when `old_string=""`,
    and `Edit.replace_all` accepts Claude Code exact `"true"`/`"false"` semantic boolean strings,
    `Glob` uses Claude Code-style parameter descriptions, strict top-level input shape, absolute-pattern base-directory extraction, exact semantic-number validation, `rg --files` hidden/no-ignore defaults, missing-directory current-working-directory and did-you-mean guidance, the Claude-style 100-result window,
    modified-time ordering, truncation notice, path validation text, and structured filename payload, `Grep` supports
    Claude Code-style parameter descriptions, strict top-level input shape, `output_mode`, `head_limit`, `offset`, `type`, exact
    semantic number and boolean validation, path validation text with current-working-directory and did-you-mean guidance, and model-visible result text with the same count and pagination summaries,
    `WebFetch` uses Claude Code-style authenticated/private URL guidance, strict top-level input shape, validates URL inputs with
    Claude Code-style invalid-URL messages, preserves Claude
    Code's untrimmed plain string prompt handling, upgrades `http` requests to `https`, fetches URL content,
    strips native external-content wrappers without trimming fetched content, preserves Claude Code's truncation marker before
    applying the requested prompt through the configured host model, blocks cross-host redirects with Claude Code-style
    redirect instructions, and reports Claude-style duration and original URL fields before
    returning the Claude-style result payload, `WebSearch` accepts strict top-level input shape, strict Claude-style `allowed_domains` and
    `blocked_domains` filters, and query length validation, uses Claude Code-style source and current-year search guidance, and returns Claude-style result text with the source-link reminder
    and validation text for missing queries and conflicting domain filters, `ToolSearch` exposes
    Claude Code-style strict top-level input shape and parameter descriptions and uses Claude-style
    `max_results` with strict numeric validation, case-insensitive comma-separated `select:` inputs, `mcp__server` prefix searches,
    bare tool-name matches, required `+term` keyword searches, string-name `matches`, and explicit no-match result text with pending MCP server hints,
    `TodoWrite` exposes Claude Code-style descriptions, strict top-level input shape, and result details and is advertised as a mutating tool,
    runtime tool catalog entries use Claude Code-style
    descriptions for aliases and deferred-tool lookup, `SendUserMessage`/`Brief` expose Claude Code-style
    descriptions, strict top-level input shapes, and parameter descriptions, require Claude Code's `status` field,
    `Agent`/`Task` expose Claude Code-style descriptions and parameter descriptions,
    `ListMcpResourcesTool`/`ReadMcpResourceTool` expose Claude Code-style descriptions and strict top-level input shapes,
    `LSP` uses Claude Code-style descriptions, strict top-level input shape, and parameter descriptions,
    and references, document/workspace symbols, and incoming/outgoing call hierarchy results use
    Claude-style empty messages, pluralized counts, per-file grouping, symbol detail/container text,
    and call-site annotations, `TaskCreate`/`TaskGet`/`TaskList`/`TaskUpdate` expose Claude Code-style
    descriptions, strict top-level input shapes, and parameter descriptions, `TaskGet`/`TaskList`/`TaskUpdate` return Claude Code-style
    model-visible task result text, `TaskUpdate` maintains both sides of `addBlocks` / `addBlockedBy` dependencies,
    `TaskOutput.block` accepts Claude Code exact `"true"`/`"false"` semantic boolean strings,
    `TaskOutput.timeout` validates Claude Code's 0 to 600000 ms range, `TaskOutput` rejects non-Claude top-level fields, and truncated `TaskOutput`
    result text uses Claude Code's full-output path header, while completed local-agent task output
    prefers the final assistant result over the raw transcript. `AgentOutputTool`/`BashOutputTool`
    aliases normalize Claude Code legacy `agentId`, `bash_id`, and `wait_up_to` inputs into
    `TaskOutput`,
    `Config` exposes Claude Code-style strict input shape, parameter descriptions, and semantic error result details, `Skill` exposes Claude Code-style strict input shape and parameter descriptions and is advertised as a mutating tool,
    `AskUserQuestion` exposes Claude Code-style strict top-level input shape, parameter descriptions, and HTML preview validation,
    `Skill` returns the Claude Code inline launch result text, `SendMessage`, `Sleep`, and
    `StructuredOutput` expose Claude Code-style descriptions, `SendMessage` exposes Claude Code-style
    strict top-level input shape and parameter descriptions, requires `summary` for plain string messages, resolves active-team
    recipients from the team manifest before falling back to standalone sessions, scopes broadcasts to
    team members instead of all sessions, returns compact JSON result text, and accepts only Claude Code
    shutdown/plan approval structured messages, `TeamCreate`/`TeamDelete` return compact JSON
    result text, `TaskList` rejects non-empty input like Claude Code, `TeamCreate`/`TeamDelete` expose Claude Code-style strict parameter schemas,
    `TeamCreate` uses Claude Code-style team-name sanitization for manifest paths while preserving
    the team name in manifests and agent ids,
    `TeamDelete` uses Claude Code's strict empty input and cleans only the active team,
    `TeamCreate` preserves existing team manifests by choosing a unique name for a
    requested name collision, team manifests include Claude Code-style `agentId`, `joinedAt`,
    `tmuxPaneId`, `cwd`, and `subscriptions` fields, `TeamDelete` refuses cleanup while non-lead team
    members are still active, `TaskStop` uses Claude Code's strict top-level input shape and returns compact JSON result text with Claude Code-style
    missing-id, not-found, not-running, and description text, and Bash/PowerShell expose Claude Code-style
    descriptions and parameter descriptions, with Bash guidance for dedicated file/search tools,
    background runs, command chaining, git safety, and sleep avoidance, reject Claude Code-style foreground long `sleep`/`Start-Sleep` commands, use Claude Code's strict top-level input shapes, and accept Claude Code semantic booleans for `dangerouslyDisableSandbox`, while
    `EnterWorktree`/`ExitWorktree` expose Claude Code-style descriptions, strict top-level input shapes, and parameter descriptions and return Claude-style visible worktree status text and
    `ExitWorktree` refuses removal when it cannot prove the worktree state without explicit
    discard confirmation. Bash/PowerShell `timeout` values use milliseconds, validate Claude Code's
    600000 ms maximum, with Bash `run_in_background` accepted as a background-run alias. The `Bash`
    alias removes redundant `cd <cwd> &&` prefixes and unescapes `find -exec` terminators like
    Claude Code. PowerShell
    runs with Claude Code's non-interactive shell invocation and foreground Bash/PowerShell results
    keep stdout and stderr separated, including Claude Code's non-error interpretations for shell
    exit codes such as `grep` no-match and PowerShell `robocopy` success ranges. Bash/PowerShell
    output strips Claude Code hint side-channel lines before the model sees them, and persisted
    output wrappers use Claude Code's `BASH_MAX_OUTPUT_LENGTH` limits, full-output path, and
    first-2KB preview text. Bash/PowerShell results include Claude Code-compatible `stdout`,
    `stderr`, `interrupted`, background task id, and persisted output path fields in their
    structured details, with Bash also reporting `noOutputExpected` for silent success commands and
    preserving `dangerouslyDisableSandbox` when the caller supplied it.
    Foreground shell output that is a complete image data URI is returned as an image content block.
    They use Claude-style background result text that points at the output file path, write shell output under runtime
    tool-result files, and keep empty command output empty instead of inventing placeholder text.
  - `reload_plugins` returns refreshed `commands`, `agents`, `plugins`, `mcpServers`, and
    `error_count`; `commands` includes project markdown commands plus discovered MCP prompt
    commands. Project markdown commands are read from `.claude/commands/*.md` and `.commands/*.md`
    under the runtime root and configured agent workspaces, using Claude Code-style `description`,
    `argument-hint`, `user-invocable`, and `hide-from-slash-command-tool` frontmatter.
  - `can_use_tool` checks the runtime tool catalog, `tools.allow`, `tools.deny`, and Claude Code
    permission modes, then returns SDK permission output with `behavior="allow"` or
    `behavior="deny"`.
  - `Agent` and legacy `Task` are accepted as Claude Code-compatible aliases for
    `subagents_spawn`. They use Claude Code-style strict top-level input shapes with
    `prompt`, `description`, `subagent_type`, `model`, `run_in_background`, `name`, `team_name`,
    and `mode`, then run through the same CrawClaw sub-agent session runtime. `name` becomes
    the spawned session title for `SendMessage` lookup, `team_name` targets an existing runtime
    team, and `mode` is forwarded with the run options. The aliases return Claude Code-style
    async/completed result text, including the background-agent instructions and completed-agent
    `agentId` plus usage trailer. When `subagent_type` matches a configured, project
    markdown, desktop, or SDK-initialized agent, the run inherits that agent's prompt, model,
    thinking level, and enabled tools unless the request supplies explicit overrides. Project
    markdown agents are read from `.claude/agents/*.md` and `.agents/*.md` frontmatter using
    Claude Code-style `name`, `description`, `tools`, `model`, `permissionMode`, and `mcpServers`
    fields, with the Markdown body used as the agent prompt. CrawClaw checks the runtime root plus
    configured agent workspaces, then lets explicit config, desktop, and SDK-initialized agents
    override matching markdown agents.
  - `AskUserQuestion`, `EnterPlanMode`, and `ExitPlanMode` expose Claude Code-style tool
    descriptions. `EnterPlanMode` uses Claude Code's strict empty input shape.
    `ExitPlanMode` exposes Claude Code-style parameter descriptions, marks
    host-supplied edited plans with Claude Code's `Approved Plan (edited by user)` result heading
    and `planWasEdited` output field, and `EnterPlanMode` returns Claude Code's read-only planning
    instructions in the tool result.
  - `AskUserQuestion` includes selected preview text and user notes from answer annotations in the
    Claude Code-style tool result text. When HTML previews are requested, option previews
    must be HTML fragments: full documents and `<script>` or `<style>` tags are rejected, and plain
    text previews are rejected with Claude Code-style validation messages.
  - `CronCreate` accepts Claude Code's exact semantic boolean handling for `recurring` and
    `durable`, safely coercing string `"true"`/`"false"` values before creating the job. It also
    applies the Claude Code 5-field cron validation, strict top-level input shapes, and 50-job cap on the compatibility wrapper.
    `CronCreate`/`CronDelete`/`CronList` expose Claude Code-style descriptions,
    `CronCreate`/`CronDelete`/`CronList` expose Claude Code-style parameter descriptions,
    `CronCreate`, `CronDelete`, and `CronList` return the narrowed Claude Code-style result
    shapes with `id`, `humanSchedule`, `recurring`, `durable`, and `jobs` fields instead of the
    full CrawClaw cron service records. `CronCreate` includes the durable metadata and CrawClaw
    cron-store placement in the model-visible result text, `CronDelete` rejects unknown job ids, and
    `RemoteTrigger` exposes Claude Code-style strict top-level input shape plus `trigger_id` and `body` parameter descriptions.
  - `RemoteTrigger` validates `trigger_id` with Claude Code's `^[\w-]+$` rule before reading,
    updating, or running a trigger, uses Claude Code-style action-specific missing parameter
    errors, and returns the Claude Code `HTTP <status>` result header before the JSON payload.
  - `interrupt` and `stop_task` map to the existing chat/session cancel surfaces. Background
    `Agent`/`Task` runs launched with `run_in_background` keep an abort handle so
    `stop_task`/`agentRuntime.cancel` can stop the running task instead of only marking its session;
    `cancel_async_message` also maps a matching async message ID to the same background-task
    cancellation path and otherwise returns `cancelled=false`.
  - `seed_read_state` accepts Claude SDK file-read seeds, resolves them inside the runtime root,
    records an LF-normalized snapshot only when the on-disk mtime has not advanced, and otherwise
    returns the Claude-compatible empty success payload.
  - `rewind_files` uses the in-memory file checkpoint captured before the matching agent turn.
    Checkpoints cover Git-visible regular files in the runtime worktree, are keyed by
    `user_message_id`, and are bounded to avoid snapshotting large worktrees. `dry_run` reports
    `filesChanged`, `insertions`, and `deletions` without writing. A non-dry run restores changed
    checkpointed files and removes Git-visible files created after the checkpoint. If no matching
    checkpoint exists, the response stays SDK-schema-compatible with `canRewind=false`.
- Operators may call `agent.observations.list` (`operator.read`) to fetch historical
  ObservationContext run summaries.
  - Filters: `query`, `status`, `source`, `from`, `to`, `limit`, and `cursor`.
  - `query` matches `runId`, `taskId`, `traceId`, `sessionKey`, and `agentId`.
  - `from` and `to` are inclusive epoch-millisecond time bounds.
  - The result is metadata-only and excludes prompt, transcript, and tool result bodies.
- Operators may call `agent.inspect` (`operator.read`) with `runId`, `taskId`, or
  `traceId` to fetch the unified observation timeline for a selected run.

## Exec approvals

- When an exec request needs approval, the gateway broadcasts `exec.approval.requested`.
- Operator clients resolve by calling `exec.approval.resolve` (requires `operator.approvals` scope).

## Agent delivery fallback

- `agent` requests can include `deliver=true` to request outbound delivery.
- `bestEffortDeliver=false` keeps strict behavior: unresolved or internal-only delivery targets return `INVALID_REQUEST`.
- `bestEffortDeliver=true` allows fallback to session-only execution when no external deliverable route can be resolved (for example internal sessions or ambiguous multi-channel configs).

## Versioning

- `GATEWAY_PROTOCOL_VERSION` lives in
  `crates/crawclaw-gateway/src/protocol_contract.rs`.
- Clients send `minProtocol` + `maxProtocol`; the server rejects mismatches.
- The packaged JSON Schema and protocol metadata artifacts are emitted by the
  Rust Gateway contract snapshot:
  - `pnpm protocol:gen`
  - `pnpm protocol:check`

## Auth

- If `CRAWCLAW_GATEWAY_TOKEN` (or `--token`) is set, `connect.params.auth.token`
  must match or the socket is closed.
- Auth failures include `error.details.code` plus `error.details.recommendedNextStep`
  (`update_auth_configuration`, `update_auth_credentials`, `wait_then_retry`, `review_auth_configuration`).
  - If that retry fails, clients should stop automatic reconnect loops and surface operator action guidance.

## Device authorization

Gateway device authorization has been removed. WebSocket clients authenticate with the configured
Gateway auth mode (`token`, `password`, `trusted-proxy`, or explicit `none`) and no longer send
a legacy device payload or wait for a preliminary challenge frame.
in addition to device/client/role/scopes/token/nonce fields.

- Legacy `v2` signatures remain accepted for compatibility, but paired-device
  metadata pinning still controls command policy on reconnect.

## TLS + pinning

- TLS is supported for WS connections.
- Clients may optionally pin the gateway cert fingerprint (see `gateway.tls`
  config plus `gateway.remote.tlsFingerprint` or CLI `--tls-fingerprint`).

## Scope

This protocol exposes the **full gateway API** (status, channels, models, chat,
agent, sessions, approvals, etc.). The runtime validator surface is still
implemented by the Rust Gateway. The generated JSON Schema artifact is emitted
from the Rust Gateway contract snapshot.
