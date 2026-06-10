---
title: "Plugin Entry Points"
sidebarTitle: "Entry Points"
summary: "当前 plugin entry boundary"
read_when:
  - 你在确认 TypeScript plugin entries 是否仍受支持
  - 你想了解 plugins 如何被发现
  - 你正在迁移旧 TypeScript runtime plugin
x-i18n:
  generated_at: "2026-06-10T11:28:57Z"
  model: codex
  provider: openai
  source_hash: a065f75f8fc6ac1d072e556fe82ab84768ec0f3013ed2c6f091e952539d6c843
  source_path: plugins/sdk-entrypoints.md
  workflow: 15
---

# Plugin Entry Points

CrawClaw 不再在 production 中加载 executable TypeScript plugin entries。Plugin discovery 会读取 `crawclaw.plugin.json` 和 Rust native descriptors。

旧 TypeScript entry files 应删除，或转换成 non-executing package helpers。Runtime behavior 属于 Rust。

## Current discovery inputs

| Input                  | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `crawclaw.plugin.json` | Plugin id、display metadata、configuration schema 和 native descriptor |
| Rust native descriptor | Provider、tool、channel、service、hook 或 capability runtime binding   |
| Generated SDK subpaths | 用于 package integration 的 types 和 non-executing helpers             |

## Runtime capabilities

Providers、tools、hooks、commands、services、channels、HTTP routes 和 Gateway methods 都由 Rust 拥有。添加或修改这些 capabilities 应在 Rust crates 中完成，而不是在 TypeScript entry callback 中完成。

## Related

- [SDK Overview](/plugins/sdk-overview) -- import map 和 SDK boundary
- [Runtime Boundary](/plugins/sdk-runtime) -- Rust-owned runtime model
- [Setup and Config](/plugins/sdk-setup) -- manifest、packaging 和 config schema
- [Provider Configuration](/plugins/sdk-provider-plugins) -- Rust-owned providers 和 `models.providers`
