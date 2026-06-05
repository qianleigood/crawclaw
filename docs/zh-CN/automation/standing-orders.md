---
read_when:
  - 设置无需逐项提示即可运行的自主智能体工作流
  - 定义智能体可独立执行的事项和需要人工审批的事项
  - 用清晰边界和升级规则组织多程序智能体
summary: 为自主智能体程序定义永久操作权限
title: 常设指令
x-i18n:
  generated_at: "2026-06-05T14:02:39Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: a17db5f8873d0cd5ed3cdd163f3846d79bd75144416c2cd1c22fff4775ba10fe
  source_path: automation/standing-orders.md
  workflow: 15
---

# 常设指令

常设指令为你的智能体授予定义程序的**永久操作权限**。无需每次都给出单独的任务指令，你可以定义具有明确范围、触发条件和升级规则的程序——智能体将在这些边界内自主执行。

这就像每周五都告诉助手"发送周报"，与授予持续性授权之间的区别："这份周报由你负责。每周五编写并发送，只在出现异常时升级。"

## 为什么要设置常设指令？

**没有常设指令时：**

- 你必须为每个任务提示智能体
- 智能体在请求之间处于空闲状态
- 常规工作被遗忘或延迟
- 你成为瓶颈

**有常设指令时：**

- 智能体在定义边界内自主执行
- 常规工作按计划进行，无需提示
- 你只在异常和审批时介入
- 智能体高效利用空闲时间

## 工作原理

常设指令在[智能体工作区](/concepts/agent-workspace)文件中定义。推荐的方法是直接将它们包含在 `AGENTS.md` 中（每次会话会自动注入），这样智能体始终在上下文中看到它们。对于较大的配置，你也可以将它们放在专用文件（如 `standing-orders.md`）中，然后从 `AGENTS.md` 中引用。

每个程序指定：

1. **范围** — 智能体被授权做什么
2. **触发条件** — 何时执行（计划、事件或条件）
3. **审批门控** — 哪些需要人工签字才能执行
4. **升级规则** — 何时停止并寻求帮助

智能体通过工作区引导层（默认情况下是 `AGENTS.md`）在每次会话中加载这些指令，并与[cron 任务](/automation/cron-jobs)结合执行时间强制。

<Tip>
将常设指令放在 `AGENTS.md` 中以保证每次会话都加载它们。其他工作区文件仍然可以存在，但除非 hook 或工作流显式注入，否则它们不再属于默认的每轮引导。
</Tip>

## 常设指令的结构

```markdown
## Program: Weekly Status Report

**Authority:** Compile data, generate report, deliver to stakeholders
**Trigger:** Every Friday at 4 PM (enforced via cron job)
**Approval gate:** None for standard reports. Flag anomalies for human review.
**Escalation:** If data source is unavailable or metrics look unusual (>2σ from norm)

### Execution Steps

1. Pull metrics from configured sources
2. Compare to prior week and targets
3. Generate report in Reports/weekly/YYYY-MM-DD.md
4. Deliver summary via configured channel
5. Log completion to Agent/Logs/

### What NOT to Do

- Do not send reports to external parties
- Do not modify source data
- Do not skip delivery if metrics look bad — report accurately
```

## 常设指令 + Cron 任务

常设指令定义智能体**被授权做什么**。[Cron 任务](/automation/cron-jobs)定义**何时**执行。它们协同工作：

```
常设指令："你负责每日收件箱分类"
    ↓
Cron 任务（每天上午 8 点）："按常设指令执行收件箱分类"
    ↓
智能体：读取常设指令 → 执行步骤 → 报告结果
```

Cron 任务提示应引用常设指令而不是重复它：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

## 示例

### 示例 1：内容与社交媒体（每周循环）

```markdown
## Program: Content & Social Media

**Authority:** Draft content, schedule posts, compile engagement reports
**Approval gate:** All posts require owner review for first 30 days, then standing approval
**Trigger:** Weekly cycle (Monday review → mid-week drafts → Friday brief)

### Weekly Cycle

- **Monday:** Review platform metrics and audience engagement
- **Tuesday–Thursday:** Draft social posts, create blog content
- **Friday:** Compile weekly marketing brief → deliver to owner

### Content Rules

- Voice must match the brand (see SOUL.md or brand voice guide)
- Never identify as AI in public-facing content
- Include metrics when available
- Focus on value to audience, not self-promotion
```

