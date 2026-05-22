---
read_when:
  - 运行或修复测试
summary: 如何本地运行原生 Rust 测试门控
title: 测试
x-i18n:
  generated_at: "2026-05-22T04:22:06Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: b489ab147a8bdda48aa94a1f7285507affbf5a53012a48ba0ea0d678ee96728f
  source_path: reference/test.md
  workflow: 15
---

# 测试

- 完整测试工具包：[测试](/help/testing)

- `pnpm test`：通过 `crawclaw-repo-tools test-workspace` 运行 Rust 工作区测试。
- `cargo run -q -p crawclaw-repo-tools -- check --profile rust-core`：Rust guardrails 加工作区测试。
- `cargo run -q -p crawclaw-repo-tools -- check --profile local`：本地 desktop 协议、TypeScript、lint 和边界检查。
- Rust 运行器设置保守的栈大小和串行 Rust 测试线程，以便 Desktop 和原生运行时集成测试不会竞争共享本地资源。
- 对于针对性调试，直接运行 Cargo，例如 `cargo test -p crawclaw-runtime <filter>`。

## 本地 PR 门控

对于本地 PR 合并/门控检查，运行：

- `pnpm check`
- `pnpm build`
- `pnpm test`
- `pnpm check:docs`

如果 `pnpm test` 在负载较高的主机上不稳定，请先重新运行一次再将其视为回归问题，然后使用 `cargo test -p <crate> <filter>` 隔离所属 crate。
