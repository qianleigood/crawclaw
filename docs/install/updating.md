---
summary: "Updating CrawClaw Desktop safely, plus rollback strategy"
read_when:
  - Updating CrawClaw
  - Something breaks after an update
title: "Updating"
---

# Updating

Keep CrawClaw up to date.

## Recommended: CrawClaw Desktop or the local Gateway API

The fastest way to update is through CrawClaw Desktop. It fetches the latest application bundle and restarts the embedded Gateway when needed.

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

To switch channels or target a specific version:

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

See [Auto-updater](#auto-updater) for channel semantics.

## Alternative: re-run the installer

Install the current CrawClaw Desktop release asset from [GitHub Releases](https://github.com/qianleigood/crawclaw/releases).

CrawClaw Desktop owns the supported update and onboarding path. Source installer
flags for the retired public CLI onboarding flow are no longer documented.

## Alternative: manual npm or pnpm

Legacy global npm/pnpm installs should migrate to the desktop package. Remove the old global package after the desktop app is installed.

## Auto-updater

The auto-updater is off by default. Enable it in `~/.crawclaw/crawclaw.json`:

```json5
{
  update: {
    channel: "stable",
    auto: {
      enabled: true,
      stableDelayHours: 6,
      stableJitterHours: 12,
      betaCheckIntervalHours: 1,
    },
  },
}
```

| Channel  | Behavior                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| `stable` | Waits `stableDelayHours`, then applies with deterministic jitter across `stableJitterHours` (spread rollout). |
| `beta`   | Checks every `betaCheckIntervalHours` (default: hourly) and applies immediately.                              |
| `dev`    | No automatic apply. Use CrawClaw Desktop or the local Gateway API manually.                                   |

The gateway also logs an update hint on startup (disable with `update.checkOnStart: false`).

## After updating

<Steps>

### Run doctor

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

Migrates config, audits DM policies, and checks gateway health. Details: [Doctor](/gateway/doctor)

### Restart the gateway

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

### Verify

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

</Steps>

## Rollback

### Pin a version (npm)

Download the CrawClaw Desktop release asset for the version you want to run.

Tip: `npm view crawclaw version` shows the current published version.

### Pin a commit (source)

```bash
git fetch origin
git checkout "$(git rev-list -n 1 --before=\"2026-01-01\" origin/main)"
pnpm install && pnpm build
```

Start CrawClaw Desktop from that checkout, or run the local Gateway API target from the same source tree.

To return to latest: `git checkout main && git pull`.

## If you are stuck

- Run CrawClaw Desktop or the local Gateway API again and read the output carefully.
- Check: [Troubleshooting](/gateway/troubleshooting)
- Open a GitHub issue: [https://github.com/qianleigood/crawclaw/issues](https://github.com/qianleigood/crawclaw/issues)

## Related

- [Install Overview](/install) — all installation methods
- [Doctor](/gateway/doctor) — health checks after updates
- [Migrating](/install/migrating) — major version migration guides
