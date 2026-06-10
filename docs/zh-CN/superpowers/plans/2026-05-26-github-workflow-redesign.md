---
title: "GitHub Workflow Redesign Implementation Plan"
summary: "将 monolithic GitHub Actions CI 拆分为面向 PR、main、platform、security 和 workflow sanity 的专用 workflow"
x-i18n:
  generated_at: "2026-06-10T12:26:38Z"
  model: codex
  provider: openai
  source_hash: 51433a9a2c01fdadb529424a9f7f7d16768446515daa49ede6614f24a63737db
  source_path: superpowers/plans/2026-05-26-github-workflow-redesign.md
  workflow: 15
---

# GitHub Workflow Redesign Implementation Plan

> **面向 agentic workers：** REQUIRED SUB-SKILL：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐项实施这个计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**Goal:** 将当前 monolithic GitHub Actions CI 拆分为面向 PR checks、main landing checks、platform smoke、security 和 workflow sanity 的专用 workflows。

**Architecture:** 保持现有 release 和 triage workflows 不变。用更小的 workflows 替换 `.github/workflows/ci.yml`，共享现有 composite setup actions，并新增一个 Linux desktop dependency setup action。Workflow 名称保持明确，因为 branch protection 当前没有 required status check list。

**Tech Stack:** GitHub Actions YAML、`.github/actions` 下的现有 composite actions、Node 24、pnpm 10、Rust `crawclaw-repo-tools`、actionlint。

---

### Task 1: Add Linux Desktop Dependency Setup

**Files:**

- Create: `.github/actions/setup-linux-desktop-deps/action.yml`

- [ ] **Step 1: Add the composite action**

创建 `.github/actions/setup-linux-desktop-deps/action.yml`，包含一个 shell step：

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

运行：`actionlint .github/actions/setup-linux-desktop-deps/action.yml`

Expected: exit code 0。

### Task 2: Split PR and Main CI

**Files:**

- Delete: `.github/workflows/ci.yml`
- Create: `.github/workflows/ci-pr.yml`
- Create: `.github/workflows/ci-main.yml`

- [ ] **Step 1: Create `CI PR`**

创建 `.github/workflows/ci-pr.yml`，包含 PR-only trigger、draft skip、scope detection，以及这些 jobs：

- `scope`: 输出 `docs_changed`、`docs_only`、`run_product`、`run_desktop`、`run_skills_python`。
- `check`: product files 变化时运行 `cargo run -q -p crawclaw-repo-tools -- check --profile local`。
- `rust-core`: product files 变化时运行 `cargo run -q -p crawclaw-repo-tools -- check --profile rust-core`。
- `desktop-contract`: desktop 或 workflow setup files 变化时安装 Linux desktop dependencies 并运行 `pnpm desktop:contract:check`。
- `docs`: docs 变化时运行 `cargo run -q -p crawclaw-repo-tools -- check --profile docs-core`。
- `skills-python`: 当 `skills/**`、`pyproject.toml` 或本 workflow 变化时运行 Python lint/tests。

- [ ] **Step 2: Create `CI Main`**

创建 `.github/workflows/ci-main.yml`，包含 push-to-main 和 workflow dispatch triggers。Jobs：

- `check`: 安装 Node deps 和 Linux desktop deps，运行 `cargo run -q -p crawclaw-repo-tools -- check --profile local`。
- `rust-core`: 运行 `cargo run -q -p crawclaw-repo-tools -- check --profile rust-core`。
- `build`: 依赖 `check`，安装 Node deps 和 Linux desktop deps，运行 `cargo run --quiet --release -p crawclaw-repo-tools -- build --profile package`，上传 `dist/`。
- `build-smoke`: 依赖 `build`，下载 `dist/`，验证 native runtime artifacts。
- `docs`: docs 变化时运行 docs-core。
- `skills-python`: 在 main 上运行 Python lint/tests。

- [ ] **Step 3: Remove old `CI`**

Replacement workflows 存在后，删除 `.github/workflows/ci.yml`。

### Task 3: Split Platform and Security Workflows

**Files:**

- Create: `.github/workflows/ci-platform.yml`
- Create: `.github/workflows/security.yml`

- [ ] **Step 1: Create `CI Platform`**

创建 `.github/workflows/ci-platform.yml`，包含 PR、push-to-main 和 workflow dispatch triggers。使用 scope job，让 PR 只针对 platform-relevant paths 运行。添加：

- `linux-package`: 带 Linux desktop dependencies 的 Ubuntu package build。
- `windows-rust-core`: Windows Rust core profile。
- `windows-package`: Windows package build profile。

- [ ] **Step 2: Create `Security`**

创建 `.github/workflows/security.yml`，包含 PR、push-to-main、schedule 和 workflow dispatch triggers。添加：

- `secret-scan`: trusted pre-commit `detect-private-key`。
- `workflow-audit`: changed workflow `zizmor` audit。
- `dependency-audit`: `pnpm audit --prod --audit-level=high`。

将这些 failures 与 product CI failures 分开。

### Task 4: Update CI Documentation

**Files:**

- Modify: `docs/ci.md`

- [ ] **Step 1: Rewrite the job overview**

描述新的 workflow-level ownership：

- `Workflow Sanity`
- `CI PR`
- `CI Main`
- `CI Platform`
- `Security`

- [ ] **Step 2: Update local equivalents**

保持命令基于现有 scripts：

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

运行：`actionlint`

Expected: exit code 0。

- [ ] **Step 2: Run conflict marker guard**

运行：`cargo run -q -p crawclaw-repo-tools -- repo-check-no-conflict-markers --root .`

Expected: exit code 0。

- [ ] **Step 3: Run docs check for touched docs**

运行：`pnpm check:docs`

Expected: exit code 0，除非它因为 pre-existing unrelated docs state 失败。如果失败，报告第一个 actionable error。
