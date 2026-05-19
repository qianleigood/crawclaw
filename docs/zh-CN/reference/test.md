---
read_when:
  - 运行或修复测试
summary: 如何本地运行原生 Rust 测试 gate
title: 测试
x-i18n:
  generated_at: "2026-05-19T00:52:30Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: b3805a49ea5e253fef66f465c1166243a7d15334028330cf6e78a18646073f1c
  source_path: reference/test.md
  workflow: 15
---

# 测试

- 完整测试套件： [测试](/help/testing)

- `pnpm test`：通过 `scripts/run-rust-tests.mjs` 运行 Rust 工作区测试。
- 该包装器设置了一个保守的 stack 大小和串行 Rust 测试线程，以避免桌面和原生运行时集成测试在共享本地资源上产生竞争。
- 聚焦调试时，直接运行 Cargo，例如 `cargo test -p crawclaw-runtime <filter>`.

## 本地 PR gate

对于本地 PR 合并/gate 检查，运行：

- `pnpm check`
- `pnpm build`
- `pnpm test`
- `pnpm check:docs`

如果 `pnpm test` 在负载较高的主机上出现 flaky 测试时，在判定为回归问题前先重新运行一次，然后使用 Cargo 隔离所属 crate： `cargo test -p <crate> <filter>`.

## 模型延迟基准测试（本地密钥）

脚本： [`scripts/bench-model.ts`](https://github.com/qianleigood/crawclaw/blob/main/scripts/bench-model.ts)

用法：

- `source ~/.profile && pnpm tsx scripts/bench-model.ts --runs 10`
- 可选环境变量： `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `MINIMAX_MODEL`, `ANTHROPIC_API_KEY`
- 默认提示词：“仅回复一个单词：ok。不使用标点或额外文本。”

上次运行（2025-12-31，20 次运行）：

- minimax 中位数 1279ms（最小 1114，最大 2431）
- opus 中位数 2454ms（最小 1224，最大 3170）
