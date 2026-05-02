---
read_when:
  - 你想要了解记忆的工作原理
  - 你想要了解应该写入哪些记忆文件
  - 你想要了解什么是可重放的，什么是仅用于调试的
summary: CrawClaw 如何使用会话记忆、持久记忆、体验记忆和 Context Archive
title: 记忆概览
x-i18n:
  generated_at: "2026-05-02T05:43:36Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 04e63fa2bbe940596c5752bae2ca253644801d6c05a3d6a65509d7def1a3fbf7
  source_path: concepts/memory.md
  workflow: 15
---

# 记忆概览

CrawClaw 通过分层记忆系统来记住事物：

- **会话记忆** 用于单个会话内的短期任务连续性
- **持久记忆** 用于长期用户和协作事实，按作用域限定
  `agentId + channel + userId`
- **体验记忆** 由 NotebookLM 提示时召回、NotebookLM 写回、用于失败写入的本地待处理发件箱和后台体验智能体提供支持
- **Context Archive** 用于重放/导出/调试运行实际看到和执行的内容的记录

模型只“记住”持久化到这些层中的内容——没有隐藏状态。

该 `coding` 工具配置文件包含 `write_experience_note` 用于显式体验写入和作用域限定的持久记忆文件工具（`memory_manifest_read`， `memory_note_read`， `memory_note_write`，
`memory_note_edit`和 `memory_note_delete`）用于显式持久记忆维护。本地新手引导在新配置未设置时默认使用该配置文件；它不会添加 `main` 智能体 `tools.alsoAllow` 内存工具的覆盖。主智能体从内存路由提示决定何时使用那些持久工具，与 Claude Code 的提示驱动内存写入方式一致。专用维护智能体通过其特殊智能体允许列表接收相同的持久工具，并保持在运行时限制在该窄表面上。会话摘要文件编辑和晋升裁决提交仍然限制在其所属的后台智能体中。

## 持久记忆文件

持久记忆以纯 Markdown 文件形式存储在作用域限定的持久记忆目录下。每个记忆是一个独立笔记，每个作用域有自己的
`MEMORY.md` 索引。

`MEMORY.md` 现在遵循有界持久索引约束：

- 它仅是索引，而非记忆体的存放位置
- 它不能包含 frontmatter
- 每个指针行应保持单行且大约 150 个字符或更少
- 整个文件应保持在约 200 行和 25KB 以下
- 过时的详情应移回主题笔记，而非扩展索引

在召回时，CrawClaw 不会盲目注入整个持久记忆目录，也不会后备为放入整个 `MEMORY.md` 文件到系统提示中。持久化召回现在在提示组装期间同步运行：

- `MEMORY.md` 作为当前作用域的第一个持久记忆索引界面
- 标题、描述和持久类型等 header 元数据提供下一层召回
- 一个轻量级正文索引缓存为每个笔记保留简短摘要和关键词集，因此正文明显相关时，标题/描述较弱的旧笔记仍可进入候选集
- 只有有限的高排名候选集读取正文摘要以进行第二轮重新排序
- 持久化召回诊断现在记录所选笔记在实际使用时是否被采纳 `index`，
  `header`， `body_index`，和/或 `body_rerank` 信号，以便 inspect/debug 流程可以解释为什么某条笔记被选中或遗漏
- 仅对最终选中项加载完整笔记内容
- 提示组装接收持久化召回评分细分，可以将少量记忆预算转向持久记忆以适应持久密集型查询，或在体验/SOP 召回更合适时从持久记忆中移开
- 选中的超过一天的持久笔记仍带有新鲜度提醒，模型被明确告知在将其作为事实之前，要根据当前实际情况验证文件/代码/仓库状态声明

持久自动写入也遵循回合结束完成触发器：

- 运行循环现在发出 `stop` 在最终顶级回合之后生命周期阶段，和 `durable_memory` 作为订阅者消费该阶段
- 同一个停止事件可以携带捕获的父分支上下文，包括父提示信封和完整的模型可见消息上下文；嵌入的
  `durable_memory` 继承该分支并仅附加一个窄范围的持久记忆维护提示
- 基于游标的最近消息窗口仍然是提取边界；较旧的分支上下文仅可用于解析最近消息中的引用，而非作为重新提取过时历史的数据源
- `durable_memory` 仅写入持久 profile/上下文记忆：用户偏好、明确的未来行为反馈、稳定项目事实和稳定引用。可复用流程、命令序列、调试工作流、测试策略、失败模式和实现经验教训应属于体验记忆。
- 该回合的新消息必须包含最终助手回复
- 如果最新的助手回复仍包含工具调用，或以
  `error` / `aborted`：该回合跳过持久记忆智能体
