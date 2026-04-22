---
read_when:
  - 你想了解记忆是如何工作的
  - 你想知道要写入哪些记忆文件
  - 你想理解什么是可回放的，什么是仅用于调试的
summary: CrawClaw 如何使用会话记忆、持久记忆、NotebookLM 经验召回和上下文归档
title: 记忆概览
x-i18n:
  generated_at: "2026-04-21T13:24:28Z"
  model: MiniMax-M2.7
  provider: minimax
  source_hash: f5ccb77422c74bb5c4996721f96dcfbefb0338a9ef2d7ce1f3ee4efcf954ccd7
  source_path: concepts/memory.md
  workflow: 15
---

# 记忆概览

CrawClaw 通过分层记忆系统来记住信息：

- **会话记忆** 用于单个会话内的短期任务连续性
- **持久记忆** 用于长期的用户和协作事实，范围由
  `agentId + channel + userId` 界定
- **经验召回** 由 NotebookLM 提供支持，在提示词组装期间查询
- **上下文归档** 用于记录/导出/调试运行期间实际看到和执行的内容

模型只“记住”持久化到这些层中的内容——没有隐藏状态。

## 持久记忆文件

持久记忆以纯 Markdown 文件形式存储在作用域的持久记忆目录下。每条记忆都是独立的笔记，每个作用域都有自己的 `MEMORY.md` 索引。

`MEMORY.md` 现在遵循有界的持久索引约束：

- 它仅作为索引，不存放记忆主体
- 不得包含 frontmatter
- 每条指针行应保持单行且约 150 个字符或更短
- 整个文件应保持在约 200 行和 25KB 以下
- 过时的细节应移回主题笔记，而非扩展索引

在召回时，CrawClaw 不会盲目注入整个持久记忆目录，也不会回退到将整个 `MEMORY.md` 文件放入系统提示词。持久召回现在在提示词组装期间同步运行：

- `MEMORY.md` 作为当前作用域的第一个持久记忆索引表面
- 标题元数据（如标题、描述和持久类型）提供下一层召回
- 轻量级正文索引缓存为每条笔记保留简短摘要和关键词集，以便标题/描述较弱的旧笔记在正文明显相关时仍能进入候选集
- 只有有界的顶部候选切片会读取正文摘要进行第二轮重排序
- 持久召回诊断现在记录所选笔记在 `index`、`header`、`body_index`、`body_rerank` 和/或 `dream_boost` 信号上是否胜出，以便检查/调试流程可以解释笔记被选中或遗漏的原因
- 仅对最终选中项加载完整笔记内容
- 最近被 dream 触动的笔记可以获得轻微的召回先验，但该先验会随时间衰减，且仅在当前查询已与笔记相关时才适用
- 提示词组装接收持久召回评分细分，对于持久密集型查询可以略微将记忆预算转向持久记忆，或在知识/SOP 召回更强时从持久记忆中移出
- 超过一天的选中持久笔记仍会携带新鲜度提醒，模型会被明确告知在将其视为事实之前要根据当前实际情况验证文件/代码/repo 状态

持久自动写入也遵循轮次结束完成触发器：

- 运行循环现在在最后一个顶级轮次后发出一个 `stop` 生命周期阶段，`memory_extractor` 作为订阅者消费该阶段
- 同一个 stop 事件可以携带捕获的父分叉上下文，包括父提示词信封和完整的模型可见消息上下文；嵌入的 `memory_extractor` 继承该分叉并仅追加一个狭窄的持久记忆维护提示词
- 基于游标的最近消息窗口仍然是提取边界；较旧的分叉上下文仅可用于解析最近消息中的引用，而非作为重新提取旧历史的来源
- 该轮次的新消息必须包含最终助手回复
- 如果最新的助手回复仍包含工具调用，或以 `error`/`aborted` 结尾，则跳过该轮次的后台持久提取
- 游标前进仅在轮次实际处理完成后才发生，因此不完整的工具调用轮次不会意外消耗提取历史

CrawClaw 还有一个第二层持久记忆维护：

- `memory_extractor` 是每个轮次的轻量级后台写入器
- `dream`（自动做梦）是默认启用的低频整合器；运行时门控仍需要配置的最小会话数、成功运行之间的最小小时数、扫描节流和数据库锁
- `session_summary` 是单个会话的短期连续性智能体
- `memory_extractor` 和 `dream` 现在都订阅运行循环的同一个 `stop` 阶段，而非直接从 `afterTurn` 调度
- 自动做梦使用运行时数据库状态，而非文件 `mtime`，来进行门控和锁所有权
- 自动做梦首选运行时存储、会话摘要和上下文归档信号，而非转录 grep 作为主要信号源
- 当摘要缺失或过时，或结构化信号太弱时，自动做梦可能向 dream 智能体暴露一个有界的 `memory_transcript_search` 回退。该回退仍限定在当前持久记忆作用域内，限制在选中的 dream 运行的最近会话 ID 中，并且仅返回简短的模型可见摘要。它不会打开 shell 访问或将原始转录 grep 作为主要工作流程。
- 自动做梦现在通过操作反馈界面展示方向/收集/整合/修剪的阶段级操作
- 手动 dream 运行现在可以用 `--session-limit`/`--signal-limit` 绑定，并可用 `--dry-run` 预览，而无需获取 dream 锁或写入记忆
- dream 状态现在保留最近的跳过/门控原因，以便状态/历史/检查可以解释为什么整合未启动
- 状态和检查界面现在明确报告检查的持久作用域的 dream 闭环是否激活，而非将 dream 作为不透明的可选后台行为
- 状态和检查界面还显示是否启用转录回退及其会话/匹配限制是多少，因此回退使用是一个明确的 dream 配置状态而非隐藏行为
- dream 状态/历史界面现在暴露最近的 `touchedNotes`，以便你可以在检查后续召回行为之前看到哪些持久笔记刚刚被重写

