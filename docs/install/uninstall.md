---
summary: "Uninstall CrawClaw completely (desktop app, local runtime state, workspace)"
read_when:
  - You want to remove CrawClaw from a machine
  - A legacy Gateway startup entry is still running after uninstall
title: "Uninstall"
---

# Uninstall

Two paths:

- **Current desktop install**: quit CrawClaw Desktop, remove the app/package, then decide whether to remove local state.
- **Manual legacy startup cleanup** if the desktop app is gone but an older startup entry is still running.

## Current desktop install

Current desktop builds do not expose a one-click full-system uninstaller through
the Gateway API. Use the OS package/app removal path for the application itself.

Before removing the app, use **Settings > Data and privacy** in CrawClaw Desktop
to export data or delete local desktop data if you want the app to do that while
the embedded Gateway is still running.

Manual steps:

1. Stop CrawClaw Desktop and any manual Gateway process:

Quit CrawClaw Desktop. If you started a Gateway or dev server manually, stop that
process before deleting files.

2. Remove the app or package:

- macOS app: move CrawClaw Desktop from `/Applications` to Trash.
- Legacy package install: remove the old global package with `npm rm -g crawclaw`
  (or `pnpm remove -g crawclaw` / `bun remove -g crawclaw` if you installed it
  that way).

3. Delete state + config if you want a full local cleanup:

```bash
rm -rf "${CRAWCLAW_STATE_DIR:-$HOME/.crawclaw}"
```

If you set `CRAWCLAW_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4. Delete your workspace only if it lives outside the state dir:

```bash
rm -rf /path/to/your/crawclaw-workspace
```

Notes:

- If you used profiles (`--profile` / `CRAWCLAW_PROFILE`), repeat the state-dir cleanup for each profile (defaults are `~/.crawclaw-<profile>`).
- In remote mode, state lives on the **gateway host**, so run cleanup there too.

## Manual legacy startup cleanup

Use this if an older startup entry keeps running but `crawclaw` is missing.

### macOS (launchd)

Current desktop installs do not create a separate Gateway helper LaunchAgent.
Only remove legacy Gateway launchd entries when they exist:

```bash
launchctl print gui/$UID | grep crawclaw
launchctl bootout gui/$UID/ai.crawclaw.gateway 2>/dev/null || true
rm -f ~/Library/LaunchAgents/ai.crawclaw.gateway.plist
```

If you used a profile, replace the label and plist name with
`ai.crawclaw.<profile>`. Remove any legacy `com.crawclaw.*` plists if present.

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

### Normal install (CrawClaw Desktop / npm / pnpm / bun)

Remove the desktop app through the OS package/app flow. If you installed an
older global `crawclaw` package, remove it with `npm rm -g crawclaw` (or `pnpm
remove -g crawclaw` / `bun remove -g crawclaw` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + CrawClaw Desktop or Gateway API / Gateway API calls):

1. Stop the local Gateway runtime **before** deleting the repo (quit CrawClaw Desktop or stop the manual dev process).
2. Delete the repo directory.
3. Remove state + workspace as shown above.
