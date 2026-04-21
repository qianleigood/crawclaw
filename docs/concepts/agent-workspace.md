---
summary: "Agent workspace: location, layout, and backup strategy"
read_when:
  - You need to explain the agent workspace or its file layout
  - You want to back up or migrate an agent workspace
title: "Agent Workspace"
---

# Agent workspace

The workspace is the agent's home. It is the only working directory used for
file tools and for workspace context. Keep it private and treat it as memory.

This is separate from `~/.crawclaw/`, which stores config, credentials, and
sessions.

**Important:** the workspace is the **default cwd**, not a hard sandbox. Tools
resolve relative paths against the workspace, but absolute paths can still reach
elsewhere on the host unless sandboxing is enabled. If you need isolation, use
[`agents.defaults.sandbox`](/gateway/sandboxing) (and/or per‑agent sandbox config).
When sandboxing is enabled and `workspaceAccess` is not `"rw"`, tools operate
inside a sandbox workspace under `~/.crawclaw/sandboxes`, not your host workspace.

## Default location

- Default: `~/.crawclaw/workspace`
- If `CRAWCLAW_PROFILE` is set and not `"default"`, the default becomes
  `~/.crawclaw/workspace-<profile>`.
- Override in `~/.crawclaw/crawclaw.json`:

```json5
{
  agent: {
    workspace: "~/.crawclaw/workspace",
  },
}
```

`crawclaw onboard`, `crawclaw configure`, or `crawclaw setup` will create the
workspace and seed the bootstrap files if they are missing.
Sandbox seed copies only accept regular in-workspace files; symlink/hardlink
aliases that resolve outside the source workspace are ignored.

If you already manage the workspace files yourself, you can disable bootstrap
file creation:

```json5
{ agent: { skipBootstrap: true } }
```

## Extra workspace folders

Older installs may have created `~/crawclaw`. Keeping multiple workspace
directories around can cause confusing auth or state drift, because only one
workspace is active at a time.

**Recommendation:** keep a single active workspace. If you no longer use the
extra folders, archive or move them to Trash (for example `trash ~/crawclaw`).
If you intentionally keep multiple workspaces, make sure
`agents.defaults.workspace` points to the active one.

`crawclaw doctor` warns when it detects extra workspace directories.

## Workspace file map (what each file means)

These are the standard files CrawClaw expects inside the workspace:

- `AGENTS.md`
  - Operating instructions for the agent and how it should use memory.
  - Loaded at the start of every session.
  - Good place for rules, priorities, and "how to behave" details.

- `SOUL.md`
  - Persona, tone, and boundaries.
  - Kept as a workspace file, but not injected by default.

- `USER.md`
  - Who the user is and how to address them.
  - Kept as a workspace file, but not injected by default.

- `IDENTITY.md`
  - The agent's name, vibe, and emoji.
  - Created/updated during the bootstrap ritual.

- `TOOLS.md`
  - Notes about your local tools and conventions.
  - Does not control tool availability; it is only guidance.
  - Not injected by default.

- `HEARTBEAT.md`
  - Compatibility checklist for legacy heartbeat-style runs.
  - Not the recommended place for new scheduled automation.
  - Use cron jobs or hooks for new proactive work.

- `BOOT.md`
  - Optional startup checklist executed on gateway restart when internal hooks are enabled.
  - Keep it short; use the message tool for outbound sends.

- `BOOTSTRAP.md`
  - One-time first-run ritual.
  - Only created for a brand-new workspace.
  - Delete it after the ritual is complete.

- `memory/YYYY-MM-DD.md`
  - Daily memory log (one file per day).
  - Recommended to read today + yesterday on session start.

- `MEMORY.md` (optional)
  - Curated long-term memory for explicit memory tools and workflows.
  - Not part of the default workspace bootstrap injection path.

See [Memory](/concepts/memory) for the workflow and automatic memory flush.

- `skills/` (optional)
  - Workspace-specific skills.
  - Overrides managed/bundled skills when names collide.

