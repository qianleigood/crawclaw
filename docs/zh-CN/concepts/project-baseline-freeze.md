---
read_when:
  - 你要确认当前仓库的基线状态，再继续做新一轮重构
  - 你需要目录 owner、入口面、缓存、e2e 和主要风险的统一清单
summary: CrawClaw 当前架构与测试基线的冻结清单
title: 项目基线冻结
---

# 项目基线冻结

这篇文档对应 `PR-00 / Phase 0`。

它的目标不是提出新架构，而是回答一个更基础的问题：

**“在继续改造之前，今天的 CrawClaw 到底是什么状态？”**

本清单给后续所有重构提供统一比较基线。

## 本次基线结论

当前代码库已经完成 `PR-01` 到 `PR-10` 的主线收口，因此这份 baseline 的重点不再是“问题很乱”，而是：

1. 冻结当前目录 owner 和主入口面
2. 冻结当前缓存和 e2e 测试面
3. 冻结当前仍然存在的 top 风险

## 目录 Owner 基线

以下是当前最值得被视为一级 owner 的运行时目录。

| 目录             | 当前文件量基线 | owner 职责                                                                     |
| ---------------- | -------------: | ------------------------------------------------------------------------------ |
| `src/gateway`    |            447 | 控制平面、auth、protocol、server methods、gateway server surface               |
| `src/auto-reply` |            375 | interaction / reply orchestration / session ingress                            |
| `src/agents`     |           1259 | agent kernel、tool runtime、subagents、special-agent substrate                 |
| `src/channels`   |            246 | channel runtime、projection、typing、threading、binding、inbound/outbound seam |
| `src/plugins`    |            290 | plugin loader、entry contract、bundled capability runtime                      |
| `src/memory`     |            171 | memory runtime、summary、dream、durable ingestion、memory CLI/API              |
| `src/workflows`  |             36 | workflow registry、operations、execution status、channel forwarder             |

维护者入口文档：

- `src/agents/README.md`
- `src/channels/README.md`
- `src/plugins/README.md`
- `src/memory/README.md`
- `src/workflows/README.md`
- `src/infra/README.md`

## 业务入口基线

当前产品入口面可以冻结为 4 类：

### 1. CLI Commands

典型入口：

- `src/entry.ts`
- `src/cli/program/build-program.ts`
- `src/commands/**`

职责：

- 运维入口
- 配置与诊断入口
- 面向操作者的命令面

### 2. Channel Text Commands

典型入口：

- `src/auto-reply/reply/commands-*.ts`
- `src/auto-reply/reply/get-reply.ts`

职责：

- 渠道内命令
- 会话指令
- reply orchestration

### 3. Gateway Methods

典型入口：

- `src/gateway/server.ts`
- `src/gateway/server-methods/**`

职责：

- UI / remote client / RPC / control plane method surface

### 4. UI Actions

典型入口：

职责：

- Browser client 的交互面
- gateway contract 消费层

## 当前可冻结的 Public Surface 基线

这些入口已经足够稳定，可以作为后续重构和未来拆包的公开 surface 基线：

- `src/gateway/server.ts`
- `src/workflows/api.ts`
- `src/memory/command-api.ts`
- `src/memory/cli-api.ts`
- `src/memory/index.ts`
- `src/plugin-sdk/index.ts`
- `src/plugin-sdk/entrypoints.ts`
- `src/plugins/entry-contract.ts`
- `src/agents/special/runtime/*`

## 缓存基线

缓存现在已经不是隐式 `Map` 集合，而是一个有治理层的体系。

当前缓存基线按 5 类理解：

### 1. Prompt / Query Identity

关键位置：

- `src/agents/query-context/cache-contract.ts`
- `src/agents/context-cache.ts`

职责：

- prompt identity
- context token reuse

### 2. Bootstrap / Runtime Snapshot

关键位置：

- `src/agents/bootstrap-cache.ts`
- `src/agents/special/runtime/parent-fork-context.ts`
- `src/agents/special/runtime/cache-plan.ts`

职责：

- workspace bootstrap snapshot
- special-agent parent fork context 与 cache hints

### 3. Memory / Summary / Built-in Runtime

关键位置：

- `src/memory/engine/built-in-memory-runtime.ts`
- `src/memory/session-summary/store.ts`
- `src/memory/bootstrap/init-memory-runtime.ts`

职责：

- built-in memory runtime cache
- session summary read-through cache

### 4. Routing / Control Plane Cache

关键位置：

- `src/routing/resolve-route.ts`
- `src/gateway/model-pricing-cache.ts`

职责：

- route normalization cache
- model pricing cache

### 5. Cache Governance Registry

关键位置：

