# GitHub Workflow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the current monolithic GitHub Actions CI into purpose-specific workflows for PR checks, main landing checks, platform smoke, security, and workflow sanity.

**Architecture:** Keep existing release and triage workflows intact. Replace `.github/workflows/ci.yml` with smaller workflows that share existing composite setup actions and one new Linux desktop dependency setup action. Keep workflow names explicit because branch protection currently has no required status check list.

**Tech Stack:** GitHub Actions YAML, existing composite actions under `.github/actions`, Node 24, pnpm 10, Rust `crawclaw-repo-tools`, actionlint.

---

### Task 1: Add Linux Desktop Dependency Setup

**Files:**

- Create: `.github/actions/setup-linux-desktop-deps/action.yml`

- [ ] **Step 1: Add the composite action**

Create `.github/actions/setup-linux-desktop-deps/action.yml` with a single shell step:

```yaml
name: Setup Linux desktop dependencies
description: Install Ubuntu packages required by Tauri/GTK desktop crates.
runs:
  using: composite
  steps:
    - name: Install desktop system packages
      shell: bash
      run: |
        set -euo pipefail
        sudo apt-get update
        sudo apt-get install -y --no-install-recommends \
          libayatana-appindicator3-dev \
          libglib2.0-dev \
          libgtk-3-dev \
          librsvg2-dev \
          libsoup-3.0-dev \
          libwebkit2gtk-4.1-dev \
          pkg-config
```

- [ ] **Step 2: Verify action shape**

Run: `actionlint .github/actions/setup-linux-desktop-deps/action.yml`

Expected: exit code 0.

### Task 2: Split PR and Main CI

**Files:**

- Delete: `.github/workflows/ci.yml`
- Create: `.github/workflows/ci-pr.yml`
- Create: `.github/workflows/ci-main.yml`

- [ ] **Step 1: Create `CI PR`**

Create `.github/workflows/ci-pr.yml` with PR-only trigger, draft skip, scope detection, and these jobs:

- `scope`: emits `docs_changed`, `docs_only`, `run_product`, `run_desktop`, `run_skills_python`.
- `check`: runs `cargo run -q -p crawclaw-repo-tools -- check --profile local` when product files changed.
- `rust-core`: runs `cargo run -q -p crawclaw-repo-tools -- check --profile rust-core` when product files changed.
- `desktop-contract`: installs Linux desktop dependencies and runs `pnpm desktop:contract:check` when desktop or workflow setup files changed.
- `docs`: runs `cargo run -q -p crawclaw-repo-tools -- check --profile docs-core` when docs changed.
- `skills-python`: runs Python lint/tests when `skills/**`, `pyproject.toml`, or this workflow changed.

- [ ] **Step 2: Create `CI Main`**

Create `.github/workflows/ci-main.yml` with push-to-main and workflow dispatch triggers. Jobs:

- `check`: installs Node deps and Linux desktop deps, runs `cargo run -q -p crawclaw-repo-tools -- check --profile local`.
- `rust-core`: runs `cargo run -q -p crawclaw-repo-tools -- check --profile rust-core`.
- `build`: depends on `check`, installs Node deps and Linux desktop deps, runs `cargo run --quiet --release -p crawclaw-repo-tools -- build --profile package`, uploads `dist/`.
- `build-smoke`: depends on `build`, downloads `dist/`, verifies native runtime artifacts.
- `docs`: runs docs-core when docs changed.
- `skills-python`: runs Python lint/tests on main.

- [ ] **Step 3: Remove old `CI`**

Delete `.github/workflows/ci.yml` after the replacement workflows exist.

### Task 3: Split Platform and Security Workflows

**Files:**

- Create: `.github/workflows/ci-platform.yml`
- Create: `.github/workflows/security.yml`

- [ ] **Step 1: Create `CI Platform`**

Create `.github/workflows/ci-platform.yml` with PR, push-to-main, and workflow dispatch triggers. Use a scope job so PRs run only for platform-relevant paths. Add:

- `linux-package`: Ubuntu package build with Linux desktop dependencies.
- `windows-rust-core`: Windows Rust core profile.
- `windows-package`: Windows package build profile.

- [ ] **Step 2: Create `Security`**

Create `.github/workflows/security.yml` with PR, push-to-main, schedule, and workflow dispatch triggers. Add:

- `secret-scan`: trusted pre-commit `detect-private-key`.
- `workflow-audit`: changed workflow `zizmor` audit.
- `dependency-audit`: `pnpm audit --prod --audit-level=high`.

Keep these failures separate from product CI failures.

### Task 4: Update CI Documentation

**Files:**

- Modify: `docs/ci.md`

- [ ] **Step 1: Rewrite the job overview**

Describe the new workflow-level ownership:

- `Workflow Sanity`
- `CI PR`
- `CI Main`
- `CI Platform`
- `Security`

- [ ] **Step 2: Update local equivalents**

Keep the commands grounded in existing scripts:

```bash
pnpm check
pnpm test
pnpm build
pnpm check:docs
pnpm desktop:contract:check
```

### Task 5: Verify Workflow Redesign

**Files:**

- Validate all changed workflow/action/docs files.

- [ ] **Step 1: Run workflow syntax validation**

Run: `actionlint`

Expected: exit code 0.

- [ ] **Step 2: Run conflict marker guard**

Run: `cargo run -q -p crawclaw-repo-tools -- repo-check-no-conflict-markers --root .`

Expected: exit code 0.

- [ ] **Step 3: Run docs check for touched docs**

Run: `pnpm check:docs`

Expected: exit code 0, unless it fails on pre-existing unrelated docs state. If it fails, report the first actionable error.
