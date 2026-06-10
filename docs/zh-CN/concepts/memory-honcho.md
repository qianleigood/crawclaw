---
title: "Honcho Memory"
summary: "通过 Honcho plugin 提供 AI-native cross-session memory"
read_when:
  - 你想要跨 sessions 和 channels 工作的持久 memory
  - 你想要 AI-powered recall 和 user modeling
x-i18n:
  generated_at: "2026-06-10T10:45:58Z"
  model: codex
  provider: openai
  source_hash: 8edf1faf5dcb5430f09353c1d0599a7948c7e520616cd3e522713f72751b8b6a
  source_path: concepts/memory-honcho.md
  workflow: 15
---

# Honcho Memory

[Honcho](https://honcho.dev) 为 CrawClaw 增加 AI-native memory。它把 conversations 持久化到专用服务，
并随着时间推移构建 user 和 agent models，为 agent 提供超出 workspace Markdown files 的 cross-session context。

## 提供什么

- **Cross-session memory**：每个 turn 后都会持久化 conversations，所以 context 可以跨 session resets、compaction 和 channel switches 保留。
- **User modeling**：Honcho 为每个 user 维护 profile（preferences、facts、communication style），也为 agent 维护 profile（personality、learned behaviors）。
- **Semantic search**：搜索过往 conversations 中的 observations，而不仅仅是当前 session。
- **Multi-agent awareness**：parent agents 自动跟踪 spawned sub-agents，并在 child sessions 中把 parents 加为 observers。

## 可用 tools

Honcho 注册 agent 可在 conversation 中使用的 tools：

**Data retrieval（快速、无 LLM call）：**

| Tool                        | 作用                                                |
| --------------------------- | --------------------------------------------------- |
| `honcho_context`            | 跨 sessions 的完整 user representation              |
| `honcho_search_conclusions` | 对 stored conclusions 做 semantic search            |
| `honcho_search_messages`    | 跨 sessions 查找 messages（可按 sender、date 过滤） |
| `honcho_session`            | 当前 session history 和 summary                     |

**Q&A（LLM-powered）：**

| Tool         | 作用                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| `honcho_ask` | 询问关于 user 的问题。`depth='quick'` 用于 facts，`'thorough'` 用于 synthesis |

## 开始使用

安装 plugin 并运行 setup：

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

setup command 会提示输入 API credentials、写入 config，并可选择迁移现有 workspace memory files。

<Info>
Honcho 可以完全本地运行（self-hosted），也可以通过 `api.honcho.dev` 的 managed API 运行。self-hosted 选项不需要外部依赖。
</Info>

## 配置

Settings 位于 `plugins.entries["crawclaw-honcho"].config`：

```json5
{
  plugins: {
    entries: {
      "crawclaw-honcho": {
        config: {
          apiKey: "your-api-key", // self-hosted 时省略
          workspaceId: "crawclaw", // memory isolation
          baseUrl: "https://api.honcho.dev",
        },
      },
    },
  },
}
```

对于 self-hosted instances，把 `baseUrl` 指向本地 server（例如 `http://localhost:8000`），并省略 API key。

## 迁移现有 memory

如果你已有 workspace memory files（`USER.md`、`MEMORY.md`、`IDENTITY.md`、`memory/`、`canvas/`），
CrawClaw Desktop 或 Gateway API 中的 Honcho setup action 会检测并提供迁移。

<Info>
迁移是 non-destructive：files 会上传到 Honcho。原始文件不会被删除或移动。
</Info>

## 工作原理

每个 AI turn 后，conversation 都会被持久化到 Honcho。User 和 agent messages 都会被 observed，让 Honcho
随着时间推移构建和改进它的 models。

在 conversation 期间，memory runtime 会在 Rust agent runtime 构建 model turn 前组装 Honcho recall。
这让 turn boundaries 和 relevant recall 与 agent runtime 的其余 memory lifecycle 保持一致。

## Honcho vs builtin memory

|                   | Builtin memory               | Honcho                               |
| ----------------- | ---------------------------- | ------------------------------------ |
| **Storage**       | Workspace Markdown files     | Dedicated service（local 或 hosted） |
| **Cross-session** | 通过 memory files            | Automatic, built-in                  |
| **User modeling** | 手动（写入 MEMORY.md）       | Automatic profiles                   |
| **Search**        | Local index 和 prompt recall | Semantic over observations           |
| **Multi-agent**   | Not tracked                  | Parent/child awareness               |
| **Dependencies**  | None                         | Plugin install                       |

Honcho 和 builtin memory system 可以一起工作：builtin memory 让 local project guidance 保持可用，而 Honcho
通过 plugin service 增加 cross-session memory。

## Desktop 和 Gateway API actions

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

## 延伸阅读

- [Plugin source code](https://github.com/plastic-labs/crawclaw-honcho)
- [Honcho documentation](https://docs.honcho.dev)
- [Honcho CrawClaw integration guide](https://docs.honcho.dev/v3/guides/integrations/crawclaw)
- [Memory](/concepts/memory)：CrawClaw memory overview
- [Context Engine Removal](/concepts/context-engine)：已移除 legacy surface 的迁移说明
