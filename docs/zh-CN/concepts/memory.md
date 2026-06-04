---
read_when:
  - 你想了解记忆是如何工作的
  - 你想了解 Hindsight 支持的持久记忆和经验记忆
  - 你想了解什么是可回放的与保留的
summary: CrawClaw 如何使用 Hindsight 记忆库、会话摘要和 Context Archive
title: 记忆概览
x-i18n:
  generated_at: "2026-06-04T03:23:49Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 9d9a80642ea144bbf8451b71e0bcdc86c25204a20e1b17ba3dc3a920422986e5
  source_path: concepts/memory.md
  workflow: 15
---

# 记忆概览

CrawClaw 记忆在保留知识方面原生支持 Hindsight，在会话连续性方面采用本地存储：

- **会话记录**记录在一个运行时会话中发生的事情。
- **会话摘要**在 `memory/session-summary` 下存储压缩的会话连续性。
- **持久记忆**在 Hindsight `durable` 层中存储稳定的用户偏好、项目事实和协作上下文。
- **经验记忆**在 Hindsight `experience` 层中存储可重用的经验和程序。
- **资源记忆**在 Hindsight `resource` 层中存储文档、代码和参考资料。
- **心智模型**在 Hindsight `mental-models` 层中存储低频反思性综合。
- **Context Archive**记录运行所看到和所做的回放和调试证据。

模型仅记住这些层持久化并在后来回忆的内容。没有隐藏的模型状态。

## 目标产品设计

产品目标是实现一个明确的、可观察的记忆循环：

- 轮次结束时的记忆工作不得阻塞主响应路径
- `memory.afterTurn` 记录模型可见的消息增量，并在运行时存储中排队记忆任务
- 网关启动自动发件箱工作器，将排队的保留任务写入 Hindsight 并记录本地遗忘墓碑标记；`memory.outbox.process` 仍然是手动排出入口
- CrawClaw Desktop 打包在捆绑嵌入式运行时之前暂存并 sha256 验证固定的 `hindsight-embed` sidecar 二进制文件
- `memory.status`、`memory.outbox.list` 和 `memory.activity.list` 公开策略、Hindsight 生命周期、工作器状态、队列状态和最近活动
- 显式 `remember` 写入持久记忆保留任务
- 显式 `do-not-remember` 阻止该轮次的 Hindsight 回写，同时保留本地会话连续性记录
- 显式 `forget` 记录本地墓碑标记。墓碑标记抑制匹配的将来回忆，而 CrawClaw 避免声称破坏性远程删除，直到 Hindsight 公开稳定的删除操作
- Desktop 记忆项目使用相同的运行时发件箱。本地项目携带 provider、layer、bank 和同步状态字段，以便 UI 可以显示它们是待 Hindsight 回写、本地独占还是待本地删除

这保持了理想设计的小型化：CrawClaw 拥有策略、幂等本地状态和可观察性；Hindsight 拥有语义存储、回忆、排序和将来的删除支持。

## Hindsight 层

内置运行时从配置的 prefix、granularity 和 layer 派生 Hindsight bank id。默认 bank granularity 为 `agent`，因此主智能体解析 banks 如下：

- `crawclaw:main:durable`
- `crawclaw:main:experience`
- `crawclaw:main:resource`
- `crawclaw:main:mental-models`

共享模式可以通过配置的共享 bank id 路由所有作用域。完整的配置面请参阅[记忆配置参考](/reference/memory-config)。

## 回忆

提示词时的回忆由 Rust 记忆运行时拥有。当 Hindsight 启用且 `memory.hindsight.memoryMode` 允许提示词回忆时，CrawClaw 查询 durable、experience、resource 和 mental-model 层，并将有界结果注入运行时上下文。

`memory.hindsight.memoryMode` 具有以下效果：

- `hybrid`：启用提示词回忆；配置的 knowledge 工具也可能在运行时允许的地方暴露。
- `context`：启用提示词回忆；面向用户的 knowledge 工具保持关闭。
- `tools`：禁用提示词回忆；工具是启用时的显式访问路径。

回忆受当前模型上下文预算约束。较小的上下文窗口接收更紧凑的记忆片段；较大的上下文窗口可以接收更多回忆而不会变得无界。

