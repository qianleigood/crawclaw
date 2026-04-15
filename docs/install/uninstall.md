---
summary: "Uninstall CrawClaw completely (CLI, service, state, workspace)"
read_when:
  - You want to remove CrawClaw from a machine
  - The gateway service is still running after uninstall
title: "Uninstall"
---

# Uninstall

Two paths:

- **Easy path** if `crawclaw` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
crawclaw uninstall
```

Non-interactive (automation / npx):

```bash
crawclaw uninstall --all --yes --non-interactive
npx -y crawclaw uninstall --all --yes --non-interactive
```

Manual steps (same result):

1. Stop the gateway service:

```bash
crawclaw gateway stop
```

2. Uninstall the gateway service (launchd/systemd/schtasks):

```bash
crawclaw gateway uninstall
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

5. Remove the CLI install (pick the one you used):

```bash
npm rm -g crawclaw
pnpm remove -g crawclaw
bun remove -g crawclaw
```

Notes:

- If you used profiles (`--profile` / `CRAWCLAW_PROFILE`), repeat step 3 for each state dir (defaults are `~/.crawclaw-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `crawclaw` is missing.

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

### Windows (Scheduled Task)

Default task name is `CrawClaw Gateway` (or `CrawClaw Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "CrawClaw Gateway"
Remove-Item -Force "$env:USERPROFILE\.crawclaw\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.crawclaw-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (install.sh / npm / pnpm / bun)

If you used `https://crawclaw.ai/install.sh` or `install.ps1`, the CLI was installed with `npm install -g crawclaw@latest`.
Remove it with `npm rm -g crawclaw` (or `pnpm remove -g` / `bun remove -g` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `crawclaw ...` / `bun run crawclaw ...`):

1. Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2. Delete the repo directory.
3. Remove state + workspace as shown above.