晋升与召回和维护是分开的：

- 持久召回直接读取作用域内的持久笔记
- `dream` 整合和修复那些持久笔记
- 晋升候选者是治理产物，用于后续审查/回写，而非提示时的持久召回输入
- 晋升负载被明确标记为 `surface: governance_only`，以使该边界可被机器读取，同时也是文档化的

## 会话记忆

会话记忆现在遵循单轨设计：

- 每个会话有一个 `summary.md` 文件
- 后台 `session_summary` 智能体从运行循环的后采样钩子维护该文件
- 摘要智能体从一个捕获的父分叉上下文运行：运行循环生命周期事件同时携带父提示词信封和完整的当前模型可见消息上下文，然后摘要运行追加一个狭窄的 `summary.md` 维护提示词，而非添加另一个摘要专用的系统提示词
- 分叉上下文是从活动的运行循环捕获的，而非从较旧的持久化行重构或从单独的持久化提示词产物重新组装，因此压缩边界与主智能体实际看到的内容保持一致
- 自动生命周期更新在分叉上下文缺失时跳过；明确的 CLI 或 Gateway 刷新从持久化的模型可见行重构一个有界的手动分叉上下文
- session-summary 为分叉保留短期缓存保留，但不派生或重用父提示词缓存键
- 调度器可以先用轻量级摘要配置文件启动，然后在以后将同一文件升级为完整配置文件
- 自然稳定的轮次仍会触发摘要更新，但调度器也可以在 token 增长阈值和工具调用阈值同时满足时提前刷新文件
- 运行时数据库仅存储边界/进度状态，如 `lastSummarizedMessageId`、`lastSummaryUpdatedAt`、`tokensAtLastSummary` 和 `summaryInProgress`

`summary.md` 是唯一的持久会话摘要来源。CrawClaw 不再将单独的运行时“会话卡片”作为主要会话记忆记录。

摘要文件使用固定结构，包括以下部分：

- `Session Title`（会话标题）
- `Current State`（当前状态）
- `Open Loops`（未完成事项）
- `Task specification`（任务规范）
- `Files and Functions`（文件和函数）
- `Workflow`（工作流）
- `Errors & Corrections`（错误和修正）
- `Codebase and System Documentation`（代码库和系统文档）
- `Learnings`（学习内容）
- `Key results`（关键结果）
- `Worklog`（工作日志）

该文件现在有两种维护模式：

- **轻量级配置文件** 首先更新最少工作状态部分：
  `Current State`、`Open Loops`、`Task specification` 和 `Key results`
- **完整配置文件** 扩展到更丰富的长期运行部分，如
  `Files and Functions`、`Workflow`、`Errors & Corrections`、`Learnings` 和 `Worklog`

提示词组装不再将 `summary.md` 注入模型可见的系统上下文。在压缩之前，连续性来自当前转录本，后台摘要智能体从同一模型可见转录本保持 `summary.md` 最新。当会话稍后压缩时，CrawClaw 将 `summary.md` 作为压缩历史的真实来源进行消费，将该渲染的压缩视图存储在压缩状态中，并在摘要边界之后仅保留最近的尾部。

压缩也不再消耗原始 `summary.md` 主体。它从最具连续性的部分渲染结构化压缩视图，包括 `Current State`、`Open Loops`、`Task specification`、`Files and Functions`、`Workflow`、`Errors & Corrections` 和 `Key results`。压缩后，提示词组装将该渲染的压缩摘要作为转录摘要消息预先添加到保留尾部之前；它仍然不会在普通轮次将完整的 `summary.md` 文件作为系统上下文注入。

会话摘要也可以为持久记忆晋升候选者提供种子。成功的摘要更新后，CrawClaw 从结构化摘要部分中提炼出稳定的长期事实，并将其记录为晋升候选者，而非直接写入持久记忆。这些候选者进入晋升/治理管道；它们不是第三层召回层，在某个后续工作流程明确将其具体化到其他地方之前不会被注入提示词组装。

会话记忆仍按 `sessionId` 键控，因此父智能体和派生的子智能体 **不** 共享同一个摘要文件。每个子运行拥有自己的 `summary.md`。

<Tip>
如果希望智能体长期记住某些内容，请明确告诉它。它可以根据事实的类型写入持久记忆或经验笔记。
</Tip>

