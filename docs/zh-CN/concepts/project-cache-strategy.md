---
read_when:
  - 你在看 prompt cache、special agent cache、memory cache 或 routing cache
  - 你要梳理缓存归属、失效策略或缓存测试
summary: CrawClaw 的分层缓存机制、关键实现点与治理建议
title: 项目缓存机制总览
---

# 项目缓存机制总览

本文档说明 CrawClaw 当前真实存在的缓存机制。结论先写在前面：

- 项目里没有单一的“缓存中心”
- cache 是跨 Agent Kernel、Special Agent、Memory、Gateway、Plugins、Routing、UI 分布的
- 真正重要的不是某个 `Map`，而是“缓存身份如何计算、缓存何时失效、谁拥有失效策略”

## 一句话定义

CrawClaw 的缓存机制是一套分层 cache substrate，而不是一个集中式 cache service。

## 当前缓存的 6 个主要层次

### 1. Query / Prompt Cache Identity

核心代码：

- `src/agents/query-context/cache-contract.ts`

职责：

- 规范 query layer 可缓存包络
- 计算 `queryContextHash`
- 计算 `forkContextMessagesHash`
- 计算最终 `envelopeHash`
- 对 tool inventory、thinking config、fork context 做稳定 hash

这层的重要性最高，因为它决定“当前 prompt 前缀是否还能复用”，而不是只决定“某个值能不能从 Map 里取出来”。

关键结论：

- 这是 prompt cache 的身份层，不是简单 KV 缓存。
- 工具清单变化、thinking config 变化、fork context 变化，都会影响缓存身份。
- 后续任何 provider prompt cache、special agent prompt reuse，都应该围绕这层 contract 理解。

### 2. Special Agent Cache Snapshot 与 Fork Cache Plan

核心代码：

- `src/agents/special/runtime/cache-safe-params.ts`
- `src/agents/special/runtime/cache-plan.ts`

职责：

- 按 `runId` 落盘 cache-safe prompt snapshot
- 保存可安全继承的 prompt envelope、query context、tool inventory、stream params
- 按 TTL 和最大文件数清理历史 snapshot
- 为 special agent 计算“是否可复用父 prompt 前缀”

当前默认治理：

- snapshot 默认 TTL 是 7 天
- 默认最多保留 200 个文件
- 可通过环境变量覆盖：
  - `CRAWCLAW_SPECIAL_CACHE_SAFE_PARAMS_TTL_MS`
  - `CRAWCLAW_SPECIAL_CACHE_SAFE_PARAMS_MAX_FILES`

关键结论：

- special agent 已经把缓存提升成正式 contract，而不是内部小技巧。
- `cache-plan.ts` 不只决定“给不给 key”，还决定“父前缀是否已经漂移”。
- `memory_extractor`、`session_summary`、`dream` 虽然声明了 parent-session prompt cache policy，但当前实现明确禁止它们复用父 prompt 前缀。

### 3. Runtime Acceleration Caches

核心代码：

- `src/config/cache-utils.ts`
- `src/agents/context-cache.ts`
- `src/agents/bootstrap-cache.ts`
- `src/agents/pi-embedded-runner/session-manager-cache.ts`
- `src/agents/pi-embedded-runner/cache-ttl.ts`

职责：

- 提供通用 TTL Map cache 原语
- 缓存 model context token 查找结果
- 按 session 缓存 workspace bootstrap files
- 对 session manager 文件做短 TTL 预热
- 记录 provider 相关 cache TTL 时间戳

关键结论：

- 这层是典型的“运行时降延迟缓存”。
- 它们大多是内存态、短生命周期、明确 TTL 或 session 作用域。
- `session-manager-cache` 本质上在利用 OS page cache 预热，而不是实现业务级持久缓存。

### 4. Plugin / Routing / Control Plane Caches

核心代码：

- `src/plugins/loader.ts`
- `src/plugins/runtime/runtime-cache.ts`
- `src/routing/resolve-route.ts`
- `src/gateway/model-pricing-cache.ts`
- `src/acp/control-plane/runtime-cache.ts`
- `src/infra/outbound/directory-cache.ts`

