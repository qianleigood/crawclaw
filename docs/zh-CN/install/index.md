---
read_when:
  - 你想要使用 CrawClaw 支持的本地桌面入口点
  - 你需要了解桌面应用捆绑了什么
  - 你正在设置贡献者代码检出
summary: 安装 CrawClaw Desktop 并了解本地 Gateway 运行时
title: 安装
x-i18n:
  generated_at: "2026-06-11T13:03:44Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: af686650aa480466498a0e2c0094982061cfdacf250cad91b9cbacb0260deb2a
  source_path: install/index.md
  workflow: 15
---

# 安装

## 推荐：CrawClaw Desktop

从 [GitHub Releases](https://github.com/qianleigood/crawclaw/releases) 安装 CrawClaw Desktop。在 Apple 平台上，CrawClaw 是桌面优先产品：应用负责用户设置、状态、日志、运行时管理、智能体对话、插件配置、模型设置和诊断。

参见 [Desktop](/install/desktop) 了解捆绑布局、运行时模型和平台支持。

## 自动化边界

Desktop 启动并监控本地 Rust Gateway。自动化和高级集成应调用本地 Gateway API，而不是调用已废弃的本地命令包装器。公共终端安装程序和教程已废弃。

## 贡献者设置

从源码进行本地开发：

```bash
git clone https://github.com/qianleigood/crawclaw.git
cd crawclaw
pnpm install
pnpm build
```

要在开发模式下运行桌面应用，使用仓库检出的 desktop Tauri 脚本：

```bash
pnpm desktop:tauri:stage-runtime
pnpm desktop:tauri:dev
```

## 运行时前置条件

- **Desktop 用户：**使用打包的应用；桌面捆绑包含 CrawClaw Gateway/运行时/native-plugin 二进制文件。
- **贡献者：**使用 Node 24.x 或 Node 25.x 进行仓库工具操作，使用 Rust 进行 Gateway/运行时 crates 开发。
- **自动化客户端：**以桌面管理的 Gateway 暴露的本地 Gateway API 为目标。
