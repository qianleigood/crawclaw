---
title: 桌面端产品化设计
summary: 结合 Codex 产品机制，把 CrawClaw Desktop 产品化为桌面 agent 助手的设计方案，覆盖前端交互、桌面 Gateway 状态、运行时事件和后端职责边界。
read_when:
  - 你正在实现或评审 CrawClaw Desktop 的产品体验。
  - 你正在修改桌面端运行事件、对话状态、sub-agent 展示、权限、插件、agent、memory 或 settings。
  - 你需要把当前桌面应用推进成完整桌面 agent 助手的分阶段落地方案。
x-i18n:
  generated_at: "2026-06-10T12:43:23Z"
  model: codex
  provider: openai
  source_hash: 2b085173327a3d99314ba4f71baa5bfd14df3f7e3ec1a1d4d43764f0f5a8ccd0
  source_path: superpowers/specs/2026-06-05-desktop-productization-design-zh.md
  workflow: 15
---

# 桌面端产品化设计

## 摘要

CrawClaw Desktop 当前已经具备不少正确的能力：聊天、附件、语音输入、workflow 消息、skills、plugin tools、agents、memory、权限、sub-agents、sessions、runtime 状态、model profiles 和 settings。当前的产品缺口不是缺页面，而是这些能力还没有收敛成一个清楚的“桌面 agent 助手”心智。

目标产品应该先像一个常驻桌面 agent 助手，再在需要时进入任务执行或自动化模式：

- 用户可以随时问问题、整理信息、理解当前状态、打开能力、检查记忆、处理提醒。
- 不是所有场景都是任务；闲聊、解释、配置、查看状态、检索记忆、管理能力都可以是轻量助手交互。
- 当用户给出明确目的或创建自动化时，系统才进入结构化 run lifecycle。
- 进入 run lifecycle 后，工具调用、权限决策、sub-agent、上下文摘要、产物、失败、重试和最终回答都应可见。
- Agents 和 plugins 通过 capability 模型配置，并能直接连接到任务执行。
- Settings 用来解释和修复本地 runtime，而不是一个宽泛的控制项陈列页。

本设计建议走增量路线：先建立 Codex-like conversation shell 和 run inspector，再把 goal-directed tasks、automations、agents、plugins、skills、memory 和 settings 接入同一套可观察状态。这个方案避免重写整个桌面端，并继续让 Rust 持有 runtime 执行职责。

这版设计同时把 Codex 作为产品参照。Codex 的关键价值不只是“能写代码”，而是把复杂 agent 协作产品化成可配置、可观察、可审查、可恢复的桌面工作台：项目和线程边界清楚，执行过程有侧栏，权限和 sandbox 明确，skills/plugins/MCP 可复用，automations 可后台运行，subagents 可并行协作，review/diff/browser 能把结果变成可反馈对象。CrawClaw Desktop 应借鉴这些界面机制，但不照搬代码开发场景；它要服务的是本地 agent 助手、插件、渠道、memory、自动化任务和有明确目的的任务。

## 当前代码基线

当前桌面端产品链路是：

```text
Tauri shell
  -> React renderer
  -> local Desktop Gateway HTTP and SSE
  -> desktop state and stores
  -> Rust runtime, sessions, tools, providers, memory, and native plugins
```

关键代码面如下：

| 区域                              | 当前代码                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| App shell 和 workspace 路由       | `apps/crawclaw-desktop/src/App.tsx`                                                                              |
| 桌面状态 bootstrap 和 SSE reducer | `apps/crawclaw-desktop/src/app/use-desktop-state.ts`                                                             |
| Desktop HTTP client               | `apps/crawclaw-desktop/src/api/desktop-client.ts`                                                                |
| Desktop SSE 订阅                  | `apps/crawclaw-desktop/src/api/desktop-events.ts`                                                                |
| 聊天和 composer 交互              | `apps/crawclaw-desktop/src/views/chat-workspace.tsx`                                                             |
| 对话渲染                          | `apps/crawclaw-desktop/src/views/chat-thread.tsx`, `apps/crawclaw-desktop/src/views/conversation-messages.tsx`   |
| Agent 管理                        | `apps/crawclaw-desktop/src/views/agent-workspace.tsx`, `apps/crawclaw-desktop/src/views/agent-create-wizard.tsx` |
| Plugin tools 和 skills            | `apps/crawclaw-desktop/src/views/plugins-workspace.tsx`                                                          |
| Memory workspace                  | `apps/crawclaw-desktop/src/views/memory-workspace.tsx`                                                           |
| Settings                          | `apps/crawclaw-desktop/src/views/settings-workspace.tsx`                                                         |
| Desktop API server state          | `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`                                                     |
| Desktop native mutations          | `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_native_operations.rs`                           |
| Desktop session routes            | `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_session_routes.rs`                              |
| Runtime loop events               | `crates/crawclaw-runtime/src/agent_runtime_types.rs`                                                             |
| Runtime backend                   | `crates/crawclaw-runtime/src/agent_runtime_backend.rs`                                                           |
| Gateway session ownership         | `crates/crawclaw-gateway/src/gateway_sessions.rs`                                                                |
| Gateway RPC ownership             | `crates/crawclaw-gateway/src/gateway_rpc.rs`                                                                     |

Renderer 当前已经处理 bootstrap、runtime status、message deltas、message finals、tool calls、tool results、permission changes、permission requests、operation failures 和 state snapshots。但它还没有把事件流整理成完整 run lifecycle。比如后端在 desktop send 时会发 `SessionStarted`，但当前 renderer reducer 还没有把这个事件作为一等状态迁移来处理。

Runtime 也已经暴露了比 desktop 当前渲染更丰富的事件。`AgentLoopEvent` 包含 context projection、provider blocks、tool execution、tool progress、permission events、tool use summaries 和 hooks。Desktop 当前主要把这些事件压缩成通用 tool call 和 tool result 消息。

## 产品问题

当前 app 有两个主要问题：助手心智不够清楚，以及结构化执行不够可观察。

助手心智问题：用户看到 chat、agents、plugins、memory、automation 和 settings 是几个独立房间。这会让 app 看起来很强，但用户不容易理解 CrawClaw 是一个可以常驻桌面、理解上下文、帮助操作和管理自动化的 agent 助手。

