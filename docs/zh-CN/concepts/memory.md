---
read_when:
  - 你想了解记忆是如何工作的
  - 你想知道需要写入哪些记忆文件
  - 你想了解哪些内容可回放、哪些仅用于调试
summary: CrawClaw 如何使用会话记忆、持久记忆、经验记忆和上下文存档
title: 记忆概览
x-i18n:
  generated_at: "2026-05-01T06:58:40Z"
  model: MiniMax-M2.7
  provider: minimax
  source_hash: f75af9014b4c239ba6aa168382fe995812c8015e4d2acca9e3b0d6d70ebd4100
  source_path: concepts/memory.md
  workflow: 15
---

# 记忆概览

CrawClaw 通过分层记忆系统来记住信息：

- **会话记忆** 用于在单个会话内维持短期任务连续性
- **持久记忆** 用于长期的用户和协作事实，以
  `agentId + channel + userId` 为作用域
- **经验记忆** 由本地索引、可选的 NotebookLM 提供商、
  后台经验智能体和提示时召回组成
- **上下文存档** 用于回放/导出/调试运行期间实际看到和执行的操作记录

模型只会"记住"持久化到这些层中的内容——没有隐藏状态。

## 持久记忆文件

持久记忆以纯 Markdown 文件形式存储在作用域对应的持久记忆目录下。每条记忆都是一个独立的笔记，每个作用域都有自己
的 `MEMORY.md` 索引。

`MEMORY.md` 现在遵循有限持久索引约束：

- 它仅作为索引，不用于存放记忆主体
- 禁止包含 frontmatter
- 每条指针行应保持单行且不超过约 150 个字符
- 整个文件应控制在约 200 行和 25KB 以内
- 过时的详情应移回主题笔记，而非扩展索引

在召回时，CrawClaw 不会盲目注入整个持久记忆目录，也不会退而求其次地将整个 `MEMORY.md` 文件放入系统提示词。持久召回现在在提示词组装期间同步运行：

- `MEMORY.md` 作为当前作用域的持久记忆索引第一层
- 头部元数据（如标题、描述和持久类型）提供下一层召回
- 轻量级主体索引缓存为每条笔记保留简短摘要和关键词集，使标题/描述较弱但正文明显相关的旧笔记也能进入候选集
- 只有有限数量的顶级候选会读取正文摘要进行二次重排序
- 持久召回诊断现在记录选中的笔记是基于 `index`、`header`、`body_index`、`body_rerank` 和/或 `dream_boost` 信号中的哪个获胜，以便检查/调试流程能够解释笔记被选中或遗漏的原因
- 仅在最终选中项上加载完整笔记内容
- 最近被 dream 触达的笔记可以获得轻微的召回先验，但该先验会随时间衰减，且仅在当前查询已与该笔记相关时才适用
- 提示词组装接收持久召回分数明细，可以将少量记忆预算转向持久记忆（对于持久密集型查询）或远离持久记忆（当经验/SOP 召回是更强的匹配时）
- 超过一天的选中持久笔记仍会带有新鲜度提醒，模型会被明确告知在将其作为事实之前，验证文件/代码/repo 状态声明是否符合当前实际情况

持久自动写入也遵循轮次结束完成触发器：

- 运行循环现在在最终顶级轮次后发出 `stop` 生命周期阶段，`memory_extractor` 作为订阅者消费该阶段
- 相同的 stop 事件可以携带捕获的父分叉上下文，包括父提示词信封和完整的模型可见消息上下文；嵌入的 `memory_extractor` 继承该分叉并仅附加一条窄带的持久记忆维护提示词
- 基于游标的最近消息窗口仍然是提取边界；较旧的分叉上下文仅可用于解析最近消息中的引用，而非作为重新提取过时历史的来源
- 该轮次的新消息必须包含最终助手回复
- 如果最新的助手回复仍包含工具调用，或以 `error`/`aborted` 结束，则跳过该轮次的后台持久提取
- 游标前进仅在轮次实际处理完成后才发生，因此不完整的工具调用轮次不会意外消耗提取历史

CrawClaw 还有第二层持久记忆维护：