职责：

- 缓存 plugin registry、Jiti loader、allowlist warning 状态
- 复用 routing 计算结果
- 缓存 OpenRouter model pricing
- 复用 ACP actor runtime
- 缓存渠道目录查询结果

关键结论：

- 这层缓存属于控制面与装配层，不应和 prompt cache 混为一谈。
- 失效策略通常依赖 config ref、TTL、max size、actor idle time。
- `plugins/loader.ts` 已经实现了轻量 LRU 式 registry cache，不是每次都全量重建插件图。

### 5. Domain / File / UI Caches

核心代码：

- `src/memory/session-summary/store.ts`
- `src/memory/engine/built-in-memory-runtime.ts`
- `src/memory/media/media-service.ts`
- `src/media-understanding/attachments.cache.ts`
- `ui/src/ui/chat/session-cache.ts`

职责：

- 通过 `mtime + size` 缓存 session summary 文件读取
- 复用 built-in memory runtime bootstrap promise
- 维护 memory media 的磁盘缓存根
- 在单次媒体理解流程内复用 attachment path/buffer/temp path
- 在 UI 中保留最近会话的 LRU 状态

关键结论：

- 这层缓存和业务对象贴得最近，必须由领域自己拥有。
- 不应把这种缓存再抽回一个“万能 infra cache”。
- UI cache 和后端 cache 的目标不同，前者是交互体验，后者是执行效率或状态复用。

### 6. Memory Special Agent 的 Cache Policy

核心代码：

- `src/memory/durable/agent-runner.ts`
- `src/memory/session-summary/agent-runner.ts`
- `src/memory/dreaming/agent-runner.ts`

当前策略共性：

- `cacheRetention: "short"`
- `skipWrite: true`
- `promptCache.scope: "parent_session"`
- `promptCache.retention: "24h"`

关键结论：

- memory 相关 special agent 已经显式声明 cache policy。
- 这说明缓存不只是 provider 选项，而是 special agent contract 的一部分。
- 但策略声明不等于一定复用父 prefix，最终是否复用仍由 `cache-plan.ts` 判断。

## 当前缓存机制的总体判断

### 优点

- prompt/query cache identity 已经标准化，不靠临时拼 key。
- special agent 的缓存策略、snapshot、漂移判断都比较完整。
- 多数缓存都有明确作用域：run、session、config、actor、UI session、磁盘文件。
- 很多缓存已经有相应测试，不是黑盒实现。

### 主要问题

- 目前没有一份正式的缓存盘点文档，理解成本高。
- 不同层的 cache observability 还不统一。
- “持久缓存、短 TTL 缓存、预热缓存、UI 缓存、prompt cache” 容易被混成一个概念。
- 失效策略主要散在各域里，团队协作时容易漏掉。

## 推荐的治理原则

1. 缓存跟随领域，不要强行集中化。
2. 每个缓存都要明确：
   - 归属层
   - key/identity
   - 生命周期
   - 失效条件
   - 观测方式
3. Prompt cache 必须继续以 envelope/hash contract 为核心，而不是回退成随手拼接字符串 key。
4. Special agent 的 cache policy 继续保持显式声明，不要让后台 agent 悄悄继承缓存行为。
5. `src/config/cache-utils.ts` 只保留通用原语，不承接领域语义。

## 推荐补强的测试重点

- query layer cache identity 稳定性测试
- special agent fork cache drift 测试
- provider prompt cache hint 与 skip-write 行为测试
- plugin registry / routing / directory cache 的失效测试
- memory summary 文件缓存的 `mtime + size` 失效测试
- UI session cache 的 LRU 行为测试

## 推荐补强的维护文档

- `project-architecture-overview`
- `project-directory-boundaries`
- `project-docs-and-test-strategy`
- `project-cache-strategy`

这样团队在讨论性能、prompt reuse、memory special agent、channel runtime、UI 状态时，才不会把所有问题都笼统叫做“缓存”。
