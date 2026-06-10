---
title: "Open Source Release Checklist"
summary: "准备 CrawClaw public open source release 的 checklist"
read_when:
  - 你正在准备 public repository 或 major open release
  - 你正在审计 release readiness、secrets、metadata 和 docs
x-i18n:
  generated_at: "2026-06-10T12:10:03Z"
  model: codex
  provider: openai
  source_hash: 8cfcc2efbdb2fa7327bc8d1d98f06723abed203f4bd90ef33dc66c055d5b6174
  source_path: reference/open-source-release-checklist.md
  workflow: 15
---

# Open Source Release Checklist

在将 repository 公开或宣布 major open release 之前，使用这份 checklist。

## Repository Surface

- 确认 public repo URL、default branch、description 和 topics。
- 确认 `README.md`、`LICENSE`、`CONTRIBUTING.md` 和 `SECURITY.md` 存在且准确。
- 确认 issue templates 和 PR template 已启用，并指向当前 repo。
- 确认 package metadata（`homepage`、`bugs`、`repository`）匹配 public repo。

## Naming And Branding

- 确认 project name 始终为 `CrawClaw`。
- 确认 public package names 使用预期的 `crawclaw` / `@crawclaw/*` 命名。
- 确认旧 `OpenClaw` / `openclaw` compatibility surfaces 已删除，或已明确文档化。

## Sensitive Data And Generated Artifacts

- 扫描 working tree 中的 secrets、tokens、internal URLs 和 private test data。
- 验证 large local caches、screenshots、logs 和 editor/tooling artifacts 没有被 tracked。
- 验证 `.gitignore` 覆盖 local dependency folders、caches、screenshots 和 tool state。
- 验证仍留在 Git 中的 generated files 都是有意且可复现的。

## Build And Test

- 从 lockfile 做 clean install。
- 验证 workspace installs 不依赖 private 或 SSH-only transitive dependencies。
- 运行 `pnpm build`。
- 运行 release 所需的 fast/unit/integration/E2E lanes。
- 验证 package 可以 global install，且 packaged desktop version check 正常。

## Docs And Onboarding

- 验证 README quick start 能从 clean checkout 运行。
- 验证 install docs 匹配当前 package manager 和 runtime requirements。
- 验证所有 top-level docs links 可解析。
- 验证 migration docs 匹配当前 state/config path conventions。

## Release And Operations

- 确认 release workflows 指向正确 repository 和 package names。
- 确认 changelog 和 version 已准备好用于下一个 public release。
- 确认 GitHub 上已配置 branch protections 和 required checks。
- 确认 maintainers 知道 release 需要 revert 时的 rollback plan。

## Final Verification

- 将 public repo clone 到一个全新目录。
- 确认 repo 不包含 `.serena`、`node_modules`、`dist-runtime` 或其他 local-only state。
- 确认按文档 setup flow 执行后 `git status --short` 是干净的。
- 确认 repo 已准备好让 external contributors 在没有 private context 的情况下参与。
