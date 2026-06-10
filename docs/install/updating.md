---
summary: "Updating CrawClaw Desktop safely, plus rollback strategy"
read_when:
  - Updating CrawClaw
  - Something breaks after an update
title: "Updating"
---

# Updating

Keep CrawClaw up to date.

## Recommended: CrawClaw Desktop

The fastest way to update is through CrawClaw Desktop. It fetches the latest application bundle and restarts the embedded Gateway when needed.

For source checkouts and automation, use the Gateway `update.run` control-plane method. It checks the current git checkout, refuses to proceed when the worktree is dirty, fetches upstream refs and tags, and reports whether the checkout is already current or whether an update is available. It does not replace the packaged desktop app bundle.

To switch channels or target a specific version:

- Set `update.channel` to `stable`, `beta`, or `dev`.
- For automation, patch config through the Gateway API (`config.patch`) and then run `update.run` to check the active checkout.
- For packaged desktop installs, download the exact version you want from [GitHub Releases](https://github.com/qianleigood/crawclaw/releases).

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

Run Doctor from CrawClaw Desktop or the Gateway repair surface.

Migrates config, audits DM policies, and checks gateway health. Details: [Doctor](/gateway/doctor)

### Restart the gateway

Restart from CrawClaw Desktop so the embedded Gateway reloads startup-bound settings. For source checkouts, stop the running dev process, rebuild if needed, and start the Gateway from the updated checkout.

### Verify

Check the Desktop health view or the Gateway `health` / `system.health` RPC. Confirm the Gateway is reachable, expected channels are connected or ready, and the log has no blocking config or service errors.

</Steps>

## Rollback

### Pin a version (npm)

Download the CrawClaw Desktop release asset for the version you want to run.

Tip: `npm view crawclaw version` shows the current published version.

### Pin a commit (source)

```bash
git fetch origin
git checkout "$(git rev-list -n 1 --before='2026-01-01' origin/main)"
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
