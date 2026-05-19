---
read_when:
  - 在本地或 CI 中运行测试
  - 为原生运行时或桌面行为添加回归测试
  - 调试 Gateway 网关 + 智能体行为
summary: 测试套件：原生 Rust 工作区检查和本地 gate 命令
title: 测试
x-i18n:
  generated_at: "2026-05-19T00:50:38Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: e23e629393f81d2a24b8b0aad2d34c2c053c86b2a971d18b2a4918f400b0dad1
  source_path: help/testing.md
  workflow: 15
---

# 测试

CrawClaw 正在将桌面应用和原生运行时确定为核心产品边界。默认测试 gate 现在是 Rust 工作区测试套件。

## 快速开始

大多数情况下：

- 完整本地 gate： `pnpm build && pnpm check && pnpm test`
- 仅测试 gate： `pnpm test`
- 聚焦 crate 调试： `cargo test -p crawclaw-runtime <filter>`

`pnpm test` 运行 `scripts/run-rust-tests.mjs`，它委托至 `cargo test --workspace -- --test-threads=1`，并使用更大的默认 Rust stack。串行执行是故意设为默认的，因为多个桌面和原生运行时测试使用共享的本地资源。

## 当前测试命令

- `pnpm test`: Rust 工作区测试。
- `pnpm test:all`: `pnpm lint && pnpm build && pnpm test`.

之前的 TypeScript 测试运行器和 Vitest 规划脚本已被移除。不要添加新的 TypeScript 测试套件，除非项目明确重新开放该领域。

## Rust 测试套件覆盖范围

- 原生 Gateway 网关护栏和协议边界。
- 运行时打包和包构建清理检查。
- 桌面/原生运行时集成测试，由 Rust crates 负责。
- 仓库级别护栏，防止已移除的 TypeScript 测试和 Node Gateway 网关表面重新出现。

## 本地 PR gate

对于本地 PR 合并/gate 检查，运行：

- `pnpm check`
- `pnpm build`
- `pnpm test`
- `pnpm check:docs`

如果 `pnpm test` 在负载较高的主机上出现 flaky 测试时，在判定为回归问题前先重新运行一次。如果仍然失败，使用 Cargo 隔离所属 crate：

```bash
cargo test -p crawclaw-runtime <filter>
```

将聚焦测试放在拥有该行为的 Rust crate 附近。对于仍以嵌入式运行时执行 JavaScript 或 TypeScript 的产品流程，应覆盖公共原生边界，而不是添加独立的 TypeScript 测试工具。
