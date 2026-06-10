---
title: "Support Matrix"
summary: "CrawClaw runtime、agent、channel 和 plugin surfaces 的当前支持状态"
read_when:
  - 你正在记录 CrawClaw surfaces 的支持状态
  - 你需要区分 supported、beta 和 experimental 区域
x-i18n:
  generated_at: "2026-06-10T12:10:03Z"
  model: codex
  provider: openai
  source_hash: 9f01b5894ad82c2fdc9f86a2d2fc7819221ffaafcfa923cd75ea3edae33f252d
  source_path: reference/support-matrix.md
  workflow: 15
---

# Support Matrix

这个 matrix 描述 CrawClaw surfaces 的当前支持状态。它不是 feature checklist。它告诉你哪些区域最适合依赖，哪些仍在快速变化，哪些应该视为 experimental。

## Support levels

- `Supported`: core path，已文档化，并预期保持稳定。
- `Beta`: 有用且积极维护，但仍在快速变化。
- `Experimental`: advanced users 可用，但 behavior、API shape 或 docs 可能变化。

## Core runtime

| Surface                    | Status    | Notes                                                            |
| -------------------------- | --------- | ---------------------------------------------------------------- |
| CrawClaw Desktop           | Supported | Apple-platform 的主要 user entrypoint。                          |
| Gateway                    | Supported | sessions、tools、channels 和 events 的 primary control plane。   |
| Local workspace and config | Supported | `~/.crawclaw` 和 `crawclaw.json` 是 canonical runtime surfaces。 |
| Onboarding                 | Beta      | Desktop-first setup path；仍在快速演进。                         |

## Agent platform

| Surface                   | Status       | Notes                                                |
| ------------------------- | ------------ | ---------------------------------------------------- |
| Core agent runtime        | Supported    | 主要 assistant loop 和 tool execution path。         |
| Sessions and history      | Supported    | 面向用户和 operator 的 core behavior。               |
| Memory recall             | Beta         | 高频使用，但仍在积极 product shaping。               |
| Skills                    | Beta         | 有用且持续增长；具体 promotion ergonomics 仍在演进。 |
| Workflows                 | Beta         | 强大，但仍是高变化区域。                             |
| Cron and hooks automation | Experimental | 适合 advanced operators；预期继续迭代。              |

## Integrations

| Surface                         | Status       | Notes                                           |
| ------------------------------- | ------------ | ----------------------------------------------- |
| High-traffic messaging channels | Beta         | 预期会持续 active fixes 和 compatibility work。 |
| Long-tail channels/plugins      | Experimental | 除非 docs 另有说明，否则 best-effort。          |
| Rust plugin SDK                 | Beta         | Public native descriptor surface。              |

## User interfaces

| Surface                           | Status       | Notes                                       |
| --------------------------------- | ------------ | ------------------------------------------- |
| Desktop-first setup and operation | Supported    | Apple platforms 上的主要推荐路径。          |
| Browser tooling                   | Experimental | Powerful local-first features，边缘变化快。 |

## Contributor guidance

- 如果你想找最安全的贡献点，从 Desktop、Gateway、sessions 或 docs 开始。
- 如果你触及 memory、skills、workflows 或 Rust plugin SDK，预期会有更多 product 和 API 讨论。
- 如果你触及 long-tail channels、browser/canvas 或 automation，预期需要更多 environment-specific validation。