- `canvas/` (optional)
  - Canvas UI files for node displays (for example `canvas/index.html`).

If the active bootstrap file for the run is missing, CrawClaw injects a
"missing file" marker and continues. Large bootstrap files are truncated when
injected; adjust limits with `agents.defaults.bootstrapMaxChars` (default: 20000) and `agents.defaults.bootstrapTotalMaxChars` (default: 150000).
`crawclaw setup` can recreate missing defaults without overwriting existing
files.

## What is NOT in the workspace

These live under `~/.crawclaw/` and should NOT be committed to the workspace repo:

- `~/.crawclaw/crawclaw.json` (config)
- `~/.crawclaw/credentials/` (OAuth tokens, API keys)
- `~/.crawclaw/agents/<agentId>/sessions/` (session transcripts + metadata)
- `~/.crawclaw/skills/` (managed skills)

If you need to migrate sessions or config, copy them separately and keep them
out of version control.

## Git backup (recommended, private)

Treat the workspace as private memory. Put it in a **private** git repo so it is
backed up and recoverable.

Run these steps on the machine where the Gateway runs (that is where the
workspace lives).

### 1) Initialize the repo

If git is installed, brand-new workspaces are initialized automatically. If this
workspace is not already a repo, run:

```bash
cd ~/.crawclaw/workspace
git init
git add AGENTS.md SOUL.md TOOLS.md IDENTITY.md USER.md HEARTBEAT.md memory/
git commit -m "Add agent workspace"
```

### 2) Add a private remote (beginner-friendly options)

Option A: GitHub web UI

1. Create a new **private** repository on GitHub.
2. Do not initialize with a README (avoids merge conflicts).
3. Copy the HTTPS remote URL.
4. Add the remote and push:

```bash
git branch -M main
git remote add origin <https-url>
git push -u origin main
```

Option B: GitHub CLI (`gh`)

```bash
gh auth login
gh repo create crawclaw-workspace --private --source . --remote origin --push
```

Option C: GitLab web UI

1. Create a new **private** repository on GitLab.
2. Do not initialize with a README (avoids merge conflicts).
3. Copy the HTTPS remote URL.
4. Add the remote and push:

```bash
git branch -M main
git remote add origin <https-url>
git push -u origin main
```

### 3) Ongoing updates

```bash
git status
git add .
git commit -m "Update memory"
git push
```

## Do not commit secrets

Even in a private repo, avoid storing secrets in the workspace:

- API keys, OAuth tokens, passwords, or private credentials.
- Anything under `~/.crawclaw/`.
- Raw dumps of chats or sensitive attachments.

If you must store sensitive references, use placeholders and keep the real
secret elsewhere (password manager, environment variables, or `~/.crawclaw/`).

Suggested `.gitignore` starter:

```gitignore
.DS_Store
.env
**/*.key
**/*.pem
**/secrets*
```

## Moving the workspace to a new machine

1. Clone the repo to the desired path (default `~/.crawclaw/workspace`).
2. Set `agents.defaults.workspace` to that path in `~/.crawclaw/crawclaw.json`.
3. Run `crawclaw setup --workspace <path>` to seed any missing files.
4. If you need sessions, copy `~/.crawclaw/agents/<agentId>/sessions/` from the
   old machine separately.

## Advanced notes

- Multi-agent routing can use different workspaces per agent. See
  [Channel routing](/channels/channel-routing) for routing configuration.
- If `agents.defaults.sandbox` is enabled, non-main sessions can use per-session sandbox
  workspaces under `agents.defaults.sandbox.workspaceRoot`.

## Related

- [Standing Orders](/automation/standing-orders) — persistent instructions in workspace files
- [Heartbeat](/gateway/heartbeat) — legacy heartbeat compatibility notes
- [Session](/concepts/session) — session storage paths
- [Sandboxing](/gateway/sandboxing) — workspace access in sandboxed environments
