---
read_when:
  - 你要梳理 `src/` 目录职责、边界和依赖方向
  - 你准备做目录治理、模块收口或后续拆包
summary: CrawClaw 目录职责、依赖边界与目录治理建议
title: 目录与边界规划
---

# 目录与边界规划

本文档关注两个问题：

- 当前仓库目录分别属于什么层
- 后续应该如何治理依赖边界，而不是一上来做大规模搬家

## 根目录分类

### 运行时核心

- `src/`
- `ui/`
- `extensions/`
- `packages/`

### 文档与知识层

- `docs/`
- `README.md`
- `README.zh-CN.md`
- `ROADMAP.md`
- `VISION.md`

### 工程交付层

- `scripts/`
- `.github/`
- `Dockerfile*`
- `render.yaml`
- `fly*.toml`

### 测试层

- `test/`
- `test-fixtures/`
- `vitest*.ts`
- `vitest*.mjs`

### 非核心 / sidecar

- `Swabble/`
- `skills/`
- `skills-optional/`

### 构建产物

- `dist/`
- `dist-runtime/`

## `src/` 的推荐一级分层

当前 `src/` 已经很大，建议在概念上先固定成以下层次。

### Control Plane

目录：

- `src/gateway`
- `src/config`
- `src/secrets`
- `src/daemon`
- `src/node-host`

依赖原则：

- 可以依赖 domain service、plugin runtime、protocol schema
- 不应该吸收过多交互编排和执行细节

### Interaction Plane

目录：

- `src/auto-reply`
- `src/sessions`
- `src/commands`

依赖原则：

- 可以调用 control plane 的公开能力
- 可以触发 agent kernel
- 不应该自己持有太多底层执行实现

### Agent Kernel

目录：

- `src/agents`

建议在目录内部继续显式分组：

- `kernel`
- `tools`
- `skills`
- `providers`
- `subagents`
- `special`
- `sandbox`
- `streaming`

依赖原则：

- 不依赖 gateway server method 细节
- 不依赖 UI 层
- 通过 contract 接入 domain service 和 plugin platform

补充说明：

- `src/agents/tools` 是 tool substrate 的集中实现区
- `src/agents/skills` 是 skills 加载、过滤、prompt 裁剪与暴露状态管理区
- `tools` 与 `skills` 都属于 Agent Kernel，但职责不同，不能混写

### Special Agent Substrate

目录：

- `src/agents/special`

边界原则：

- special agent 的 contract、cache policy、tool policy、execution mode 统一在这里定义
- memory、workflow、verification 等场景只能“注册 special agent”，不应各自复制运行机制

### Channel Runtime

目录：

- `src/channels`

依赖原则：

- 渠道生命周期、threading、pairing、binding、interactive、message actions 应封装在这一层
- 避免把渠道细节散落在 `auto-reply`、`gateway methods`、`extensions` 里

### Capability Platform

目录：

- `src/plugins`
- `src/plugin-sdk`

配套目录：

- `extensions/*`

依赖原则：

- 插件平台定义扩展 contract 与运行时装配
- `extensions/*` 只实现能力，不直接反向污染主运行时边界

### Domain Services

目录：

- `src/memory`
- `src/workflows`
- `src/cron`
- `src/tasks`

依赖原则：

- 作为标准领域服务被调用
- 不直接成为 UI 或 channel 的私有实现

补充说明：

- `src/memory` 当前已包含 durable、session-summary、dream、context assembly 等完整运行时能力
- memory 还通过 `src/agents/special` 接入 special agent substrate，因此应被视为“领域服务 + 特殊执行消费者”

### Protocol / Interop

目录：

- `src/acp`
- `src/mcp`
- `src/gateway/protocol`

依赖原则：

- 通过稳定 contract 连接 control plane 和外部端
- 不应夹带大量领域逻辑

### Shared / Infra

目录：

- `src/shared`
- `src/infra`
- `src/utils`

治理原则：

- 只保留真正跨域的基础设施
- 任何偏领域的逻辑都应迁回领域目录
- 新逻辑默认禁止继续落到 `infra`

补充说明：

- `src/config/cache-utils.ts` 这类文件只应该提供 TTL / expiring-map 之类的通用原语
- prompt cache identity、special agent cache policy、memory 文件缓存、routing cache、plugin registry cache 都应保留在各自域内
- 不建议再抽一个“全局缓存中心”把这些语义强行揉平

## 重点边界问题

### 1. `commands` 与 `auto-reply` 的重复入口

现状：

- CLI commands
- channel text commands
- gateway methods

