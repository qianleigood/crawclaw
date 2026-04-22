---
read_when:
  - 想系统阅读 Claude Code 源码时
  - 想把 CrawClaw 和 Claude Code 的 runtime 设计做对比时
  - 想知道 `/path/to/claude-code` 该按什么顺序读时
summary: 基于本地 Claude Code 源码的学习型架构拆解
title: Claude Code 架构拆解
---

# Claude Code 架构拆解

这份文档基于你本机上的 Claude Code 源码快照：

```text
/path/to/claude-code
```

它不是 Anthropic 官方文档，而是一份**面向学习的源码拆解笔记**。目标不是“把所有文件列一遍”，而是帮你抓住 Claude Code 的真正架构骨架。

## 先给结论

Claude Code 最适合被理解成一个：

- **厚运行时**
- **强状态机**
- **工具优先**
- **权限治理内建**
- **多入口产品壳**
- **agent/task 深度内建**

的交互式产品系统。

它不是：

- 一个简单 CLI
- 一个 prompt 模板
- 一个 “模型 + tools” 的轻量封装

一句话概括：

> Claude Code 的中心不是 prompt，而是 runtime。

## 最值得先看的文件顺序

如果你想高效读源码，我建议按下面顺序看：

1. `src/entrypoints/cli.tsx`
2. `src/main.tsx`
3. `src/QueryEngine.ts`
4. `src/query.ts`
5. `src/Tool.ts`
6. `src/tools.ts`
7. `src/utils/permissions/permissionSetup.ts`
8. `src/utils/permissions/permissions.ts`
9. `src/state/AppStateStore.ts`
10. `src/tools/AgentTool/AgentTool.tsx`
11. `src/tools/AgentTool/runAgent.ts`
12. `src/utils/forkedAgent.ts`
13. `src/services/mcp/client.ts`
14. `src/remote/RemoteSessionManager.ts`
15. `src/bridge/bridgeMain.ts`
16. `src/services/vcr.ts`

这条顺序背后对应的是 Claude Code 的真实架构层次：

- 入口
- 启动
- 会话引擎
- query 主循环
- 工具契约
- 权限治理
- 全局状态
- agent/task
- MCP/remote/bridge
- 回归基础设施

## 一、入口层不是简单 CLI，而是产品壳

核心文件：

- `src/entrypoints/cli.tsx`
- `src/main.tsx`

### `cli.tsx` 在做什么

`cli.tsx` 不是传统意义上的“小入口”。它本身就负责：

- 处理 fast path
- 根据参数决定进入哪个产品模式
- 避免不必要的模块加载
- 在一些模式下直接绕过完整 app bootstrap

你能在这里直接看到多种一级入口：

- `--version`
- `--dump-system-prompt`
- `--claude-in-chrome-mcp`
- `--chrome-native-host`
- `--computer-use-mcp`
- `remote-control / bridge`
- `daemon`
- background sessions

这说明 Claude Code 从入口层开始就不是“一个命令对应一条逻辑”，而是**同一套 runtime 的多种产品壳**。

### `main.tsx` 在做什么

`main.tsx` 才是真正的运行时装配中心。它做的不是“读配置然后启动 REPL”这么简单，而是：

- MDM / managed settings
- keychain prefetch
- telemetry / analytics
- auth
- GrowthBook gates
- MCP 初始化
- plugin / skill 初始化
- remote session / bridge 相关准备
- REPL 启动
- policy limits
- settings migration

这意味着 Claude Code 的启动不是轻量初始化，而是**完整产品环境准备**。

### 这一层的学习点

Claude Code 很明显把“启动”视为架构的一部分，而不是附属细节。  
这就是为什么它后面可以承载：

- bridge
- daemon
- remote viewer
- MCP
- agents
- background sessions

而不显得完全拼凑。

## 二、`QueryEngine` 是会话对象，不是工具函数

核心文件：

- `src/QueryEngine.ts`

这里最重要的判断是：

**Claude Code 不是每来一条消息就临时拼一遍上下文然后调用模型。**

它先创建一个 `QueryEngine`，由这个对象持有会话级状态，比如：

- `mutableMessages`
- `abortController`
- `permissionDenials`
- `totalUsage`
- `readFileState`
- turn 级 skill discovery 状态

`submitMessage()` 才是新回合入口。

### 这一层意味着什么

这说明 Claude Code 的基本单位不是：

- “一次 prompt 调用”

