---
read_when:
  - 你希望审核或应用 CrawClaw 改进提案
  - 你需要检查 Skill 或工作流晋升的证据
  - 你想要回滚一个已应用的改进提案
summary: CLI 参考：`crawclaw improve` 提案收件箱、审核、应用、验证、回滚和指标
title: 改进
x-i18n:
  generated_at: "2026-05-02T05:18:37Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: ff1249c9fb2a35c5b9d9c055c5d31e40c197cce63c0fd3c07ddd3ff05e03ddb4
  source_path: cli/improve.md
  workflow: 15
---

# `crawclaw improve`

审核并应用由 CrawClaw 的经验到 Skill 和经验到工作流的晋升循环所产生的治理改进提案。

相关：

- 学习循环： [学习循环](/concepts/learning-loop)
- Skills 和工作流： [Skill 与工作流的区别](/concepts/skill-vs-workflow)
- 记忆： [记忆](/concepts/memory)

## 示例

```bash
crawclaw improve run
crawclaw improve inbox
crawclaw improve inbox --status pending_review,approved --kind skill --json
crawclaw improve show proposal-123
crawclaw improve review proposal-123 --approve --reviewer maintainer
crawclaw improve review proposal-123 --reject --comments "Needs more evidence"
crawclaw improve apply proposal-123
crawclaw improve verify proposal-123
crawclaw improve rollback proposal-123
crawclaw improve metrics --json
```

## 选项

`improve run`：

- `--json`: 打印机器可读的运行输出。

`improve inbox`：

- `--status <csv>`: 按提案状态筛选，例如 `pending_review` 或
  `applied`。
- `--kind <csv>`: 按提案类型筛选： `skill`， `workflow`或 `code`。
- `--limit <n>`: 限制提案数量。默认为 `50`。
- `--json`: 打印机器可读的提案列表输出。

`improve show <id>`：

- `--json`: 打印完整的提案详情、证据引用、政策阻碍项和可用操作。

`improve review <id>`：

- `--approve`: 批准该提案。
- `--reject`: 拒绝该提案。
- `--reviewer <name>`: 记录审核者姓名。
- `--comments <text>`: 记录审核评论。
- `--json`：打印更新后的提案。

`improve apply <id>`， `improve verify <id>`， `improve rollback <id>`和
`improve metrics`：

- `--json`: 打印机器可读的输出。

## 行为

- 提案存储在工作区本地的 `.crawclaw/improvements`
  目录中。
- `improve run` 向 NotebookLM 请求重复的经验信号，并能从其返回的结构化候选中创建新提案。
- 如果 NotebookLM 被禁用或返回的结构化候选为空，扫描将记录
  `no_candidate`；它不会将本地待处理发件箱作为后备读取。
- `improve inbox` 是用于审核 Skills 和工作流晋升的提案队列。
- `improve show` 在批准任何内容之前显示证据引用、风险、政策阻碍项和补丁预览。
- `improve apply` 需要已批准的审核和通过的政策门控。
- `improve rollback` 使用记录的应用程序产物。生成的 Skills 会被删除或从其之前的 markdown 中恢复；工作流更新在存在先前版本时使用工作流版本回滚。
- 代码改进提案在收件箱中可见，但它们不能自动应用或回滚。它们必须经过手动隔离的工作树和审核流程。

## 文本用户界面

终端 UI 也提供相同的审核界面：

```text
/improve
/improve <proposal-id>
/improve run
```

使用详情覆盖层来批准、拒绝、应用、验证或回滚提案，而无需离开 `crawclaw tui`。
