---
title: "Plugin Dependency Maintenance"
summary: "Maintainer workflow for plugin dependency baselines and install-time runtime setup"
read_when:
  - You add, remove, rename, publish, or repackage a bundled plugin
  - You change plugin package dependencies, staged runtime dependencies, or managed plugin runtimes
  - You need to verify Python runtime requirements for plugin install setup
---

# Plugin Dependency Maintenance

The plugin dependency plan is a read-only generated baseline for the dependency
surface owned by bundled plugins and managed plugin runtimes.

It is generated from source metadata. It does not install packages, activate
plugins, import plugin runtime code, or modify runtime state.

## What It Covers

`pnpm plugin-deps:gen` writes:

- `docs/.generated/plugin-dependency-plan.json`
- `docs/.generated/plugin-dependency-plan.jsonl`

The plan covers:

- root package dependency sections and Node engine policy from `package.json`
- pnpm workspace package patterns and build-script allowlists from
  `pnpm-workspace.yaml`
- tracked bundled plugin manifests under `extensions/*/crawclaw.plugin.json`
- each tracked bundled plugin `package.json` dependency section
- released plugin `crawclaw.install.npmSpec` metadata
- `crawclaw.bundle.stageRuntimeDependencies` metadata
- install-time managed runtimes from `scripts/install-plugin-runtimes.mjs`
- `scrapling-fetch` Python package pins from
  `extensions/scrapling-fetch/runtime/requirements.lock.txt`

The scanner prefers `git ls-files` for plugin manifests. Local untracked plugin
experiments do not enter the committed baseline.

## Commands

Use the generator when an intentional dependency surface change lands:

```bash
pnpm plugin-deps:gen
```

Use the check in CI or local review:

```bash
pnpm plugin-deps:check
```

The check compares the generated content against the committed JSON and JSONL
artifacts. A failure means either the dependency metadata changed intentionally
and the baseline needs regeneration, or the dependency change should be reverted
or corrected.

## Install Layers

Treat plugin dependency setup as four separate layers:

- Core runtime dependencies live in the root `package.json`.
- Bundled plugin JavaScript dependencies live in each plugin package.
- Staged bundled plugin dependencies are explicitly marked by
  `crawclaw.bundle.stageRuntimeDependencies`.
- Managed plugin runtimes are prepared by `scripts/install-plugin-runtimes.mjs`
  during install or repair flows.

Do not move plugin-only dependencies into the root package unless core code
imports them directly.

## Python Runtime Policy

Python is currently a managed runtime concern for `scrapling-fetch`.

The generated plan records the policy from `scripts/install-plugin-runtimes.mjs`:

- minimum Python version: `>=3.10`
- override environment variables:
  `CRAWCLAW_RUNTIME_PYTHON` and `CRAWCLAW_SCRAPLING_PYTHON`
- interpreter candidates discovered by the installer
- Windows-only extra package pins such as `msvc-runtime`
- locked Python packages from
  `extensions/scrapling-fetch/runtime/requirements.lock.txt`

If the Python policy changes, update the installer and locked requirements first,
then run `pnpm plugin-deps:gen`.

## Review Checklist

Before landing plugin dependency changes:

1. Confirm dependency ownership: core dependency, plugin dependency, staged
   runtime dependency, or managed runtime.
2. Run `pnpm plugin-deps:gen` for intentional dependency surface changes.
3. Inspect `docs/.generated/plugin-dependency-plan.json` for unexpected plugin
   count, runtime count, or version-split changes.
4. Run `pnpm plugin-deps:check`.
5. For install/runtime changes, also run the nearest installer or runtime test.
