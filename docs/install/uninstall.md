---
summary: "Uninstall CrawClaw completely (desktop app, local runtime state, workspace)"
read_when:
  - You want to remove CrawClaw from a machine
  - A legacy Gateway startup entry is still running after uninstall
title: "Uninstall"
---

# Uninstall

Two paths:

- **Easy path** from CrawClaw Desktop.
- **Manual legacy startup cleanup** if the desktop app is gone but an older startup entry is still running.

## Easy path

Recommended: use the built-in uninstaller:

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Non-interactive (automation / npx):

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
npx -y CrawClaw Desktop or the local Gateway API
```

Manual steps (same result):

1. Stop CrawClaw Desktop and any manual Gateway process:

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

2. Remove any legacy OS startup entry:

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

3. Delete state + config:

```bash
rm -rf "${CRAWCLAW_STATE_DIR:-$HOME/.crawclaw}"
```

If you set `CRAWCLAW_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4. Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/.crawclaw/workspace
```

5. Remove any old global `crawclaw` package only if you installed one before the desktop-first packaging model.

Notes:

- If you used profiles (`--profile` / `CRAWCLAW_PROFILE`), repeat step 3 for each state dir (defaults are `~/.crawclaw-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual legacy startup cleanup

Use this if an older startup entry keeps running but `crawclaw` is missing.

### macOS (launchd)

Default label is `ai.crawclaw.gateway` (or `ai.crawclaw.<profile>`; legacy `com.crawclaw.*` may still exist):

```bash
launchctl bootout gui/$UID/ai.crawclaw.gateway
rm -f ~/Library/LaunchAgents/ai.crawclaw.gateway.plist
```

If you used a profile, replace the label and plist name with `ai.crawclaw.<profile>`. Remove any legacy `com.crawclaw.*` plists if present.

### Linux (systemd user unit)

Default unit name is `crawclaw-gateway.service` (or `crawclaw-gateway-<profile>.service`):

```bash
systemctl --user disable --now crawclaw-gateway.service
rm -f ~/.config/systemd/user/crawclaw-gateway.service
systemctl --user daemon-reload
```

### Windows legacy task

Default task name is `CrawClaw Gateway` (or `CrawClaw Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "CrawClaw Gateway"
Remove-Item -Force "$env:USERPROFILE\.crawclaw\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.crawclaw-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (CrawClaw Desktop installer / npm / pnpm / bun)

If you used `https://crawclaw.ai/CrawClaw Desktop installer` or `CrawClaw Desktop installer`, the CLI was installed with `install CrawClaw Desktop from GitHub Releases`.
Remove it with `npm rm -g crawclaw` (or `pnpm remove -g` / `bun remove -g` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + CrawClaw Desktop or Gateway API / Gateway API calls):

1. Stop the local Gateway runtime **before** deleting the repo (use the easy path above or manual cleanup).
2. Delete the repo directory.
3. Remove state + workspace as shown above.
