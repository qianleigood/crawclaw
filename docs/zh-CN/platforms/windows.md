---
read_when:
  - 在 Windows 上安装 CrawClaw
  - 定义 Windows 支持范围
summary: Windows 原生安装、Gateway 运行时模式、插件和验证关卡的 Windows 支持矩阵
title: Windows
x-i18n:
  generated_at: "2026-06-05T14:41:43Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 3b0f08c032590dc9b0f7c303048bc9432d6341ed348aa7c1b5d70295daa3e1f5
  source_path: platforms/windows.md
  workflow: 15
---

# Windows

CrawClaw 支持用于 Gateway 主机使用的**原生 Windows**。Windows 产品边界包括 CLI、Gateway、插件、安装/运行时设置以及 Windows 主机上每用户启动。

原生 Windows 支持并不**意味着**与 macOS 本地安装、CrawClaw CLI、运行 Gateway、管理每用户启动、加载支持的插件以及通过 Windows 兼容性层验证的完全对等。

## 原生能力状态

Windows 矩阵使用三种支持状态：

- `supported`：CrawClaw 拥有原生 Windows 路径，并通过自动化或冒烟测试支持的关卡进行验证。
- `not-native`：该能力超出当前原生 Windows 产品边界。

## 原生能力矩阵

| 表面                            | 状态         | Windows 边界                                                                        |
| ------------------------------- | ------------ | ----------------------------------------------------------------------------------- |
| Desktop 安装程序                | `supported`  | GitHub Releases 的 desktop 资源安装 CrawClaw Desktop 和嵌入式运行时。               |
| CLI                             | `supported`  | 命令从 PowerShell 运行，具有 Windows 安全的参数、路径、shell 和进程生成处理。       |
| Gateway 前台                    | `supported`  | CrawClaw Desktop 或本地 Gateway API 直接在 Windows 主机上启动 Gateway。             |
| Gateway 运行时                  | `supported`  | CrawClaw Desktop 或本地 Gateway API 直接在 Windows 主机上启动本地 Rust Gateway。    |
| `exec` 和 `system.run` 工具     | `supported`  | 首选 PowerShell 7，Windows PowerShell 回退；命令 shim 必须避免不安全的 shell 回退。 |
| 浏览器自动化                    | `supported`  | 在 Windows 冒烟测试覆盖 Chrome/Edge/Brave 发现和浏览器运行时后支持。                |
| Feishu、QQBot、DingTalk、Weixin | `supported`  | 通过内置或捆绑的渠道/插件路径支持，在提供商凭证允许的情况下进行冒烟覆盖。           |
| 常用提供商插件                  | `supported`  | 提供商目录和传输由 Rust 拥有；捆绑的默认值使用原生运行时资源。                      |
| 旧版消息和 Weixin               | `not-native` | 需要 Mac 端旧版消息或 Apple 消息主机，位于 Windows 运行时之外。                     |
| Apple skills 和 macOS 专用工具  | `not-native` | 需要 Apple 主机，位于 Windows 运行时之外。                                          |

## 安装

以普通用户身份运行 PowerShell：

从 [GitHub Releases](https://github.com/qianleigood/crawclaw/releases) 安装最新的 Windows desktop 资源。

对于试运行或 beta 安装：

使用 GitHub Releases 中匹配的资源或预发布资源。

验证安装：

打开 CrawClaw Desktop 并确认本地 Gateway 状态，或在自动化验证时查询本地 Gateway API。

Desktop 用户不需要全局的 `crawclaw` 命令。使用 CrawClaw Desktop 或本地 Gateway API 进行操作员操作。

## Gateway 参考

在前台运行 Gateway：

使用 CrawClaw Desktop 启动本地 Rust Gateway。源码检出开发应使用仓库的 desktop 或 Gateway 包脚本。

托管的 OS 启动不属于默认 desktop 运行时路径。使用 CrawClaw Desktop 或本地 Gateway API 启动本地 Rust Gateway。

对于仅 Gateway API 设置，跳过健康门控的新手引导：

在配置提供商凭证和认证后直接调用本地 Gateway API。

## 兼容性关卡

仓库在原生 Rust 工作区关卡内保持 Windows 相关的兼容性覆盖：

```bash
pnpm test
```

此关卡覆盖可从任何开发主机验证的原生运行时生成辅助工具和跨平台路径/进程行为。

完整的原生验证仍需要 Windows VM 或主机：

```bash
pnpm desktop:tauri:release-check
pnpm desktop:tauri:release-check
```

## 一级验收标准

当满足以下所有条件时，原生 Windows 可被描述为一级：

- CrawClaw Desktop 可以在干净的支持的 Windows 11 机器上安装或更新 CrawClaw，而无需手动设置 Node 或 Git。
- 打包的 desktop 版本检查在新的 PowerShell 会话中正常工作，无需手动修复 PATH。
- CrawClaw Desktop 和本地 Gateway API 检查没有阻塞错误。
- 本地 Gateway 设置通过 CrawClaw Desktop 或纯 API 设置流程完成。
- CrawClaw Desktop 或本地 Gateway API 报告可达的 Gateway。
- 首次本地 agent 轮次通过 CrawClaw Desktop 或本地 Gateway API 完成。
- 浏览器运行时检查要么通过，要么返回清晰、可操作的修复说明。
- 声明支持 Windows 的提供商和渠道插件在安装或 postinstall 期间安装其运行时依赖项，而不是在首次用户请求时延迟安装。
- 从发布的 `latest` 包升级到当前包成功。
- CI 和发布关卡覆盖 Windows 安装、postinstall 清单、Gateway 生命周期、首次智能体轮次和冒烟测试支持的运行时检查。

## 当前边界

- Gateway 自动启动是每用户登录模式。在任何 Windows 用户登录之前运行需要管理员安装的 Windows Service，这是后续阶段。
- 某些插件可能需要提供商凭证、本机二进制文件、浏览器安装或 CrawClaw 包之外的运行时依赖项。
- Apple 本地集成需要 Apple 设备或桥接主机，是 `桥接的`，而非原生 Windows 能力。
- 在本文档中的关卡在 CI、nightly 和发布验证中为绿色之前，不应将原生 Windows 支持描述为完全 Windows 对等。

## Gateway

- [Gateway 运行手册](/gateway)
- [配置](/gateway/configuration)

## Gateway 运行时

使用 CrawClaw Desktop 或本地 Gateway API。旧的 CLI 管理的计划 OS 任务和登录项路径已从默认 desktop 产品路径中移除。

## 相关页面

- [Desktop](/install/desktop)
- [Node.js 安装与故障排除](/install/node)
- [Gateway 运行手册](/gateway)
- [Gateway 配置](/gateway/configuration)
