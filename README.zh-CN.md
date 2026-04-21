# 🦞 CrawClaw

<p align="center">
  <img src="https://raw.githubusercontent.com/qianleigood/crawclaw/main/docs/assets/crawclaw-logo-badge.png" alt="CrawClaw logo" width="360">
</p>

<p align="center">
  <a href="./README.md">English</a> · 简体中文
</p>

<p align="center">
  <a href="https://github.com/qianleigood/crawclaw/actions/workflows/ci.yml?branch=main"><img src="https://img.shields.io/github/actions/workflow/status/qianleigood/crawclaw/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="https://github.com/qianleigood/crawclaw/releases"><img src="https://img.shields.io/github/v/release/qianleigood/crawclaw?include_prereleases&style=for-the-badge" alt="GitHub release"></a>
  <a href="https://www.npmjs.com/package/crawclaw"><img src="https://img.shields.io/npm/v/crawclaw?style=for-the-badge" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

**CrawClaw** 是一个本地优先的助手运行时，用一个统一控制面来承载聊天、记忆、工作流、浏览器自动化、宿主工具和 Web 控制台。

这份 README 只保留五件事：

- 项目整体设计
- 记忆设计
- 工作流设计
- 工具底座设计
- 通过 npm 和 Docker 的安装方式

更完整的产品文档见 [docs.crawclaw.ai](https://docs.crawclaw.ai)。

## 项目设计

CrawClaw 采用 **Gateway-first** 架构。

- **Gateway** 是整个系统的控制面，负责 session、认证、配置、Web UI、agent 调用、事件和工具调用入口。
- **agent runtime** 运行在 gateway 后面，负责模型调用、工具调用、subagent、流式输出和安全策略。
- **memory runtime** 不是附属能力，而是 prompt assembly、compaction、durable recall 和长期助手行为的一部分。
- **workflow layer** 不是第二套助手运行时。它负责把成功执行路径沉淀成可部署工作流，并把 n8n 作为执行引擎。
- **tool layer** 是强类型、受策略控制的执行底座。tools 是 substrate，skills 和 plugins 建立在这个 substrate 之上。

从仓库结构看，系统大致分为：

- [src/gateway](/Users/qianlei/crawclaw/src/gateway)：控制面、协议、认证、methods、gateway 服务
- [src/agents](/Users/qianlei/crawclaw/src/agents)：agent runtime、工具注册、sandbox、provider 集成、subagents
- [src/memory](/Users/qianlei/crawclaw/src/memory)：记忆引擎、提取、持久存储、编排、prompt assembly
- [src/workflows](/Users/qianlei/crawclaw/src/workflows)：workflow registry、版本管理、n8n 编译与执行桥接
- [extensions](/Users/qianlei/crawclaw/extensions)：为渠道、provider、浏览器后端等提供扩展能力的插件式包

## 记忆设计

记忆系统在 CrawClaw 里被设计成一个**运行时服务**，不是单纯的向量检索适配层。

核心入口：

- [src/memory/index.ts](/Users/qianlei/crawclaw/src/memory/index.ts:1)
- [src/memory/engine/memory-runtime.ts](/Users/qianlei/crawclaw/src/memory/engine/memory-runtime.ts:1)
- [src/memory/orchestration/context-assembler.ts](/Users/qianlei/crawclaw/src/memory/orchestration/context-assembler.ts:1)

整体可以分成四层：

1. **摄取与提取**
   - 从 transcript、文件和运行时信号中提取候选记忆。
   - 支持 session summary、durable memory 和 knowledge note 等提升路径。
   - 相关模块在
     [src/memory/extraction](/Users/qianlei/crawclaw/src/memory/extraction)
     和
     [src/memory/promotion](/Users/qianlei/crawclaw/src/memory/promotion)。

2. **存储**
   - 内置引擎是本地优先、SQLite 驱动的。
   - durable memory、summary 和 assembly audit 数据都保存在本地 runtime store 中，而不是强依赖远端服务。
   - 相关模块：
     [src/memory/runtime](/Users/qianlei/crawclaw/src/memory/runtime)
     和
     [src/memory/durable](/Users/qianlei/crawclaw/src/memory/durable)。

3. **召回与排序**
   - 召回默认是混合式的：向量检索、文本检索、reranking、freshness 一起参与。
   - 系统显式区分 durable memory、knowledge layers、session memory 和 runtime signals，而不是把所有内容压成一个 top-k。
   - 相关模块：
     [src/memory/orchestration](/Users/qianlei/crawclaw/src/memory/orchestration)、
     [src/memory/search](/Users/qianlei/crawclaw/src/memory/search)、
     [src/memory/recall](/Users/qianlei/crawclaw/src/memory/recall)。

4. **Prompt assembly 与 compaction**
   - 记忆会被组装成结构化 prompt section，并带有明确的 token budget。
   - session summary 和 durable recall 都会作为单独 section 进入 prompt。
   - compaction 在设计上是一级维护路径，不是兜底补丁。
   - 相关模块：
     [src/memory/context](/Users/qianlei/crawclaw/src/memory/context)
     和
     [src/memory/session-summary](/Users/qianlei/crawclaw/src/memory/session-summary)。

设计结论：

- CrawClaw 的记忆是为了维持长期助手连续性。
- 它是本地优先、查询感知、分层组织的。
- 它不是“把所有东西做 embedding，然后把最近邻塞回上下文”那么简单。

配置参考：

- [docs/reference/memory-config.md](/Users/qianlei/crawclaw/docs/reference/memory-config.md)

## 工作流设计

工作流系统围绕一个硬边界来设计：

- **CrawClaw 负责设计和控制工作流**
- **n8n 负责执行工作流**

对应代码入口：

- [src/workflows/api.ts](/Users/qianlei/crawclaw/src/workflows/api.ts:1)
- [src/workflows/n8n-client.ts](/Users/qianlei/crawclaw/src/workflows/n8n-client.ts:1)
- [src/agents/tools/workflow-tool.ts](/Users/qianlei/crawclaw/src/agents/tools/workflow-tool.ts:1)

工作流模型大致是：

1. 用户任务先由普通 agent runtime 正常完成。
2. 当用户明确要求可复用时，CrawClaw 从成功执行路径中提炼 workflow spec。
3. CrawClaw 在本地存储、版本化、diff 和管理这个 workflow spec。
4. CrawClaw 把 spec 编译成 n8n workflow JSON。
5. n8n 成为 triggers、waits、retries、branching 和外部集成的执行面。
6. 仍然需要模型推理的步骤，会通过专门的 workflow-step agent 回调到 CrawClaw，而不是把所有智能逻辑都塞进 n8n。

所以工作流设计可以分成三部分：

- **Registry 与生命周期**
  - list、describe、diff、versions、update、republish、rollback、archive
  - 主要实现位于
    [src/workflows](/Users/qianlei/crawclaw/src/workflows)

- **编译与执行桥**
  - 把 workflow spec 编译到 n8n
  - 发布到 n8n
  - 把 execution ID 和状态同步回 CrawClaw

- **Agent step 执行**
  - 对于仍需要推理的 step，通过 CrawClaw 执行
  - 避免让 n8n 直接承担重提示词、重上下文的 agent 宿主角色

设计结论：

- CrawClaw 不试图自己再造一套通用 workflow engine。
- 它负责 authoring、versioning 和 assistant-facing 的控制面。
- n8n 负责 durable workflow execution。

参考文档：

- [docs/reference/n8n-workflow-architecture.md](/Users/qianlei/crawclaw/docs/reference/n8n-workflow-architecture.md)

## 工具底座设计

agent runtime 建立在一个**强类型工具层**之上。凡是超出纯文本生成的行为，基本都通过 tools 执行。

工具文档入口：

- [docs/tools/index.md](/Users/qianlei/crawclaw/docs/tools/index.md)

运行时入口：

- [src/agents/crawclaw-tools.runtime.ts](/Users/qianlei/crawclaw/src/agents/crawclaw-tools.runtime.ts:1)
- [src/agents/bash-tools.ts](/Users/qianlei/crawclaw/src/agents/bash-tools.ts:1)
- [src/agents/tools/gateway.ts](/Users/qianlei/crawclaw/src/agents/tools/gateway.ts:1)

这一层的结构是：

1. **内置 tools**
   - 文件 IO、patch、shell/process 执行、browser、web、PDF、image、message、sessions、cron、nodes、gateway 操作

2. **Skills**
   - 用 markdown 指导模型什么时候、怎么使用 tools
   - skill 本身不是 tool，而是行为层

3. **Plugins**
   - 可注册 tools、channels、model providers、skills、browser capabilities 和其他扩展能力的包

4. **策略与作用域**
   - tool profiles、allow/deny、provider-specific restrictions、sandbox/elevation gates、gateway auth scopes 都位于模型和执行之间

设计结论：

- tool layer 是真正的执行 substrate。
- skills 负责解释行为。
- plugins 负责扩展 substrate。
- gateway auth 和 sandbox policy 决定什么能真正执行。

## 使用 npm 安装

参考：

- [docs/install/node.md](/Users/qianlei/crawclaw/docs/install/node.md)

要求：

- 推荐 Node **24**
- 支持 Node **22.14+**

全局安装：

```bash
npm install -g crawclaw@latest
```

然后运行 onboarding：

```bash
crawclaw onboard --install-daemon
```

常用后续命令：

```bash
crawclaw gateway --port 18789 --verbose
crawclaw doctor
```

如果安装后找不到 `crawclaw`，先看全局 npm bin 路径：

```bash
npm prefix -g
```

## 使用 Docker 安装

参考：

- [docs/install/docker.md](/Users/qianlei/crawclaw/docs/install/docker.md)

Docker 路径适合把 gateway 作为容器化服务运行。

从仓库根目录最快的方式：

```bash
./scripts/docker/setup.sh
```

这个流程会：

- 本地构建镜像，或者使用你指定的 `CRAWCLAW_IMAGE`
- 运行 onboarding
- 写入配置和 token
- 通过 Docker Compose 启动 gateway

如果要直接用发布镜像：

```bash
export CRAWCLAW_IMAGE="ghcr.io/qianleigood/crawclaw:latest"
./scripts/docker/setup.sh
```

完成后可以连接 gateway：

```bash
crawclaw tui
```

手动 Docker 路径：

```bash
docker build -t crawclaw:local -f Dockerfile .
docker compose up -d crawclaw-gateway
```

健康检查：

```bash
curl -fsS http://127.0.0.1:18789/healthz
curl -fsS http://127.0.0.1:18789/readyz
```

## 仓库入口

- Gateway: [src/gateway](/Users/qianlei/crawclaw/src/gateway)
- Memory: [src/memory](/Users/qianlei/crawclaw/src/memory)
- Workflows: [src/workflows](/Users/qianlei/crawclaw/src/workflows)
- Agent runtime and tools: [src/agents](/Users/qianlei/crawclaw/src/agents)
- Browser subsystem and plugins: [extensions](/Users/qianlei/crawclaw/extensions)

## 仓库结构

这个 monorepo 当前同时承载了几层内容：

- `src/`：运行时主系统
- `extensions/`：能力扩展生态
- `packages/`：支持型子包
- `skills-optional/`：可选技能目录
- `Swabble/`：旁支/侧项目代码
- `test/`：共享测试基础设施
- `dist/`：构建产物

维护者结构说明：

- [docs/maintainers/repo-structure.md](/Users/qianlei/crawclaw/docs/maintainers/repo-structure.md)
