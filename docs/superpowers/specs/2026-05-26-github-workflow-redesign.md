# GitHub Workflow Redesign

## Goal

Split the current monolithic CI workflow into clear GitHub Actions lanes so
failures identify the broken gate directly: PR checks, main landing checks,
platform smoke checks, security checks, and workflow self-checks.

## Current State

The repository currently keeps most product validation in
`.github/workflows/ci.yml`. That file owns scope detection, security checks,
Linux and Windows matrices, artifact building, docs checks, and Python skill
checks. Recent `main` runs show `Workflow Sanity` passing while `CI` fails,
which means the workflow syntax and GitHub automation checks are healthy but
the product CI lanes are too tightly coupled.

Recent failure modes:

- `security-fast` fails on `pnpm audit --prod --audit-level=high`.
- Linux `check` fails when desktop/Tauri contract checks build crates that need
  GTK/glib system libraries not present on the default runner image.
- Downstream build and platform jobs are skipped or canceled under the single
  `CI` workflow, making the failed gate harder to classify from the Actions
  overview.

## Recommended Architecture

Keep release and triage workflows out of the first redesign pass. The first
pass should focus on CI responsibility boundaries:

- `Workflow Sanity`: validate workflow files and repository automation rules.
- `CI PR`: fast pull request checks. Skip draft PRs. Run docs, Rust core,
  local repo checks, and Python skill checks based on changed paths.
- `CI Main`: complete landing checks for `main` pushes. Run the local profile,
  Rust tests, package build, and packaged artifact smoke checks.
- `CI Platform`: platform-specific smoke checks, with Windows isolated from the
  main Linux gate.
- `Security`: secrets, workflow hardening audit, and production dependency
  audit. Keep workflow hardening failures blocking. Keep dependency audit
  separate from product build failures so maintainers can see security debt
  without misclassifying it as a compiler or test failure.

## Implementation Boundaries

- Do not edit release publish workflows in this pass.
- Do not edit `CODEOWNERS`.
- Keep existing composite actions where useful.
- Add only narrowly needed composite setup helpers if duplication becomes
  significant.
- Update `docs/ci.md` so it matches the new workflow graph and local commands.
- Preserve Node 24 and pnpm 10 behavior.

## Success Criteria

- GitHub Actions failures are grouped by workflow purpose:
  `Workflow Sanity`, `CI PR`, `CI Main`, `CI Platform`, or `Security`.
- The old `CI` monolith no longer owns all product, platform, and security
  checks.
- Linux product checks install the desktop system dependencies needed by
  Tauri/GTK-related crates before running desktop contract checks.
- The workflow sanity check can validate the new workflow files locally or in
  GitHub Actions.
- Documentation explains which workflow owns each gate and which local command
  corresponds to it.
