---
read_when:
  - 理解 CrawClaw 中的智能体运行时所有权
  - 修改智能体会话生命周期、工具、cron、自动回复、命令、特殊智能体或记忆流程
summary: CrawClaw Rust 拥有的智能体运行时和会话生命周期架构
title: Rust 智能体运行时架构
x-i18n:
  generated_at: "2026-06-05T14:47:09Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: d4d6dc3f13087208eb1f3ac17da6339d8faa61fa76f2c9cef2c2710604f63bc8
  source_path: reference/rust-agent-runtime.md
  workflow: 15
---

# Rust 智能体运行时架构

CrawClaw 智能体执行由 Rust 运行时拥有。旧的 TypeScript 智能体运行器不是生产执行路径。

智能体模型轮次使用 Rust NativeProvider 后端。`native-provider` 是唯一支持的桌面智能体提供商运行时值；旧的 `pi-agent-rust` 运行时和依赖已被移除。

本页描述了智能体轮次、会话状态、提供商传输、特殊智能体、cron 任务、自动回复、命令和记忆生命周期工作的当前运行时边界。

## 所有权

Rust 运行时拥有：

- 通过 `AgentRuntime` 的智能体轮次执行。
- 提供商元数据、模型默认值、认证选项、传输能力和 NativeProvider 传输调用。
- 会话绑定、转录写入、运行 ID、事件投影、使用量元数据，以及中止或超时处理。
- 提供商调用之前的上下文预算投影，包括模型感知的有效提示预算、提供商输出限制、能力驱动的工具或推理降级、大型工具结果预览、可恢复的持久化工具输出、投影的历史 token 估计、延迟工具计数、已加载 Skill 计数、记忆片段计数，以及能力降级、工具结果投影、历史压缩和溢出投影的显式投影阶段标志。
- 工具执行生命周期事件，包括权限请求、权限决策、进度、完成，以及用于 UI 和 Gateway 观察者的紧凑工具使用摘要。
- Cron `agentTurn` 任务、自动回复轮次、命令轮次、特殊智能体运行和记忆任务。
- 持久记忆提取、经验提取、dream 任务、会话摘要、组装、压缩和轮次后摄取。

TypeScript 仅保留用于桌面渲染器。它不得重新进入智能体执行桥、渠道适配器、提供商运行时或回退运行器。

## Gateway 入口点

公共运行时入口点是 Gateway RPC 方法，由 Rust 支持：

- `agent.runTurn`
- `agent.command.run`
- `autoReply.run`
- cron `agentTurn` 负载执行
- 记忆 RPC，如 `memory.bootstrap`、`memory.ingestBatch`、`memory.assemble`、`memory.compact`、`memory.dream.*` 和 `memory.session_summary.*`
- Rust gateway 暴露的特殊智能体运行时方法

这些方法规范化请求元数据并调用相同的 Rust 运行时核心，以便会话、转录、工具、模型选择、取消和记忆处理在入口点之间保持一致。

## 运行时流程

1. Gateway 接收类型化请求并验证会话、触发器、渠道、消息、模型、提供商、推理和运行元数据。
2. Rust 从 Rust 提供商注册表解析提供商和模型配置。
3. Rust 组装有效的会话上下文、转录、记忆输入、系统提示和工具清单。
4. Rust 将提供商上下文投影到活跃预算。大型工具结果被替换为简短的预览和省略原因；磁盘上的原始转录不会被重写。
5. Rust 执行模型轮次、流式传输事件、记录使用量并处理工具负载。
6. Rust 写入转录条目并发出可投递的回复负载。
7. Rust 在请求是持久会话轮次时触发轮次后记忆摄取。

临时命令模式（如 `/btw`）可以选择退出转录写入和轮次后摄取，同时仍使用 Rust 命令运行时。

## 会话和队列

运行按会话键序列化。运行时使用会话键作为车道标识，以便一个用户会话不能有重叠的活跃轮次。

更高级别的入口点也可以使用全局并发上限。Cron、自动回复、命令和特殊智能体运行都绑定到相同的运行时标识模型，因此运行元数据、取消和状态报告不会按触发类型分叉。

## 工具

工具清单在每个 Rust 轮次之前解析。TypeScript 不托管渠道适配器、工具负载投影或智能体循环。

Rust 返回的工具负载被投影到 Gateway 和渠道特定的投递格式。渠道插件应调用其文档化的 SDK 或 Gateway 客户端界面，而不是导入智能体内部。

面向工作区的工具遵循活跃的 `EnterWorktree` 状态。`read`、`write`、`edit`、`apply_patch`、Bash/PowerShell、`grep`、`find`、`ls`、LSP 和 `NotebookEdit` 相对于活跃的 worktree 解析路径，而会话、团队、配置、MCP、记忆和特殊智能体状态保持在运行时根目录下。

