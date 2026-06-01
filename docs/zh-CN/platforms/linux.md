---
read_when:
  - 规划平台覆盖范围或贡献
summary: Linux support status
title: Linux App
x-i18n:
  generated_at: "2026-03-16T06:24:30Z"
  model: gpt-5.4
  provider: openai
  source_hash: 12f2a28ec8fc17769210bda97af11fda332355956d41bba69ac51cc523be6178
  source_path: platforms/linux.md
  workflow: 15
---

# Linux App

本地 Rust Gateway 支持 Linux。TypeScript 和 JavaScript 仍然只用于 desktop renderer，不属于默认 product runtime path。

Linux support 重点覆盖本地 Gateway、native plugins 和 Gateway API clients。

## 面向初学者的快速路径（VPS）

1. 安装 Node 24.x（stable）或 Node 25.x（experimental）。
2. 安装 GitHub Releases 中的 CrawClaw Desktop。
3. 使用 CrawClaw Desktop 或本地 Gateway API。
4. 在你的笔记本电脑上运行：`ssh -N -L 18789:127.0.0.1:18789 <user>@<host>`。
5. 在本地运行 CrawClaw Desktop 或本地 Gateway API，或者让受支持的 Gateway client 通过 SSH tunnel 连接。

完整 Linux server 指南：[Linux Server](/vps)。分步 VPS 示例：[exe.dev](/install/exe-dev)

## 安装

- [Getting Started](/start/getting-started)
- [Install & updates](/install/updating)
- 可选流程：[Bun (experimental)](/install/bun)、[Nix](/install/nix)

## Gateway

- [Gateway runbook](/gateway)
- [Configuration](/gateway/configuration)

## Gateway runtime

使用 CrawClaw Desktop 或本地 Gateway API 作为支持的 runtime owner。旧的 CLI-managed Linux supervisor flow 已从默认 desktop product path 中退役。