- `memory_extractor` 是轻量级每轮后台写入器
- `dream`（自动做梦）默认启用，作为低频整合器；运行时门控仍然需要配置的最小会话数、成功运行之间的最小小时数、扫描节流和数据库锁
- `session_summary` 是单个会话的短期连续性智能体
- `memory_extractor` 和 `dream` 现在都订阅运行循环的 `stop` 阶段，而非直接从 `afterTurn` 调度
- 自动做梦使用运行时数据库状态，而非文件 `mtime`，用于门控和锁所有权
- 自动做梦优先使用运行时存储、会话摘要和上下文存档信号，而非转录 grep 作为主要信号源
- 当摘要缺失或过时，或结构化信号太弱时，自动做梦可能会向 dream 智能体暴露有限的 `memory_transcript_search` 后备。该后备仍限定在当前持久记忆作用域内，限制在选择用于 dream 运行的最近会话 ID 内，仅返回简短的模型可见摘要。它不会打开 shell 访问，也不会将原始转录 grep 作为主要工作流程。
- 自动做梦现在通过操作反馈界面呈现面向/收集/整合/修剪的阶段级操作
- 手动 dream 运行现在可以用 `--session-limit`/`--signal-limit` 限定范围，并用 `--dry-run` 预览，而无需获取 dream 锁或写入记忆
- dream 状态现在保留最近的跳过/门控原因，以便 status/history/inspect 可以解释整合未启动的原因
- status 和 inspect 界面明确报告 dream 闭环是否在检查的持久作用域上激活，而非将 dream 留作不透明的可选后台行为
- status 和 inspect 界面还显示是否启用了转录后备及其会话/匹配限制，以便后备使用成为明确的 dream 配置状态而非隐藏行为
- dream status/history 界面现在暴露最近的 `touchedNotes`，以便你可以在检查后续召回行为之前查看刚刚重写的持久笔记

晋升与召回和维护是分开的：

- 持久召回直接从作用域持久笔记读取
- `dream` 整合和修复这些持久笔记
- 晋升候选是供后续审查/回写的治理产物，非提示时持久召回输入
- 晋升载荷明确标记为 `surface: governance_only`，以使该边界可被机器读取，同时也是文档化边界

## 会话记忆

会话记忆现在遵循单轨设计：

- 每个会话只有一个 `summary.md` 文件
- 后台 `session_summary` 智能体从运行循环采样后钩子维护该文件
- 摘要智能体从一个捕获的父分叉上下文运行：运行循环生命周期事件同时携带父提示词信封和完整的当前模型可见消息上下文，然后摘要运行仅附加一条窄带的 `summary.md` 维护提示词，而非添加另一个摘要专用的系统提示词
- 分叉上下文从活动运行循环捕获，而非从较旧的持久化行重构或从单独的持久化提示词产物重新组装，因此压缩边界与主智能体实际看到的内容保持一致
- 自动生命周期更新在分叉上下文缺失时跳过；显式 CLI 或网关刷新从持久化的模型可见行重构有限的手动分叉上下文
- 会话摘要为分叉保留短期缓存保留，但不派生或重用父提示词缓存键
- 调度器可以先用轻量级摘要配置文件启动，稍后再将同一文件升级为完整配置文件
- 自然稳定轮次仍然触发摘要更新，但当令牌增长阈值和工具调用阈值同时满足时，调度器也可以更早刷新文件
- 运行时数据库仅存储边界/进度状态，如 `lastSummarizedMessageId`、`lastSummaryUpdatedAt`、`tokensAtLastSummary` 和 `summaryInProgress`

`summary.md` 是唯一的持久会话摘要来源。CrawClaw 不再将单独的运行时"会话卡片"作为主要会话记忆记录。

摘要文件使用固定结构，包括以下部分：

- `Session Title`（会话标题）
- `Current State`（当前状态）
- `Open Loops`（未完成事项）
- `Task specification`（任务规范）
- `Files and Functions`（文件和函数）
- `Workflow`（工作流）
- `Errors & Corrections`（错误与修正）
- `Codebase and System Documentation`（代码库和系统文档）
- `Learnings`（学习成果）
- `Key results`（关键结果）
- `Worklog`（工作日志）

该文件现在有两种维护模式：

