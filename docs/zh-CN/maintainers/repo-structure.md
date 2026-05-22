---
read_when:
  - 你正在大规模清理或移动文件之前进行定向
  - 你需要解释哪些顶层目录是产品、文档、测试或边车
summary: CrawClaw monorepo 布局和源码边界维护者地图
title: 仓库结构
x-i18n:
  generated_at: "2026-05-22T04:21:31Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: aee5f84945d9c1654bd151c128ca0adc3518bc2c81951b711e3b06f37e3252e4
  source_path: maintainers/repo-structure.md
  workflow: 15
---

# 仓库结构

本文档解释在做出大规模移动之前如何阅读 CrawClaw monorepo。

简要版本：

- `crates/` 是 Rust 产品运行时和公开原生契约层
- `apps/crawclaw-desktop/` 是 desktop 应用程序
- `src/` 保留非运行时元数据、生成的 JSON 和本地边界说明
- `extensions/` 是捆绑插件元数据生态系统
- `packages/` 是保留的工作区支持包槽位，不是运行时核心
- `docs/` 包含产品文档和维护者面向的设计材料
- `scripts/` 和 `.github/` 是交付层
- `test/` 是共享测试基础设施
- `dist/` 是构建输出，不是源码
- `skills-optional/` 是可选 skill 目录，不是运行时核心代码
- `Swabble/` 是一个单独的边车应用/代码库，不是主运行时的一部分

## 主运行时

主产品运行时位于 Rust crates 下。

主要领域：

- `crates/crawclaw-gateway`：控制平面、凭证、协议和 Gateway 服务
- `crates/crawclaw-runtime`：智能体循环、记忆、cron、运行时工具、本机插件注册接线、运行时布局和运行时状态
- `crates/crawclaw-repo-tools`：构建、发布、文档检查、生成的基线、仓库 guardrails、GitHub 辅助工具和 Node/npm 工具适配器
- `crates/crawclaw-native-plugins`：本机插件描述符和操作
- `crates/crawclaw-providers`：提供商目录、凭证/设置元数据、模型规范化、请求构建和响应/流解析
- `crates/crawclaw-plugin-sdk`：公开的 Rust 插件 SDK
- `crates/crawclaw-channels`：本机渠道契约、能力描述符和 desktop 渠道配置目录

当人们说“产品代码”时，他们通常指的是 `crates/` 加上 `apps/crawclaw-desktop/` 下的 desktop shell。

`src/` 内保留的维护者入口点：

- `src/agents/README.md`
- `src/plugins/README.md`
- `src/workflows/README.md`
- `src/infra/README.md`
- `src/generated/`

## 能力生态系统

`extensions/` 是官方扩展/插件生态系统层。

它包括多种类型的包：

- 渠道适配器
- 模型/提供商适配器
- 浏览器/运行时辅助工具
- 面向工具的扩展
- `extensions/shared` 下的共享支持包

并非每个扩展在角色上都相同，但它们都属于能力层，而不是主运行时层。

`skills-optional/` 也属于仓库的生态系统端。它是一个可选 skills 和配方目录，不是核心运行时树。

## 支持包

`packages/` 被有意保留，但目前除了边界说明外应保持为空。默认情况下不应添加新的支持包。首先决定代码是否属于：

- `crates/` 用于运行时核心或 Rust 仓库工具
- `extensions/` 用于插件生态系统
- `apps/` 用于应用或边车产品代码
- `scripts/` 用于 shell、Go 或 Python 交付辅助工具

## 文档层

`docs/` 今天服务于多个目的：

- 产品文档
- 安装文档
- 参考文档
- 维护者设计笔记
- 调试和审计材料

这意味着 `docs/` 不是纯粹面向用户的。在文档树被更激进地拆分之前，维护者应将其视为混合参考层。

本文档特别位于 `docs/maintainers/` 下，以使该拆分更加明确。

## 交付层

这些路径构成构建/发布/交付系统：

- `scripts/`
- `.github/`
- `package.json` 中的发布元数据

这一层在操作上至关重要，但它与运行时架构不是同一回事。

该层的 Rust 入口点是 `crates/crawclaw-repo-tools`。产品运行时 crates 可能暴露维护者工具读取的目录或暂存辅助工具，但构建、发布、文档和 guardrail 命令实现不应位于 `crates/crawclaw-runtime` 中。

`package.json` 为贡献者和 CI 保留 pnpm 兼容别名，但规范实现现在位于 repo-tools profile 后面：

- `check --profile local|ci|rust-core|desktop-renderer|docs-core|docs-hosted`
- `build --profile package|strict-smoke|desktop-renderer`
- `release-check`
- `desktop-renderer dev|build|tauri-dev|tauri-build`

Node/npm 仍然存在，用于 desktop 渲染器、托管文档工具和 npm pack/publish 边界。当存在 Rust 编排路径时，应通过 repo-tools 适配器调用它们。

## 测试基础设施

`test/` 是共享测试基础设施。

用于：

- 共享 fixtures
- mocks
- 辅助工具
- 跨域测试支持

尽可能将小型、领域本地测试保留在源码附近。当支持资产跨多个域共享时使用 `test/`。

## 非核心 / 边车代码

`Swabble/` 不是主 CrawClaw 运行时树的一部分。

它是一个位于同一仓库中的独立边车应用/代码库。将其视为相邻项目。如果仓库稍后重新组织，此目录应移至 `apps/` 或 `experiments/` 等明确伞形目录下。

## 构建输出

`dist/` 是构建输出。

- 它的存在是因为发布的 npm 包和一些发布路径需要它。
- 它不应用于解释源码架构。
- 如果你试图理解系统如何工作，请从 `crates/`、`apps/crawclaw-desktop/`、`extensions/` 和 `src/generated/` 开始，而不是 `dist/`。

## 当前清理方向

当前推荐的清理顺序是：

1. 将产品运行时代码和仓库自动化保持在独立的 crates 中。
2. 通过文档和目录 README 使结构更加明确。
3. 通过重新分类边车和目录目录来减少根目录歧义。
4. 更清晰地拆分维护者文档和面向用户的文档。
5. 只有这样才考虑为 `src/` 内生成的元数据或保留的边界说明进行更深层次的移动。

这在提高可维护性的同时保持低发布/构建风险。
