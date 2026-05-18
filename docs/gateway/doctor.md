---
summary: "Doctor command: health checks, config migrations, and repair steps"
read_when:
  - Adding or modifying doctor migrations
  - Introducing breaking config changes
title: "Doctor"
---

# Doctor

CrawClaw Desktop or the local Gateway API is the repair + migration tool for CrawClaw. It fixes stale
config/state, checks health, and provides actionable repair steps.

## Quick start

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

### Headless / automation

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Apply recommended repairs without prompting (repairs + restarts where safe).

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Apply aggressive repairs too (overwrites custom supervisor configs).

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Legacy state migrations run automatically when detected.

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Scan system services for extra gateway installs (launchd/systemd/schtasks).

If you want to review changes before writing, open the config file first:

```bash
cat ~/.crawclaw/crawclaw.json
```

## What it does (summary)

- Optional pre-flight update for git installs (interactive only).
- Health check + restart prompt.
- Skills status summary (eligible/missing/blocked) and plugin status.
- Config normalization for legacy values.
- Browser migration checks for legacy browser configs.
- OpenCode provider override warnings (`models.providers.opencode` / `models.providers.opencode-go`).
- Legacy on-disk state migration (sessions/agent dir/Weixin auth).
- Legacy plugin manifest contract key migration (`speechProviders` → `contracts`) and removal of legacy media-understanding provider keys.
- Legacy cron store migration (`jobId`, `schedule.cron`, top-level delivery/payload fields, payload `provider`, simple `notify: true` webhook fallback jobs).
- Session lock file inspection and stale lock cleanup.
- State integrity and permissions checks (sessions, transcripts, state dir).
- Config file permission checks (chmod 600) when running locally.
- Model auth health: checks OAuth expiry, can refresh expiring tokens, and reports auth-profile cooldown/disabled states.
- Extra workspace dir detection (`~/crawclaw`).
- Legacy service migration and extra gateway detection.
- Removed TypeScript channel state migrations are no longer maintained.
- Gateway runtime checks (service installed but not running; cached launchd label).
- Channel status warnings (probed from the running gateway).
- Supervisor config audit (launchd/systemd/schtasks) with optional repair.
- Gateway runtime best-practice checks (Node vs Bun, version-manager paths).
- Gateway port collision diagnostics (default `18789`).
- Security warnings for open DM policies.
- Gateway auth checks for local token mode (offers token generation when no token source exists; does not overwrite token SecretRef configs).
- systemd linger check on Linux.
- Workspace bootstrap file size check (truncation/near-limit warnings for context files).
- Shell completion status check and auto-install/upgrade.
- Source install checks (pnpm workspace mismatch and npm lockfile drift).
- Writes updated config + wizard metadata.

## Detailed behavior and rationale

### 0) Optional update (git installs)

If this is a git checkout and doctor is running interactively, it offers to
update (fetch/rebase/build) before running doctor.

### 1) Config normalization

If the config contains legacy value shapes (for example `messages.ackReaction`
without a channel-specific override), doctor normalizes them into the current
schema.

### 2) Legacy config key migrations

When the config contains deprecated keys, other commands refuse to run and ask
you to run CrawClaw Desktop or the local Gateway API.

Doctor will:

- Explain which legacy keys were found.
- Show the migration it applied.
- Rewrite `~/.crawclaw/crawclaw.json` with the updated schema.

The Gateway also auto-runs doctor migrations on startup when it detects a
legacy config format, so stale configs are repaired without manual intervention.
Cron job store migrations are handled by CrawClaw Desktop or the local Gateway API.

Current migrations:

- `routing.allowFrom` → `channels.weixin.allowFrom`
- `routing.groupChat.requireMention` → `channels.weixin/feishu/weixin.groups."*".requireMention`
- `routing.groupChat.historyLimit` → `messages.groupChat.historyLimit`
- `routing.groupChat.mentionPatterns` → `messages.groupChat.mentionPatterns`
- `routing.queue` → `messages.queue`
- `routing.bindings` → top-level `bindings`
- `routing.agents`/`routing.defaultAgentId` → `agents.list` + `agents.list[].default`
- `routing.agentToAgent` → `tools.agentToAgent`
- `routing.transcribeAudio` → `tools.media.audio.models`
- `bindings[].match.accountID` → `bindings[].match.accountId`
- For channels with named `accounts` but missing `accounts.default`, move account-scoped top-level single-account channel values into `channels.<channel>.accounts.default` when present
- `identity` → `agents.list[].identity`
- `agent.model`/`allowedModels`/`modelAliases`/`modelFallbacks`/`imageModelFallbacks`
  → `agents.defaults.models` + `agents.defaults.model.primary/fallbacks` + `agents.defaults.imageModel.primary/fallbacks`
