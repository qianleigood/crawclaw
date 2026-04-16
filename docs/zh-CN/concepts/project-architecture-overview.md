---
read_when:
  - 你想从项目整体层面理解 CrawClaw 的真实系统结构
  - 你要做跨模块重构、前端重构或平台级设计
summary: CrawClaw 的项目级整体架构分层与运行链总览
title: 项目整体架构总览
---

# 项目整体架构总览

本文档用于说明 CrawClaw 仓库的真实系统形态。它不是一个普通的“聊天应用 + 管理后台”，而是一个本地优先的 AI runtime platform。

## 一句话定义

CrawClaw 是一个以 Gateway 为控制平面、以 Agent Kernel 为执行内核、以 Plugin Platform 为扩展底座、以 Channel Runtime 为渠道运行层、并同时承载 Memory、Workflow、ACP 和 Control UI 的统一 AI 运行时平台。

## 当前仓库的一级结构

- `src/`: 主运行时与控制平面
- `ui/`: Control UI 独立前端包
- `extensions/`: 官方扩展生态
- `packages/`: 辅助包与兼容包
- `docs/`: 产品文档、参考文档、维护文档、调试材料
- `scripts/` 与 `.github/`: 交付与工程自动化层
- `test/`: 跨域共享测试基础设施
- `Swabble/`: 并列 sidecar 项目，不属于主运行时
- `dist/`: 构建产物，不用于解释源码架构

## 真实的一等模块

当前代码形态更适合按 9 个一等模块理解。

### 1. Control Plane

职责：

- 系统配置、鉴权、节点、设备、事件、WebSocket/RPC、健康状态、控制面 API

主要目录：

- `src/gateway`
- `src/config`
- `src/secrets`
- `src/daemon`

结论：

Gateway 不是一个简单的 Web 服务，而是整个系统的控制平面。

### 2. Interaction Plane

职责：

- 入站消息编排
- session 生命周期
- command 语义
- reply orchestration
- typing、route、queue、inline directive

主要目录：

- `src/auto-reply`
- `src/sessions`
- `src/commands`

结论：

这里不是模型执行层，而是交互编排层。它应该只负责“如何进入一次运行”，而不直接成为执行内核。

### 3. Agent Kernel

职责：

- 模型调用
- tool 调用
- tool policy 与 allow/deny 控制
- provider 接入
- subagent
- sandbox
- shell/browser/file/process 执行
- 流式事件与执行观测

主要目录：

- `src/agents`

结论：

这是当前仓库里最重的核心模块，也是后续最需要收敛边界的地方。

### 3.1 Tool Substrate

职责：

- 提供模型可调用的结构化执行面
- 把 shell、browser、gateway、workflow、memory、message、sessions、nodes 等能力统一成 typed tool
- 为 special agent、主 agent、workflow step 提供同一套工具契约

主要代码入口：

- `src/agents/crawclaw-tools.ts`
- `src/agents/tools`
- `src/agents/pi-tools.ts`

结论：

tools 不是实现细节，而是执行内核真正的能力底座。系统里几乎所有“超出纯文本生成”的能力都通过 tool substrate 暴露。

### 3.2 Skills Layer

职责：

- 以 Markdown 指令集的形式给模型提供任务型行为覆盖
- 管理 bundled、workspace、project、personal、plugin skills 的加载与合并
- 控制 skill 是否进入系统提示词、如何裁剪 prompt 预算、如何参与 hook 决策

主要代码入口：

- `src/agents/skills`
- `src/agents/skills/workspace.ts`
- `src/agents/skills/local-loader.ts`
- `src/agents/skills/plugin-skills.ts`

结论：

skills 不是 tools。  
tools 负责“能做什么”，skills 负责“什么时候做、如何做、按什么流程做”。它们应该在架构里被明确地区分。

### 4. Special Agent Substrate

职责：

- 支撑维护型、验证型、后台型 special agent
- 为特殊 agent 声明稳定 contract
- 管理 execution mode、transcript policy、tool allowlist、cache policy、timeout、observability