### 示例 2：财务运营（事件触发）

```markdown
## Program: Financial Processing

**Authority:** Process transaction data, generate reports, send summaries
**Approval gate:** None for analysis. Recommendations require owner approval.
**Trigger:** New data file detected OR scheduled monthly cycle

### When New Data Arrives

1. Detect new file in designated input directory
2. Parse and categorize all transactions
3. Compare against budget targets
4. Flag: unusual items, threshold breaches, new recurring charges
5. Generate report in designated output directory
6. Deliver summary to owner via configured channel

### Escalation Rules

- Single item > $500: immediate alert
- Category > budget by 20%: flag in report
- Unrecognizable transaction: ask owner for categorization
- Failed processing after 2 retries: report failure, do not guess
```

### 示例 3：监控与告警（持续）

```markdown
## Program: System Monitoring

**Authority:** Check system health, restart services, send alerts
**Approval gate:** Restart services automatically. Escalate if restart fails twice.
**Trigger:** Cron job on the desired monitoring interval

### Checks

- Service health endpoints responding
- Disk space above threshold
- Pending tasks not stale (>24 hours)
- Delivery channels operational

### Response Matrix

| Condition        | Action                   | Escalate?                |
| ---------------- | ------------------------ | ------------------------ |
| Service down     | Restart automatically    | Only if restart fails 2x |
| Disk space < 10% | Alert owner              | Yes                      |
| Stale task > 24h | Remind owner             | No                       |
| Channel offline  | Log and retry next cycle | If offline > 2 hours     |
```

## 执行-验证-报告模式

常设指令与严格的执行纪律相结合时效果最佳。常设指令中的每个任务都应遵循此循环：

1. **执行** — 做实际工作（不要只是确认指令）
2. **验证** — 确认结果正确（文件存在、消息已送达、数据已解析）
3. **报告** — 告诉所有者做了什么以及验证了什么

```markdown
### Execution Rules

- Every task follows Execute-Verify-Report. No exceptions.
- "I'll do that" is not execution. Do it, then report.
- "Done" without verification is not acceptable. Prove it.
- If execution fails: retry once with adjusted approach.
- If still fails: report failure with diagnosis. Never silently fail.
- Never retry indefinitely — 3 attempts max, then escalate.
```

此模式防止最常见的智能体失败模式：确认任务而不完成它。

## 多程序架构

对于管理多个关注点的智能体，将常设指令组织为具有清晰边界的独立程序：

```markdown
# Standing Orders

## Program 1: [Domain A] (Weekly)

...

## Program 2: [Domain B] (Monthly + On-Demand)

...

## Program 3: [Domain C] (As-Needed)

...

## Escalation Rules (All Programs)

- [Common escalation criteria]
- [Approval gates that apply across programs]
```

每个程序应具有：

- 自己的**触发节奏**（每周、每月、事件驱动、持续）
- 自己的**审批门控**（某些程序比其他程序需要更多监督）
- 清晰的**边界**（智能体应该知道一个程序在哪里结束，另一个在哪里开始）

## 最佳实践

### 应该做

- 从窄权限开始，随着信任的建立逐步扩展
- 为高风险操作定义明确的审批门控
- 包含"不应该做什么"部分——边界与权限同样重要
- 与 cron 任务结合使用以实现可靠的时间执行
- 每周审查智能体日志以验证常设指令是否被遵守
- 随着需求的演变更新常设指令——它们是活的文档

### 避免

- 在第一天就授予广泛权限（"做你认为最好的任何事"）
- 跳过升级规则——每个程序都需要"何时停止并询问"条款
- 假设智能体会记住口头指令——把所有东西都写在文件中
- 在单个程序中混合关注点——不同领域使用不同程序
- 忘记用 cron 任务强制执行——没有触发条件的常设指令会变成建议

## 相关

- [自动化与任务](/automation) — 所有自动化机制一览
- [Cron 任务](/automation/cron-jobs) — 常设指令的计划执行
- [Hooks](/automation/hooks) — SDK 生命周期 hooks 和 webhooks
- [Webhooks](/automation/cron-jobs#webhooks) — 入站 HTTP 事件触发器
- [智能体工作区](/concepts/agent-workspace) — 常设指令的存放位置，包括自动注入的引导文件完整列表（AGENTS.md、SOUL.md 等）