结构化执行问题：当用户给出明确目的、要求执行操作、创建自动化或触发高风险能力时，app 还没有完整展示执行故事。它可以流式显示 assistant message，可以展示通用工具事件，也可以请求权限，但还不能稳定回答这些问题：

- 使用了什么上下文？
- 哪个 agent profile 在负责这次 run？
- 哪些工具可用？
- 哪些工具运行了，为什么运行？
- 每个工具报告了什么进度？
- 做了哪些权限决策？
- 是否 spawn 了 sub-agent？
- 产生了哪些 artifact？
- 为什么失败？
- 用户下一步能做什么？

轻量助手交互不应被强行包装成任务；结构化执行才需要 run lifecycle。产品应该在这两种模式之间自然切换，让用户无需理解 runtime 内部结构。

## 目标

- 让桌面端默认界面成为 conversation shell：打开后进入最近对话或新对话，而不是单独设计首页。
- 区分轻量助手交互、明确目的任务、自动化任务三类场景。
- 让每个明确目的任务和自动化任务都产生结构化 run，并有可见状态。
- 在 conversation 中只为结构化 run 渲染按时间顺序组织的 task timeline。
- 把 tool calls、progress、permission requests、sub-agent activity、artifacts、failures、retries 和 final answers 呈现成一条连续交互。
- 把 agent、plugin、skill、memory 和 settings 页面连接到助手能力、自动化和真实任务执行。
- 继续让 Rust 持有 runtime policy、provider calls、tool execution、session state、memory 和 permissions。
- 让 React 保持 renderer 和本地交互控制层职责。
- 使用现有 Desktop Gateway 作为产品 API，不增加新的 TypeScript runtime seam。
- 分阶段落地，确保每个阶段都能测试和发布。

## 非目标

- 不重写整个桌面 app。
- 不新增公共 JavaScript plugin SDK。
- 不把 runtime orchestration 移到 React。
- 不替换 Rust runtime loop。
- 不把 remote gateway parity 作为桌面产品前置条件。
- 不在第一阶段把每个 settings 控制项都实现为平台集成。
- 本设计不修改生成目录 `docs/zh-CN/**`。
- 不为了无关 cleanup 触碰安全受限 surface。

## 假设

- CrawClaw Desktop 仍是 supported local-first product entrypoint。
- Local Desktop Gateway 仍保持 loopback-bound 和 token-protected。
- Desktop app 继续消费 `/api/desktop/bootstrap`、`/api/desktop/state`、`/api/desktop/events` 和对应 mutation routes。
- Session transcripts 仍是 durable history source。
- Runtime execution 仍由 Rust 持有。
- Desktop renderer 可以展示更丰富的 run state，但不成为 run policy owner。
- 当前部分文件偏大。本设计只建议服务于产品工作的定向拆分。

## 设计原则

1. 助手是主对象，任务是模式。
   CrawClaw 的默认心智是桌面 agent 助手。Conversation 重要，是因为它承载助手关系和上下文；task run 重要，是因为它承载明确目的的执行；automation 重要，是因为它让助手能在后台持续工作。

2. 正在运行的工作必须可观察。
   对于明确目的任务和自动化，用户应该始终知道 CrawClaw 是在 planning、thinking、using context、waiting for permission、running a tool、spawning a sub-agent、writing an artifact、retrying，还是 finished。对于轻量对话，不应制造多余任务状态。

3. 能力配置必须导向使用。
   Agent、plugin、tool、skill 和 memory 配置应该说明这些能力会在哪里被使用，以及如何影响 task。

4. 高级控制保持可达，但不要喧宾夺主。
   Composer 应该暴露当前 agent、model、thinking、permission mode、attachments 和 command entry。低频设置放在 menus、drawers 或 workspace pages。

5. 失败状态需要恢复动作。
   Runtime check、provider setup、tool call、memory sync 或 permission decision 失败时，都应该给出下一步有用动作。

6. Rust 发出事实，React 渲染决策。
   Rust 发出结构化 run events 和 state snapshots。React 渲染它们，保留临时 UI state，并向用户请求决策。

## Codex 产品参照

Codex 产品给 CrawClaw Desktop 的最大启发是：agent 产品不能只给一个聊天框，也不能只做任务队列。它需要让用户在一个桌面工作台里完成“提问、理解、计划、执行、权限、产物、验证、审查、继续迭代”的完整闭环。

本节基于 2026-06-05 获取的官方 Codex manual 做产品抽象，重点参考 Codex app features、best practices、skills、plugins、MCP、automations、subagents、permissions、memories 和 hooks。这里借鉴的是产品机制，不是要求 CrawClaw 复制 Codex 的代码开发定位。

### UI 标杆结论

CrawClaw Desktop 的主界面设计应以当前 Codex app 为最高优先级参照。原因是 Codex app 已经把 agent 产品最难的几个界面问题处理得比较成熟：多线程任务管理、执行过程可观察、权限和 sandbox 可理解、产物可审查、用户能在同一工作台里继续反馈和迭代。

这里的“以 Codex 为标杆”不是复制颜色、文案或代码开发内容，而是复用它的界面骨架和交互节奏：

- 左侧是项目、线程、活动和 inbox 导航，承担定位和切换。
- 中间是助手对话和当前工作流，轻量场景显示自然对话，结构化场景显示计划、执行事件和最终结果。
- 右侧是 inspector/review 面板，承担上下文、工具、产物、验证和反馈。
- 底部是 composer，承担输入、模式、权限、agent、model 和附件。
- 顶部或右上角是轻量状态区，承担 runtime、terminal/diagnostics、browser/review、settings 入口。
- 阻塞项通过全局 tray 暴露，不要求用户停留在某个页面才能发现。

因此，后续 UI 设计不应走传统后台管理系统路线，也不应走营销式大卡片首页路线。它应该像 Codex 一样保持工作台密度：信息紧凑、状态清楚、操作可达、解释性文字克制，把屏幕空间留给助手对话、当前上下文和正在发生的工作。

### 可借鉴机制

