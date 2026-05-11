---
summary: "Exec tool usage, stdin modes, and TTY support"
read_when:
  - Using or modifying the exec tool
  - Debugging stdin or TTY behavior
title: "Exec Tool"
---

# Exec tool

Run shell commands in the workspace. Supports foreground + background execution via `process`.
If `process` is disallowed, `exec` runs synchronously and ignores `yieldMs`/`background`.
Background sessions are scoped per agent; `process` only sees sessions from the same agent.

## Parameters

- `command` (required)
- `workdir` (defaults to cwd)
- `env` (key/value overrides)
- `yieldMs` (default 10000): auto-background after delay
- `background` (bool): background immediately
- `timeout` (seconds, default 1800): kill on expiry
- `pty` (bool): run in a pseudo-terminal when available (TTY-only CLIs, coding agents, terminal UIs)
- `security` (`deny | allowlist | full`): enforcement mode for host execution
- `ask` (`off | on-miss | always`): approval prompts for host execution
- `elevated` (bool): request elevated mode (gateway host); `security=full` is only forced when elevated resolves to `full`

Notes:

- `elevated` forces `host=gateway`; it is only available when elevated access is enabled for the current session/provider.
- Gateway host approvals are controlled by `~/.crawclaw/exec-approvals.json`.
- `host=node` is no longer supported.
- On non-Windows hosts, exec uses `SHELL` when set; if `SHELL` is `fish`, it prefers `bash` (or `sh`)
  from `PATH` to avoid fish-incompatible scripts, then falls back to `SHELL` if neither exists.
- On Windows hosts, exec prefers PowerShell 7 (`pwsh`) discovery (Program Files, ProgramW6432, then PATH),
  then falls back to Windows PowerShell 5.1.
- Host execution rejects `env.PATH` and loader overrides (`LD_*`/`DYLD_*`) to
  prevent binary hijacking or injected code.
- Script preflight checks (for common Python/Node shell-syntax mistakes) only inspect files inside the
  effective `workdir` boundary. If a script path resolves outside `workdir`, preflight is skipped for
  that file.

## Config

