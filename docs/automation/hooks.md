---
summary: "Hooks: Gateway SDK lifecycle callbacks and external webhooks"
read_when:
  - You want to register Claude Code-compatible SDK lifecycle hooks
  - You want to react to Gateway lifecycle events or external webhooks
title: "Hooks"
---

# Hooks

CrawClaw has two active hook surfaces:

- **SDK lifecycle hooks**: Claude Code-compatible callback matchers supplied by an SDK client during Gateway `initialize`. These run through the live SDK control transport and can add context, block or adjust tool calls, and react to lifecycle events.
- **Webhooks**: external HTTP endpoints that let other systems trigger work in CrawClaw. See [Webhooks](/automation/cron-jobs#webhooks).

The older managed or workspace internal hook module loader is not part of the current Rust Gateway runtime. Do not put `HOOK.md` and `handler.ts` files under `~/.crawclaw/hooks` or `<workspace>/hooks` expecting automatic discovery.

## SDK Lifecycle Hooks

SDK lifecycle hooks are registered by sending `hooks` in the Gateway SDK `initialize` request. Each entry is keyed by hook event and contains callback matchers with `hookCallbackIds`.

When a matching event fires, the Gateway sends a `hook_callback` control request back to the connected SDK client. If no live SDK control transport is attached, the Gateway creates a pending hook callback request that an operator client can inspect with `hook_callback.list` and answer with `hook_callback.respond`.

For the full control protocol shape, see [Gateway Protocol](/gateway/protocol).

## Supported Events

| Event                | When it fires                                                               |
| -------------------- | --------------------------------------------------------------------------- |
| `Setup`              | During SDK `initialize`                                                     |
| `SessionStart`       | Before the first turn in a new Gateway session                              |
| `UserPromptSubmit`   | Before a submitted user prompt enters the agent run                         |
| `PreToolUse`         | Immediately before Rust tool execution                                      |
| `PostToolUse`        | Immediately after a successful tool call                                    |
| `PostToolUseFailure` | Immediately after a failed tool call                                        |
| `PermissionRequest`  | During `can_use_tool` permission checks                                     |
| `PermissionDenied`   | After Gateway permission denial                                             |
| `Stop`               | After a successful agent turn completes                                     |
| `StopFailure`        | When a Gateway agent turn fails before completion                           |
| `SessionEnd`         | Before a session reset clears transcript state                              |
| `SubagentStart`      | Before an `Agent` or `Task` child run starts                                |
| `SubagentStop`       | After an `Agent` or `Task` child run stops                                  |
| `Notification`       | For SDK-facing prompts and hook callback or elicitation failures            |
| `ConfigChange`       | After `config.set`, `config.apply`, or `config.patch` writes Gateway config |
| `Elicitation`        | Before an SDK MCP elicitation prompt is shown                               |
| `ElicitationResult`  | Before an SDK MCP elicitation response is returned                          |
| `PreCompact`         | Before Gateway compaction                                                   |
| `PostCompact`        | After Gateway compaction                                                    |

## Hook Responses

Callbacks return the Claude Code HookJSONOutput shape. CrawClaw currently consumes these fields:

| Field                                     | Effect                                                      |
| ----------------------------------------- | ----------------------------------------------------------- |
| `continue: false`                         | Blocks the current lifecycle step where blocking is honored |
| `decision: "block"`                       | Blocks the current lifecycle step with `reason`             |
| `hookSpecificOutput.additionalContext`    | Adds context for supported events                           |
| `hookSpecificOutput.initialUserMessage`   | Prepends initial user text for `SessionStart`               |
| `hookSpecificOutput.updatedInput`         | Replaces tool input for `PreToolUse`                        |
| `hookSpecificOutput.updatedMCPToolOutput` | Replaces MCP tool output for `PostToolUse`                  |
| `hookSpecificOutput.decision`             | Allows or denies `PermissionRequest`                        |
| `hookSpecificOutput.retry`                | Marks `PermissionDenied` as retryable                       |
| `hookSpecificOutput.action` and `content` | Overrides `Elicitation` or `ElicitationResult`              |

`PreToolUse`, `PostToolUse`, and `PostToolUseFailure` additional context is returned to the model as a system reminder attached to the related tool result. `Setup` additional context is appended to the main agent system prompt for later runs.

## Matchers

Hook matcher strings are matched against event-specific values:

| Event family                          | Matcher input      |
| ------------------------------------- | ------------------ |
| Tool and permission events            | Tool name          |
| `SessionStart`                        | Startup source     |
| `Setup`                               | Trigger            |
| `PreCompact` and `PostCompact`        | Compaction trigger |
| `Notification`                        | Notification type  |
| `SessionEnd`                          | End reason         |
| `StopFailure`                         | Error text         |
| `SubagentStart` and `SubagentStop`    | Agent type         |
| `ConfigChange`                        | Config source      |
| `Elicitation` and `ElicitationResult` | MCP server name    |

An empty matcher or `*` matches all values. Simple `A|B` strings match exact values, and other matcher strings are treated as regular expressions.

## Webhooks

Use Webhooks when an external service should trigger CrawClaw over HTTP. Webhook routes, mappings, transforms, and delivery settings live under the `hooks` Gateway configuration keys. See [Webhooks](/automation/cron-jobs#webhooks) and [Configuration](/gateway/configuration-reference#hooks).

## Removed Local Module Loader

The generated configuration reference still includes legacy `hooks.internal.*` keys for compatibility, but the current Rust Gateway runtime does not load local TypeScript hook modules from managed or workspace hook directories.

The removed local module loader used `HOOK.md`, `handler.ts`, `hooks.internal.entries`, and `hooks.internal.load.extraDirs`. Those files and keys should not be used for new automation. Use SDK lifecycle hooks for Gateway lifecycle interception, Webhooks for external triggers, or Rust native plugin capabilities for distributable plugin behavior.

## Troubleshooting

### SDK hook not firing

1. Confirm the SDK client sent `hooks` during `initialize`.
2. Confirm the callback id appears in the matcher for the expected event.
3. Confirm the matcher matches the event-specific value, such as tool name for `PreToolUse`.
4. Keep the SDK control transport connected, or respond to the pending callback with `hook_callback.respond`.

### External webhook not firing

Check that `hooks.enabled` is set, the request path matches a `hooks.mappings` entry, and the request uses the configured token when one is required.

## Related

- [Gateway Protocol](/gateway/protocol)
- [Webhooks](/automation/cron-jobs#webhooks)
- [Configuration](/gateway/configuration-reference#hooks)