| Codex 产品机制                     | Codex 中的作用                                             | CrawClaw Desktop 落点                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Project 和 thread                  | 每个项目有明确工作目录，每个 thread 承载一段上下文         | 用 Conversations 和 Activity 表达桌面助手状态，而不是把所有能力散在 workspace                                                |
| Local、Worktree、Cloud 模式        | 让用户知道 agent 在哪里运行，以及是否隔离本地改动          | 先落 Local runtime，后续可扩展为 Local、Remote Gateway、Isolated Workspace 等执行模式                                        |
| Plan mode                          | 复杂任务先澄清和计划，再执行                               | 在 composer 加入“计划优先”任务模式，复杂任务先产出 plan card，用户确认后执行                                                 |
| Task sidebar                       | 展示 plan、sources、artifacts、summary，让用户跟随工作进展 | 在 conversation 中加入 inspector 或 right rail；轻量对话显示上下文，结构化 run 显示 tools、permissions、subagents、artifacts |
| Review pane 和 diff                | 用户能检查 Codex 做了什么，给精确反馈                      | 对 CrawClaw 产物提供 artifact review、配置变更 review、文件变更 review，而不是只显示最终文本                                 |
| Integrated terminal                | 验证命令、日志和状态留在同一 thread                        | 对本地 runtime、gateway、channel、plugin health 提供内置诊断输出和可复制验证命令                                             |
| In-app browser 和 browser comments | 可视化页面可以直接标注反馈                                 | 对 UI、网页、dashboard、local preview 类任务提供 visual review 入口和元素级反馈模型                                          |
| Skills                             | 把重复工作沉淀为可复用 workflow                            | 把 CrawClaw 的 skills 做成 capability，并显示触发条件、输入、输出、使用记录                                                  |
| Plugins                            | 把 skills、apps、MCP servers 打包分发                      | 把 bundled plugins 和用户插件作为 capability package，而不是单纯安装列表                                                     |
| MCP                                | 连接外部工具和上下文                                       | 把 provider、channel、工具和外部数据源统一为“连接能力”，显示认证、权限和健康状态                                             |
| Automations                        | 后台周期任务进入 inbox 或 triage                           | CrawClaw 的 automations 应有 activity inbox、失败恢复、thread automation 和 standalone automation 区分                       |
| Subagents                          | 并行探索、测试、审查，主线程只收摘要                       | CrawClaw 的 sub-agents 应显示为 child activities，并能展开查看、停止、继续或汇总                                             |
| Permissions 和 sandbox             | 让用户理解 agent 能做什么、何时需要确认                    | 权限模式要在任务前可见，权限请求要进入 global tray 和 timeline，决定结果要可审计                                             |
| Memories                           | 把可复用上下文从历史工作中沉淀出来                         | Memory workspace 不只显示 records，还要显示“本次任务用到和写入了哪些 memory”                                                 |
| Hooks                              | 在 agent lifecycle 上接入校验、记录、拦截                  | CrawClaw 后端应把 runtime lifecycle 作为统一事件 spine，避免 UI、memory、plugins 各自定义生命周期                            |

### 不应照搬的部分

- Codex 的主场景是软件开发，CrawClaw 的主场景是本地 agent 和跨渠道自动化，因此不要把所有任务都设计成代码 diff。
- Codex 的 Worktree 很适合 Git repo 隔离；CrawClaw 可以借鉴“隔离执行模式”，但第一阶段不应强行引入 worktree。
- Codex 的 review pane 是代码 diff 优先；CrawClaw 需要更通用的 artifact review，包括文件、配置、渠道消息、workflow、memory 写入和插件调用结果。
- Codex 的 plugin/app 生态依赖 Codex 配置层；CrawClaw 应保留 Rust plugin SDK 和 native plugin 边界，不新增 JavaScript SDK seam。

### 对 CrawClaw 的产品判断

CrawClaw Desktop 应该成为“桌面 agent 助手”，而不是“聊天页加若干管理页”，也不是“任务执行器”。Codex 已经证明，agent 产品的体验关键在于让用户看见 agent 的工作边界、上下文来源、工具动作、权限风险和结果可审查性。CrawClaw 的优势是本地 runtime、channels、memory、native plugins 和多入口自动化，因此桌面端要把这些能力收敛成一个可对话、可观察、可自动化、可执行明确目的任务的助手。

## 推荐产品形态

### 一级信息架构

App 保留当前 workspace model，但围绕用户工作重新排序。这个排序借鉴 Codex app 的项目、线程、自动化、skills/plugins 和 review 组织方式，但使用 CrawClaw 自己的 runtime 和 channel 语义。

| 产品区域                 | 目的                                                                | 当前来源                                  |
| ------------------------ | ------------------------------------------------------------------- | ----------------------------------------- |
| Projects                 | 管理本地 runtime 项目、workspace roots、执行模式和诊断入口          | 新 workspace 或 Settings 中的项目 section |
| Conversations            | 默认入口，恢复最近 thread 或新建对话；承载轻量助手交互和结构化 run  | `ChatWorkspace`                           |
| Agents                   | Worker profiles、tools、skills、model、permission defaults          | `AgentWorkspace`                          |
| Capabilities             | Plugins、tools、skills、installs 和 test runs                       | `PluginsWorkspace`                        |
| Memory                   | Local 和 Hindsight memory activity、search、repair                  | `MemoryWorkspace`                         |
| Activity And Automations | 运行中的工作、后台自动化、thread automation 和 recurring work inbox | 现有 nav item，未来 workspace             |
| Review                   | 审查 artifacts、配置变更、文件变更、memory 写入和 workflow 输出     | 新 workspace 或 conversation right rail   |
| Settings                 | Runtime、providers、safety、privacy、notifications、advanced        | `SettingsWorkspace`                       |

左侧 sidebar 可以继续保留 conversations，但 nav 应该让 assistant activity status 可见。用户不应该必须进入每个 workspace 才知道后台自动化是否在运行、是否有权限待确认、或是否有工具失败。

### Codex-like 界面骨架

推荐采用 Codex-like 三栏工作台，而不是 dashboard-heavy 布局：

```text
Left sidebar
  project switcher
  conversations
  activity and automations
  agents
  capabilities
  memory
  settings

Main pane
  active thread or new conversation
  conversation
  optional plan card
  optional task timeline
  assistant response or selected workspace
  composer

Right inspector
  assistant state or run summary
  context sources
  tool activity
  permission decisions
  sub-agents
  artifacts
  review feedback
  diagnostics
```

布局规则：

- 左侧导航宽度稳定，避免因为 thread 标题变化导致布局跳动。
- 中间主任务流保持阅读优先，timeline cards 用紧凑层级，不堆叠大装饰卡片。
- 右侧 inspector 默认可折叠；运行中、权限待确认、review needed 时自动显示对应 section。
- Composer 固定在主任务流底部，并把 agent/model/permission/plan-first 作为状态控件，而不是正文说明。
- Settings、Capabilities、Memory 可以复用三栏骨架：左侧列表，中间详情，右侧状态/诊断/最近使用。
- 所有页面都应有清楚的 empty、loading、running、blocked、failed、done 状态。