- 游标前进仅在回合实际处理后才发生，因此不完整的工具调用回合不会意外消耗提取历史

CrawClaw 也有第二层持久记忆维护层：

- `durable_memory` 是轻量级每回合后台写入器
- `dream` 是轻量级每回合后台写入器
- `session_summary` 是单个会话的短期连续性智能体
- 两者 `durable_memory` 和 `dream` 现在订阅相同的 run-loop `stop` 阶段，而不是直接从 `afterTurn`
- Dream 作为独立的后台维护任务运行，而非作为父运行嵌入式分支。停止事件仅触发调度和作用域解析；Dream 不接收父提示信封、父模型可见消息、父运行 ID 或父提供商/模型选择。
- Dream 使用自己的系统提示和生成的特殊智能体会话以及 dream 工具策略，因此它不会继承默认嵌入式主智能体提示、表面 Skills、引导上下文文件或工作区提醒。
- auto-dream 使用按作用域的 `.consolidate-lock` 文件用于持久记忆作用域目录中的锁所有权及其整合水印；锁文件 `mtime` 在运行开始时前进，如果运行失败则回滚
- auto-dream 按以下方式扫描智能体会话转录文件 `mtime` 并在之前的文件水印之后传递所触及会话的引用；Dream 可能使用窄
  `read` 或只读 `exec` 在这些引用上进行搜索，同时主机防护阻止变更性 Bash 并阻止原始 `write` / `edit` 在持久记忆目录之外
- Dream 不会消耗 `session_summary` 文件或压缩摘要
  `summaryOverrideText`；这些保持在单个会话连续性和压缩范围内，而非跨会话持久化整合
- auto-dream 由其运行超时限制，而非固定的回合数上限，因此大型跨会话整合不会仅仅因为需要更多智能体回合而被中断
- auto-dream 整合相同的持久 profile/上下文层，并且不得将可复用操作经验转化为持久笔记
- auto-dream 现在通过操作源呈现用于定向/收集/整合/修剪的阶段级操作
- 手动 dream 运行现在可以用以下方式限制 `--session-limit` / `--signal-limit`
  并使用以下方式预览 `--dry-run` ：无需获取 dream 锁或写入记忆即可预览。
- status 和 inspect 界面明确报告 dream 闭环针对所检查的持久作用域是否处于活跃状态，而非将 dream 保留为不透明的可选后台行为
- dream status 和 inspect 界面报告文件水印、锁路径以及当前是否有锁处于活跃状态；dream 运行历史不再持久化到运行时数据库中

晋升与召回和维护是分开的：

- 持久化召回直接读取作用域限定的持久笔记
- `dream` 整合和修复那些持久笔记
- 晋升候选是用于后续审核/写回的管理工件，而非提示时持久化召回输入
- 晋升负载被明确标记 `surface: governance_only` 以使该边界既可被机器读取，也有文档记录

## 会话记忆

会话记忆现在遵循单轨设计：

- 每个会话有一个 `summary.md` 文件
- 一个后台 `session_summary` 智能体从运行循环后采样钩子维护该文件
- 摘要智能体从一个捕获的父分支上下文运行：运行循环生命周期事件同时携带父提示信封和完整的当前模型可见消息上下文，然后摘要运行附加一个窄
  `summary.md` 维护提示，而非添加另一个特定于摘要的系统提示
- 分支上下文从活跃运行循环中捕获，而非从更旧的持久化行重新构造或从单独的持久化提示产物重新组装，因此压缩边界与主智能体实际看到的内容保持一致
- 自动生命周期更新在分支上下文缺失时跳过；显式 CLI 或网关刷新从持久化的模型可见行重建有限的手动分支上下文
- session-summary 为该分支保留短期缓存保留，但不会派生或重用父提示缓存密钥
- 调度器可以更早地使用轻量级摘要配置文件启动，然后稍后将同一文件升级为完整配置文件
- 自然的稳定回合仍会触发摘要更新，但调度器也可以在令牌增长阈值和工具调用阈值同时满足时更早刷新该文件
- 运行时数据库仅存储边界/进度状态，例如
  `lastSummarizedMessageId`， `lastSummaryUpdatedAt`， `tokensAtLastSummary`和
  `summaryInProgress`

`summary.md` 是唯一持久化的会话摘要来源。CrawClaw 不再保留单独的运行时“会话卡片”作为主要会话记忆记录。

摘要文件使用固定结构，包括以下部分：

- `Session Title`
- `Current State`
- `Open Loops`
- `Task specification`
- `Files and Functions`
- `Workflow`
- `Errors & Corrections`
- `Codebase and System Documentation`
- `Learnings`
- `Key results`
- `Worklog`