主要目录：

- `src/agents/special/runtime`

当前已接入 special agent：

- `verification`
- `memory-extraction`
- `dream`
- `session-summary`

结论：

special agent 不是 memory 内部技巧，而是 Agent Kernel 的一级子层。未来任何“受控后台 agent”都应通过这层接入，而不是各自私建子会话。

### 5. Channel Runtime

职责：

- 渠道入站/出站
- command gating
- allowlist
- pairing
- typing
- threading
- conversation binding
- message action
- stream surface projection

主要目录：

- `src/channels`

结论：

channels 不应再被视为“插件附属代码”。它已经是一个独立运行时层。

### 6. Capability Platform

职责：

- 插件发现、加载、启停、运行时注入
- provider/channel/tool/setup/interactive 扩展接口
- 对外的 plugin-sdk 公共能力面

主要目录：

- `src/plugins`
- `src/plugin-sdk`
- `extensions`

结论：

这部分实际上已经形成平台底座，只是命名上还没有完全显式化。

### 7. Domain Services

职责：

- Memory
- Workflow
- Cron
- Tasks

主要目录：

- `src/memory`
- `src/workflows`
- `src/cron`
- `src/tasks`

结论：

这些能力都应以“领域服务”身份存在，而不是零散嵌进别的层。

### 7.1 Memory Runtime

Memory 需要单独强调，因为它在当前系统里不是一个“附加搜索插件”，而是正式运行时。

职责：

- 记忆抽取
- durable memory 存储
- session summary
- dream
- recall / ranking
- prompt assembly
- compaction 相关上下文维护

主要代码入口：

- `src/memory/index.ts`
- `src/memory/engine`
- `src/memory/durable`
- `src/memory/session-summary`
- `src/memory/dreaming`
- `src/memory/orchestration`

同时，memory 还通过 special agent substrate 显式接入了三类后台 agent：

- `memory-extraction`
- `session-summary`
- `dream`

结论：

memory 是平台级领域服务，不应被简化成“向量检索”或“附加上下文”。

### 7.2 Cache Substrate

缓存也需要被单独强调，因为它在当前系统里不是一个集中式模块，而是一套跨层分布的运行时机制。

主要层次：

- query / prompt cache contract：
  - `src/agents/query-context/cache-contract.ts`
- special agent cache snapshot 与 fork reuse：
  - `src/agents/special/runtime/cache-safe-params.ts`
  - `src/agents/special/runtime/cache-plan.ts`
- 运行时加速缓存：
  - `src/agents/context-cache.ts`
  - `src/agents/bootstrap-cache.ts`
  - `src/agents/pi-embedded-runner/session-manager-cache.ts`
- plugin / routing / control plane 缓存：
  - `src/plugins/loader.ts`
  - `src/routing/resolve-route.ts`
  - `src/gateway/model-pricing-cache.ts`
  - `src/acp/control-plane/runtime-cache.ts`
- domain / UI 读写缓存：
  - `src/memory/session-summary/store.ts`
  - `src/memory/engine/built-in-memory-runtime.ts`
  - `ui/src/ui/chat/session-cache.ts`

关键结论：

- 项目里没有“唯一缓存中心”，而是多种 cache substrate 并存。
- 最关键的缓存不是简单 `Map`，而是 prompt/query 层的身份计算与 special agent 的继承/漂移判断。
- memory special agent 已经把 cache policy 提升成正式 contract，而不是运行时临时选项。
- 后续架构治理时，缓存应被视为跨层能力主题，而不是散落的性能技巧。

### 8. Protocol / Interop Plane

职责：

- ACP
- MCP
- Gateway protocol schema
- 外部控制端与第三方 agent 互操作

主要目录：

- `src/acp`
- `src/mcp`
- `src/gateway/protocol`

结论：

ACP 不是一个小功能，而是独立协议面。它应和 Gateway 的外部互操作一起被看待。

### 9. Presentation Plane

职责：

- 浏览器 Control UI
- 通过 Gateway 协议消费系统状态与执行状态

