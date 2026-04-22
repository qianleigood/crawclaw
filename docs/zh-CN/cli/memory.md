---
read_when:
  - 你想检查 NotebookLM 知识可用性
  - 你正在调试记忆写入、知识访问或提示词日志
summary: "`crawclaw memory`（status/login/refresh/dream/session-summary/prompt-journal-summary）的 CLI 参考"
title: memory
x-i18n:
  generated_at: "2026-04-05T20:28:00Z"
  model: gpt-5.4
  provider: codex
  source_hash: manual-update
  source_path: cli/memory.md
  workflow: manual
---

# `crawclaw memory`

用于查看和管理 NotebookLM 知识访问状态，以及汇总记忆提示词日志。

相关内容：

- 记忆概念：[记忆](/concepts/memory)
- 插件：[插件](/tools/plugin)

## 示例

```bash
crawclaw memory status
crawclaw memory refresh
crawclaw memory login
crawclaw memory dream status --json
crawclaw memory dream history --json
crawclaw memory dream run --agent main --channel telegram --user alice --force
crawclaw memory dream run --agent main --channel telegram --user alice --dry-run --session-limit 6 --signal-limit 6
crawclaw memory session-summary status --agent main --session-id sess-1 --json
crawclaw memory session-summary refresh --agent main --session-id sess-1 --session-key agent:main:sess-1 --force
crawclaw memory status --json
crawclaw memory prompt-journal-summary --json --days 1
crawclaw memory prompt-journal-summary --date 2026-04-05 --json
```

## 选项

`memory status`：

- `--json`：输出 JSON。
- `--verbose`：在 provider 探测期间输出详细日志。

`memory refresh` 和 `memory login`：

- `--json`：输出 JSON。
- `--verbose`：在刷新或登录过程中输出详细日志。

`memory prompt-journal-summary`：

- `--json`：输出机器可读的汇总 JSON。
- `--file <path>`：只汇总一个指定的 journal JSONL 文件。
- `--dir <path>`：从指定目录读取 journal 文件。
- `--date <YYYY-MM-DD>`：汇总指定日期桶。
- `--days <n>`：汇总最近 `n` 个按天滚动的 journal 文件。
- `--verbose`：读取 journal 时输出详细日志。

`memory dream status`：

- `--json`：输出机器可读的状态和最近运行历史。
- `--agent <id>` / `--channel <id>` / `--user <id>`：解析一个 durable scope。
- `--scope-key <key>`：查看一个显式 durable scope。
- `--limit <n>`：限制最近 dream runs 的条数。
- `--verbose`：输出详细日志。

`memory dream run`：

- `--json`：输出机器可读的运行结果。
- `--agent <id>` / `--channel <id>` / `--user <id>`：解析一个 durable scope。
- `--scope-key <key>`：对一个显式 durable scope 触发运行。
- `--force`：手动运行时跳过 min-hours 和 min-sessions gate。
- `--dry-run`：只预览 dream 窗口，不拿 runtime DB lock，也不写 durable memory。
- `--session-limit <n>`：限制这次手动运行或预览最多读取多少个最近 session。
- `--signal-limit <n>`：限制这次手动运行或预览最多读取多少条结构化 signal。
- `--verbose`：输出详细日志。

`memory dream history`：

- `--json`：输出机器可读的最近 dream runs。
- `--agent <id>` / `--channel <id>` / `--user <id>`：解析一个 durable scope。
- `--scope-key <key>`：过滤一个显式 durable scope。
- `--limit <n>`：限制最近运行条数。
- `--verbose`：输出详细日志。

`memory session-summary status`：

- `--json`：输出机器可读结果。
- `--agent <id>`：summary file 所属的 agent，默认 `main`。
- `--session-id <id>`：查看一个具体 session。
- `--verbose`：输出详细日志。

`memory session-summary refresh`：

- `--json`：输出机器可读结果。
- `--agent <id>`：summary file 所属的 agent，默认 `main`。
- `--session-id <id>`：刷新一个具体 session。
- `--session-key <key>`：运行后台 summary agent 时使用的 session key。
- `--force`：手动刷新时跳过 summary gate 检查。
- `--verbose`：输出详细日志。

说明：

- `memory status` 会显示当前 NotebookLM provider 的 lifecycle、reason、recommended action 等状态。
- `memory refresh` 会从配置好的 cookie fallback 重建本地 NotebookLM profile。
- `memory login` 会执行交互式 NotebookLM 登录流程，并重新验证 profile。
- `memory prompt-journal-summary` 会把 nightly memory prompt journal 汇总成 prompt assembly、after-turn decision、durable extraction、knowledge write 等统计数据。
- `memory dream status` 会从 runtime DB 显示 auto-dream state 和最近的 dream runs。
- `memory dream status` 现在还会显示最近一次 skip/gate reason，例如 `min_hours_gate`、`min_sessions_gate`、`scan_throttle`、`lock_held`。
- `memory dream run` 会对一个 durable scope 手动触发一次 dream run。
- `memory dream run --dry-run` 会复用相同的 gate 和输入收集逻辑，但不会真正启动 dream agent。
- `memory dream history` 会显示一个 scope 或所有 scope 最近的 dream 运行记录；如果某次 dream 失败，也会显示失败原因。
- `memory session-summary status` 会显示某个 session 当前 `summary.md` 的路径、文件状态以及 runtime 里的 summary boundary。
- `memory session-summary refresh` 会对某个 session 强制触发一次 `session_summary` 后台更新。
- durable `MEMORY.md` 索引现在会按 Claude 风格做校验：不能带 frontmatter、每条索引应保持单行短 hook，并整体控制在约 200 行 / 25KB 以内。
- NotebookLM 的 experience recall 本身发生在 live agent turn 的 prompt assembly 阶段；`crawclaw memory` 不会主动触发 recall。
- 当前运行时只有 `write_experience_note` 这一条 NotebookLM 写入路径。
- prompt journal 只用于 debug，而且会被截断/清洗；如果你要拿到可回放、
  可导出的运行真相层，应使用 Context Archive、`crawclaw agent inspect`
  或 `crawclaw agent export-context`。

## Prompt Journal

CrawClaw 可以把记忆提示词诊断按天写入：

```text
~/.crawclaw/logs/memory-prompt-journal/YYYY-MM-DD.jsonl
```

启用方式：

```bash
CRAWCLAW_MEMORY_PROMPT_JOURNAL=1
```

可选清理：

```bash
CRAWCLAW_MEMORY_PROMPT_JOURNAL_RETENTION_DAYS=14
```

这套日志主要用于记忆系统提示词优化和行为审计，会记录：

- memory prompt assembly 上下文
- after-turn durable extraction 决策
- durable extraction 的提示词和结果
- NotebookLM knowledge write 的结果

`prompt-journal-summary` 现在还会额外汇总 durable extraction 的保存率和最常见提取原因，便于排查提示词回退。

如果你需要某次 task-backed run 的 replay/export 记录，而不是 nightly 诊断
汇总，请改用：

```bash
crawclaw agent export-context --task-id <task-id> --json
```

它不是 canonical replay/export 层：

- prompt journal 是可选的，并且受环境变量开关控制
- payload 会被截断和清洗
- 真正的运行真相层是 Context Archive，它保存模型可见上下文、tool 决策和 post-turn 状态