该文件现在有两种维护模式：

- **轻量配置文件** 首先更新最小工作状态部分：
  `Current State`， `Open Loops`， `Task specification`和 `Key results`
- **完整配置文件** 扩展到更丰富的长期运行部分，例如
  `Files and Functions`， `Workflow`， `Errors & Corrections`， `Learnings`和
  `Worklog`

提示组装不再注入 `summary.md` 进入模型可见的系统上下文。在压缩之前，连续性来自当前转录文本，后台摘要智能体保留 `summary.md` 从同一模型可见转录文本中的当前内容。当会话稍后压缩时，CrawClaw 消费
`summary.md` 作为压缩历史的真相来源，将该渲染的压缩视图存储在压缩状态中，并在摘要边界之后仅保留最近的尾部。

压缩也，不再消耗原始 `summary.md` 正文。它从最关键的连续性部分渲染结构化压缩视图，包括
`Current State`， `Open Loops`， `Task specification`， `Files and Functions`，
`Workflow`， `Errors & Corrections`和 `Key results`。压缩后，提示组装在该保留尾部之前将该渲染的压缩摘要作为转录摘要消息进行前置；它仍不注入完整的 `summary.md` 文件作为普通回合的系统上下文。

会话摘要也可以为持久记忆晋升候选提供种子。成功的摘要更新后，CrawClaw 从结构化摘要部分提炼稳定的长期事实，并将其记录为晋升候选，而非直接写入持久记忆。这些候选进入晋升/治理管道；它们不是第三层召回层，在后续工作流明确将其具体化到其他地方之前，不会被注入到提示组装中。

会话记忆仍然以 `sessionId`，因此父智能体和派生的子智能体确实 **不** 共享相同的摘要文件。每个子运行拥有自己的
`summary.md`。

<Tip>
如果你希望你的智能体长期记住某事，请明确告诉它。它可以根据应该保留的内容写入持久记忆或体验笔记。
</Tip>

## 体验召回

体验记忆是一个独立的记忆层，用于存储来自之前工作的已验证经验。它存储可复用流程、决策、运行时模式、失败模式、工作流模式和引用。NotebookLM 是面向提示的体验召回提供者和主要写入目标。本地体验存储仅在 NotebookLM 写回不可用时用作失败发件箱；它不是后备提示召回来源或主要体验存储。CrawClaw 可以：

- 查询 NotebookLM 以获取相关可复用体验
- 通过 `write_experience_note`
- 在顶级回合后运行后台体验智能体以提取可复用体验，而不阻塞主任务
- 通过以下方式管理登录、刷新和提供商状态 `crawclaw memory`
- 使用以下方式刷新本地待处理体验笔记 `crawclaw memory sync`
- 通过以下方式汇总夜间记忆提示诊断 `crawclaw memory prompt-journal-summary`

体验提取和召回是故意分开的：

- 生命周期 `stop` 捕获刚刚完成的顶级回合
- 体验智能体审查最近的模型可见消息、会话摘要上下文和本地待处理发件箱中未同步的 NotebookLM 写入
- 智能体只能使用 `write_experience_note`它不能运行 shell 命令、浏览、检查源文件、写入持久记忆或生成智能体
- 成功的写入在提供商就绪时直接发送到 NotebookLM
- 如果 NotebookLM 未就绪，写入会留在本地待处理发件箱中，直到登录、心跳、启动或 `crawclaw memory sync` 将其刷新
- 下一个提示组装同步地从 NotebookLM 召回最相关的体验

体验召回在每个智能体回合的上下文组装阶段运行。运行时首先对用户查询进行分类，然后根据该分类构建提供商查询计划：

- 纯偏好提示被路由到持久记忆，并跳过体验提供商查询
- SOP 和操作手册提示可以借用少量提供商搜索预算，这样较弱的元数据不会使操作体验匮乏
- 成功的 `write_experience_note` 调用不会保留完整的本地体验副本；只有失败的 NotebookLM 写入才会保留在本地待处理发件箱中
- 如果 NotebookLM 返回无结果或未认证，则该回合的体验召回为空，而非回退到本地发件箱条目
- NotebookLM/Gemini 拥有体验召回的语义相关性和排序权；CrawClaw 保留提供商顺序，仅应用确定性防护栏，如仅 NotebookLM 源过滤、去重、非空内容检查和提示预算限制
- 体验召回诊断暴露保留的 `providerOrder` 和选择原因，而非本地评分细分；本地评分字段保留给持久记忆可观测性
- 选中的体验召回仍受记忆提示预算限制；层分配是软性指导，但组装的体验部分必须符合该回合的全局体验预算
- 选中的目标层、提供商 ID、原因和限制被写入记忆召回诊断，以便 inspect/debug 流程可以解释为什么查询或跳过了体验

