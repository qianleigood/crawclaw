---
title: CI Pipeline
summary: "GitHub Actions lanes, scope gates, and local command equivalents"
read_when:
  - You need to understand which GitHub Actions workflow owns a gate
  - You are debugging failing GitHub Actions checks
---

# CI Pipeline

The GitHub Actions setup is split by responsibility. Each workflow owns one
class of signal so failures are easier to classify from the Actions overview.

## Workflow Overview

| Workflow          | Purpose                                                                | When it runs                                      |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| `Workflow Sanity` | Validate workflow files, composite action safety, and conflict markers | Pull requests, pushes to `main`, manual dispatch  |
| `CI PR`           | Fast pull request product checks with path-based scope detection       | Non-draft pull requests                           |
| `CI Main`         | Full landing gate for `main`: check, Rust core, build, and smoke       | Pushes to `main`, manual dispatch                 |
| `CI Platform`     | Platform-specific package and Windows smoke checks                     | Pull requests, pushes to `main`, manual dispatch  |
| `Security`        | Secret scan, workflow hardening audit, and production dependency audit | Pull requests, pushes to `main`, schedule, manual |

Release and triage automation remains separate:

- `CrawClaw NPM Release` publishes the root package through the gated release flow.
- `Plugin NPM Release` previews and publishes bundled plugin packages.
- `Labeler`, `Auto response`, and `Stale` manage repository triage.
- `CodeQL` remains manually dispatched.

## Product Gates

`CI PR` is the fast feedback path. Its `scope` job compares the pull request
against the base commit and skips unrelated lanes:

- `check` runs the local repo profile for product changes.
- `rust-core` runs the Rust core profile for product changes.
- `desktop-contract` runs only for desktop or CI setup changes.
- `docs` runs only when docs changed.
- `skills-python` runs only when Python skill files or related config changed.

`CI Main` is the landing gate for `main`. It intentionally runs the full product
bar even when a narrower PR gate already passed:

- `check` runs the local profile.
- `rust-core` runs the Rust core profile.
- `build` creates package artifacts and uploads `dist/`.
- `build-smoke` verifies the expected native runtime binaries in `dist/`.
- `docs` runs when docs changed.
- `skills-python` runs on every `main` push.

Linux product checks install the desktop system packages needed by Tauri/GTK
crates before running desktop contract or package-build work.

## Platform Gates

`CI Platform` isolates platform-specific failures from the core product gate:

- `linux-package` verifies the package build on Ubuntu.
- `windows-rust-core` verifies the Rust core profile on Windows.
- `windows-package` verifies package build behavior on Windows.

Pull requests use scope detection so docs-only changes do not run platform
smoke. Pushes to `main` and manual dispatches can run the complete platform bar.

## Security Gates

`Security` keeps security signals separate from compiler, lint, and package
signals:

- `secret-scan` runs the trusted pre-commit `detect-private-key` hook.
- `workflow-audit` runs `zizmor` for changed workflow files, or all workflow
  files on manual and scheduled runs.
- `dependency-audit` runs `pnpm audit --prod --audit-level=high`.

On pull requests, pre-commit based security jobs use the base branch
`.pre-commit-config.yaml` so untrusted pull request changes cannot weaken the
security hooks being run.

## Workflow Sanity

`Workflow Sanity` validates GitHub automation itself:

- tabs are rejected in workflow files;
- `actionlint` validates workflow syntax;
- composite actions cannot interpolate raw inputs directly in shell blocks;
- tracked merge conflict markers are rejected.

Keep this workflow small. Product, platform, and dependency checks belong in the
purpose-specific workflows above.

## Local Equivalents

```bash
pnpm check
pnpm test
pnpm build
pnpm check:docs
pnpm desktop:contract:check
```

For direct repo-tools profiles:

```bash
cargo run -q -p crawclaw-repo-tools -- check --profile local
cargo run -q -p crawclaw-repo-tools -- check --profile rust-core
cargo run -q -p crawclaw-repo-tools -- check --profile docs-core
cargo run --quiet --release -p crawclaw-repo-tools -- build --profile package
```
