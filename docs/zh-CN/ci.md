---
read_when:
  - 你需要了解 CI 作业未运行或已运行的原因
  - 你正在调试 GitHub Actions 检查失败问题
summary: CI 作业图、范围门控和本地命令对照
title: CI 流水线
x-i18n:
  generated_at: "2026-05-22T04:20:26Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: dd81fac8607b9ece83530eddbee667706a1d733f0a9d6cf5ed18c16d668cd5df
  source_path: ci.md
  workflow: 15
---

# CI 流水线

CI 在每次推送到 `main` 和每次拉取请求时运行。它使用智能范围来确定仅在不相关区域发生变化时跳过昂贵的作业。

## 作业概览

| 作业              | 用途                                                              | 运行条件                                     |
| ----------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| `preflight`       | Docs 范围、变更范围、密钥扫描、工作流审计、prod 依赖审计          | 始终运行；非文档变更时仅运行基于 Node 的审计 |
| `docs-scope`      | 检测仅文档变更                                                    | 始终运行                                     |
| `changed-scope`   | 检测哪些区域发生变化（node/macos/android/windows）                | 非文档变更                                   |
| `check`           | Repo-tools 本地 profile：desktop 协议、TypeScript、lint、边界检查 | 非文档、Node 变更                            |
| `check-docs`      | Repo-tools docs-core profile：词汇表、链接、生成的文档基线        | 文档变更                                     |
| `secrets`         | 检测泄露的密钥                                                    | 始终运行                                     |
| `build-artifacts` | 构建 dist 一次，与 `release-check` 共享                           | 推送到 `main`、Node 变更                     |
| `release-check`   | 验证 npm 包内容                                                   | 推送到 `main` 后构建                         |
| `checks`          | PR 上运行 Rust 核心 profile；推送时运行包构建 profile             | 非文档、Node/包变更                          |
| `checks-windows`  | Windows Rust 核心和包构建 profile                                 | 非文档、windows 相关变更                     |
| `macos`           | Swift lint/构建/测试                                              | 带 macos 变更的 PR                           |
| `android`         | Gradle 构建 + 测试                                                | 非文档、android 变更                         |

## 快速失败顺序

作业按成本排序，确保便宜的检查先运行，昂贵的检查在最后运行：

1. `docs-scope` + `changed-scope` + `check` + `secrets`（并行，先运行便宜的 gate）
2. PR：`checks`（Rust 工作区测试）、`checks-windows`、`macos`、`android`
3. 推送到 `main`：`build-artifacts` + `release-check` + 包构建兼容性

范围逻辑位于 `.github/workflows/ci.yml` 的 `preflight` 作业中；修改范围行为时需通过工作流审计和受影响的 CI 通道保持验证。

Node 设置仅限于需要 Node/npm 适配器的通道，如 desktop renderer 检查、包/发布验证和托管文档工具。Rust core 和 docs-core 通道直接使用 `crawclaw-repo-tools`。

## 运行器

| 运行器                           | 作业                            |
| -------------------------------- | ------------------------------- |
| `blacksmith-16vcpu-ubuntu-2404`  | 大多数 Linux 作业，包括范围检测 |
| `blacksmith-32vcpu-windows-2025` | `checks-windows`                |
| `macos-latest`                   | `macos`、`ios`                  |

## 本地等效命令

```bash
cargo run -q -p crawclaw-repo-tools -- check --profile local
cargo run -q -p crawclaw-repo-tools -- check --profile rust-core
cargo run -q -p crawclaw-repo-tools -- check --profile docs-core
cargo run --quiet -p crawclaw-repo-tools -- release-check
```

对应的 pnpm 别名仍然可用：`pnpm check`、`pnpm test`、`pnpm check:docs` 和 `pnpm release:check`。
