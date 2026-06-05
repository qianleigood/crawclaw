---
read_when:
  - 你需要具有显式审批的多步骤确定性工作流
  - 你需要恢复工作流而不重新执行之前的步骤
summary: 带可恢复审批门控的 CrawClaw 类型化工作流运行时
title: Lobster
x-i18n:
  generated_at: "2026-06-05T14:05:15Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 36eddbd6face8974ed805f73ea8bf01699dcf32c50cc9707cc33fa0b8755a6fc
  source_path: tools/lobster.md
  workflow: 15
---

# Lobster

Lobster 是一个工作流外壳，让 CrawClaw 能够将多步骤工具序列作为单一确定性操作来运行，并带有显式审批检查点。

Lobster 是独立后台工作之上的一个创作层。关于当前多步骤工作流资产和 n8n 执行，参见[任务流](/automation/taskflow)。关于任务活动账本，参见[后台任务](/automation/tasks)。

## 钩子

你的助手可以构建管理自身的工具。请求一个工作流，30 分钟后你就拥有了一个 CLI 加上作为一次调用运行的管道。Lobster 就是缺失的部分：确定性管道、显式审批和可恢复状态。

## 为什么

当前，复杂工作流需要许多来回的工具调用。每次调用都消耗 token，且 LLM 必须编排每个步骤。Lobster 将这种编排移入类型化运行时：

- **一次调用而非多次**：CrawClaw 运行一次 Lobster 工具调用并获得结构化结果。
- **内置审批**：副作用（发送邮件、发布评论）暂停工作流直到显式审批。
- **可恢复**：暂停的工作流返回一个 token；审批并恢复而无需重新运行所有内容。

## 为什么是 DSL 而非普通程序？

Lobster 有意设计得很小。目标不是“一种新语言”，而是一个可预测的、AI 友好的管道规范，带有一等审批和恢复 token。

- **审批/恢复是内置的**：普通程序可以提示人类，但它无法在没有你自己发明该运行时的情况下*暂停并用持久 token 恢复*。
- **确定性 + 可审计性**：管道是数据，因此易于记录、diff、重放和审查。
- **AI 的受限表面**：小语法 + JSON 管道减少了“创意”代码路径并使验证变得现实。
- **仍然可编程**：每个步骤可以调用任何 CLI 或脚本。如果你想要 JS/TS，从代码生成 `.lobster` 文件。

## 工作原理

CrawClaw 在**工具模式**下启动本地 `lobster` CLI 并从 stdout 解析 JSON 信封。如果管道暂停等待审批，工具返回 `resumeToken` 以便你稍后继续。

## 模式：小 CLI + JSON 管道 + 审批

构建说 JSON 的小命令，然后链接成单一 Lobster 调用。（下方示例命令名称——替换为你自己的。）

```bash
inbox list --json
inbox categorize --json
inbox apply --json
```

```json
{
  "action": "run",
  "pipeline": "exec --json --shell 'inbox list --json' | exec --stdin json --shell 'inbox categorize --json' | exec --stdin json --shell 'inbox apply --json' | approve --preview-from-stdin --limit 5 --prompt 'Apply changes?'",
  "timeoutMs": 30000
}
```

如果管道请求审批，用 token 恢复：

```json
{
  "action": "resume",
  "token": "<resumeToken>",
  "approve": true
}
```

AI 触发工作流；Lobster 执行步骤。审批门控保持副作用显式且可审计。

示例：将输入项映射到工具调用：

```bash
gog.gmail.search --query 'newer_than:1d' \
  | crawclaw.invoke --tool message --action send --each --item-key message --args-json '{"provider":"feishu","to":"..."}'
```

## 仅 JSON 的 LLM 步骤（llm-task）

对于需要**结构化 LLM 步骤**的工作流，启用可选的 `llm-task` 插件工具并从 Lobster 调用它。这保持工作流确定性，同时仍允许你用模型进行分类/摘要/起草。

启用工具：

```json
{
  "plugins": {
    "entries": {
      "llm-task": { "enabled": true }
    }
  },
  "agents": {
    "list": [
      {
        "id": "main",
        "tools": { "allow": ["llm-task"] }
      }
    ]
  }
}
```

在管道中使用：

```lobster
crawclaw.invoke --tool llm-task --action json --args-json '{
  "prompt": "Given the input email, return intent and draft.",
  "thinking": "low",
  "input": { "subject": "Hello", "body": "Can you help?" },
  "schema": {
    "type": "object",
    "properties": {
      "intent": { "type": "string" },
      "draft": { "type": "string" }
    },
    "required": ["intent", "draft"],
    "additionalProperties": false
  }
}'
```

参见 [LLM Task](/tools/llm-task) 了解详情和配置选项。

## 工作流文件（.lobster）

Lobster 可以运行带有 `name`、`args`、`steps`、`env`、`condition` 和 `approval` 字段的 YAML/JSON 工作流文件。在 CrawClaw 工具调用中，将 `pipeline` 设置为文件路径。

```yaml
name: inbox-triage
args:
  tag:
    default: "family"
steps:
  - id: collect
    command: inbox list --json
  - id: categorize
    command: inbox categorize --json
    stdin: $collect.stdout
  - id: approve
    command: inbox apply --approve
    stdin: $categorize.stdout
    approval: required
  - id: execute
    command: inbox apply --execute
    stdin: $categorize.stdout
    condition: $approve.approved
```

注意：

- `stdin: $step.stdout` 和 `stdin: $step.json` 传递前一步的输出。
- `condition`（或 `when`）可以根据 `$step.approved` 门控步骤。

## 安装 Lobster