主要目录：

- `ui`

结论：

UI 现在已经独立成包，但当前更接近 control console，还不是彻底按平台信息架构组织的产品界面。

## 与其他概念文档的关系

- 如果你想看 Gateway 控制面的细节，请继续读 [Gateway 网关架构](/concepts/architecture)。
- 如果你想看智能体运行细节，请继续读 [智能体运行时](/concepts/agent)。
- 如果你想看记忆层，请继续读 [记忆](/concepts/memory)。
- 如果你想看缓存在整个平台里的归属与策略，请继续读 [项目缓存机制总览](/concepts/project-cache-strategy)。

## 关键运行链

### 主交互链

`CLI / Channel / UI / ACP -> Gateway -> auto-reply -> agent kernel -> tools/providers/plugins -> reply projection -> channel/UI`

其中：

- `tools` 负责执行能力暴露
- `skills` 负责任务型提示覆盖
- `special agent` 负责受控后台运行

### Memory 维护链

`session / runtime signals -> memory orchestration -> special agent -> durable/session-summary outputs -> prompt assembly`

### Workflow 链

`user task -> agent success path -> workflow spec -> local registry/versioning -> n8n compile/execute -> execution sync -> channel/UI/action feed`

### Special Agent 链

`domain trigger / parent run -> special agent substrate -> embedded_fork 或 spawned_session -> constrained tools/cache/transcript -> structured completion`

### Cache 链

`query assembly / provider hints / special agent fork / routing / plugin registry / file snapshot / UI session -> 各域缓存与失效策略 -> 更低延迟与更稳定的运行时行为`

## 当前架构的主要优点

- 控制平面、执行内核、扩展层都已经成形，不是从零开始的系统。
- `extensions/*` 与 `plugin-sdk` 已经具备正式平台雏形。
- `memory` 和 `workflow` 不是附属模块，而是系统内生能力。
- `special agent` 已经有共享 substrate，而不是每个域各造一套后台 agent。
- 缓存并非零散优化，而是已经形成 prompt、runtime、control-plane、UI 多层协作机制。
- UI 已独立成包，适合继续做平台级信息架构。

## 当前架构的主要问题

- `src/agents` 过大，承载了过多执行与集成逻辑。
- `src/infra` 有明显沉积层倾向，很多逻辑已经不是真正的基础设施。
- `src/commands`、`src/auto-reply`、`src/gateway` 存在重复入口语义。
- `channels` 已经是一层运行时，但在工程叙事里仍容易被低估。
- `ACP` 和 `special agent` 都足够大，但目前仍缺正式一级定位。
- 缓存层已经很多，但目前仍缺统一的缓存盘点、治理规则和测试叙事。
- `docs/` 和 `tests/` 很丰富，但还没有完全按照平台边界组织。

## 目标架构原则

- 先治理边界，再治理物理拆包。
- 先统一事件模型，再统一 UI 展示。
- 先收敛业务入口，再拆分控制面与执行面。
- 特殊 agent 一律走 substrate，不再私建后台执行路径。
- channels、plugins、ACP 明确作为平台层，而不是配件层。

## 推荐的近期重构重点

1. 收敛 `commands / auto-reply / gateway methods` 的重复业务入口。
2. 把 `special agent substrate` 正式纳入架构与文档，而不是只留在 debug 叙事里。
3. 将 `channels` 提升为正式一级平台层。
4. 继续统一 execution visibility、workflow、action feed、channel projection 的事件语义。
5. 以平台边界重做 UI 信息架构，而不是继续按单页功能堆叠。

## 长期目标

待边界稳定后，再考虑物理拆分为独立包或子系统，例如：

- `control-plane-core`
- `interaction-engine`
- `agent-kernel`
- `special-agent-substrate`
- `channel-runtime`
- `plugin-platform`
- `memory-runtime`
- `workflow-runtime`

当前不建议直接进入大规模拆包。先让依赖方向和语义分层稳定，否则只会把复杂度从目录里搬到 workspace 里。