视觉风格应接近 Codex 的工作台气质：低装饰、低饱和、边界清楚、控件紧凑、强调可读状态而不是大面积品牌表达。除非是真正的欢迎或首次安装流程，不做 landing page 和大 hero。

### 默认打开状态

CrawClaw Desktop 不设计独立首页。默认打开状态应贴近 Codex：直接进入最近使用的 conversation；如果没有历史 thread，则进入空白新对话 shell。

默认状态只需要表达三件事：

- 当前可以直接和 CrawClaw 对话。
- 当前 runtime、provider、memory、channels 是否可用。
- 是否有需要处理的活动，例如权限请求、自动化发现、review-needed artifact 或失败恢复。

这些状态不应占据一个首页，而应分布在左侧 sidebar、全局 tray、right inspector 和 composer 附近。用户启动 app 后的主动作始终是“继续对话或开始新对话”，不是先浏览首页模块。

### Conversations

Conversation 仍是主要工作界面。布局应为：

```text
Header
  current thread, agent, model, runtime status, task actions

Timeline
  user message
  run card
  context summary
  tool and permission events
  sub-agent events
  assistant answer
  artifacts and follow-up actions

Composer
  attachment menu, agent selector, thinking selector, model selector,
  permission mode, text input, voice input, send or stop
```

现有 composer 已经有很多这些控制项。本设计目标不是继续增加更多控制项，而是让这些控制项在发送前和发送后的影响更清楚。

Codex 参照下，Conversation 不应只是消息流，而应包含 run inspector。Run inspector 可以放在右侧 rail 或可展开 drawer，展示：

- plan 和用户确认状态
- context sources，包括 memory、skills、files、sessions、channel context
- tool 和 plugin 调用
- permission requests
- sub-agent threads
- artifacts
- verification 或 diagnostics
- task summary 和下一步动作

复杂任务默认先进入 plan-first 流程。用户可以选择“直接执行”或“先计划”。先计划时，assistant 输出 plan card，用户确认后才进入执行 run；这能把 Codex Plan mode 的产品价值迁移到 CrawClaw，而不要求所有任务都走重流程。

### Agents

Agents 应呈现为可复用任务 profiles：

- identity and purpose
- model and thinking defaults
- permission default
- enabled tools
- enabled skills
- memory behavior
- channel behavior
- last used tasks
- setup or validation status

Create wizard 最后应该有一个可用的“test this agent”动作。Agent detail page 应展示一个 task 会从该 agent 继承什么，以及哪些设置会被当前 conversation 覆盖。

### Capabilities

Plugins、tools 和 skills 应分组为 capabilities：

- installed plugins
- available tools
- available skills
- permission category
- read-only or write-capable status
- owning plugin or runtime source
- required configuration
- recent usage
- attach to agent action
- safe test run action

这样 `PluginsWorkspace` 不再只是一个孤立 marketplace，而是用户理解 CrawClaw 能做什么、这些能力如何进入 task 的地方。

参考 Codex 的 skills/plugins/MCP 模型，Capabilities 应分成三层：

- Workflow capabilities：skills、playbooks、可复用任务流程。
- Tool capabilities：runtime tools、native plugin tools、MCP-like external tools。
- Connection capabilities：channels、providers、external apps、auth-backed data sources。

每个 capability 都应展示“何时使用、需要什么权限、输入输出是什么、最近在哪些任务用过、能否绑定到 agent、能否后台自动化运行”。

### Memory

Memory 应同时展示内容和运行状态：

- memory records
- active filters and search
- Hindsight status
- worker status
- outbox state
- last sync
- sync failures
- repair actions
- 写入或使用 memory 的 task runs

用户应该能快速回答两个问题：“CrawClaw 记住了什么？”以及“memory 是否健康？”

### Settings

Settings 应变成 repair 和 defaults surface：

- General and appearance
- Provider and model setup
- Task defaults
- Permission defaults
- Memory defaults
- Notifications
- Privacy and data
- Runtime diagnostics
- Advanced controls

每个 setting row 都应该有诚实状态：

- Active：已持久化，且影响当前 task behavior。
- Preview：已持久化或展示，但还没有连接到平台效果。
- Needs setup：被缺失的 provider、runtime、plugin、permission 或操作系统能力阻塞。

Codex 的 settings 强调 config、permissions、sandbox、MCP、plugins 和 automations。CrawClaw Settings 也应围绕这些影响执行结果的设置组织，而不是只按视觉页面分组。推荐增加一个“Execution profile”区块，集中展示默认 model、reasoning/thinking、permission mode、runtime root、network policy、channel access、plugin access 和 memory policy。

## Task Run 生命周期

### 状态机

每个用户任务应该有一个 run state。复杂任务可以在 `draft` 和 `submitted` 之间插入 `planned` 和 `approved_to_execute`，对应 Codex 的 plan-first 工作方式：

```text
draft
  -> planned
  -> approved_to_execute
  -> submitted
  -> context_ready
  -> running
  -> waiting_for_permission
  -> running
  -> streaming
  -> completed

Any non-final state may transition to:
  -> failed
  -> cancelled
```

Sub-agents 和 tools 是 run 内部的 child activities。除非它们明显会在 parent 之外继续存在，否则不应该创建无关的顶层状态。

### Run 阶段

| 阶段                     | 用户看到                                                           | 数据来源                                |
| ------------------------ | ------------------------------------------------------------------ | --------------------------------------- |
| `draft`                  | Composer text、selected agent、model、permission mode、attachments | local React state                       |
| `planned`                | plan card、scope、verification、risk notes                         | assistant plan output                   |
| `approved_to_execute`    | 用户确认执行后的 run gate                                          | user decision                           |
| `submitted`              | User message 和 pending run card                                   | optimistic UI plus Desktop Gateway send |
| `context_ready`          | context summary、selected tools、memory snippets、token estimate   | runtime context summary                 |
| `running`                | thinking 或 tool activity                                          | runtime loop event                      |
| `waiting_for_permission` | global permission tray 和 timeline permission node                 | desktop permission request              |
| `tool_running`           | 带 arguments summary 和 progress 的 tool card                      | tool execution events                   |
| `subagent_running`       | child task card 和 child transcript link                           | session events                          |
| `streaming`              | assistant output stream                                            | message delta events                    |
| `completed`              | final answer、artifacts、follow-up actions                         | message final plus run summary          |
| `failed`                 | error code、detail、retry、diagnostics、settings link              | operation failed or run error           |
| `cancelled`              | cancellation marker 和 optional retry                              | abort action                            |