中文和混合中英文回忆使用相同的 Hindsight 后端，但增加了本地质量层。CrawClaw 使用确定性双语技术别名重写中文密集型回忆查询，在查询正文中保留原始最近上下文，应用最小相关性评分，并在提示词预算修剪前限制 top reranked 项目。这保持了常见中文术语（如 gateway、cache、database、plugin 和 memory）在中英文项目笔记中对齐。有效质量配置文件在 `memory.status` 中可见；高级部署可以在 `memory.hindsight.quality` 下覆盖分块、本地评分阈值、top-k 准入和查询重写。

回忆在 Hindsight 返回结果后也应用本地墓碑过滤。如果墓碑针对 Desktop 记忆项目 id，则通过元数据移除匹配的回忆项目。否则，CrawClaw 抑制文本与 forget 查询匹配的项目。

## 回写

轮次结束时的回写按记忆类型故意拆分：

- `memory.afterTurn` 在运行时存储中记录新的模型可见用户和助手消息。
- 符合条件的已完成轮次排队 Hindsight `experience` 保留任务。工作器稍后将其写入 Hindsight。此路径不调用 `experience` 特殊智能体。
- 长的中文密集型保留载荷在发送给 Hindsight 之前被拆分为带重叠和块元数据的句子边界块。这保持了长中文轮次的可检查性，并避免了一个过大的记忆项目。
- 显式 `remember` 请求排队 Hindsight `durable` 保留任务。
- 显式 `do-not-remember` 请求跳过该轮次的 Hindsight 回写。
- 显式 `forget` 请求被跟踪为记忆活动和发件箱工作；工作器记录本地墓碑标记并将任务标记为 `completed_local`。
- Desktop 创建和编辑操作在 Hindsight 可用时排队保留工作到匹配的 Hindsight 层。Desktop 清理隐藏本地项目并为同一项目 id 排队遗忘墓碑标记。
- `durable-memory` 是稳定的长期事实的受限维护特殊智能体。它接收结构化记忆增量输入，不继承父级记录历史。
- `dream` 是用于手动反思性维护的维护特殊智能体。自动 dream 整合路径使用 Rust Hindsight 反思管道。
- `session-summary` 是压缩和会话连续性特殊智能体。它写入本地会话摘要文件，而不是 Hindsight 持久记忆。

记忆维护工具仅限特殊智能体使用。运行时还为记忆特殊智能体强制执行目标 Hindsight 层：

- `durable-memory` 只能写入 `durable`
- `experience` 只能写入 `experience`
- `dream` 只能写入 `mental-models`

这防止记忆维护提示词静默写入错误的 bank。

## 持久记忆

持久记忆用于稳定事实、持久偏好、未来行为指导和长期项目上下文。它不是记录副本，也不是可重用程序的地方。

`durable-memory` 特殊智能体使用窄结构化输入包。输入可能包括最近的模型可见消息增量、作用域元数据、光标状态、现有清单数据和显式 remember 或 forget 信号。它不得包含完整的父级记录、父级系统提示词或隐藏的父级提示词上下文。

此边界防止持久提取被旧父级上下文或无关运行历史污染。

## 经验记忆

经验记忆用于可重用的操作知识：

- 成功的程序
- 失败模式
- 调试经验
- 工作流模式
- 适用性边界

正常的自动路径直接将符合条件的已完成轮次写入 Hindsight experience。手动或维护经验提取仍可使用 `experience` 特殊智能体，但它不是默认的轮次结束写入器。

## 会话摘要

会话摘要是本地连续性产物。它们帮助压缩用简洁摘要替换更旧的记录历史，同时保留最近的尾部。

会话摘要维护与持久记忆和经验记忆分开：

- 它按会话作用域键控
- 它写入 `memory/session-summary`
- 它被压缩消耗
- 它不会自动提升到持久记忆

## 梦境整合

梦境整合是低频反思层。自动路径使用 Hindsight 反思处理最近的会话摘要，并将综合内容存储在 `mental-models` 中。

`dream` 特殊智能体仍可作为具有窄记忆维护工具策略的手动维护面使用。它不继承父级记录上下文。

## Context Archive

Context Archive 是智能体运行的面向回放的记录层。它捕获：

- 模型可见上下文
- 工具准入决策
- 工具结果
- 运行时事件和结果

Context Archive 与记忆不同。它是回放和检查的证据，不是提示词时回忆存储。

## 进一步阅读

- [记忆配置参考](/reference/memory-config)
- [内置记忆运行时](/concepts/memory-builtin)
- [会话与记忆](/concepts/session-vs-memory)
- [记忆与 Skill](/concepts/memory-vs-skill)
- [压缩](/concepts/compaction)
