---
read_when:
  - 你需要了解哪个 GitHub Actions 工作流负责哪个门控
  - 你在调试 GitHub Actions 检查失败的问题
summary: GitHub Actions 流水线、范围门控及本地命令对照
title: CI 流水线
x-i18n:
  generated_at: "2026-06-05T14:11:35Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: ebbe93f157f46a036a77b98855c90ef41cd31819da9a3dd00d7db33ca00be259
  source_path: ci.md
  workflow: 15
---

# CI 流水线

GitHub Actions 配置按职责划分。每个工作流负责一类信号，使得从 Actions 概览中更容易分类失败原因。

## 工作流概览

| 工作流            | 用途                                               | 运行时机                                 |
| ----------------- | -------------------------------------------------- | ---------------------------------------- |
| `Workflow Sanity` | 验证工作流文件、组合 action 安全性和冲突标记       | Pull requests、推送到 `main`、手动触发   |
| `CI PR`           | 基于路径范围检测的快速 pull request 产品检查       | 非草稿 pull requests                     |
| `CI Main`         | `main` 的完整落地门控：检查、Rust core、构建和冒烟 | 推送到 `main`、手动触发                  |
| `CI Platform`     | 平台特定包和 Windows 冒烟检查                      | Pull requests、推送到 `main`、手动触发   |
| `Security`        | 密钥扫描、工作流加固审计和生产依赖审计             | Pull requests、推送到 `main`、定时、手动 |

发布和分类自动化保持独立：

- `CrawClaw NPM Release` 通过门控发布流程发布根包。
- `Plugin NPM Release` 预览并发布捆绑的插件包。
- `Labeler`、`Auto response` 和 `Stale` 管理仓库分类。
- `CodeQL` 仍为手动触发。

## 产品门控

`CI PR` 是快速反馈路径。其 `scope` job 将 pull request 与基础提交进行比较，并跳过不相关的流水线：

- `check` 对产品变更运行本地 repo profile。
- `rust-core` 对产品变更运行 Rust core profile。
- `desktop-contract` 仅在 desktop 或 CI 设置变更时运行。
- `docs` 仅在文档变更时运行。
- `skills-python` 仅在 Python skill 文件或相关配置变更时运行。

`CI Main` 是 `main` 的落地门控。即使较窄的 PR 门控已通过，它也会故意运行完整的产品检查栏：

- `check` 运行本地 profile。
- `rust-core` 运行 Rust core profile。
- `build` 创建包制品并上传 `dist/`。
- `build-smoke` 验证 `dist/` 中预期的原生运行时二进制文件。
- `docs` 在文档变更时运行。
- `skills-python` 在每次 `main` 推送时运行。

Linux 产品检查在运行 desktop contract 或包构建工作之前，会安装 Tauri/GTK crate 所需的 desktop 系统包。

## 平台门控

`CI Platform` 将平台特定失败与核心产品门控隔离：

- `linux-package` 在 Ubuntu 上验证包构建。
- `windows-rust-core` 在 Windows 上验证 Rust core profile。
- `windows-package` 在 Windows 上验证包构建行为。

Pull requests 使用范围检测，因此仅文档变更不会运行平台冒烟。推送到 `main` 和手动触发可以运行完整的平台检查栏。

## 安全门控

`Security` 将安全信号与编译器、代码检查和包信号分离：

- `secret-scan` 运行受信任的 pre-commit `detect-private-key` hook。
- `workflow-audit` 对变更的工作流文件运行 `zizmor`，手动和定时运行则检查所有工作流文件。
- `dependency-audit` 运行 `pnpm audit --prod --audit-level=high`。

对于 pull requests，基于 pre-commit 的安全 job 使用基础分支的 `.pre-commit-config.yaml`，以确保不受信任的 pull request 变更无法削弱正在运行的安全 hook。

## 工作流完整性

`Workflow Sanity` 验证 GitHub 自动化本身：

- 工作流文件中拒绝使用 tabs；
- `actionlint` 验证工作流语法；
- 组合 actions 不能直接在 shell 块中插值原始 inputs；
- 拒绝跟踪的合并冲突标记。

保持此工作流小巧。产品、平台和依赖检查应放在上述特定用途的工作流中。

## 本地命令对照

```bash
pnpm check
pnpm test
pnpm build
pnpm check:docs
pnpm desktop:contract:check
```

对于直接的 repo-tools profiles：

```bash
cargo run -q -p crawclaw-repo-tools -- check --profile local
cargo run -q -p crawclaw-repo-tools -- check --profile rust-core
cargo run -q -p crawclaw-repo-tools -- check --profile docs-core
cargo run --quiet --release -p crawclaw-repo-tools -- build --profile package
```