在与运行 CrawClaw Gateway 的**同一主机**上安装 Lobster CLI（参见 [Lobster 仓库](https://github.com/crawclaw/lobster)），并确保 `lobster` 在 `PATH` 上。

## 启用工具

Lobster 是一个**可选**插件工具（默认不启用）。

推荐方式（增量添加，安全）：

```json
{
  "tools": {
    "alsoAllow": ["lobster"]
  }
}
```

或按智能体：

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "tools": {
          "alsoAllow": ["lobster"]
        }
      }
    ]
  }
}
```

除非你打算在限制性允许列表模式下运行，否则避免使用 `tools.allow: ["lobster"]`。

注意：允许列表对可选插件是可选加入的。如果你的允许列表只命名了插件工具（如 `lobster`），CrawClaw 会保持核心工具启用。要限制核心工具，也要在允许列表中包含你想要的核销工具或组。

## 示例：邮件分类

没有 Lobster：

```
用户："检查我的邮件并起草回复"
→ crawclaw 调用 gmail.list
→ LLM 摘要
→ 用户："起草 #2 和 #5 的回复"
→ LLM 起草
→ 用户："发送 #2"
→ crawclaw 调用 gmail.send
（每天重复，对已分类内容无记忆）
```

有 Lobster：

```json
{
  "action": "run",
  "pipeline": "email.triage --limit 20",
  "timeoutMs": 30000
}
```

返回 JSON 信封（截断）：

```json
{
  "ok": true,
  "status": "needs_approval",
  "output": [{ "summary": "5 need replies, 2 need action" }],
  "requiresApproval": {
    "type": "approval_request",
    "prompt": "Send 2 draft replies?",
    "items": [],
    "resumeToken": "..."
  }
}
```

用户审批 → 恢复：

```json
{
  "action": "resume",
  "token": "<resumeToken>",
  "approve": true
}
```

一个工作流。确定性。安全。

## 工具参数

### `run`

在工具模式下运行管道。

```json
{
  "action": "run",
  "pipeline": "gog.gmail.search --query 'newer_than:1d' | email.triage",
  "cwd": "workspace",
  "timeoutMs": 30000,
  "maxStdoutBytes": 512000
}
```

带参数运行工作流文件：

```json
{
  "action": "run",
  "pipeline": "/path/to/inbox-triage.lobster",
  "argsJson": "{\"tag\":\"family\"}"
}
```

### `resume`

审批后继续暂停的工作流。

```json
{
  "action": "resume",
  "token": "<resumeToken>",
  "approve": true
}
```

### 可选输入

- `cwd`：管道的相对工作目录（必须保持在当前进程工作目录内）。
- `timeoutMs`：如果超过此持续时间则终止子进程（默认值：20000）。
- `maxStdoutBytes`：如果 stdout 超过此大小则终止子进程（默认值：512000）。
- `argsJson`：传递给 `lobster run --args-json` 的 JSON 字符串（仅限工作流文件）。

## 输出信封

Lobster 返回带有三种状态之一的 JSON 信封：

- `ok` → 成功完成
- `needs_approval` → 暂停；需要 `requiresApproval.resumeToken` 才能恢复
- `cancelled` → 显式拒绝或取消

工具在 `content`（格式化的 JSON）和 `details`（原始对象）中呈现信封。

## 审批

如果存在 `requiresApproval`，检查提示并决定：

- `approve: true` → 恢复并继续副作用
- `approve: false` → 取消并结束工作流

使用 `approve --preview-from-stdin --limit N` 将 JSON 预览附加到审批请求，无需自定义 jq/here-doc 粘合。恢复 token 现在是紧凑的：Lobster 将工作流恢复状态存储在其状态目录下，并返回一个小的 token 键。

## OpenProse

OpenProse 与 Lobster 搭配得很好：用 `/prose` 编排多智能体准备，然后运行 Lobster 管道进行确定性审批。如果 Prose 程序需要 Lobster，通过 `tools.subagents.tools` 为子智能体允许 `lobster` 工具。参见 [OpenProse](/prose)。

## 安全

- **仅本地子进程** — 插件本身无网络调用。
- **无密钥** — Lobster 不管理 OAuth；它调用执行此操作的 CrawClaw 工具。
- **加固** — `PATH` 上固定的可执行文件名（`lobster`）；强制执行超时和输出限制。

## 故障排除

- **`lobster 子进程超时`** → 增加 `timeoutMs`，或拆分长管道。
- **`lobster 输出超过 maxStdoutBytes`** → 提高 `maxStdoutBytes` 或减小输出大小。
- **`lobster 返回无效 JSON`** → 确保管道以工具模式运行且仅打印 JSON。
- **`lobster 失败（代码 …）`** → 在终端中运行相同管道以检查 stderr。

## 了解更多

- [插件](/tools/plugin)
- [插件运行时能力](/plugins/building-plugins#runtime-capabilities)

## 案例研究：社区工作流

一个公开示例：一个“第二大脑”CLI + Lobster 管道，管理三个 Markdown 库（个人、伴侣、共享）。CLI 发出 JSON 格式的统计数据、收件箱列表和陈旧扫描；Lobster 将这些命令链接成 `weekly-review`、`inbox-triage`、`dream` 和 `shared-task-sync` 等工作流，每个都有审批门控。AI 在可用时处理判断（分类），在不可用时回退到确定性规则。

- 讨论串：[https://x.com/plattenschieber/status/2014508656335770033](https://x.com/plattenschieber/status/2014508656335770033)
- 仓库：[https://github.com/bloomedai/brain-cli](https://github.com/bloomedai/brain-cli)

## 相关

- [自动化与任务](/automation) — 调度 Lobster 工作流
- [自动化概览](/automation) — 所有自动化机制
- [工具概览](/tools) — 所有可用的智能体工具