- `browser.ssrfPolicy.allowPrivateNetwork` → `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork`
- remove `browser.relayBindHost` (legacy extension relay setting)

Doctor warnings also include account-default guidance for multi-account channels:

- If two or more `channels.<channel>.accounts` entries are configured without `channels.<channel>.defaultAccount` or `accounts.default`, doctor warns that fallback routing can pick an unexpected account.
- If `channels.<channel>.defaultAccount` is set to an unknown account ID, doctor warns and lists configured account IDs.

### 2b) OpenCode provider overrides

If you’ve added `models.providers.opencode`, `opencode-zen`, or `opencode-go`
manually, it overrides the built-in OpenCode catalog from `@mariozechner/pi-ai`.
That can force models onto the wrong API or zero out costs. Doctor warns so you
can remove the override and restore per-model API routing + costs.

### 2c) Browser migration cleanup

If your browser config still points at removed browser relay settings, doctor
normalizes it to the current Rust native `agent-browser` model:

- `browser.relayBindHost` is removed

### 3) Legacy state migrations (disk layout)

Doctor can migrate older on-disk layouts into the current structure:

- Sessions store + transcripts:
  - from `~/.crawclaw/sessions/` to `~/.crawclaw/agents/<agentId>/sessions/`
- Agent dir:
  - from `~/.crawclaw/agent/` to `~/.crawclaw/agents/<agentId>/agent/`
- Weixin auth state (Baileys):
  - from legacy `~/.crawclaw/credentials/*.json` (except `oauth.json`)
  - to `~/.crawclaw/credentials/weixin/<accountId>/...` (default account id: `default`)

These migrations are best-effort and idempotent; doctor will emit warnings when
it leaves any legacy folders behind as backups. The Gateway/CLI also auto-migrates
the legacy sessions + agent dir on startup so history/auth/models land in the
per-agent path without a manual doctor run. Weixin auth is intentionally only
migrated via CrawClaw Desktop or the local Gateway API.

### 3a) Legacy plugin manifest migrations

Doctor scans all installed plugin manifests for deprecated top-level capability keys.
When `speechProviders` is found, it offers to move it into the `contracts` object
and rewrite the manifest file in-place. Legacy `mediaUnderstandingProviders` keys
are removed because TypeScript media-understanding providers are no longer a
plugin contract.

### 3b) Legacy cron store migrations

Doctor also checks the cron job store (`~/.crawclaw/cron/jobs.json` by default,
or `cron.store` when overridden) for old job shapes that the scheduler still
accepts for compatibility.

Current cron cleanups include:

- `jobId` → `id`
- `schedule.cron` → `schedule.expr`
- top-level payload fields (`message`, `model`, `thinking`, ...) → `payload`
- top-level delivery fields (`deliver`, `channel`, `to`, `provider`, ...) → `delivery`
- payload `provider` delivery aliases → explicit `delivery.channel`
- simple legacy `notify: true` webhook fallback jobs → explicit `delivery.mode="webhook"` with `delivery.to=cron.webhook`

Doctor only auto-migrates `notify: true` jobs when it can do so without
changing behavior. If a job combines legacy notify fallback with an existing
non-webhook delivery mode, doctor warns and leaves that job for manual review.

### 3c) Session lock cleanup

Doctor scans every agent session directory for stale write-lock files — files left
behind when a session exited abnormally. For each lock file found it reports:
the path, PID, whether the PID is still alive, lock age, and whether it is
considered stale (dead PID or older than 30 minutes). In `--fix` / `--repair`
mode it removes stale lock files automatically; otherwise it prints a note and
instructs you to rerun with `--fix`.

### 4) State integrity checks (session persistence, routing, and safety)

The state directory is the operational brainstem. If it vanishes, you lose
sessions, credentials, logs, and config (unless you have backups elsewhere).

