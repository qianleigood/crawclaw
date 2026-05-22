---
read_when:
  - 在本地或 CI 中运行测试
  - 为原生运行时或 Desktop 行为添加回归测试
  - 调试 gateway 网关 + 智能体行为
summary: 测试工具包：原生 Rust 工作区检查和本地门控命令
title: 测试
x-i18n:
  generated_at: "2026-05-22T04:21:00Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: d47bfc6993912643c53a166653f4c756fbb8566a46ed7cdd16d59fbabd64a5ee
  source_path: help/testing.md
  workflow: 15
---

# 测试

CrawClaw 正在将 Desktop 应用和原生运行时收敛为产品边界。默认测试门控现在是 Rust 工作区测试套件。Node/npm 仍然作为 Desktop 渲染器、托管文档检查和 npm 打包的工具适配器可用。

## 快速开始

日常使用：

- 完整本地门控：`pnpm build && pnpm check && pnpm test`
- 仅测试门控：`pnpm test`
- 针对 crate 调试：`cargo test -p crawclaw-runtime <filter>`

`pnpm check` 和 `pnpm build` 是 `crawclaw-repo-tools check --profile local` 和 `crawclaw-repo-tools build --profile package` 的兼容别名。`pnpm test` 运行 `crawclaw-repo-tools test-workspace`，它委托给 `cargo test --workspace -- --test-threads=1`，并使用更大的默认 Rust 栈。并行默认值是有意的，因为多个 Desktop 和原生运行时测试使用共享的本地资源。

## 当前测试命令

- `pnpm test`：Rust 工作区测试。
- `pnpm test:all`：`pnpm check && pnpm build && pnpm test`。
- `cargo run -q -p crawclaw-repo-tools -- check --profile rust-core`：Rust guardrails 加工作区测试，供 Rust CI 通道使用。
- `cargo run -q -p crawclaw-repo-tools -- check --profile desktop-renderer`：通过 Node/npm 适配器进行 Desktop 渲染器构建。
- `cargo run -q -p crawclaw-repo-tools -- check --profile docs-core`：文档词汇表、内部链接、生成的基线和文档列表。
- `cargo run -q -p crawclaw-repo-tools -- check --profile docs-hosted`：托管/Mintlify 特定文档锚点检查。

之前的 TypeScript 测试运行器和 Vitest 规划器脚本已被移除。除非项目明确重新开放该层面，否则不要添加新的 TypeScript 测试套件。

## Rust 测试套件覆盖范围

- 原生 gateway 网关 guardrails 和协议边界。
- 运行时打包和包构建清理检查。
- Desktop/原生运行时集成测试，由 Rust crate 拥有。
- 仓库级 guardrails，确保已移除的 TypeScript 测试和 Node gateway 网关层面不会回归。

## 本地 PR 门控

对于本地 PR 合并/门控检查，运行：

- `pnpm check`
- `pnpm build`
- `pnpm test`
- `pnpm check:docs`

如果 `pnpm test` 在负载较高的主机上不稳定，请先重新运行一次再将其视为回归问题。如果仍然失败，使用 Cargo 隔离所属 crate：

```bash
cargo test -p crawclaw-runtime <filter>
```

将针对性测试保留在拥有该行为的 Rust crate 附近。对于 Desktop 渲染器流程，覆盖公共原生边界，而不是添加独立的 TS 测试工具。
