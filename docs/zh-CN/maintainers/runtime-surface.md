---
read_when:
  - 你需要审计 Rustification 进度
  - 你需要决定 TypeScript 或 JavaScript 文件是否属于产品运行时
  - 你需要审查桌面打包或插件运行时变更
summary: Rust 所有运行时边界与允许的 TypeScript 或 JavaScript 表面的维护者边界
title: 运行时边界
x-i18n:
  generated_at: "2026-06-10T18:35:39Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: e0fa358c93450c42b02fd2e97bc9f66d60c55cf2006564e40876c8b528dd334a
  source_path: maintainers/runtime-surface.md
  workflow: 15
---

# 运行时边界

本文档定义了 CrawClaw 维护者的当前运行时边界。在判断剩余的 TypeScript 或 JavaScript 源代码是属于产品运行时、生态系统契约、构建工具还是可移除的遗留层面时，请参考本文档。

目标不是移除所有 TypeScript 或 JavaScript 文件。目标是产品运行时路径由 Rust/native 所有，而 TypeScript 和 JavaScript 仅在有意且有界的地方保留。

## Rust 所有产品路径

这些层面是产品运行时层面，应保持 Rust/native 所有：

- `apps/crawclaw-desktop/src-tauri` 下的桌面 shell 后端和本地 API。
- `crates/crawclaw-gateway` 下的 Gateway 运行时。
- `crates/crawclaw-runtime` 下的 Agent、会话、记忆、自动化、工具和原生插件执行。
- `crates/crawclaw-native-plugins` 下的捆绑原生插件描述符和调度。
- `crates/crawclaw-providers` 下的提供商元数据和原生传输描述符。
- `crates/crawclaw-channels` 下的原生渠道契约。

生产桌面包必须在 `runtime/crawclaw/bin/` 下嵌入 Rust 运行时二进制文件，不得准备公共 `crawclaw` CLI 二进制文件、默认 JavaScript 插件运行时或 QuickJS 回退。`crates/crawclaw-repo-tools` 中的发布检查是该包形式的防护栏，通过 `pnpm desktop:tauri:stage-runtime` 和 `pnpm desktop:tauri:release-check` 公开。

托管浏览器自动化也在打包时按平台范围进行限定。桌面运行时仅将主机的 `agent-browser` 二进制文件复制到 `runtime/crawclaw/runtimes/browser/bin/`，并在运行时清单中记录所选平台、架构和二进制文件名。不要复制完整的 npm 包 bin 目录，也不要将其他平台二进制文件打包到桌面包中。

## 允许的 TypeScript 和 JavaScript 层面

以下 TypeScript 和 JavaScript 层面是设计允许的：

- `apps/crawclaw-desktop/src`：React 和 Vite 桌面渲染器。
- `apps/crawclaw-desktop/vite.config.ts`：桌面渲染器构建配置。

这些层面应保持有界。不要将允许的层面用作后门，以在 TypeScript 中添加新的生产 Gateway 处理器、桌面桥接或默认插件运行时。

## 迁移候选

当 TypeScript 或 JavaScript 位于以下路径之一时，将其视为迁移候选：

- 它启动或处理生产 Gateway 运行时行为，而不是委托给 `crates/crawclaw-gateway`。
- 它执行默认桌面工具，而不是使用 `crates/crawclaw-runtime` 或 `crates/crawclaw-native-plugins`。
- 它通过 Node 运行器为默认桌面产品路径加载捆绑插件行为。
- 它在 Rust provider/native 插件边界之外注册模型、语音、Web 或媒体提供商行为。
- 它仅存在以保留遗留 Electron 桌面、公共 CLI、JavaScript 插件运行时或 QuickJS 回退层面。

迁移这些层面之一时，首先证明 Rust 路径是活的。然后一起删除过时的 TypeScript 或 JavaScript 实现及其测试，而不是留下兼容性副本。

## 首选清理顺序

1. 保持 `cargo test -p crawclaw-runtime`、`cargo test -p crawclaw-providers` 和桌面运行时 release-check 绿色通过。
2. 仅在 Rust/native 路径拥有相同运行时行为后才能移除 TypeScript 或 JavaScript。
3. 在添加面向作者的能力时，保持 Rust 插件 SDK 和原生插件描述符对齐。
4. 仅在减少发布风险、包大小或维护成本时才将构建和生成脚本移至 Rust。脚本语言本身不是产品运行时关注点。

## 如何回答 Rustification 审计

不要仅通过计算文件扩展名来回答 Rustification 进度。

使用以下分类代替：

- 产品运行时入口点：Rust/native。
- 桌面渲染器：按设计为 TypeScript/React。
- 插件 SDK：Rust crate `crawclaw-plugin-sdk`；JavaScript 包导出已移除。
- 捆绑插件包：主要是带有原生清单的元数据 shell。
- 构建和发布工具：Rust、shell、Go 或 Python。不要添加新的 TypeScript/JavaScript 仓库自动化。

这将桌面产品目标与完整仓库语言重写分开。