- `tools.exec.notifyOnExit` (default: true): when true, backgrounded exec sessions enqueue a system event and request a main-session wake on exit.
- `tools.exec.approvalRunningNoticeMs` (default: 10000): emit a single “running” notice when an approval-gated exec runs longer than this (0 disables).
- `tools.exec.ask` (default: `off`)
- No-approval host exec is the default for the Gateway host. If you want approvals/allowlist behavior, tighten both `tools.exec.*` and the host `~/.crawclaw/exec-approvals.json`; see [Exec approvals](/tools/exec-approvals#no-approval-yolo-mode).
- YOLO comes from the host-policy defaults (`security=full`, `ask=off`), not from `host=auto`. If you want to force gateway routing, set `tools.exec.host` or use `/exec host=gateway`.
- `tools.exec.strictInlineEval` (default: false): when true, inline interpreter eval forms such as `python -c`, `node -e`, `ruby -e`, `perl -e`, `php -r`, `lua -e`, and `osascript -e` always require explicit approval. `allow-always` can still persist benign interpreter/script invocations, but inline-eval forms still prompt each time.
- `tools.exec.safeBins`: stdin-only safe binaries that can run without explicit allowlist entries. For behavior details, see [Safe bins](/tools/exec-approvals#safe-bins-stdin-only).
- `tools.exec.safeBinTrustedDirs`: additional explicit directories trusted for `safeBins` path checks. `PATH` entries are never auto-trusted. Built-in defaults are `/bin` and `/usr/bin`.
- `tools.exec.safeBinProfiles`: optional custom argv policy per safe bin (`minPositional`, `maxPositional`, `allowedValueFlags`, `deniedFlags`).

Example:

```json5
{
  tools: {
    exec: {
      pathPrepend: ["~/bin", "/opt/oss/bin"],
    },
  },
}
```

### PATH handling

- `host=gateway`: merges your login-shell `PATH` into the exec environment. `env.PATH` overrides are
  rejected for host execution. The daemon itself still runs with a minimal `PATH`:
  - macOS: `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`
  - Linux: `/usr/local/bin`, `/usr/bin`, `/bin`
    CrawClaw prepends `env.PATH` after profile sourcing via an internal env var (no shell interpolation);
    `tools.exec.pathPrepend` applies here too.

## Session overrides (`/exec`)

Use `/exec` to set **per-session** defaults for `host`, `security`, and `ask`.
Send `/exec` with no arguments to show the current effective values. If the current posture allows
host exec without approval prompts, the reply includes a warning with the safer config shape.

Example:

```
/exec host=auto security=allowlist ask=on-miss
```

## Authorization model

`/exec` is only honored for **authorized senders** (channel allowlists/pairing plus `commands.useAccessGroups`).
It updates **session state only** and does not write config. To hard-disable exec, deny it via tool
policy (`tools.deny: ["exec"]` or per-agent). Host approvals still apply unless you explicitly set
`security=full` and `ask=off`.

## Exec approvals

See [Exec approvals](/tools/exec-approvals) for the policy, allowlist, and UI flow.

When approvals are required, the exec tool returns immediately with
`status: "approval-pending"` and an approval id. Once approved (or denied / timed out),
the Gateway emits system events (`Exec finished` / `Exec denied`). If the command is still
running after `tools.exec.approvalRunningNoticeMs`, a single `Exec running` notice is emitted.

## Allowlist + safe bins

Manual allowlist enforcement matches **resolved binary paths only** (no basename matches). When
`security=allowlist`, shell commands are auto-allowed only if every pipeline segment is
allowlisted or a safe bin. Chaining (`;`, `&&`, `||`) and redirections are rejected in
allowlist mode unless every top-level segment satisfies the allowlist (including safe bins).
Redirections remain unsupported.
Durable `allow-always` trust does not bypass that rule: a chained command still requires every
top-level segment to match.

`autoAllowSkills` is a separate convenience path in exec approvals. It is not the same as
manual path allowlist entries. For strict explicit trust, keep `autoAllowSkills` disabled.

Use the two controls for different jobs:

- `tools.exec.safeBins`: small, stdin-only stream filters.
- `tools.exec.safeBinTrustedDirs`: explicit extra trusted directories for safe-bin executable paths.
- `tools.exec.safeBinProfiles`: explicit argv policy for custom safe bins.
- allowlist: explicit trust for executable paths.

Do not treat `safeBins` as a generic allowlist, and do not add interpreter/runtime binaries (for example `python3`, `node`, `ruby`, `bash`). If you need those, use explicit allowlist entries and keep approval prompts enabled.
`crawclaw security audit` warns when interpreter/runtime `safeBins` entries are missing explicit profiles, and `crawclaw doctor --fix` can scaffold missing custom `safeBinProfiles` entries.
`crawclaw security audit` and `crawclaw doctor` also warn when you explicitly add broad-behavior bins such as `jq` back into `safeBins`.
If you explicitly allowlist interpreters, enable `tools.exec.strictInlineEval` so inline code-eval forms still require a fresh approval.

For full policy details and examples, see [Exec approvals](/tools/exec-approvals#safe-bins-stdin-only) and [Safe bins versus allowlist](/tools/exec-approvals#safe-bins-versus-allowlist).

## Examples

Foreground:

```json
{ "tool": "exec", "command": "ls -la" }
```

Background + poll:

```json
{"tool":"exec","command":"npm run build","yieldMs":1000}
{"tool":"process","action":"poll","sessionId":"<id>"}
```

Send keys (tmux-style):

```json
{"tool":"process","action":"send-keys","sessionId":"<id>","keys":["Enter"]}
{"tool":"process","action":"send-keys","sessionId":"<id>","keys":["C-c"]}
{"tool":"process","action":"send-keys","sessionId":"<id>","keys":["Up","Up","Enter"]}
```

Submit (send CR only):

```json
{ "tool": "process", "action": "submit", "sessionId": "<id>" }
```

Paste (bracketed by default):

```json
{ "tool": "process", "action": "paste", "sessionId": "<id>", "text": "line1\nline2\n" }
```

## apply_patch

`apply_patch` is a subtool of `exec` for structured multi-file edits.
It is enabled by default for OpenAI and OpenAI Codex models. Use config only
when you want to disable it or restrict it to specific models:

```json5
{
  tools: {
    exec: {
      applyPatch: { workspaceOnly: true, allowModels: ["gpt-5.2"] },
    },
  },
}
```

Notes:

- Only available for OpenAI/OpenAI Codex models.
- Tool policy still applies; `allow: ["write"]` implicitly allows `apply_patch`.
- Config lives under `tools.exec.applyPatch`.
- `tools.exec.applyPatch.enabled` defaults to `true`; set it to `false` to disable the tool for OpenAI models.
- `tools.exec.applyPatch.workspaceOnly` defaults to `true` (workspace-contained). Set it to `false` only if you intentionally want `apply_patch` to write/delete outside the workspace directory.

## Related

- [Exec Approvals](/tools/exec-approvals) — approval gates for shell commands
- [Background Process](/gateway/background-process) — long-running exec and process tool
- [Security](/gateway/security) — tool policy and elevated access