- **轻量级配置** 优先更新最少工作状态部分：
  `Current State`、`Open Loops`、`Task specification` 和 `Key results`
- **完整配置** 扩展到更丰富的长期运行部分，如
  `Files and Functions`、`Workflow`、`Errors & Corrections`、`Learnings` 和 `Worklog`

提示词组装不再将 `summary.md` 注入模型可见的系统上下文。压缩前，连续性来自当前转录本，后台摘要智能体从同一模型可见转录本保持 `summary.md` 最新。当会话稍后压缩时，CrawClaw 将 `summary.md` 作为压缩历史的真实来源来消费，将该渲染的压缩视图存储在压缩状态中，并在摘要边界后仅保留最近的尾部。

压缩也不再消费原始 `summary.md` 正文。它从最关键的连续性部分渲染结构化压缩视图，包括 `Current State`、`Open Loops`、`Task specification`、`Files and Functions`、`Workflow`、`Errors & Corrections` 和 `Key results`。压缩后，提示词组装将该渲染的压缩摘要作为转录摘要消息添加到保留尾部之前；普通轮次仍然不会将完整的 `summary.md` 文件作为系统上下文注入。

会话摘要也可以为持久记忆晋升候选提供种子。成功的摘要更新后，CrawClaw 从结构化摘要部分中提炼稳定的长期事实，并将其记录为晋升候选，而非直接写入持久记忆。这些候选进入晋升/治理管道；它们不是第三层召回层，在后续工作流明确将其具体化到其他地方之前不会注入提示词组装。

会话记忆仍以 `sessionId` 为键，因此父智能体和派生的子智能体**不**共享同一个摘要文件。每个子运行都拥有自己的 `summary.md`。

<Tip>
如果你希望智能体长期记住某些内容，请明确告知。它可以根据应该保留的内容写入持久记忆或经验笔记。
</Tip>

## 经验召回

经验记忆是用于验证从先前工作中习得经验教训的独立记忆层。它存储可复用的流程、决策、运行时模式、失败模式、工作流模式和引用。NotebookLM 是面向提示词的经验召回提供商。本地经验索引作为可靠的预写入出站盒和同步账本维护，而非作为后备提示词召回源。CrawClaw 可以：

- 查询 NotebookLM 获取相关可复用经验
- 通过 `write_experience_note` 直接写入结构化经验笔记
- 在顶级轮次后运行后台经验智能体以提取可复用经验，不阻塞主要任务
- 通过 `crawclaw memory` 管理登录、刷新和提供商状态
- 用 `crawclaw memory sync` 刷新本地待处理经验笔记
- 通过 `crawclaw memory prompt-journal-summary` 汇总夜间记忆提示词诊断

经验提取和召回是刻意分离的：

- 生命周期 `stop` 捕获刚完成的顶级轮次
- 经验智能体审查最近的模型可见消息、会话摘要上下文和现有经验索引
- 智能体只能使用 `write_experience_note`；它不能运行 shell 命令、浏览、检查源文件、写入持久记忆或派生智能体
- 成功写入首先更新本地经验同步账本，并在提供商就绪时同步到 NotebookLM
- 如果 NotebookLM 未就绪，写入会留在本地待发箱中，直到登录、心跳、启动或 `crawclaw memory sync` 将其刷新
- 下一个提示词组装仅从 NotebookLM 同步召回最相关的经验

经验召回在每个智能体轮次的上下文组装阶段运行。运行时首先对用户查询进行分类，然后从该分类构建提供商查询计划：

- 仅偏好提示词被路由到持久记忆，跳过经验提供商查询
- SOP 和操作手册提示词可以借用少量提供商搜索预算，以避免弱元数据导致操作经验饿死
- 成功的 `write_experience_note` 调用首先更新本地同步账本，但提示词召回不会读取本地待处理笔记
- 如果 NotebookLM 未返回结果或未认证，该轮次的经验召回为空，而非回退到本地出站条目
- 召回排名记录经验特定信号，如触发匹配、适用性匹配、失败/工作流模式提升、最近成功措辞和置信度
- 选中的经验召回仍受记忆提示词预算限制；层级分配是软性指导，但组装的经验部分必须符合该轮次的全局经验预算
- 选中的目标层级、提供商 ID、原因和限制被写入记忆召回诊断，以便检查/调试流程可以解释经验被查询或跳过的原因

