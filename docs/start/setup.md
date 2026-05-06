---
summary: "Advanced setup and development workflows for CrawClaw"
read_when:
  - Setting up a new machine
  - You want “latest + greatest” without breaking your personal setup
title: "Setup"
---

# Setup

<Note>
If you are setting up for the first time, start with [Getting Started](/start/getting-started).
For onboarding details, see [Onboarding (CLI)](/start/wizard).
</Note>

## TL;DR

- **Tailoring lives outside the repo:** `~/.crawclaw/workspace` (workspace) + `~/.crawclaw/crawclaw.json` (config).
- **Stable workflow:** install the runtime and run the Gateway directly.
- **Bleeding edge workflow:** run the Gateway yourself via `pnpm gateway:watch`.

## Prereqs (from source)

- Node 24.x (stable) or Node 25.x (experimental)
- `pnpm`
- Docker (optional; only for containerized setup/e2e — see [Docker](/install/docker))

## Tailoring strategy (so updates do not hurt)

If you want “100% tailored to me” _and_ easy updates, keep your customization in:

- **Config:** `~/.crawclaw/crawclaw.json` (JSON/JSON5-ish)
- **Workspace:** `~/.crawclaw/workspace` (skills, prompts, memories; make it a private git repo)

Bootstrap once:

```bash
crawclaw setup
```

From inside this repo, use the local CLI entry:

```bash
crawclaw setup
```

If you don’t have a global install yet, run it via `pnpm crawclaw setup`.

## Run the Gateway from this repo

After `pnpm build`, you can run the packaged CLI directly:

```bash
node crawclaw.mjs gateway --port 18789 --verbose
```

## Stable workflow

1. Install the runtime and start the Gateway locally.
2. Complete onboarding/configuration from the CLI.
3. Link surfaces (example: WhatsApp):

```bash
crawclaw channels login
```

4. Sanity check:

```bash
crawclaw health
```

## Bleeding edge workflow (Gateway in a terminal)

Goal: work on the TypeScript Gateway and get hot reload.

### 1) Start the dev Gateway

```bash
pnpm install
pnpm gateway:watch
```

`gateway:watch` runs the gateway in watch mode and reloads on relevant source,
config, and bundled-plugin metadata changes.

### 2) Verify

- Via CLI:

```bash
crawclaw health
```

### Common footguns

- **Wrong port:** Gateway WS defaults to `ws://127.0.0.1:18789`; keep all clients on the same port.
- **Where state lives:**
- Credentials: `~/.crawclaw/credentials/`
- Sessions: `~/.crawclaw/agents/<agentId>/sessions/`
- Logs: `/tmp/crawclaw/`

## Credential storage map

Use this when debugging auth or deciding what to back up:

- **WhatsApp**: `~/.crawclaw/credentials/whatsapp/<accountId>/creds.json`
- **Telegram bot token**: config/env or `channels.telegram.tokenFile` (regular file only; symlinks rejected)
- **Discord bot token**: config/env or SecretRef (env/file/exec providers)
- **Slack tokens**: config/env (`channels.slack.*`)
- **Pairing allowlists**:
  - `~/.crawclaw/credentials/<channel>-allowFrom.json` (default account)
  - `~/.crawclaw/credentials/<channel>-<accountId>-allowFrom.json` (non-default accounts)
- **Model auth profiles**: `~/.crawclaw/agents/<agentId>/agent/auth-profiles.json`
- **File-backed secrets payload (optional)**: `~/.crawclaw/secrets.json`
- **Legacy OAuth import**: `~/.crawclaw/credentials/oauth.json`
  More detail: [Security](/gateway/security#credential-storage-map).

## Updating (without wrecking your setup)

- Keep `~/.crawclaw/workspace` and `~/.crawclaw/` as “your stuff”; don’t put personal prompts/config into the `crawclaw` repo.
- Updating source: `git pull` + `pnpm install` (when lockfile changed) + keep using `pnpm gateway:watch`.

## Linux (systemd user service)

Linux installs use a systemd **user** service. By default, systemd stops user
services on logout/idle, which kills the Gateway. Onboarding attempts to enable
lingering for you (may prompt for sudo). If it’s still off, run:

```bash
sudo loginctl enable-linger $USER
```

For always-on or multi-user servers, consider a **system** service instead of a
user service (no lingering needed). See [Gateway runbook](/gateway) for the systemd notes.

## Related docs

- [Gateway runbook](/gateway) (flags, supervision, ports)
- [Gateway configuration](/gateway/configuration) (config schema + examples)
- [Discord](/channels/discord) and [Telegram](/channels/telegram) (reply tags + replyToMode settings)
- [CrawClaw assistant setup](/start/crawclaw)