而是：

- “一个持续存在的 conversation runtime”

这和 CrawClaw 现在做 task-backed runtime 的方向其实是同一类思路，只是 Claude Code 更早把这件事做成了产品内核。

## 三、`query.ts` 才是真正的核心

核心文件：

- `src/query.ts`

如果要找 Claude Code 的“心脏”，就是这个文件。

### 1. 它是一个真正的状态机

这里不是线性流程，而是：

- 一个显式 `State`
- 一个 `while (true)` 主循环
- 每轮都做：
  - 组 query 参数
  - 流式调用模型
  - 检测 `tool_use`
  - 执行工具
  - 回填结果
  - 决定继续、恢复还是结束

### 2. Claude Code 的 loop 机制其实在这里

它不像 CrawClaw 那样先有一套独立的通用 tool loop detector，再挂到 `before-tool-call`。

Claude Code 更像：

- 在主状态机里识别需要继续的条件
- 把坏状态当成恢复分支处理

比如这里已经内建了很多恢复链：

- auto compact
- reactive compact
- context collapse
- `prompt too long` 恢复
- `max_output_tokens` 恢复
- stop hook blocking 后继续
- token budget 自动续跑
- `maxTurns` 硬上限

所以 Claude Code 的哲学更像：

> 先用主状态机吸收复杂性，再用少量硬上限收口。

### 3. 它怎么判断这一轮要不要继续

关键变量是 `needsFollowUp`。

流式输出里只要看到 `tool_use`，就设置成 `true`。  
如果一轮结束后 `needsFollowUp === false`，说明模型没有继续请求工具，这时才进入：

- recovery 检查
- stop hooks
- token budget 检查
- 最终完成判断

这就是 Claude Code 的“完成判定”为什么更像**状态机自然收口**，而不是独立 `CompletionGuard`。

## 四、工具运行时比大多数 agent 框架都厚

核心文件：

- `src/Tool.ts`
- `src/tools.ts`
- `src/services/tools/toolOrchestration.ts`

### `Tool.ts` 的真正价值

`Tool.ts` 不只是定义 tool schema。

真正重要的是它定义了一个非常厚的 `ToolUseContext`。这个上下文里已经包含：

- commands
- tools
- MCP clients / resources
- app state getter / setter
- permission context
- read file state
- notification
- message list
- attribution
- file history
- query chain tracking
- 甚至一些 UI 相关回调

这说明 Claude Code 的工具不是“纯函数式能力”，而是**运行在共享 runtime 里的操作单元**。

### `tools.ts` 是统一真源

`tools.ts` 做的是：

- 所有 base tools 的统一注册
- feature gate 控制
- 环境控制
- default tool pool 装配

这让它在产品层能稳定回答：

- 当前有哪些工具
- 哪些对这个模式可用
- 哪些要屏蔽

### `toolOrchestration.ts` 的关键点

Claude Code 不会盲目串行所有工具。

它先把工具分两类：

- concurrency-safe
- mutating / unsafe

然后：

- 读类工具可以并发批量执行
- 写类/高风险类工具串行执行

这个点很重要，因为它说明 Claude Code 的工具层已经不是“能调用就行”，而是开始做**执行语义编排**。

## 五、权限系统是分层治理，不是一个 if/else 守卫

核心文件：

- `src/utils/permissions/permissionSetup.ts`
- `src/utils/permissions/permissions.ts`

### `permissionSetup.ts` 在做什么

这一层更像“权限模式准备器”。

它负责：

- 初始 mode 决定
- rule 加载
- dangerous rule 剥离
- auto mode / plan mode 相关转换

最值得注意的是：

- Claude Code 会显式把某些 Bash / PowerShell / Agent 允许规则视为危险项
- 尤其是 broad allow，一旦会绕过 classifier，它就会在 auto mode 下被剥掉

这说明 Claude Code 不是“先允许，再靠模型自觉”，而是从模式层就开始做风险约束。

### `permissions.ts` 在做什么

这一层是真正的 allow/deny/ask 决策器。

它要合并多种来源：

- settings
- CLI
- command
- session

再叠加：

- hooks
- classifier
- sandbox
- async agent 差异
- permission dialog

这套东西本质上是一个**治理系统**，不是单个 guard 函数。

## 六、`AppStateStore` 暴露了它的产品野心

核心文件：

- `src/state/AppStateStore.ts`