如果没有适用于当前轮次的可用提示词，运行时完全跳过经验提供商查询。

`write_experience_note` 是当前运行时中唯一的经验写入工具。它首先写入本地经验索引条目，也可以在 `memory.notebooklm.write.enabled` 未被明确禁用时同步到 NotebookLM。使用托管的 NotebookLM 运行时，CrawClaw 通过 `nlm note create` 写入；自定义 `memory.notebooklm.write.command` 仅用于非标准写入辅助工具。CrawClaw 也可以从有限的本地经验索引维护一个名为 `CrawClaw Memory Index` 的托管 NotebookLM 源。该源允许 NotebookLM 原生源查询工作，而无需将每条经验笔记作为单独源上传；每条笔记的 NotebookLM 回写仍是笔记级同步路径。经验笔记应捕获可复用上下文、触发器、操作、结果、经验教训、适用边界和支持证据，而非临时任务状态。写入模式仅接受当前的结构化字段；遗留别名（如自由格式正文/理由字段）不会作为兼容输入保留。

NotebookLM 认证可以通过 `memory.notebooklm.auth.autoLogin` 保持活跃。默认提供商按每日间隔运行托管的 `nlm login --profile <profile>` 流程，复用持久的 notebooklm-mcp-cli 浏览器配置文件。对于 OpenClaw 托管的浏览器，将提供商设置为 `openclaw_cdp` 并提供 CDP URL。自动登录成功后，CrawClaw 清除提供商缓存并将待处理经验笔记刷新到 NotebookLM。

## 上下文存档

上下文存档是智能体运行面向回放的记录层。

它捕获：

- 模型可见上下文，包括组装的提示词/消息/工具表面
- 工具准入决策、循环策略操作和工具结果
- 轮次后更新，如会话摘要维护、压缩、完成和审查结果

上下文存档与较旧的记录层不同：

- **会话转录本** 是面向产品的对话记录，后续可能会被压缩或重写
- **提示词日志** 是仅用于调试的，故意有损/截断
- **诊断会话状态** 是内存镜像/缓存，不是持久真实源

如果你需要导出或回放任务支持型运行，上下文存档是要使用的层级。

## 作用域和共享

这些层不共享相同的边界：

- **会话记忆** 每个会话独立隔离。
- **持久记忆** 只要运行解析到相同的
  `agentId + channel + userId` 作用域就会共享。
- **经验记忆** 在运行之间使用相同的本地同步账本和 NotebookLM 提供商配置；不以会话 ID 分区。

所有使用内置记忆运行时的智能体都接收相同的智能体记忆路由契约。本指南不限于 `main` 智能体。

## 会话摘要维护

在 [压缩](/concepts/compaction) 修整会话之前，CrawClaw 会等待当前 `session_summary` 运行在短的限定窗口内完成，然后使用 `summary.md` 和 `lastSummarizedMessageId` 作为压缩边界。压缩在该摘要边界之后立即开始，仅在需要满足最小保留尾部条件时才向后扩展。如果崩溃的进程使 `summaryInProgress` 超出了过期租约窗口，压缩会清除过期租约而非等待已死亡的摘要运行。

这使短期连续性保持在一个真实来源上：

- 后台智能体更新 `summary.md`
- 该智能体看到由捕获的父分叉上下文携带的当前模型可见消息上下文
- 自动摘要更新需要父分叉上下文；显式 CLI/网关刷新从持久化的模型可见行重构有限的手动分叉上下文
- 压缩保留摘要边界后的尾部，仅在需要保持可用的最近工作集时向后扩展
- 压缩后，模型可见历史包含压缩摘要消息加上保留的尾部
- 提示词组装继续使用最近的转录本，不单独注入 `summary.md`

## CLI

```bash
crawclaw memory status   # 检查 NotebookLM 提供商状态
crawclaw memory login    # 重建 NotebookLM 配置
crawclaw memory refresh  # 从 cookie 后备刷新 NotebookLM 认证
crawclaw memory sync     # 将待处理经验笔记刷新到 NotebookLM
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