`NotebookEdit` 遵循与文件编辑工具相同的读前写边界。notebook 必须首先通过 `read` 读取；运行时记录文件 mtime 和内容，在该读取后文件更改时拒绝编辑，并在成功的 notebook 写入后刷新读取状态，以便顺序单元格编辑可以继续。

每个工具调用也产生 Rust 拥有的可观测性。权限提示在用户或策略解析之前发出请求事件，在运行时收到批准或拒绝之后发出决策事件。完成的调用发出工具使用摘要，包含调用 ID、工具名称、状态、只读分类、持续时间、错误状态，以及结果是否被投影或持久化。这些事件是客户端的诊断界面；它们不让 Gateway 或 Desktop 拥有工具执行。

## 用户可见的任务智能体

用户可见的任务智能体是 Rust 运行时子智能体定义，而非内部特殊智能体。内置智能体位于 `agent_definitions.rs` 中，并从 `subagent_type`、`agentType` 或子智能体 `agentId` 解析：

- `general-purpose`：通用委托工作，默认工作区权限模式，继承模型，默认工具策略
- `Explore`：只读代码和上下文研究，继承模型，仅读取/搜索和 MCP 资源工具
- `Plan`：只读实现规划，继承模型，仅读取/搜索和 MCP 资源工具
- `verification`：只读验证，继承模型，仅读取/搜索和 MCP 资源工具，带必需的 `VERDICT` 结果行

`model: "inherit"` 被视为配置的父级/默认提供商模型。`permissionMode` 和 `mode` 映射到原生权限策略：`readOnly` 和 `plan` 选择只读工具，`dontAsk` 和 `bypassPermissions` 选择完全访问，而 `default`、`acceptEdits`、`auto` 或 `workspace` 选择工作区模式。Gateway 在 `agents` 中暴露这些内置智能体，并允许配置的、项目 markdown、Desktop 和 SDK 提供的智能体定义覆盖它们。

## 记忆

记忆工作是 Rust 原生的：

- 轮次后摄取
- 持久提取
- 经验提取
- dream 任务
- 会话摘要
- 记忆组装
- 记忆压缩

记忆任务使用 Rust 特殊智能体或 Rust 智能体运行时定义。生产记忆路径不得调用旧的 TypeScript 记忆任务。

## 特殊智能体

特殊智能体由 Rust 运行时定义和执行。定义包括工具允许列表、父上下文策略、输入和输出契约、超时、最大轮次、结果详情、持久化行为和记忆层策略。

特殊智能体是内部维护或审查智能体，如 `review-spec`、`review-quality`、`durable-memory`、`dream`、`session-summary` 和 `experience`。它们使用 `SpecialAgentDefinition` 和仅特殊智能体工具。它们与用户可见的任务智能体（如 `Explore`、`Plan` 和 `verification`）故意分开，后者通过正常子智能体配置文件运行。

`embedded_fork` 语义是一个内部 Rust 运行时 fork。它不调用 TypeScript 特殊智能体运行器。

## Cron 和自动回复

Cron 调度、存储访问、到期运行处理、手动运行、运行日志、webhook 投递和 `agentTurn` 执行由 Rust 拥有。

自动回复触发处理通过 `autoReply.run` 路由到 Rust 运行时。回复路由、去重、typing/status 事件、跟进行为、转录投影、可发送部分和记忆触发器在 Rust 运行时端或由薄 Gateway/渠道投影代码处理。

## 兼容性边界

已移除的 TypeScript 执行界面包括：

- 旧版 TypeScript 智能体运行器
- 类型化插件钩子运行器
- 旧版提供商运行时注册
- TypeScript 特殊智能体运行器
- TypeScript cron 隔离智能体运行器
- TypeScript 自动回复智能体运行器
- 旧版 TypeScript 记忆任务

如果调用者需要智能体轮次，它必须使用 Rust 支持的 Gateway/运行时方法。没有 TypeScript 回退桥。

已移除的智能体运行时界面还包括 `pi-agent-rust` 运行时模式和外部 `pi_agent_rust` crate 依赖。现有提供商配置应使用 `runtime: "native-provider"` 或省略 `runtime`，默认为 NativeProvider 路径。

## 测试

使用 Rust 运行时关卡进行执行行为测试：

```bash
cargo test -p crawclaw-runtime agent_runtime
cargo test -p crawclaw-runtime cron
cargo test -p crawclaw-runtime memory
cargo test -p crawclaw-runtime special_agents
cargo test -p crawclaw-gateway agent_run_turn
```

仅对桌面渲染器和过时引用清理使用 TypeScript 关卡：

```bash
pnpm tsgo
pnpm check
pnpm build
```
