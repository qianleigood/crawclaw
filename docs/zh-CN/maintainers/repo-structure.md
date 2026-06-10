---
read_when:
  - 你在进行大规模仓库清理或文件移动之前进行定向
  - 你需要解释哪些顶层目录属于产品、文档、测试或辅助程序
summary: CrawClaw 单体仓库布局和源代码边界的维护者地图
title: 仓库结构
x-i18n:
  generated_at: "2026-06-10T17:47:05Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 09bba7541aa8894c4a4e554efcb7182d6de7e9a79250f545d05e327c48429886
  source_path: maintainers/repo-structure.md
  workflow: 15
---

# 仓库结构

本文档说明在进行大规模移动之前如何阅读 CrawClaw 单体仓库。

简要说明：

- `crates/` 是 Rust 产品运行时和公共原生契约层
- `apps/crawclaw-desktop/` 是桌面应用程序
- `src/` 是保留的非运行时元数据、生成的 JSON 和本地边界注释
- `extensions/` 是捆绑的插件元数据生态系统
- `automation/` 包含用于 n8n 和 ComfyUI 的托管本地运行时安装资源
- `packages/` 是保留的工作区支持包插槽，不是运行时核心
- `docs/` 同时包含产品文档和维护者设计材料
- `scripts/` 和 `.github/` 是交付层
- `test-fixtures/` 是共享的测试 fixture 数据
- `dist/` 是构建输出，不是源代码
- `skills-optional/` 是可选的技能目录，不是运行时核心代码
- `Swabble/` 是一个独立的辅助应用程序/代码库，不属于主运行时
- `firmware/` 是硬件辅助代码和设备元数据，不是桌面运行时代码

## 主运行时

主产品运行时位于 Rust crates 下。

主要领域：

- `crates/crawclaw-gateway`：控制平面、凭证、协议和 Gateway 网关服务
- `crates/crawclaw-runtime`：智能体循环、记忆、定时任务、运行时工具、原生插件注册接线、运行时布局和运行时状态
- `crates/crawclaw-repo-tools`：构建、发布、文档检查、生成的基线、仓库护栏、GitHub 辅助工具和 Node/npm 工具适配器
- `crates/crawclaw-native-plugins`：原生插件描述符和操作
- `crates/crawclaw-providers`：提供商目录、凭证/设置元数据、模型标准化、请求构建和响应/流解析
- `crates/crawclaw-plugin-sdk`：公共 Rust 插件 SDK
- `crates/crawclaw-channels`：原生渠道契约、能力描述符和桌面渠道配置目录

当人们说“产品代码”时，通常指的是 `crates/` 加上 `apps/crawclaw-desktop/` 下的桌面外壳。

`src/` 内保留的维护者入口点：

- `src/agents/README.md`
- `src/gateway/protocol/AGENTS.md`
- `src/plugins/README.md`
- `src/generated/`

## 能力生态系统

`extensions/` 是捆绑的插件生态系统层。

它包含多种类型的包：

- 渠道适配器
- 模型/提供商适配器
- 浏览器/运行时辅助工具
- 工具导向插件
- 当建模为插件包时的共享支持包

并非每个插件包在角色上都是相同的，但它们都属于能力层，而不是主运行时层。

`skills-optional/` 也属于仓库的生态系统侧。它是可选技能和配方目录，不是核心运行时树。

`automation/` 也是生态系统相邻的。它包含用于 n8n 和 ComfyUI 等托管本地运行时的发布清单支持安装脚本和校验和。运行时控制仍然位于 Rust 和桌面应用中；这些文件是环境资产，不是独立的工作流引擎。

## 支持包

`packages/` 是有意保留的，但目前应该保持空置状态，仅供边界注释使用。新支持包不应默认添加。首先决定代码是否属于：

- `crates/` 用于运行时核心或 Rust 仓库工具
- `extensions/` 用于插件生态系统
- `apps/` 用于应用程序或辅助产品代码
- `scripts/` 用于 shell、Go 或 Python 交付辅助工具

## 文档层

`docs/` 今天服务于多个目的：

- 产品文档
- 安装文档
- 参考文档
- 维护者设计笔记
- 调试和审计材料

这意味着 `docs/` 不是纯用户面向的。在文档树更积极地拆分之前，维护者应将其视为混合参考层。

本文档专门位于 `docs/maintainers/` 下，以使该拆分更加明确。

## 交付层

这些路径构成构建/发布/交付系统：

- `scripts/`
- `.github/`
- `package.json` 中的发布元数据

该层在操作上至关重要，但它与运行时架构不是同一回事。

该层的 Rust 入口点是 `crates/crawclaw-repo-tools`。产品运行时 crates 可能暴露维护者工具读取的目录或 staging 辅助工具，但构建、发布、文档和护栏命令实现不应位于 `crates/crawclaw-runtime` 中。

`package.json` 为贡献者和 CI 保留 pnpm 兼容性别名，但现在规范实现位于 repo-tools profiles 之后：

- `check --profile local|ci|rust-core|desktop-renderer|docs-core|docs-hosted`
- `build --profile package|strict-smoke|desktop-renderer`
- `release-check`
- `desktop-renderer dev|build|tauri-dev|tauri-build`

Node/npm 仍然存在，用于桌面渲染器、文档托管工具和 npm pack/publish 边界。当存在 Rust 编排路径时，应通过 repo-tools 适配器调用它们。

## 测试基础设施

`test-fixtures/` 是共享的测试 fixture 数据。

用途：

- 共享 fixtures
- 契约样本
- 跨域测试输入
- 跨域测试支持

可能时，将小型领域本地测试保留在源代码附近。当支持资产跨多个领域共享时使用 `test-fixtures/`。不要添加新的 TypeScript 测试套件；活跃的测试表面是 Rust 工作区。

## 非核心/辅助代码

`Swabble/` 不是主 CrawClaw 运行时树的一部分。

它是位于同一仓库中的独立辅助应用程序/代码库。将其视为相邻项目。如果仓库稍后重新组织，此目录应移至明确的伞形目录下，如 `apps/` 或 `experiments/`。

`firmware/` 遵循相同的非核心规则。它携带设备端代码和硬件集成元数据，而主产品运行时仍位于 `crates/` 和 `apps/crawclaw-desktop/` 下。

## 构建输出

`dist/` 是构建输出。

- 它存在是因为发布的 npm 包和一些发布路径需要它。
- 它不应用于解释源代码架构。
- 如果你试图理解系统如何工作，请从 `crates/`、`apps/crawclaw-desktop/`、`extensions/` 和 `src/generated/` 开始，而不是 `dist/`。

## 当前清理方向

当前推荐的清理顺序是：

1. 将产品运行时代码和仓库自动化保持在单独的 crates 中。
2. 通过文档和目录 README 使结构更加明确。
3. 通过重新分类辅助和目录目录来减少根目录歧义。
4. 更清晰地拆分维护者文档和用户面向文档。
5. 然后才考虑对 `src/` 内的生成元数据或保留边界注释进行更深入的移动。

这在保持发布/构建风险低的同时仍能提高可维护性。
