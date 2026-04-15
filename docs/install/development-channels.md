---
summary: "Stable, beta, and dev channels: semantics, switching, pinning, and tagging"
read_when:
  - You want to switch between stable/beta/dev
  - You want to pin a specific version, tag, or SHA
  - You are tagging or publishing prereleases
title: "Release Channels"
sidebarTitle: "Release Channels"
---

# Development channels

CrawClaw ships three update channels:

- **stable**: npm dist-tag `latest`. Recommended for most users.
- **beta**: npm dist-tag `beta` (builds under test).
- **dev**: moving head of `main` (git). npm dist-tag: `dev` (when published).
  The `main` branch is for experimentation and active development. It may contain
  incomplete features or breaking changes. Do not use it for production gateways.

We usually ship stable builds to **beta** first, test them there, then run an
explicit promotion step that moves the vetted build to `latest` without
changing the version number. Maintainers can also publish a stable release
directly to `latest` when needed. Dist-tags are the source of truth for npm
installs.

## Switching channels

```bash
crawclaw update --channel stable
crawclaw update --channel beta
crawclaw update --channel dev
```

`--channel` persists your choice in config (`update.channel`) and aligns the
install method:

- **`stable`/`beta`** (package installs): updates via the matching npm dist-tag.
- **`stable`/`beta`** (git installs): checks out the latest matching git tag.
- **`dev`**: ensures a git checkout (default `~/crawclaw`, override with
  `CRAWCLAW_GIT_DIR`), switches to `main`, rebases on upstream, builds, and
  installs the global CLI from that checkout.

Tip: if you want stable + dev in parallel, keep two clones and point your
gateway at the stable one.

## One-off version or tag targeting

Use `--tag` to target a specific dist-tag, version, or package spec for a single
update **without** changing your persisted channel:

```bash
# Install a specific version
crawclaw update --tag 2026.4.1-beta.1

# Install from the beta dist-tag (one-off, does not persist)
crawclaw update --tag beta

# Install from GitHub main branch (npm tarball)
crawclaw update --tag main

# Install a specific npm package spec
crawclaw update --tag crawclaw@2026.4.1-beta.1
```

Notes:

- `--tag` applies to **package (npm) installs only**. Git installs ignore it.
- The tag is not persisted. Your next `crawclaw update` uses your configured
  channel as usual.
- Downgrade protection: if the target version is older than your current version,
  CrawClaw prompts for confirmation (skip with `--yes`).

## Dry run

Preview what `crawclaw update` would do without making changes:

```bash
crawclaw update --dry-run
crawclaw update --channel beta --dry-run
crawclaw update --tag 2026.4.1-beta.1 --dry-run
crawclaw update --dry-run --json
```

The dry run shows the effective channel, target version, planned actions, and
whether a downgrade confirmation would be required.

## Plugins and channels

When you switch channels with `crawclaw update`, CrawClaw also syncs plugin
sources:

- `dev` prefers bundled plugins from the git checkout.
- `stable` and `beta` restore npm-installed plugin packages.
- npm-installed plugins are updated after the core update completes.

## Checking current status

```bash
crawclaw update status
```

Shows the active channel, install kind (git or package), current version, and
source (config, git tag, git branch, or default).

## Tagging best practices

- Tag releases you want git checkouts to land on (`vYYYY.M.D` for stable,
  `vYYYY.M.D-beta.N` for beta).
- `vYYYY.M.D.beta.N` is also recognized for compatibility, but prefer `-beta.N`.
- Legacy `vYYYY.M.D-<patch>` tags are still recognized as stable (non-beta).
- Keep tags immutable: never move or reuse a tag.
- npm dist-tags remain the source of truth for npm installs:
  - `latest` -> stable
  - `beta` -> candidate build or beta-first stable build
  - `dev` -> main snapshot (optional)
