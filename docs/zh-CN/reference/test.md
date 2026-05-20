---
summary: "如何在本地运行原生 Rust test gate"
read_when:
  - 运行或修复 tests
title: "Tests"
---

# Tests

- 完整测试套件：[Testing](/help/testing)

- `pnpm test`：通过 `crawclaw-runtime test-workspace` 运行 Rust workspace tests。
- Rust runner 会设置保守的 stack size，并串行化 Rust test threads，避免 desktop
  和 native runtime integration tests 争用共享本地资源。
- 聚焦调试时，直接运行 Cargo，例如 `cargo test -p crawclaw-runtime <filter>`。

## Local PR gate

本地 PR land/gate 检查运行：

- `pnpm check`
- `pnpm build`
- `pnpm test`
- `pnpm check:docs`

如果 `pnpm test` 在高负载主机上 flaky，先重跑一次再判定为回归。如果仍然失败，
用 `cargo test -p <crate> <filter>` 隔离 owning crate。