### Run 模型

引入 desktop run model。它可以先作为 `ConversationState` 的一部分，等 Conversations 和 Activity 需要更强 durable 能力时再移动到独立的 `TaskRunsState`。

```ts
type DesktopTaskRun = {
  id: string;
  threadId: string;
  parentRunId?: string;
  status:
    | "submitted"
    | "contextReady"
    | "running"
    | "waitingForPermission"
    | "streaming"
    | "completed"
    | "failed"
    | "cancelled";
  title: string;
  userText: string;
  agentId?: string;
  agentName?: string;
  model: string;
  thinking?: string;
  permissionMode: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  contextSummary?: ConversationContextSummary;
  activities: DesktopTaskActivity[];
  artifacts: DesktopTaskArtifact[];
  error?: DesktopTaskError;
};
```

Activities 应代表 tools、permissions、sub-agents、hooks、memory、provider blocks 和 status updates。

```ts
type DesktopTaskActivity =
  | DesktopToolActivity
  | DesktopPermissionActivity
  | DesktopSubagentActivity
  | DesktopMemoryActivity
  | DesktopProviderActivity
  | DesktopStatusActivity;
```

第一版可以在添加 `taskRuns` 的同时继续渲染现有 `ConversationMessage` kinds。长期看，messages 和 task run activities 应该来自同一个 event source，避免漂移。

## 前端交互设计

### Composer

Composer 在发送前应展示当前执行契约：

- selected agent or local default
- selected model
- selected thinking level when supported
- permission mode
- attachment and workflow drafts
- skill command draft
- voice input state
- send or stop action
- plan-first toggle 或 execution mode

Composer 的视觉和交互应贴近 Codex：输入框是主入口，左右两侧是少量高频图标和状态 pill。不要把 model、permission、agent、thinking 做成大表单；它们应该像 Codex 的 composer 状态控件一样轻量、可点开、可继承、可快速回到默认值。

交互规则：

- 只有 draft 非空且没有当前 run 阻塞发送时，Enter 才发送。
- Stop 取消 active run。
- 复杂或高风险任务默认建议先计划，低风险短任务可以直接执行。
- Plan card 需要显示 scope、assumptions、steps、verification 和 risks。
- 用户确认 plan 后，原计划进入 run timeline，后续执行结果能和计划逐项对应。
- 只有后端支持当前 run 的 queued follow-ups 时，运行中的 follow-up text 才能排队。
- Attachment 和 workflow drafts 应在发送前可见，并在发送后转换成 timeline activities。
- 选择 agent 后，agent-owned settings 应显示为 locked 或 inherited。
- Permission mode 会改变风险，因此发送前必须可见。

### Timeline

Timeline 应是 task execution 的事实来源。它应该渲染：

- user prompt
- plan card
- run card
- context summary
- tool cards
- permission cards
- sub-agent cards
- memory cards
- status cards
- assistant response
- artifact cards
- failure cards
- verification cards
- review cards

Tool cards 应展示：

- tool name
- short argument summary
- progress message
- status
- duration
- output summary
- read-only or write-capable badge
- 有 artifact 时的打开动作

Permission cards 应展示：

- request title
- detail
- category
- requested tool
- approve or deny actions
- decision outcome
- timestamp

Sub-agent cards 应展示：

- child session title
- status
- parent task relation
- last update
- open transcript action
- 支持时的 cancel action

Failure cards 应展示：

- code
- explanation
- retry same context
- copy diagnostics
- open relevant settings

Review cards 应展示：

- 产物类型，例如文件、配置、渠道消息、workflow 输出、memory 写入。
- 用户需要审查的差异或摘要。
- accept、revise、discard 或 open artifact 动作。
- 用户反馈入口，反馈应回流到当前 thread，类似 Codex review pane 和 browser comments 的交互。

Timeline 的视觉层级应像 Codex thread：用户输入和最终回答保持清楚，工具、权限、验证、review 作为可折叠的结构化事件，不把所有中间日志展开成噪音。默认展示摘要，用户需要时再展开参数、输出、诊断和原始记录。

### Right Inspector

Right inspector 是 Codex task sidebar 和 review pane 在 CrawClaw 中的组合形态。它不替代 timeline，而是给当前 run 一个可快速扫描的结构化摘要。

Inspector sections：

- Plan：scope、steps、risks、verification gate、approval state。
- Context：memory snippets、skills、files、sessions、channel context、provider profile。
- Activity：active tools、sub-agents、automation runs、plugin calls。
- Permissions：pending、approved、denied，以及每个 decision 的作用范围。
- Artifacts：文件、配置、消息草稿、workflow 输出、memory writes。
- Review：用户待审项、inline feedback、accept/revise/discard。
- Diagnostics：runtime checks、gateway status、last failed command、copy diagnostics。

交互规则：

- 点击 timeline event 时，inspector 自动定位到对应 section。
- 点击 inspector item 时，timeline 滚动到对应 event。
- 运行中默认打开 Activity；权限阻塞时默认打开 Permissions；产物生成后默认提示 Review。
- Inspector 不展示营销解释文字，只展示状态、证据和动作。

### Global Pending Tray

权限请求、active runs、automation findings 和 review-needed artifacts 都应该进入一个小型 persistent tray。如果用户离开 conversation，这个 tray 仍要能提示当前阻塞项。

Tray 内容：

- active run count
- pending permission count
- most recent blocked action
- unread automation findings
- review needed count
- 点击返回相关 timeline node

Tray 不应复制整条 timeline。它只是导航和感知辅助。

### Search And Navigation

Search 应能路由到所有产品对象：

- thread
- task run
- agent
- plugin
- tool
- skill
- memory record
- automation run
- review item
- settings section
- artifact when available

当前 search result routing 只处理了其中一部分。新的 route target shape 应允许每个 workspace 定义自己的 selection action，避免在 `App.tsx` 里继续扩展特殊分支。

### Empty And Unavailable States