三套入口已经存在重复业务语义。

建议：

- 统一成共享领域 handler
- transport 层只做参数适配
- 不再为每个入口单独写一套核心逻辑

### 2. `agents` 过重

现状：

- 工具运行、provider、subagent、special agent、sandbox、streaming 均堆在一起

建议：

- 先在目录和命名上做子域化
- 再决定是否拆包

### 3. `channels` 被低估

现状：

- channels 已经承担很多正式运行时职责

建议：

- 将其提升为一级平台层
- 明确与 `gateway`、`auto-reply`、`extensions` 的边界

### 4. `special agent` 没有被正式纳入总架构

现状：

- 运行机制已经成熟
- 但更像埋在 code path 和 debug 文档里

建议：

- 把它作为 Agent Kernel 的子层正式写入架构、目录说明和测试策略

### 5. `Swabble` 的位置不清晰

现状：

- 它是 sidecar 项目，但目录层级与主系统并列

建议：

- 未来迁到 `apps/` 或 `sidecars/`
- 在根目录结构说明中继续明确“非主运行时”

### 6. 缓存归属仍缺统一叙事

现状：

- prompt cache、special agent cache、plugin cache、routing cache、memory file cache、UI cache 分散在多个域里

建议：

- 在架构文档中把缓存作为跨层主题单列
- 但在目录治理上继续坚持“缓存跟随领域”
- 不要为了统一而把不同失效模型的缓存抽成一套假统一实现

### 7. 可读性、注释和精简还没有被当成边界问题

现状：

- 很多复杂度不是来自算法，而是来自跨层调用、重复入口和多职责大文件
- 如果只从“功能对不对”看代码，边界会继续变软

建议：

- 把可读性视为边界治理的一部分，而不是风格偏好
- 把注释聚焦在 invariant、兼容层、缓存规则、状态机边界
- 把代码精简优先理解成“减少重复路径和错误 owner”，而不是单纯压缩行数

## 推荐的目录治理顺序

1. 写清楚边界说明与依赖约束。
2. 为 `agents`、`channels`、`plugins`、`memory`、`workflows` 补充目录级 README 或 maintainer 文档。
3. 限制新逻辑继续沉积到 `infra`。
4. 把共享业务入口从 transport 层收敛到领域 handler。
5. 用 `check:loc`、`dup:check`、`deadcode:*` 辅助收口大文件、重复逻辑和陈旧 fallback。
6. 最后才考虑物理迁移与拆包。

## 不建议当前做的事

- 不建议立即把 `src/agents` 拆成多个 workspace 包。
- 不建议在边界未稳前做大规模目录迁移。
- 不建议继续把“方便放的逻辑”落到 `src/infra`。
- 不建议把 `channels` 或 `special agent` 继续当成“实现细节”。
- 不建议用大段低信号注释掩盖混乱边界或过重函数。
- 不建议为了兼容临时加第三套路径，却不收旧路径。

## 目录治理如何服务可读性

目录治理不是为了“看起来整齐”，而是为了让代码天然更容易读。

### 可读性

- 一个目录要能回答“这里负责什么，不负责什么”
- 一个文件最好只有一个主要 owner 和一个主要变化原因
- 跨层调用应该通过 contract 暴露，而不是直接钻实现细节

### 注释

- 模块入口优先写高层说明
- 函数内部只保留少量高信号注释
- 如果某段逻辑需要大量解释，优先考虑拆函数、拆模块或补 maintainer 文档

### 精简

- 精简首先是删重复入口、删死 fallback、删错层 glue code
- 其次才是拆大文件、合并重复 helper
- 目录边界越清楚，后续精简成本越低

## 推荐的目标目录认知

在不大搬家的前提下，团队应统一以下认知：

- `src/gateway` 是控制平面，不是所有逻辑的汇总层
- `src/auto-reply` 是交互编排层，不是执行内核
- `src/agents` 是执行内核
- `src/agents/special` 是 special agent substrate
- `src/agents/query-context` + `src/agents/special/runtime` 是 prompt/cache identity 的核心区
- `src/channels` 是渠道运行时
- `src/plugins` + `src/plugin-sdk` + `extensions` 是能力平台
- `src/memory`、`src/workflows`、`src/cron`、`src/tasks` 是领域服务
- `src/acp` 是正式互操作协议层
- `ui/src/ui/chat/session-cache.ts` 这类 UI cache 仍归 Presentation Plane，不应倒灌回后端

只要团队先按这个模型协作，后续目录改造会容易很多。