如果只想知道 Claude Code 是“轻工具”还是“厚产品”，看这个文件就够了。

这里的 `AppState` 很重，包含：

- settings
- permission context
- task state
- MCP clients / tools / resources
- plugins
- agent definitions
- file history
- attribution
- todos
- remote bridge 状态
- notifications
- elicitation queue
- 各种面板/视图态

这意味着 Claude Code 把大量复杂度集中在：

- query loop
- app state
- tool runtime

而不是拆成很多概念上“更纯净”但产品上更割裂的小模块。

这是非常典型的产品工程取向。

## 七、Agent 其实是任务系统，不只是递归调用

核心文件：

- `src/tools/AgentTool/AgentTool.tsx`
- `src/tools/AgentTool/runAgent.ts`
- `src/utils/forkedAgent.ts`
- `src/utils/agentContext.ts`
- `src/tasks/LocalAgentTask/LocalAgentTask.tsx`

### `AgentTool.tsx`

这个文件本身就像一个子 runtime：

- 定义 input/output schema
- 决定是否 background
- 支持不同 isolation mode
- 控制 model override
- 控制 agent type / built-in agents
- 跟 task/progress/notification 对接

说明 Claude Code 把 agent 当成正式产品能力，而不是 demo 级 delegation。

### `runAgent.ts`

这个文件负责真正把子 agent 跑起来：

- 解析 agent definition
- 初始化 agent-specific MCP
- 组 prompt
- 组 tools
- 处理 transcript / metadata
- 处理 worktree / cwd
- 跑 query loop

### `forkedAgent.ts`

这是非常值得学的一个点。

Claude Code 不只是“复制一份上下文给子 agent”，而是专门抽出了：

- `CacheSafeParams`
- `createSubagentContext`
- forked transcript 记录
- mutable state 隔离

核心目标有两个：

1. 尽量共享 prompt cache
2. 避免父子运行时互相污染

### `agentContext.ts`

这里用 `AsyncLocalStorage` 管理 agent 身份归因。  
这不是小技巧，而是为了解决：

- 多个 background agent 并发
- analytics attribution
- teammate / subagent 区分

说明 Claude Code 很清楚并发 agent 的状态污染问题。

### `LocalAgentTask.tsx`

这层进一步说明 agent 在 Claude Code 里本质上是 task：

- 有 progress
- 有 notifications
- 有 transcript path
- 有 foreground/background 语义
- 有 retained transcript / panel 生命周期

所以 Claude Code 的 agent 设计，本质上是：

> agent = 受管任务单元

而不是：

> agent = 一次递归 LLM 调用

## 八、MCP 和 remote-control 是第一层能力

核心文件：

- `src/services/mcp/client.ts`
- `src/remote/RemoteSessionManager.ts`
- `src/bridge/bridgeMain.ts`
- `src/utils/messages/systemInit.ts`

### `services/mcp/client.ts`

这个文件非常重要，因为它说明 MCP 在 Claude Code 里不是边角功能。

它承担了：

- transport 适配
- auth refresh
- tool fetch
- tool call
- result shaping
- media handling
- elicitation
- result persistence
- MCP auth 错误传播

这已经不是“SDK client wrapper”，而是一个 MCP runtime 子系统。

### `RemoteSessionManager.ts`

remote session 这块也不是简单 websocket。

它同时管理：

- SDK message 流
- control request/response
- permission request
- reconnect
- HTTP message send

所以它的“远程”不是只远程发 prompt，而是把一套运行时控制协议也带过去。

### `bridgeMain.ts`

这个文件进一步说明 bridge 不是 toy：

- session spawning
- environment/work secret
- backoff
- heartbeat
- capacity wake
- reconnect / timeout / cleanup

说明 Claude Code 把“远端控制 / 远端执行环境”当成核心产品面，而不是附属通道。

### `systemInit.ts`

这里定义了 Claude Code 发给 SDK/remote 客户端的初始化快照：

- cwd
- tools
- MCP servers
- model
- permission mode
- commands
- agents
- skills
- plugins

这等于说明它在系统边界上已经把 runtime 视图正式结构化了。

## 九、Memory 和 stop hook 被当成 turn boundary augmentation seam

核心文件：

- `src/services/SessionMemory/sessionMemory.ts`
- `src/query/stopHooks.ts`

### Session Memory 的位置

Claude Code 的 session memory 不是内嵌在 query 主逻辑里，而是作为后台增强能力接到 turn 边界上。

