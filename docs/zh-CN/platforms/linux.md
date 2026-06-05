---
read_when:
  - 规划平台覆盖范围或贡献
summary: Linux 支持状态
title: Linux 应用
x-i18n:
  generated_at: "2026-06-05T14:41:06Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 2c77d85a34ec6c682d1ebcb6d899842ee139fe18fa84569444cc3f7a64378d6e
  source_path: platforms/linux.md
  workflow: 15
---

# Linux 应用

本地 Rust Gateway 在 Linux 上受支持。TypeScript 和 JavaScript 仅保留用于桌面渲染器，不用于默认产品运行时路径。

Linux 支持专注于本地 Gateway、原生插件和 Gateway API 客户端。

## 初学者快速路径（VPS）

1. 安装 Node 24.x（稳定版）或 Node 25.x（实验版）
2. 从 GitHub Releases 安装 CrawClaw Desktop
3. CrawClaw Desktop 或本地 Gateway API
4. 从你的笔记本：`ssh -N -L 18789:127.0.0.1:18789 <user>@<host>`
5. 在本地运行 CrawClaw Desktop 或本地 Gateway API，或通过 SSH 隧道连接支持的 Gateway 客户端

完整 Linux 服务器指南：[Linux Server](/vps)。分步 VPS 示例：[exe.dev](/install/exe-dev)

## 安装

- [入门指南](/start/getting-started)
- [安装与更新](/install/updating)
- 可选流程：[Bun（实验版）](/install/bun)、[Nix](/install/nix)

## Gateway

- [Gateway 运行手册](/gateway)
- [配置](/gateway/configuration)

## Gateway 运行时

使用 CrawClaw Desktop 或本地 Gateway API 作为支持的运行时所有者。
旧的 CLI 管理的 Linux 监管流程已从默认桌面产品路径中移除。