Doctor checks:

- **State dir missing**: warns about catastrophic state loss, prompts to recreate
  the directory, and reminds you that it cannot recover missing data.
- **State dir permissions**: verifies writability; offers to repair permissions
  (and emits a `chown` hint when owner/group mismatch is detected).
- **macOS cloud-synced state dir**: warns when state resolves under iCloud Drive
  (`~/Library/Mobile Documents/com~apple~CloudDocs/...`) or
  `~/Library/CloudStorage/...` because sync-backed paths can cause slower I/O
  and lock/sync races.
- **Linux SD or eMMC state dir**: warns when state resolves to an `mmcblk*`
  mount source, because SD or eMMC-backed random I/O can be slower and wear
  faster under session and credential writes.
- **Session dirs missing**: `sessions/` and the session store directory are
  required to persist history and avoid `ENOENT` crashes.
- **Transcript mismatch**: warns when recent session entries have missing
  transcript files.
- **Main session “1-line JSONL”**: flags when the main transcript has only one
  line (history is not accumulating).
- **Multiple state dirs**: warns when multiple `~/.crawclaw` folders exist across
  home directories or when `CRAWCLAW_STATE_DIR` points elsewhere (history can
  split between installs).
- **Remote mode reminder**: if `gateway.mode=remote`, doctor reminds you to run
  it on the remote host (the state lives there).
- **Config file permissions**: warns if `~/.crawclaw/crawclaw.json` is
  group/world readable and offers to tighten to `600`.

### 5) Model auth health (OAuth expiry)

Doctor inspects OAuth profiles in the auth store, warns when tokens are
expiring/expired, and can refresh them when safe. If the Anthropic Claude Code
profile is stale, it suggests running `claude setup-token` (or pasting a setup-token).
Refresh prompts only appear when running interactively (TTY); `--non-interactive`
skips refresh attempts.

Doctor also reports auth profiles that are temporarily unusable due to:

- short cooldowns (rate limits/timeouts/auth failures)
- longer disables (billing/credit failures)

### 6) Hooks model validation

If `hooks.gmail.model` is set, doctor validates the model reference against the
catalog and allowlist and warns when it won’t resolve or is disallowed.

that can be detected without mutating the runtime.

### 8) Gateway service migrations and cleanup hints

Doctor detects legacy gateway services (launchd/systemd/schtasks) and
offers to remove them and install the CrawClaw service using the current gateway
port. It can also scan for extra gateway-like services and print cleanup hints.
Profile-named CrawClaw gateway services are considered first-class and are not
flagged as "extra."

### 8b) Startup channel checks

When a Feishu channel account has a pending or actionable legacy state migration,
doctor (in `--fix` / `--repair` mode) creates a pre-migration snapshot and then
runs the best-effort migration steps: legacy Feishu state migration and legacy
encrypted-state preparation. Both steps are non-fatal; errors are logged and
startup continues. In read-only mode (CrawClaw Desktop or the local Gateway API without `--fix`) this check
is skipped entirely.

### 9) Security warnings

Doctor emits warnings when a provider is open to DMs without an allowlist, or
when a policy is configured in a dangerous way.

### 10) systemd linger (Linux)

If running as a systemd user service, doctor ensures lingering is enabled so the
gateway stays alive after logout.

### 11) Workspace status (skills, plugins, and legacy dirs)

Doctor prints a summary of the workspace state for the default agent:

- **Skills status**: counts eligible, missing-requirements, and allowlist-blocked skills.
- **Legacy workspace dirs**: warns when `~/crawclaw` or other legacy workspace directories
  exist alongside the current workspace.
- **Plugin status**: counts loaded/disabled/errored plugins; lists plugin IDs for any
  errors; reports bundle plugin capabilities.
- **Plugin compatibility warnings**: flags plugins that have compatibility issues with
  the current runtime.
- **Plugin diagnostics**: surfaces any load-time warnings or errors emitted by the
  plugin registry.

### 11b) Bootstrap file size

Doctor checks whether workspace bootstrap files (for example `AGENTS.md`,
`CLAUDE.md`, or other injected context files) are near or over the configured
character budget. It reports per-file raw vs. injected character counts, truncation
percentage, truncation cause (`max/file` or `max/total`), and total injected
characters as a fraction of the total budget. When files are truncated or near
the limit, doctor prints tips for tuning `agents.defaults.bootstrapMaxChars`
and `agents.defaults.bootstrapTotalMaxChars`.