`sessionMemory.ts` 的模式是：

- 检测时机
- fork 子 agent
- 静默提炼
- 维护当前会话记忆文件

这和 CrawClaw 现在 built-in memory runtime 的方向很像，但 Claude Code 更强调“post-turn side work”。

### `stopHooks.ts` 的意义

这个文件名容易误导，它不只是“停止前的钩子”。

它实际上承担了：

- stop hooks
- task completed hooks
- teammate idle hooks
- extract memories
- prompt suggestion
- auto-dream

所以它更像是：

> 回合结束后的统一扩展 seam

这是 Claude Code 很产品化的一个设计点。

## 十、回归基础设施非常强

核心文件：

- `src/services/vcr.ts`
- 另外还有：
  - `src/tools/AgentTool/built-in/verificationAgent.ts`
  - `src/tools/TodoWriteTool/TodoWriteTool.ts`
  - `src/tools/TaskUpdateTool/TaskUpdateTool.ts`

### `vcr.ts`

Claude Code 的回归不是大量手写 mock，而是：

- 真实 API 输入做 hash
- fixture 持久化
- CI 缺 fixture 就失败

这是一种非常工程化的回归保护。

### verification agent

Claude Code 甚至内置了一个专门找茬的 verification agent。

它的目标不是“确认看起来差不多对”，而是：

- 强制跑命令
- 强制给输出证据
- 强制给 `VERDICT: PASS|FAIL|PARTIAL`
- 明确禁止在项目目录里改代码

再加上 `TodoWriteTool` / `TaskUpdateTool` 在收尾阶段自动 nudge 去调用 verification agent，这说明 Claude Code 对“假完成”这件事是有明确产品机制的。

## 十一、为什么这套架构整体上是成立的

Claude Code 虽然很厚，但主轴其实很清楚：

- `cli.tsx`：入口路由
- `main.tsx`：启动装配
- `QueryEngine.ts`：会话对象
- `query.ts`：回合状态机
- `Tool.ts`：执行契约
- `permissions/*`：治理系统
- `AppStateStore.ts`：共享状态中心
- `AgentTool/*`：任务化 agent runtime
- `services/mcp/*` / `bridge/*`：扩展与远程平面
- `vcr.ts`：回归基础设施

它不是 textbook clean architecture，但它是很强的**产品 runtime architecture**。

## 十二、它的优点和代价

### 优点

- runtime 模型统一
- 会话级状态非常清晰
- 工具和权限不是外挂
- agent 是正式任务对象
- MCP / remote / bridge 都不是边角功能
- recovery 路径大多被主状态机吸收
- regression 能力很强

### 代价

- 核心文件很厚
- startup 很重
- `AppState` 很大
- feature gate 带来很多分叉
- 对新读代码的人来说，心智负担不低

也就是说，Claude Code 不是“小而美”，而是“厚但有内在秩序”。

## 十三、如果你要从中学什么，最值得学的是这几个点

1. **把 agent 做成 task-backed runtime**
   不是一次工具调用，而是正式任务单元。

2. **把恢复逻辑尽量收回主状态机**
   而不是 everywhere detector。

3. **把权限做成分层治理**
   mode、rules、classifier、hooks、dialog，不是一层 `before_tool_call`。

4. **尽早做 inspection / status / structured init**
   这样后面 remote、SDK、运维面都会顺。

5. **把 replay / fixture / review 当成基础设施**
   这会直接决定这套系统能不能长期稳定进化。

## 十四、你下一步怎么继续读

如果你接下来想继续深入，我建议按三条线继续：

### A. 如果你想学 runtime

继续看：

- `src/query.ts`
- `src/query/stopHooks.ts`
- `src/query/tokenBudget.ts`
- `src/services/compact/*`

### B. 如果你想学 agent

继续看：

- `src/tools/AgentTool/*`
- `src/tasks/*`
- `src/utils/forkedAgent.ts`
- `src/utils/agentContext.ts`

### C. 如果你想学治理

继续看：

- `src/utils/permissions/*`
- `src/hooks/*`
- `src/services/mcp/*`

## 最后的判断

如果只用一句话总结 Claude Code 的整体设计，我会这么说：

> Claude Code 不是围绕“提示词”组织起来的，而是围绕“一个长期存在、可治理、可扩展、可恢复的 agent runtime”组织起来的。

这也是它最值得学习的地方。
