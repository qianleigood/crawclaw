---
read_when:
  - 你想要检查体验记忆可用性
  - 你需要登录、刷新或调试体验访问权限
  - 你想要记忆提示日志数据的夜间摘要
summary: CLI 参考：`crawclaw memory`（status/login/refresh/dream/session-summary/prompt-journal-summary）
title: 记忆
x-i18n:
  generated_at: "2026-05-02T05:22:56Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 2a6d662a845f96bb433d196c03776d08ca6a34d74855e0fbca204320381991dc
  source_path: cli/memory.md
  workflow: 15
---

# `crawclaw memory`

检查和管理体验记忆访问、可选的 NotebookLM 提供商集成、持久记忆维护和会话摘要维护。

相关：

- 记忆概念： [记忆](/concepts/memory)
- 插件： [插件](/tools/plugin)

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
```

## 选项

`memory status`：

- `--json`: 打印 JSON 输出。
- `--verbose`: 在提供商探测期间输出详细日志。

`memory refresh` 和 `memory login`：

- `--json`: 打印 JSON 输出。
- `--verbose`和

`memory prompt-journal-summary`：

- `--json`: 打印机器可读的摘要输出。
- `--file <path>`: 总结一个特定的 journal JSONL 文件。
- `--dir <path>`：从特定目录读取 journal 文件。
- `--date <YYYY-MM-DD>`: 总结一个特定的每日数据桶。
- `--days <n>`: 总结最近的 `n` 每日 journal 文件。
- `--verbose`：在读取 journal 文件时输出详细日志。

`memory dream status`：

- `--json`: 打印机器可读的文件的标记和锁定状态。
- `--agent <id>` / `--channel <id>` / `--user <id>`：解析一个持久作用域。
- `--scope-key <key>`：检查一个显式持久作用域。
- `--verbose`：输出详细日志。

`memory dream run`：

- `--json`: 打印机器可读的运行结果。
- `--agent <id>` / `--channel <id>` / `--user <id>`：解析一个持久作用域。
- `--scope-key <key>`：运行一个显式持久作用域。
- `--force`：绕过手动运行的最小小时数和最小会话数门控。
- `--dry-run`：预览 dream 窗口，无需获取文件锁或写入持久记忆。
- `--session-limit <n>`：限制手动运行或预览的最近会话数量。
- `--signal-limit <n>`：限制手动运行或预览的结构化信号数量。
- `--verbose`：输出详细日志。

`memory dream history`：

- `--json`：打印机器可读的历史可用性。
- `--agent <id>` / `--channel <id>` / `--user <id>`：解析一个持久作用域。
- `--scope-key <key>`：过滤一个显式持久作用域。
- `--verbose`：输出详细日志。

`memory session-summary status`：

- `--json`: 打印机器可读的摘要输出。
- `--agent <id>`拥有会话摘要文件的智能体 ID。默认为 `main`。
- `--session-id <id>`：检查一个具体的会话。
- `--verbose`：输出详细日志。

`memory session-summary refresh`：

- `--json`：打印机器可读的运行输出。
- `--agent <id>`拥有会话摘要文件的智能体 ID。默认为 `main`。
- `--session-id <id>`：刷新一个具体的会话。
- `--session-key <key>`：用于运行后台摘要智能体的会话密钥。
- `--force`：绕过手动刷新的摘要门控检查。
- `--verbose`：输出详细日志。

备注：

- `memory status` 报告当前 NotebookLM 提供商状态，包括生命周期、原因和推荐操作。
- `memory refresh` 从配置的 Cookie 后备方案重建本地 NotebookLM 配置文件。
- `memory login` 运行交互式 NotebookLM 登录流程并验证重建的配置文件。
- `memory sync` 将本地待处理的体验笔记刷新到 NotebookLM，并删除已成功同步的本地负载。
- `memory prompt-journal-summary` 将夜间记忆提示日志汇总为提示组装、回合后决策、持久化提取、经验提取和经验写入的计数。
- 自动 dream 默认启用，但在启动后台 dream 过程之前仍会遵守最小会话数、最小小时数、扫描节流和文件锁门控。
- `memory dream status` 报告每个作用域的 `.consolidate-lock` 文件标记、锁路径和活动/过期锁状态。
- `memory dream status` 明确报告 dream 闭环针对所检查的作用域是否处于活跃状态。 `closedLoopActive=false` 使用
  `closedLoopReason=disabled` 意味着配置已禁用它； `scope_unresolved`
  意味着状态无法解析正在检查的持久作用域。
- `memory dream run` 触发针对一个作用域的一次手动持久记忆 dream 过程。
- `memory dream run --dry-run` 预览相同的门控/输入收集路径，无需生成 dream 智能体。
- `memory dream history` 不再读取运行时数据库运行历史；Dream 使用该作用域 `.consolidate-lock` 文件 `mtime` 作为其持久化标记。
- `memory session-summary status` 显示当前的 `summary.md` 路径、文件状态和一个会话的运行时摘要边界。
- `memory session-summary status` 还报告推断的摘要配置文件和当前的 `Open Loops` 存在的部分。
- `memory session-summary refresh` 强制执行一次 `session_summary` 针对特定会话的后台更新。
- `memory session-summary refresh` 使用与自动会话摘要维护相同的轻量到完整调度路径。
- 持久化 `MEMORY.md` 索引现在被验证为有界召回索引：无 frontmatter，每行一个短指针，大约限制在 200 行 / 25KB。
- 持久化召回可观测性现在记录所选笔记在实际使用时是否被采纳
  `index`， `header`， `body_index`，和/或 `body_rerank` 信号；使用以下方式检查这些详情 `crawclaw agent inspect`。
- 仅 NotebookLM 的体验召回发生在活跃智能体回合的提示组装期间； `crawclaw memory` 不会触发召回。
- `crawclaw agent inspect` 报告 NotebookLM 提供商顺序中的体验召回。它不暴露本地体验排名分数，因为 CrawClaw 不再在本地重新排序 NotebookLM 结果。
- 体验智能体在符合条件的顶级回合之后运行，并记录 `experience_extract` 提示日志记录启用时的诊断信息。
- `write_experience_note` 是当前运行时中唯一的体验写入路径。
- 提示日志仅用于调试，且故意有损/截断。使用 Context Archive， `crawclaw agent inspect`或 `crawclaw agent export-context` 当你需要重放/导出级别的记录而不是提示调优诊断时使用。

## Prompt Journal

CrawClaw 可以将夜间记忆提示诊断记录到以下位置的 JSONL 文件中：

```text
~/.crawclaw/logs/memory-prompt-journal/YYYY-MM-DD.jsonl
```

启用方式：

```bash
CRAWCLAW_MEMORY_PROMPT_JOURNAL=1
```

可选维护：

```bash
CRAWCLAW_MEMORY_PROMPT_JOURNAL_RETENTION_DAYS=14
```

提示日志旨在用于提示调优和行为审计。它捕获：

- 记忆提示组装上下文
- 回合后持久化提取决策
- 持久化提取提示和结果
- 后台体验提取决策和结果
- 体验写入结果，包括本地 outbox 写入和可选的 NotebookLM 同步

摘要命令还呈现持久化提取保存率和主要提取原因，以便更容易发现提示回归。

如果你需要重放/导出级别的运行历史而不是夜间诊断，使用 Context Archive，通过：

```bash
crawclaw agent export-context --task-id <task-id> --json
```

这不是规范的重放/导出层：

- 提示日志是可选的，且由环境变量控制
- 负载会被截断/脱敏
- Context Archive 是模型可见上下文、工具决策和回合后状态的运行级真相层
