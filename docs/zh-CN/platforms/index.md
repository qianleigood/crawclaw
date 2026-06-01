---
read_when:
  - 查找操作系统支持或安装路径
  - 决定在哪里运行 Gateway
summary: Gateway hosts 和 supported runtimes 的平台支持概览
title: 平台
x-i18n:
  generated_at: "2026-03-16T06:24:20Z"
  model: gpt-5.4
  provider: openai
  source_hash: 653f395598b9558cb15b58ab42ed931dba47c70780be1c803d33dd795bad6503
  source_path: platforms/index.md
  workflow: 15
---

# 平台

CrawClaw Desktop 运行本地 Rust Gateway/runtime。TypeScript 和 JavaScript 仍然只用于 desktop renderer，不属于默认 product runtime path。

CrawClaw 聚焦于 desktop app、本地 Rust Gateway、native plugins 和本地 integrations。Linux、macOS 和 Windows 目前都是支持的 Gateway host targets。

## 选择你的操作系统

- Linux：[Linux](/platforms/linux)
- macOS：[macOS](/platforms/macos)
- Windows：[Windows](/platforms/windows)

## VPS 与托管

- VPS 中心：[VPS hosting](/vps)
- Azure（Linux VM）：[Azure](/install/azure)
- exe.dev（VM + HTTPS proxy）：[exe.dev](/install/exe-dev)

## 常用链接

- 安装指南：[Getting Started](/start/getting-started)
- Gateway runbook：[Gateway](/gateway)
- Gateway configuration：[Configuration](/gateway/configuration)
- Runtime status：CrawClaw Desktop 或本地 Gateway API

## Gateway runtime

使用 CrawClaw Desktop 或本地 Gateway API 作为默认 runtime owner。旧的 CLI-managed OS startup path 已不属于 desktop product path。