如果没有适用于当前回合的提示，运行时完全跳过体验提供商查询。

`write_experience_note` 是当前运行时中唯一的体验写入工具。当 NotebookLM 启用时，它首先写入 NotebookLM。使用托管的 NotebookLM 运行时时，CrawClaw 通过以下方式写入 `nlm note create`；自定义
`memory.notebooklm.write.command` 仅在需要非标准写入帮助器时才需要。
如果 NotebookLM 写回失败，CrawClaw 将结构化笔记存储在本地待处理发件箱中，稍后通过 heartbeat、启动或 `crawclaw memory sync`。 待处理项目成功同步后，本地负载被移除。体验笔记应捕获可复用上下文、触发器、行动、结果、经验教训、适用边界和支持证据，而非临时任务状态。写入模式仅接受当前的结构化字段；遗留别名（如自由格式正文/理由字段）不作为兼容性输入保留。

NotebookLM 认证可以通过以下方式保持活跃 `memory.notebooklm.auth.autoLogin`。默认提供商运行托管 `nlm login --profile <profile>` 流程按每日间隔运行，复用持久化的 notebooklm-mcp-cli 浏览器配置文件。对于 OpenClaw 管理的浏览器，将提供商设置为 `openclaw_cdp` 并提供 CDP URL。自动登录成功后，CrawClaw 清除提供商缓存并将待处理体验笔记刷新到 NotebookLM。

## Context Archive

Context Archive 是面向重放的智能体运行记录层。

它捕获：

- 模型可见上下文，包括组装的提示/消息/工具界面
- 工具准入决策、循环策略操作和工具结果
- 回合后更新，如会话摘要维护、压缩、完成和审核结果

Context Archive 与旧的记录层不同：

- **会话转录文本** 是面向产品的对话记录，之后可能会被压缩或重写
- **Prompt Journal** 仅用于调试，故意有损/截断
- **诊断会话状态** 是内存镜像/缓存，不是持久化真相来源

如果你需要导出或重放任务支持的运行，Context Archive 是要使用的层。

## 作用域与共享

这些层的边界不相同：

- **会话记忆** 按会话隔离。
- **持久记忆** 共享于（当运行解析到相同的
  `agentId + channel + userId` 作用域。
- **体验记忆** 跨运行使用相同的 NotebookLM 提供商配置和本地待处理发件箱；它不按会话 ID 分区。

所有使用内置记忆运行时的智能体都收到相同的智能体记忆路由契约。此指导不仅限于 `main` 智能体。

## 会话摘要维护

之前 [压缩](/concepts/compaction) 修剪会话时，CrawClaw 等待当前的 `session_summary` 运行在短限定窗口内完成后，然后使用 `summary.md` 加上 `lastSummarizedMessageId` 作为压缩边界。压缩在该摘要边界之后立即开始，仅在需要满足最小保留尾部条件时向后扩展。如果崩溃的进程留下 `summaryInProgress` 设置超过过期租约窗口，压缩会清除过期租约，而不是等待已终止的摘要运行。

这使短期连续性保持在一个真相来源上：

- 后台智能体更新 `summary.md`
- 该智能体看到由捕获的父分支上下文携带的当前模型可见消息上下文
- 自动摘要更新需要该父分支上下文；显式 CLI/网关刷新从持久化的模型可见行重建有限的手动分支上下文
- 压缩在摘要边界之后保留尾部，仅向后扩展到足以保持可用的最近工作集
- 压缩后，模型可见历史包含压缩摘要消息加上该保留尾部
- 提示组装继续使用最近的转录文本，不单独注入 `summary.md`

## CLI

```bash
crawclaw memory status   # Check NotebookLM provider status
crawclaw memory login    # Rebuild the NotebookLM profile
crawclaw memory refresh  # Refresh NotebookLM auth from cookie fallback
crawclaw memory sync     # Flush pending experience notes to NotebookLM
crawclaw memory dream status --json
crawclaw memory dream history --json
crawclaw memory dream run --agent main --channel telegram --user alice --force
crawclaw memory dream run --agent main --channel telegram --user alice --dry-run --session-limit 6 --signal-limit 6
crawclaw memory prompt-journal-summary --json --days 1
crawclaw agent export-context --task-id <task-id> --json
```

## 延伸阅读

- [记忆配置参考](/reference/memory-config) -- 所有配置旋钮
- [压缩](/concepts/compaction) -- 压缩如何与记忆交互
