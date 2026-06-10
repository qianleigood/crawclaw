---
title: "GitHub Workflow Redesign"
summary: "将 monolithic CI workflow 拆分为明确的 GitHub Actions lanes"
x-i18n:
  generated_at: "2026-06-10T12:21:02Z"
  model: codex
  provider: openai
  source_hash: 4f8f5c9386994837d9e6bb65a07db6e79e09b5001ea479454229c8ba1603cd49
  source_path: superpowers/specs/2026-05-26-github-workflow-redesign.md
  workflow: 15
---

# GitHub Workflow Redesign

## Goal

将当前 monolithic CI workflow 拆分成清晰的 GitHub Actions lanes，让 failures 能直接指出 broken gate：PR checks、main landing checks、platform smoke checks、security checks 和 workflow self-checks。

## Current State

Repository 当前把大多数 product validation 放在 `.github/workflows/ci.yml` 中。该文件负责 scope detection、security checks、Linux and Windows matrices、artifact building、docs checks 和 Python skill checks。最近的 `main` runs 显示 `Workflow Sanity` 通过而 `CI` 失败，这意味着 workflow syntax 和 GitHub automation checks 是健康的，但 product CI lanes 过度耦合。

近期 failure modes：

- `security-fast` 在 `pnpm audit --prod --audit-level=high` 上失败。
- Linux `check` 会在 desktop/Tauri contract checks 构建需要 GTK/glib system libraries 的 crates 时失败，因为 default runner image 没有这些 libraries。
- Downstream build 和 platform jobs 在单一 `CI` workflow 下被 skipped 或 canceled，导致从 Actions overview 更难分类 failed gate。

## Recommended Architecture

第一轮 redesign 不处理 release 和 triage workflows。第一轮应聚焦 CI responsibility boundaries：

- `Workflow Sanity`: 验证 workflow files 和 repository automation rules。
- `CI PR`: fast pull request checks。跳过 draft PRs。基于 changed paths 运行 docs、Rust core、local repo checks 和 Python skill checks。
- `CI Main`: `main` pushes 的完整 landing checks。运行 local profile、Rust tests、package build 和 packaged artifact smoke checks。
- `CI Platform`: platform-specific smoke checks，将 Windows 与 main Linux gate 隔离。
- `Security`: secrets、workflow hardening audit 和 production dependency audit。保持 workflow hardening failures blocking。将 dependency audit 与 product build failures 分开，这样 maintainers 可以看到 security debt，而不会误判为 compiler 或 test failure。

## Implementation Boundaries

- 本轮不编辑 release publish workflows。
- 不编辑 `CODEOWNERS`。
- 保留有用的 existing composite actions。
- 只有当 duplication 明显时，才添加 narrowly needed composite setup helpers。
- 更新 `docs/ci.md`，使其匹配新的 workflow graph 和 local commands。
- 保留 Node 24 和 pnpm 10 behavior。

## Success Criteria

- GitHub Actions failures 按 workflow purpose 分组：
  `Workflow Sanity`、`CI PR`、`CI Main`、`CI Platform` 或 `Security`。
- 旧 `CI` monolith 不再负责所有 product、platform 和 security checks。
- Linux product checks 在运行 desktop contract checks 前，安装 desktop system dependencies needed by Tauri/GTK-related crates。
- Workflow sanity check 可以在本地或 GitHub Actions 中验证新的 workflow files。
- 文档解释每个 workflow 拥有哪个 gate，以及对应哪个 local command。
