---
title: "Dependency Maintenance"
summary: "Maintainer workflow for plugin dependency baselines and core skill dependencies"
read_when:
  - You add, remove, rename, publish, or repackage a bundled plugin
  - You change plugin package dependencies or bundled core skill runtime requirements
  - You need to verify Python requirement lockfiles
---

# Dependency Maintenance

The plugin dependency plan is a read-only generated baseline for the dependency
surface owned by bundled plugins and bundled core skill helper runtimes.

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
- bundled core skill Python package pins from
  `skills/.runtime/requirements.lock.txt`
- `openai-whisper` Apple Silicon package pins from
  `skills/openai-whisper/runtime/requirements.macos-arm64.lock.txt`

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
- Bundled plugin development dependencies live in each plugin package and must
  not become published runtime `node_modules` trees.
- Python sidecars and external tools must be owned by Rust/native runtime
  descriptors or explicit user configuration, not install-time TS repair flows.

Do not move plugin-only dependencies into the root package unless core code
imports them directly.

## Python Requirement Policy

The generated plan records locked Python packages from committed requirement
lockfiles. CrawClaw no longer has an install-time managed plugin runtime
installer; runtime launch and sidecar ownership must stay in Rust/native
runtime code or explicit user configuration.

If the Python policy changes, update the owning Rust/native runtime descriptor
and locked requirements first, then run `pnpm plugin-deps:gen`.

## Review Checklist

Before landing plugin dependency changes:

1. Confirm dependency ownership: core dependency, plugin dependency, staged
   runtime dependency, or managed runtime.
2. Run `pnpm plugin-deps:gen` for intentional dependency surface changes.
3. Inspect `docs/.generated/plugin-dependency-plan.json` for unexpected plugin
   count, runtime count, or version-split changes.
4. Run `pnpm plugin-deps:check`.
5. For install/runtime changes, also run the nearest installer or runtime test.