## 经验召回

经验召回是一个提供商支持的层。NotebookLM 是当前的默认提供商，但提示词组装与经验提供商注册表对话，而非直接调用 NotebookLM CLI。CrawClaw 可以：

- 查询 NotebookLM 获取相关可复用经验
- 通过 `write_experience_note` 直接写入结构化经验笔记
- 通过 `crawclaw memory` 管理登录、刷新和提供商状态
- 通过 `crawclaw memory prompt-journal-summary` 汇总夜间记忆提示词诊断

经验召回在每个智能体轮次的上下文组装阶段运行。运行时首先对用户查询进行分类，然后从该分类构建提供商查询计划：

- 仅偏好提示词被路由到持久记忆并跳过经验提供商查询
- SOP 和操作手册提示词可以借用少量提供商搜索预算，以免弱元数据导致运营经验饥饿
- 成功的 `write_experience_note` 调用更新小型本地基线索引，因此最近写入的经验在实时提供商搜索无结果时仍可被召回
- 本地基线命中保持自己的 `local_experience_index` 来源，因此检查和提示词诊断可以将它们与实时 NotebookLM 命中区分开来
- 选中的经验召回仍由记忆提示词预算限制；层分配是软指导，但组装的经验部分必须适合该轮次的全局经验预算
- 选中的目标层、提供商 ID、原因和限制被写入记忆召回诊断，以便检查/调试流程可以解释经验被查询或跳过的原因

如果当前轮次没有可用的提示词，运行时完全跳过经验提供商查询。

`write_experience_note` 是当前运行时中唯一的 NotebookLM 写入路径。它在模式和安全验证后直接通过工具路径写入。经验笔记应记录可复用的上下文、触发条件、操作、结果、经验教训、适用边界和支持证据，而不是临时任务状态。

知识层目前不运行 `dream` 风格的后台整合智能体。自动知识清理、去重、过期笔记审查或跨提供商治理需要单独设计；它不应被折叠到持久记忆 dream 运行中或隐藏在提示时召回之后。

## 上下文归档

上下文归档是智能体运行面向回放的记录层。

它捕获：

- 模型可见上下文，包括组装的提示词/消息/工具表面
- 工具准入决策、循环策略操作和工具结果
- 轮次后更新，如会话摘要维护、压缩、完成和验证器结果

上下文归档与旧的记录层不同：

- **会话转录本** 是面向产品的对话记录，以后可能会被压缩或重写
- **提示词日志** 是仅用于调试的，故意是有损/截断的
- **诊断会话状态** 是内存中的镜像/缓存，不是持久的真实来源

如果你需要导出或回放任务支持的运行，上下文归档是要使用的层。

## 作用域和共享

这些层不共享相同的边界：

- **会话记忆** 按会话隔离。
- **持久记忆** 在运行解析到相同的
  `agentId + channel + userId` 作用域时共享。
- **经验召回** 在运行中跨会话使用相同的已配置 NotebookLM 后端；
  不按会话 ID 分区。

所有使用内置记忆运行时的智能体都接收相同的智能体记忆路由契约。本指南不仅限于 `main` 智能体。

## 会话摘要维护

在 [压缩](/concepts/compaction) 修剪会话之前，CrawClaw 等待当前 `session_summary` 运行在短有界窗口内完成，然后将 `summary.md` 加上 `lastSummarizedMessageId` 作为压缩边界。压缩在该摘要边界之后立即开始，仅在需要满足最小保留尾部条件时才向后扩展。如果崩溃的进程将 `summaryInProgress` 设置为超过过期租约窗口，压缩会清除过期租约而非等待已死亡的摘要运行。

这将短期连续性保持在一个真实来源上：

- 后台智能体更新 `summary.md`
- 该智能体看到由捕获的父分叉上下文携带的当前模型可见消息上下文
- 自动摘要更新需要该父分叉上下文；明确的 CLI/Gateway 刷新从持久化的模型可见行重构一个有界的手动分叉上下文
- 压缩保留摘要边界后的尾部，仅向后扩展到足以保持可用的最近工作集
- 压缩后，模型可见历史包含压缩摘要消息加上该保留尾部
- 提示词组装继续使用最近的转录本，不再单独注入 `summary.md`

## CLI

```bash
crawclaw memory status   # 检查 NotebookLM 提供商状态
crawclaw memory login    # 重建 NotebookLM 配置文件
crawclaw memory refresh  # 从 cookie 回退刷新 NotebookLM 认证
crawclaw memory dream status --json
crawclaw memory dream history --json
crawclaw memory dream run --agent main --channel telegram --user alice --force
crawclaw memory dream run --agent main --channel telegram --user alice --dry-run --session-limit 6 --signal-limit 6
crawclaw memory prompt-journal-summary --json --days 1
crawclaw agent export-context --task-id <task-id> --json
```

## 进一步阅读

- [记忆配置参考](/reference/memory-config) -- 所有配置旋钮
- [压缩](/concepts/compaction) -- 压缩如何与记忆交互