Runtime unavailable mode 不应展示假的产品内容，而应该展示：

- what failed
- what is available without the runtime
- what can be repaired
- refresh runtime、open logs、open settings、export diagnostics 等直接动作

Fallback state 仍可用于本地 UI 开发，但产品 runtime 应明确呈现 unavailable mode。

## 后端与事件设计

### Desktop Event Model

当前 Desktop API 可以保留现有 events 做兼容，但更丰富的 task rendering 应收敛到 run event。

```ts
type DesktopRunEvent = {
  type: "runEvent";
  runId: string;
  threadId: string;
  sequence: number;
  occurredAt: string;
  event:
    | { type: "started"; userText: string; agentId?: string; model: string }
    | { type: "planned"; plan: DesktopRunPlan }
    | { type: "planApproved"; approvedBy: "user" | "policy" }
    | { type: "contextReady"; summary: ConversationContextSummary }
    | { type: "providerBlock"; blockType: string; text?: string; metadata: JsonValue }
    | { type: "toolStarted"; callId: string; toolName: string; arguments: JsonValue }
    | { type: "toolProgress"; callId: string; toolName: string; status: string; message?: string }
    | { type: "permissionRequested"; requestId: string; toolName: string; reason: string }
    | { type: "permissionDecided"; requestId: string; toolName: string; decision: string }
    | { type: "toolCompleted"; callId: string; toolName: string; ok: boolean; output?: string }
    | {
        type: "toolSummary";
        callId: string;
        toolName: string;
        durationMs: number;
        omittedChars: number;
      }
    | { type: "subagentStarted"; childSessionId: string; title: string }
    | { type: "subagentUpdated"; childSessionId: string; status: string; detail?: string }
    | { type: "memoryUsed"; recordIds: string[]; summary: string }
    | { type: "memoryWritten"; recordIds: string[]; summary: string }
    | { type: "automationFinding"; automationId: string; summary: string }
    | { type: "artifactCreated"; artifactId: string; kind: string; summary: string }
    | { type: "reviewNeeded"; artifactId: string; kind: string; summary: string }
    | {
        type: "verification";
        status: "passed" | "failed" | "skipped";
        command?: string;
        summary: string;
      }
    | { type: "messageDelta"; text: string }
    | { type: "messageFinal"; role: "assistant" | "user"; text: string }
    | { type: "failed"; code: string; message: string }
    | { type: "cancelled"; reason?: string }
    | { type: "completed"; summary?: string };
};
```

规则：

- Events 必须包含 `runId` 和 `threadId`。
- Events 必须按 run 维度有序，使用 `sequence`。
- Events 应包含摘要和 refs，不携带完整私有 payload。
- 大 artifacts 应用 asset IDs 或 persisted paths 表示。
- 后端继续发送 `StateChanged` snapshots 用于恢复。
- Renderer 应能从 snapshot 或 event stream 重建可见 run state。
- Plan、artifact、review 和 verification events 应与同一个 `runId` 关联，避免“执行结果”和“审查结果”分裂成两个不相关页面。

### Runtime Events 映射

Runtime loop events 已经提供大部分所需信息：

| Runtime event                        | Desktop event                      |
| ------------------------------------ | ---------------------------------- |
| `ContextProjected`                   | `contextReady`                     |
| `ProviderBlock`                      | `providerBlock` or timeline status |
| `ToolExecution::Started`             | `toolStarted`                      |
| `ToolExecution::Progress`            | `toolProgress`                     |
| `ToolExecution::PermissionRequested` | `permissionRequested`              |
| `ToolExecution::PermissionDecision`  | `permissionDecided`                |
| `ToolExecution::Completed`           | `toolCompleted`                    |
| `ToolUseSummary`                     | `toolSummary`                      |
| `Hook`                               | status or hook activity            |
| lifecycle stop or validation result  | `verification` or `completed`      |

Desktop bridge 不应丢弃 progress 或 permission events。为了兼容，它仍可派生简单 `ConversationMessage` records。

### Desktop State Shape

保留单个 bootstrap payload，但在类型模型中拆分 domain：

```ts
type DesktopState = {
  activeNavId: string;
  projects: ProjectsState;
  sidebar: DesktopSidebarState;
  conversation: ConversationState;
  taskRuns: TaskRunsState;
  agentWorkspace: AgentWorkspaceState;
  capabilitiesWorkspace: CapabilitiesWorkspaceState;
  memoryWorkspace: MemoryWorkspaceState;
  automationsWorkspace: AutomationsWorkspaceState;
  reviewWorkspace: ReviewWorkspaceState;
  preferences: DesktopPreferences;
  permissionRequest: PermissionRequest;
  searchSuggestions: SearchSuggestion[];
};
```

只有在产品 copy 和兼容迁移计划明确之后，`pluginsWorkspace` 才应重命名为 `capabilitiesWorkspace`。第一阶段可以保留旧字段，并通过 selectors 或 copy 把它呈现为 capabilities。

### 后端职责

Rust 持有：

- run IDs 和 run lifecycle emission
- plan execution gate 和 run policy
- session selection 和 transcript persistence
- provider calls
- tool execution
- tool progress
- permission requests and decisions
- sub-agent session creation and updates
- memory reads and writes
- plugin and native tool descriptors
- runtime health
- automation run records
- artifact refs 和 review-needed records

React 持有：

- transient draft state
- popovers and menus
- visible selection state
- optimistic UI pending server acknowledgement
- local rendering reducers
- user-triggered navigation
- plan confirmation、review feedback、browser annotation 这类用户交互状态

这个拆分让 renderer 聚焦产品展示，避免 TypeScript 里长出第二套 runtime policy layer。

## Capability Model

即使来自不同 runtime sources，capabilities 也应该被表示成统一产品概念。

```ts
type DesktopCapability = {
  id: string;
  kind:
    | "tool"
    | "skill"
    | "plugin"
    | "agent"
    | "channel"
    | "provider"
    | "automation"
    | "mcpLikeConnection";
  ownerId?: string;
  name: string;
  description: string;
  source: "runtime" | "nativePlugin" | "bundledPlugin" | "user";
  status: "available" | "disabled" | "needsSetup" | "unavailable";
  permissionCategory?: string;
  readOnly?: boolean;
  enabledByDefault?: boolean;
  recentUsage?: CapabilityUsageSummary;
  automationEligible?: boolean;
  reviewSurface?: "none" | "artifact" | "diff" | "message" | "memory";
};
```