### 11c) Shell completion

Doctor checks whether tab completion is installed for the current shell
(zsh, bash, fish, or PowerShell):

- If the shell profile uses a slow dynamic completion pattern
  (`source <(CrawClaw Desktop or the local Gateway API...)`), doctor upgrades it to the faster
  cached file variant.
- If completion is configured in the profile but the cache file is missing,
  doctor regenerates the cache automatically.
- If no completion is configured at all, doctor prompts to install it
  (interactive mode only; skipped with `--non-interactive`).

Run CrawClaw Desktop or the local Gateway API to regenerate the cache manually.

### 12) Gateway auth checks (local token)

Doctor checks local gateway token auth readiness.

- If token mode needs a token and no token source exists, doctor offers to generate one.
- If `gateway.auth.token` is SecretRef-managed but unavailable, doctor warns and does not overwrite it with plaintext.
- CrawClaw Desktop or the local Gateway API forces generation only when no token SecretRef is configured.

### 12b) Read-only SecretRef-aware repairs

Some repair flows need to inspect configured credentials without weakening runtime fail-fast behavior.

- CrawClaw Desktop or the local Gateway API now uses the same read-only SecretRef summary model as status-family commands for targeted config repairs.
- Example: Feishu `allowFrom` / `groupAllowFrom` `@username` repair tries to use configured bot credentials when available.
- If the Feishu bot token is configured via SecretRef but unavailable in the current command path, doctor reports that the credential is configured-but-unavailable and skips auto-resolution instead of crashing or misreporting the token as missing.

### 13) Gateway health check + restart

Doctor runs a health check and offers to restart the gateway when it looks
unhealthy.

### 14) Channel status warnings

If the gateway is healthy, doctor runs a channel status probe and reports
warnings with suggested fixes.

### 15) Supervisor config audit + repair

Doctor checks the installed supervisor config (launchd/systemd/schtasks) for
missing or outdated defaults (e.g., systemd network-online dependencies and
restart delay). When it finds a mismatch, it recommends an update and can
rewrite the service file/task to the current defaults.

Notes:

- CrawClaw Desktop or the local Gateway API prompts before rewriting supervisor config.
- CrawClaw Desktop or the local Gateway API accepts the default repair prompts.
- CrawClaw Desktop or the local Gateway API applies recommended fixes without prompts.
- CrawClaw Desktop or the local Gateway API overwrites custom supervisor configs.
- If token auth requires a token and `gateway.auth.token` is SecretRef-managed, doctor service install/repair validates the SecretRef but does not persist resolved plaintext token values into supervisor service environment metadata.
- If token auth requires a token and the configured token SecretRef is unresolved, doctor blocks the install/repair path with actionable guidance.
- If both `gateway.auth.token` and `gateway.auth.password` are configured and `gateway.auth.mode` is unset, doctor blocks install/repair until mode is set explicitly.
- For Linux user-systemd units, doctor token drift checks now include both `Environment=` and `EnvironmentFile=` sources when comparing service auth metadata.
- You can always force a full rewrite via CrawClaw Desktop or the local Gateway API.

### 16) Gateway runtime + port diagnostics

Doctor inspects the service runtime (PID, last exit status) and warns when the
service is installed but not actually running. It also checks for port collisions
on the gateway port (default `18789`) and reports likely causes (gateway already
running, SSH tunnel).

### 17) Gateway runtime best practices

Doctor warns when the gateway service runs on Bun or a version-managed Node path
(`nvm`, `fnm`, `volta`, `asdf`, etc.). Weixin + Feishu channels require Node,
and version-manager paths can break after upgrades because the service does not
load your shell init. Doctor offers to migrate to a system Node install when
available (Homebrew/apt/choco).

### 18) Config write + wizard metadata

Doctor persists any config changes and stamps wizard metadata to record the
doctor run.

### 19) Workspace tips (backup + memory system)

Doctor suggests a workspace memory system when missing and prints a backup tip
if the workspace is not already under git.

See [/concepts/agent-workspace](/concepts/agent-workspace) for a full guide to
workspace structure and git backup (recommended private GitHub or GitLab).
