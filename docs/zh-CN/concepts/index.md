---
read_when:
  - 你想快速了解 CrawClaw 的概念文档应该从哪里开始读
  - 你要梳理项目架构、记忆、会话、流式输出和执行过程展示
summary: CrawClaw 概念文档导航与推荐阅读路径
title: 概念总览
---

# 概念总览

`concepts/` 关注的是 CrawClaw 的系统模型，而不是具体安装步骤或单个命令用法。

如果你第一次进入这组文档，建议不要按文件名随机跳着读，而是先按下面 6 组进入。

## 推荐入口

<Columns>
  <Card title="项目整体架构" href="/concepts/project-architecture-overview" icon="blocks">
    先看项目真实分层：Control Plane、Interaction、Agent Kernel、Special Agent、Channels、Plugins、Memory、Workflow、ACP、UI。
  </Card>
  <Card title="目录与边界" href="/concepts/project-directory-boundaries" icon="folder-tree">
    看清楚 `src/` 各目录分别属于哪一层，哪些边界现在最容易混。
  </Card>
  <Card title="缓存机制" href="/concepts/project-cache-strategy" icon="database">
    如果你在看 memory、special agent、prompt reuse 或性能问题，这篇应该尽早读。
  </Card>
  <Card title="文档与测试体系" href="/concepts/project-docs-and-test-strategy" icon="clipboard-check">
    想继续做维护治理、重构和测试规划时，从这里接上。
  </Card>
  <Card title="项目基线冻结" href="/concepts/project-baseline-freeze" icon="shield-check">
    如果你要继续推进新一轮重构，先看当前 owner、入口、缓存、e2e 和风险基线。
  </Card>
  <Card title="拆包准备" href="/concepts/project-package-split-prep" icon="package">
    如果你要评估未来拆包，先看哪些 surface 已能冻结，哪些模块还不适合物理拆分。
  </Card>
</Columns>

## 文档分组

### 1. 项目治理与实施

这组文档面向维护者和重构工作，回答“项目整体怎么分层、怎么演进、怎么验证”：

- [项目整体架构总览](/concepts/project-architecture-overview)
- [目录与边界规划](/concepts/project-directory-boundaries)
- [项目缓存机制总览](/concepts/project-cache-strategy)
- [文档与测试体系规划](/concepts/project-docs-and-test-strategy)
- [项目基线冻结](/concepts/project-baseline-freeze)
- [控制面 API 重构方案](/concepts/project-control-plane-api-refactor)
- [控制面 API 实施清单](/concepts/project-control-plane-api-implementation-plan)
- [控制面 API PR 计划](/concepts/project-control-plane-api-pr-plan)
- [控制面 API Inventory](/concepts/project-control-plane-api-inventory)
- [Control UI 剩余重构 PR 计划](/concepts/project-control-ui-remaining-pr-plan)
- [Control UI Stitch 重写 PR 计划](/concepts/project-control-ui-stitch-pr-plan)
- [项目实施路线图](/concepts/project-implementation-roadmap)
- [Phase 对应 PR 计划](/concepts/project-phase-pr-plan)
- [模块公开 Surface 与拆包准备](/concepts/project-package-split-prep)

### 2. 运行时与执行主链

这组文档关注 agent 运行、上下文组装、流式输出和执行循环：

- [智能体运行时](/concepts/agent)
- [Agent Loop](/concepts/agent-loop)
- [智能体工作区](/concepts/agent-workspace)
- [上下文](/concepts/context)
- [系统提示词](/concepts/system-prompt)
- [流式传输和分块](/concepts/streaming)
- [执行过程可见性系统](/concepts/execution-visibility-system)
- [执行过程可见性 PRD](/concepts/execution-visibility-prd)

### 3. 会话、记忆与压缩

这组文档关注 session、memory、compaction 和长期状态：

- [会话管理](/concepts/session)
- [记忆](/concepts/memory)
- [会话修剪](/concepts/session-pruning)
- [会话工具](/concepts/session-tool)
- [压缩](/concepts/compaction)
- [时区处理](/concepts/timezone)

### 4. 模型、工具与多智能体

这组文档关注 provider、model 选择、容错和多 agent 协作：

- [模型](/concepts/models)
- [模型提供商](/concepts/model-providers)
- [模型故障切换](/concepts/model-failover)
- [多智能体](/concepts/multi-agent)
- [使用量跟踪](/concepts/usage-tracking)
- [OAuth](/concepts/oauth)

### 5. 消息、渠道与交互体验

这组文档关注消息体验、presence、typing、queue 和重试：

- [消息](/concepts/messages)
- [Presence](/concepts/presence)
- [输入中指示器](/concepts/typing-indicators)
- [队列](/concepts/queue)
- [重试](/concepts/retry)
- [Markdown 格式化](/concepts/markdown-formatting)
- [TypeBox 模式](/concepts/typebox)

### 6. 面向入门和旧文档的桥接页

这组页更偏“总览”和“入口”，可以帮助从旧阅读路径切到新结构：

- [Gateway 网关架构](/concepts/architecture)
- [功能](/concepts/features)

## 推荐阅读路径

### 1. 想理解项目整体怎么工作

推荐顺序：

1. [项目整体架构总览](/concepts/project-architecture-overview)
2. [目录与边界规划](/concepts/project-directory-boundaries)
3. [Gateway 网关架构](/concepts/architecture)
4. [智能体运行时](/concepts/agent)
5. [功能](/concepts/features)

### 2. 想理解运行主链

推荐顺序：

1. [智能体运行时](/concepts/agent)
2. [Agent Loop](/concepts/agent-loop)
3. [上下文](/concepts/context)
4. [系统提示词](/concepts/system-prompt)
5. [流式传输和分块](/concepts/streaming)
6. [执行过程可见性系统](/concepts/execution-visibility-system)

### 3. 想理解会话、记忆和压缩

推荐顺序：

1. [会话管理](/concepts/session)
2. [记忆](/concepts/memory)
3. [会话修剪](/concepts/session-pruning)
4. [压缩](/concepts/compaction)
5. [缓存机制](/concepts/project-cache-strategy)

### 4. 想理解模型、工具和多智能体

推荐顺序：

1. [模型](/concepts/models)
2. [模型提供商](/concepts/model-providers)
3. [模型故障切换](/concepts/model-failover)
4. [多智能体](/concepts/multi-agent)
5. [使用量跟踪](/concepts/usage-tracking)

### 5. 想理解消息体验和渠道侧行为

推荐顺序：

1. [消息](/concepts/messages)
2. [Presence](/concepts/presence)
3. [输入中指示器](/concepts/typing-indicators)
4. [队列](/concepts/queue)
5. [重试](/concepts/retry)
6. [Markdown 格式化](/concepts/markdown-formatting)

## 如何理解这组文档

- `project-*`：项目治理、边界、缓存、路线图、baseline、拆包准备。
- 传统概念文档：单个系统主题，例如 session、memory、streaming、model、messages。
- `execution-visibility-*`：过程展示统一化的专项设计文档。

如果你现在是在做架构调整、前端重构、渠道流式输出、workflow 展示、memory/special agent 设计，建议优先看 `project-*` 这组，再回到单点主题文档。