这不需要新增 public SDK。它是基于现有 runtime descriptors、plugin manifests 和 agent state 的桌面产品投影。

## 文件拆分计划

第一阶段不应为了大重构停下来。以下拆分只建议在直接服务新功能时进行。

### Renderer

| 当前文件                                                 | 问题                                                                                                  | 目标拆分                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/crawclaw-desktop/src/App.tsx`                      | routing、state wiring、session polling、preference updates、plugin mutations、search routing 混在一起 | 保留 app shell，提取 workspace router、session panel controller、preference actions、search route handler |
| `apps/crawclaw-desktop/src/app/use-desktop-state.ts`     | bootstrap、SSE subscription、event reduction、optimistic messages 混在一起                            | 拆分 event subscription 和 event reducers，加入 exhaustive run event reducer                              |
| `apps/crawclaw-desktop/src/views/chat-workspace.tsx`     | composer state、command menus、attachment actions、selectors、timeline props 混在一起                 | 提取 composer controller、run tray、run inspector、command menu、attachment menu                          |
| `apps/crawclaw-desktop/src/views/plugins-workspace.tsx`  | 大组件中包含 display catalogs、install flows、dialogs、invocation                                     | display metadata 移到 data 或 generated descriptors，拆分 installed plugins、tools、skills、dialogs       |
| `apps/crawclaw-desktop/src/views/settings-workspace.tsx` | provider setup、model defaults、privacy、memory、notifications、advanced 全在一个 surface             | 拆分 provider setup、model defaults、memory、privacy、diagnostics sections                                |
| 新增 `review-workspace.tsx`                              | 当前没有通用 review surface                                                                           | 汇总 artifacts、配置变更、memory 写入、workflow 输出和用户反馈                                            |
| 新增 `activity-workspace.tsx`                            | 当前没有统一 activity inbox                                                                           | 汇总 active runs、automation findings、pending permissions、review needed                                 |

### Tauri Desktop Gateway

| 当前文件                                                                               | 问题                                                                                                | 目标拆分                                                                            |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api.rs`                           | server setup、state construction、routing、tests、helpers 混在一起                                  | 拆分 server、bootstrap、events、permission requester、state builder                 |
| `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_native_operations.rs` | message generation、attachments、workflows、agents、memory、plugins、capability resolution 混在一起 | 拆分 messages、assets、workflows、agents、memory、plugins、capabilities、run events |
| `apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_session_routes.rs`    | session routes 有用，但没有充分连接到 renderer events                                               | 加入 session changed 和 sub-agent run event integration                             |

这些拆分应贴近需要它们的 feature work。不要只是为了让文件变小而移动大段代码。

## 实施阶段

### Phase 0: Contract And Reducer Foundation

目标：先让事件模型可靠，再铺开 UI 工作。

交付项：

- 新增 `DesktopRunEvent` 或等价 typed event。
- 包含 `runId`、`threadId`、`sequence` 和 event payload。
- 支持 `planned`、`planApproved`、`artifactCreated`、`reviewNeeded`、`verification`。
- 在 renderer 中处理 `sessionStarted`。
- 在 `use-desktop-state` 中加入 run event reducer。
- 保持与现有 `ConversationMessage` rendering 兼容。
- 更新 generated desktop API contract。
- 增加 Rust tests 验证 event emission。
- 在可行时增加 renderer smoke coverage 覆盖 run state。

验证：

- `cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml --test gateway_desktop_api_test`
- `pnpm desktop:contract:check`
- `pnpm desktop:e2e:smoke`

### Phase 1: Conversation Run Timeline

目标：让一个任务从发送到完成都可理解。

交付项：

- Codex-like 三栏 conversation shell：left sidebar、main thread、right inspector。
- plan card 和确认执行 gate。
- send 后出现 run card。
- context summary timeline node。
- 带 arguments summary、progress、output、result status 的 tool cards。
- 带 approve 或 deny actions 的 permission cards。
- 带 retry、copy diagnostics、open settings actions 的 failure cards。
- completed run summary。
- stop 和 queued follow-up behavior 反映到 timeline。
- verification 和 review-needed 节点进入同一条 timeline。
- inspector 和 timeline 双向定位。

验证：

- 针对 tool progress、permission、failure、final event emission 的 Rust tests。
- 覆盖 send、stop、permission、tool event rendering、failure card 的 e2e smoke。
- e2e smoke 覆盖 inspector 打开、section 定位、review-needed 提示。
- 如果工作触碰 lazy loading 或 build output，运行 `pnpm build`。

### Phase 2: Activity And Automations

目标：在不设计独立首页的前提下，让后台活动和需要用户处理的事项可见、可进入、可恢复。

交付项：

- Activity workspace 或 sidebar inbox。
- active run list。
- pending permission list。
- failed task list。
- recent completed tasks。
- running sub-agent list。
- automation findings inbox。
- review-needed artifact list。
- memory health summary。
- runtime health summary。
- 点击后能导航到 timeline nodes。

验证：

- 覆盖 activity inbox 和 navigation 的 e2e smoke。
- 覆盖包含 active runs 的 state snapshots 的 reducer tests 或 runtime tests。
- tray 和 list keyboard navigation 的 accessibility pass。

### Phase 3: Capability Center

目标：把 plugins、tools、skills 和 agents 连接到真实 task usage。

交付项：

- normalized capability projection。
- capability detail panel。
- attach capability to agent。
- 支持时的 safe test invocation。
- recent usage summary。
- needs setup state。
- permission category display。
- capability 的 automation eligibility 和 review surface。

验证：

- descriptor projection 和 disablement semantics 的 Rust tests。
- plugin、tool、skill、agent capability flows 的 e2e smoke。
- 不新增 JavaScript SDK public subpaths。

### Phase 4: Settings And Repair

目标：把 settings 变成产品支持界面。

交付项：

- provider setup status 和 test action。
- runtime diagnostic card。
- execution profile，包括 model、thinking、permission、runtime root、network、channel、plugin 和 memory policy。
- memory repair actions。
- effect 清楚的 permission defaults。
- 平台状态诚实的 notification defaults。
- unavailable mode repair flow。
- export diagnostics action。

验证：

- preference persistence 和 diagnostic outputs 的 Rust tests。
- provider setup 和 runtime unavailable mode 的 e2e smoke。
- 触碰平台集成时，在 macOS desktop app 上手动检查。