- `src/cache/governance.ts`
- `src/cache/governance-types.ts`

职责：

- owner
- lifecycle
- invalidation
- observability

配套设计文档：

- [项目缓存机制总览](/concepts/project-cache-strategy)

## E2E / Smoke 基线

当前测试基线分为 4 层。

### 1. 全仓门禁

- `pnpm check`

职责：

- tsgo
- lint
- boundaries
- auth / webhook / ecosystem guard

### 2. 默认 unit / integration

- `pnpm test`

脚本：

- `node scripts/test-parallel.mjs`

### 3. Vitest E2E

- `pnpm test:e2e`

脚本：

- `vitest run --config vitest.e2e.config.ts`

### 4. Docker Smoke

当前最明确的两条主链脚本：

- `pnpm test:docker:onboard`
- `pnpm test:docker:gateway-network`

脚本：

- `bash scripts/e2e/onboard-docker.sh`
- `bash scripts/e2e/gateway-network-docker.sh`

配套测试文档：

- [Testing](/help/testing)

## 当前测试基线结果

以 `2026-04-17` 这轮实际执行为准：

- `pnpm check`：通过
- `pnpm test`：通过
- `pnpm test:e2e`：通过
- `pnpm test:docker:onboard`：通过
- `pnpm test:docker:gateway-network`：通过

### 本轮基线回归的重点修复

这轮 baseline 收口中，恢复并稳定下来的关键面包括：

- `pnpm test` 主链中的既有红项
  - `status.gather/status`
  - `channels-misc`
  - `telegram-model-picker`
  - `command-secret-resolution.coverage`
  - `gateway-chat`
  - `utils`
  - `hooks/install`
- `pnpm test:e2e` 主链中的既有红项
  - `subagent-announce.format`
  - `subagent-registry.lifecycle-retry-grace`
  - `agent-runner.runreplyagent`
  - `workflow.n8n`
  - `models.list`
  - `whatsapp connection/logging`
  - `wired-hooks-after-tool-call`
- Docker smoke 主链
  - `scripts/e2e/onboard-docker.sh`
  - `scripts/e2e/gateway-network-docker.sh`

说明：

- Phase 0 现在不再只是“冻结旧失败状态”，而是已经把 baseline 恢复到可持续验证的通过状态。
- 以后若再出现 `pnpm test` / `pnpm test:e2e` / docker smoke 红项，应按回归处理，而不是继续视为历史包袱。

## 当前 Top 风险基线

这份 baseline 记录的是“现在仍然存在，值得在后续继续关注”的风险，而不是“历史上曾经有过”的问题。

### 风险 1：Interaction Engine 还没有单一 facade

影响范围：

- `src/auto-reply`
- `src/sessions`
- `src/commands`

说明：

- `PR-02` 和 `PR-SR` 已经显著收口
- 但 `interaction-engine` 仍主要靠目录边界，不是单入口 package facade

### 风险 2：Agent Kernel 仍缺 top-level public facade

影响范围：

- `src/agents`

说明：

- `command / subagents / special-agent substrate` 已拆出清晰子域
- 但 `agent-kernel` 仍不适合直接物理拆包

### 风险 3：Plugin SDK 仍需稳定级别分层

影响范围：

- `src/plugin-sdk/*`

说明：

- subpath surface 已统一
- 但后续若真拆包，仍应区分“稳定 facade”和“兼容 facade”

### 风险 4：浏览器侧 E2E 在受限环境下可运行性不足

影响范围：

说明：

- 在受限沙箱里，Playwright 监听端口可能触发 `EPERM`
- 这不是功能回归，但意味着 UI browser smoke 仍依赖更完整的本机/CI 环境

### 风险 5：Docker Smoke 依赖宿主环境

影响范围：

- `scripts/e2e/*.sh`

说明：

- baseline 命令已经明确
- 但 docker smoke 是否能执行，仍取决于当前宿主是否安装 Docker 并开放 daemon

## Phase 0 收口结论

现在可以明确说：

- 后续 phase 已经有统一 baseline 可比
- 当前最重的结构性风险已经从“边界混乱”收缩为“少数内核层还缺 facade freeze”
- 如果未来继续推进新一轮重构，应优先对照这份 baseline 判断：
  - owner 是否更清晰
  - public surface 是否更稳定
  - tests / e2e 是否更完整

## 延伸阅读

- [项目整体架构总览](/concepts/project-architecture-overview)
- [目录与边界规划](/concepts/project-directory-boundaries)
- [项目缓存机制总览](/concepts/project-cache-strategy)
- [文档与测试体系规划](/concepts/project-docs-and-test-strategy)
- [模块公开 Surface 与拆包准备](/concepts/project-package-split-prep)
