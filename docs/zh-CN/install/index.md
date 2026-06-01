---
read_when:
  - 你需要支持的本地桌面入口
  - 你需要了解桌面应用包含哪些 runtime
  - 你正在设置 contributor checkout
summary: 安装 CrawClaw Desktop 并了解本地 Gateway runtime
title: 安装
x-i18n:
  generated_at: "2026-03-16T06:23:36Z"
  model: gpt-5.4
  provider: openai
  source_hash: 14b80b6176b2a4ff5c60aad2db88460d8d980bd416faaa3103b38d90521496af
  source_path: install/index.md
  workflow: 15
---

# 安装

## 推荐：CrawClaw Desktop

从 [GitHub Releases](https://github.com/qianleigood/crawclaw/releases) 安装 CrawClaw Desktop。在 Apple 平台上，CrawClaw 是 desktop-first 产品：应用负责用户设置、状态、日志、runtime 管理、Agent 聊天、plugin 配置、模型设置和诊断。

有关 bundle 布局、runtime 模型和平台支持，请参阅 [Desktop](/install/desktop)。

## 自动化边界

Desktop 会启动并监管本地 Rust Gateway。自动化和高级集成应调用本地 Gateway API，而不是 shell 到已退役的本地命令 wrapper。公共终端安装器和旧教程已退役。

## Contributor 设置

从源码进行本地开发：

```bash
git clone https://github.com/qianleigood/crawclaw.git
cd crawclaw
pnpm install
pnpm build
```

从仓库 checkout 运行 desktop app 时，使用 desktop Tauri scripts：

```bash
pnpm desktop:tauri:stage-runtime
pnpm desktop:tauri:dev
```

## Runtime 前置条件

- **Desktop 用户：** 使用打包应用；desktop bundle 包含 CrawClaw Gateway/runtime/native-plugin binaries。
- **Contributors：** 使用 Node 24+ 运行仓库工具，并使用 Rust 构建 Gateway/runtime crates。
- **Automation clients：** 连接 desktop-managed Gateway 暴露的本地 Gateway API。