### Phase 5: Maintainability Cleanup

目标：在产品行为稳定后降低未来风险。

交付项：

- targeted renderer file splits。
- targeted Tauri module splits。
- event reducer exhaustive handling。
- 适当使用 generated 或 backend-owned display metadata。
- 从产品 runtime paths 移除 stale static showcase content。
- run inspector、review workspace 和 activity 的 shared selectors 和 event projection 整理。
- Codex-like shell 的布局 primitives 固化为可复用组件，避免每个 workspace 自己造一套页面骨架。

验证：

- `pnpm check`
- 逻辑变更时运行 `pnpm test`
- 影响 build output、lazy loading 或 published surfaces 时运行 `pnpm build`
- `git diff --check`

## UX 验收标准

当用户能从 UI 回答以下问题时，一个 task run 才算产品化：

- 我让 CrawClaw 做了什么？
- 哪个 agent 或 default profile 在处理？
- 当前 model 和 permission mode 是什么？
- 包含了什么上下文？
- CrawClaw 是 running、waiting、failed、cancelled 还是 done？
- 这次任务是否先生成了 plan，用户是否确认过执行？
- 哪些 tools 运行了？
- 这些 tools 报告了什么 progress？
- CrawClaw 是否请求了 permission？
- 我 approve 或 deny 了什么？
- 是否有 sub-agent 运行？
- task 是否创建了 artifact？
- 哪些产物需要我 review？
- 是否做过 verification，结果是什么？
- 为什么 task 失败？
- 下一步有用动作是什么？

用户不应为了回答这些问题去看 logs 或 developer tools。

## 技术验收标准

- 每个 run event 都携带稳定 `runId`。
- Run events 在每个 run 内有序。
- Renderer reducers 能从 events 重建可见 task state。
- State snapshots 能从 missed events 中恢复。
- Permission requests 同时出现在 timeline 和 global pending tray。
- Desktop bridge 不丢弃 tool progress。
- Plan、artifact、review 和 verification events 与 run state 保持同源。
- Sub-agent start 和 update events 能更新可见 UI，不只依赖 polling。
- Runtime unavailable mode 明确且可行动。
- Agent、plugin、skill 和 memory pages 能链接回相关 task runs。
- Contract generation 与 Rust 和 TypeScript types 保持一致。
- Tests 覆盖被触碰的 event 和 rendering behavior。

## 风险与缓解

| 风险                                        | 缓解                                                                |
| ------------------------------------------- | ------------------------------------------------------------------- |
| Event model 变得过宽                        | 保持 `DesktopRunEvent` 小而稳定，大 payload 用 refs 摘要化          |
| Renderer 变成 runtime policy owner          | 所有 run decisions 和 execution 保持在 Rust                         |
| State snapshots 和 events 漂移              | 尽量从同一个 run state 派生二者，并加 contract tests                |
| UI 视觉噪音过多                             | Global tray 保持紧凑，细节放进可展开 timeline cards                 |
| 过度照搬 Codex 导致偏向代码开发             | 只借鉴工作台机制，review surface 覆盖通用 artifacts 和配置变更      |
| 现有 workspaces 变得不一致                  | 增加 route targets 和 related task links，避免复制 capability state |
| 大文件 cleanup 拖慢产品工作                 | 只围绕已触碰 feature boundaries 拆分                                |
| Runtime unavailable fallback 看起来像假产品 | 把 fallback 做成 repair mode，而不是假装产品在运行                  |

## 测试策略

使用能证明变更行为的最小测试；当触碰 surface 需要更宽验证时，再运行更宽 gates。

推荐 targeted tests：

- Rust Desktop API tests 覆盖 run event emission。
- Rust Desktop API tests 覆盖 permission request 和 decision lifecycle。
- Rust Desktop API tests 覆盖 tool progress 和 tool summary projection。
- Rust Desktop API tests 覆盖 plan、artifact、review、verification event projection。
- Desktop e2e smoke 覆盖 initial ready、send、run card、timeline updates、permission tray、sub-agent activity、failure recovery 和 settings routing。
- 修改 Desktop API models 后运行 contract generation 和 check。

推荐 landing gates：

- `pnpm check` 用于常规本地验证。
- 修改 runtime 或 gateway logic 时运行 `pnpm test`。
- 影响 lazy loading、build output、packaging、generated contracts 或 published surfaces 时运行 `pnpm build`。
- 提交前运行 `git diff --check`。

## Rollout 顺序

推荐第一个实施单元是 Phase 0 加 Phase 1 中最小有用切片：

1. 新增 run event contract。
2. 发出 run started、planned、planApproved、context ready、tool started、tool progress、tool completed、permission requested、permission decided、artifactCreated、reviewNeeded、verification、message final、failed 和 completed events。
3. 新增 renderer reducer。
4. 渲染基础 run card 以及 tool 或 permission timeline nodes。
5. 渲染基础 plan card 和 review-needed 节点。
6. 保持现有 conversation messages 可用。
7. 增加 targeted tests。

这能立即提升产品价值，并为 Activity、Capability Center 和 settings repair work 建立基础。

## 待定决策

进入 implementation planning 前需要做出这些决策：

- `taskRuns` 第一阶段是立即持久化，还是先从 session transcripts 和 recent run events 派生？
- 默认打开最近 conversation 还是始终新建 conversation？
- 本次工作中是否把代码里的 `pluginsWorkspace` 重命名，还是只在产品 copy 中呈现为 Capabilities？
- 第一阶段从 backend descriptor model 暴露多少 provider setup detail？
- Review workspace 是第一阶段独立页面，还是先作为 conversation right rail？
- Plan-first 是默认开启，还是只对高风险和复杂任务推荐？

推荐答案：

- 第一阶段先派生 `taskRuns`，等 history UX 需要时再持久化。
- 默认打开最近 conversation；如果没有历史 thread，则进入新对话。不要增加独立首页。
- 第一阶段代码中保留 `pluginsWorkspace`，通过 selectors 或 copy 呈现 capabilities。
- 只暴露 provider setup status，不在当前支持 settings 之外扩展 provider-specific secret forms。
- Review 先作为 conversation right rail，等 artifact 类型稳定后再独立成 workspace。
- Plan-first 对高风险、跨 workspace、多工具、多 agent、automation 创建任务默认推荐，对短任务保留直接执行。
