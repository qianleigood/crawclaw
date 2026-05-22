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

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

To switch channels or target a specific version:

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

See [Auto-updater](#auto-updater) for channel semantics.

## Alternative: re-run the installer

```bash
# Install CrawClaw Desktop from GitHub Releases.
```

CrawClaw Desktop owns the supported update and onboarding path. Source installer
flags for the retired public CLI onboarding flow are no longer documented.

## Alternative: manual npm or pnpm

```bash
# Install CrawClaw Desktop from GitHub Releases.
```

```bash
# Install CrawClaw Desktop from GitHub Releases.
```

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

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Migrates config, audits DM policies, and checks gateway health. Details: [Doctor](/gateway/doctor)

### Restart the gateway

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

### Verify

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

</Steps>

## Rollback

### Pin a version (npm)

```bash
Install the matching CrawClaw Desktop release asset
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Tip: `npm view crawclaw version` shows the current published version.

### Pin a commit (source)

```bash
git fetch origin
git checkout "$(git rev-list -n 1 --before=\"2026-01-01\" origin/main)"
pnpm install && pnpm build
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

To return to latest: `git checkout main && git pull`.

## If you are stuck

- Run CrawClaw Desktop or the local Gateway API again and read the output carefully.
- Check: [Troubleshooting](/gateway/troubleshooting)
- Open a GitHub issue: [https://github.com/qianleigood/crawclaw/issues](https://github.com/qianleigood/crawclaw/issues)

## Related

- [Install Overview](/install) — all installation methods
- [Doctor](/gateway/doctor) — health checks after updates
- [Migrating](/install/migrating) — major version migration guides
