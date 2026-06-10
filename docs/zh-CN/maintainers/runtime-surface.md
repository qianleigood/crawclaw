---
summary: Rust 拥有的运行时 surface 以及允许保留的 TypeScript 或 JavaScript surface 的维护边界
read_when:
  - 你在审计 Rust 化进度
  - 你需要判断 TypeScript 或 JavaScript 文件是否属于产品运行时
  - 你在评审桌面打包或插件运行时变更
title: Runtime Surface
x-i18n:
  generated_at: "2026-06-10T10:32:09Z"
  model: codex
  provider: openai
  source_hash: e252a749ae2414643aa774b0e0a0bb348127b86e524a63d6c2c800204c8a77e4
  source_path: maintainers/runtime-surface.md
  workflow: 15
---

# Runtime Surface

本文为 CrawClaw 维护者定义当前运行时边界。判断剩余 TypeScript 或
JavaScript 源码到底是产品运行时、生态系统合约、构建工具，还是可以删除的旧 surface 时，先看这里。

目标不是移除每一个 TypeScript 或 JavaScript 文件。目标是让产品运行时路径由 Rust/native 拥有，而
TypeScript 和 JavaScript 只保留在有明确意图和清晰边界的位置。

## Rust 拥有的产品路径

这些 surface 属于产品运行时，应继续由 Rust/native 拥有：

- `apps/crawclaw-desktop/src-tauri` 下的桌面 shell 后端和本地 API。
- `crates/crawclaw-gateway` 下的 Gateway 运行时。
- `crates/crawclaw-runtime` 下的 agent、session、memory、automation、tool 和 native plugin 执行。
- `crates/crawclaw-native-plugins` 下的捆绑 native plugin 描述符和 dispatch。
- `crates/crawclaw-providers` 下的 provider 元数据和 native transport 描述符。
- `crates/crawclaw-channels` 下的 native channel 合约。

生产桌面包必须把 Rust 运行时二进制嵌入 `runtime/crawclaw/bin/`，并且不得打包公开的 `crawclaw`
CLI 二进制、默认 JavaScript plugin runtime 或 QuickJS fallback。`crates/crawclaw-repo-tools`
中的 release check 是这类 bundle 形状的护栏，并通过 `pnpm desktop:tauri:stage-runtime` 和
`pnpm desktop:tauri:release-check` 暴露。

托管浏览器自动化也在 staging 时按平台收敛。桌面运行时只把宿主平台的 `agent-browser` 二进制复制到
`runtime/crawclaw/runtimes/browser/bin/`，并在 runtime manifest 中记录所选平台、架构和二进制名称。
不要把完整 npm package 的 bin 目录复制进桌面 bundle，也不要把其他平台二进制 staged 到桌面 bundle。

## 允许的 TypeScript 和 JavaScript surface

以下 TypeScript 和 JavaScript surface 是设计上允许的：

- `apps/crawclaw-desktop/src`：React 和 Vite 桌面 renderer。
- `apps/crawclaw-desktop/vite.config.ts`：桌面 renderer 构建配置。

这些 surface 应保持有边界。不要把允许保留的 surface 当作后门，在 TypeScript 中新增生产 Gateway
handler、desktop bridge 或默认 plugin runtime。

## 迁移候选项

当 TypeScript 或 JavaScript 位于以下路径时，把它视为迁移候选项：

- 它启动或处理生产 Gateway 运行时行为，而不是委托给 `crates/crawclaw-gateway`。
- 它执行默认桌面工具，而不是使用 `crates/crawclaw-runtime` 或 `crates/crawclaw-native-plugins`。
- 它通过 Node runner 为默认桌面产品路径加载捆绑 plugin 行为。
- 它在 Rust provider/native plugin 边界之外注册 model、speech、web 或 media provider 行为。
- 它存在的唯一目的，是保留旧 Admin Desktop、Electron desktop、公开 CLI、JavaScript plugin runtime 或
  QuickJS fallback surface。

迁移这类 surface 时，先证明 Rust 路径已经真实可用。然后把过时的 TypeScript 或 JavaScript 实现和测试一起删除，
不要留下兼容副本。

## 推荐清理顺序

1. 保持 `cargo test -p crawclaw-runtime`、`cargo test -p crawclaw-providers` 和 desktop runtime
   release-check 通过。
2. 只有当 Rust/native 路径已经拥有相同行为后，才删除 TypeScript 或 JavaScript。
3. 添加面向作者的 capability 时，保持 Rust plugin SDK 和 native plugin 描述符对齐。
4. 只有当迁移能降低发布风险、包体积或维护成本时，才把 build 和 generation scripts 迁到 Rust。脚本语言本身不是产品运行时问题。

## 如何回答 Rust 化审计

不要只靠统计文件扩展名来回答 Rust 化进度。

使用下面的划分：

- 产品运行时入口：Rust/native。
- 桌面 renderer：按设计使用 TypeScript/React。
- Plugin SDK：Rust crate `crawclaw-plugin-sdk`；JavaScript package exports 已移除。
- 捆绑 plugin packages：主要是带 native manifest 的 metadata shell。
- 构建和发布工具：Rust、shell、Go 或 Python。不要新增 TypeScript/JavaScript 仓库自动化。

这样可以把桌面产品目标和整个仓库的语言重写区分开。
