---
read_when:
  - 你在看 prompt cache、memory cache、web fetch cache 或 routing cache 行为
  - 你要确认缓存 owner、cache key、失效规则或缓存测试
summary: CrawClaw 的分层缓存模型、当前归属边界与治理规则
title: 项目缓存策略
---

# 项目缓存策略

CrawClaw 没有单一的中心化 cache service。缓存分布在 agent kernel、web tools、memory、plugins、routing、gateway control plane、media 和 UI 等领域里，并由各领域自己拥有。

审查缓存时，关键问题不是“这个 `Map` 放在哪里”，而是：

- 谁拥有这个 cache
- cache key 的 identity 是什么
- cache 何时过期或失效
- 测试如何证明它不会跨 user、session、provider 或 config 边界复用

## Cache Governance Registry

代码层面的缓存盘点从 `src/cache/governance.ts` 开始。

每个关键 cache 都应该有一个 `CacheGovernanceDescriptor`，明确：

- `owner`
- `key`
- `lifecycle`
- `invalidation`
- `observability`

`src/cache/governance.test.ts` 会保持 descriptor ID 唯一，并要求关键可变 cache 注册进治理清单，例如 `config.sessions.store` 和 `agents.web-fetch.response`。

## Query And Prompt Identity

主要代码：

- `src/agents/query-context/cache-contract.ts`

这一层定义 query-layer cache envelope 和以下 hash：

- `queryContextHash`
- `forkContextMessagesHash`
- `envelopeHash`

Tool inventory、thinking config、system prompt text 和 fork context 都属于 identity。User prompt content 不是这些 hash 的隐藏输入；调用方必须把它理解为 prompt-prefix identity contract，而不是通用 response cache。

## Runtime Acceleration Caches

主要代码：

- `src/config/cache-utils.ts`
- `src/agents/context-cache.ts`
- `src/agents/bootstrap-cache.ts`
- `src/agents/pi-embedded-runner/session-manager-cache.ts`
- `src/agents/pi-embedded-runner/cache-ttl.ts`

这些 cache 用来减少重复 runtime work。它们通常是短生命周期、进程内的 cache，并按 TTL、session 或 workspace 作用域隔离。

`src/config/cache-utils.ts` 应保持为小型通用原语层。领域语义和失效规则应该留在拥有数据的 domain cache 里。

## Session Store Cache

主要代码：

- `src/config/sessions/store-cache.ts`
- `src/config/sessions/store.ts`

Session store cache 有两部分：

- object cache，key 包含 store path、文件 `mtimeMs` 和 size
- serialized write-through cache，也绑定同一组文件 fingerprint

外部进程改写 session file 后，serialized cache 不能继续跳过写盘。回归覆盖在 `src/config/sessions.cache.test.ts`。

## Web Fetch Response Cache

主要代码：

- `src/agents/tools/web-fetch.ts`
- `src/agents/tools/web-fetch-runtime-helpers.ts`
- `src/agents/tools/web-shared.ts`

`web_fetch` 会在进程内缓存 provider-backed 和本地 fetch response。它的 cache key 包含请求 URL、输出形态、fetch 设置、provider ID、sticky `sessionId` 和 provider wait hints。

这是安全敏感 cache。一个 sticky browser session 的 provider-backed response 不能被另一个 session 复用。回归覆盖在 `src/agents/tools/web-fetch.provider-fallback.test.ts`。

## Routing And Control Plane Caches

主要代码：

- `src/routing/resolve-route.ts`
- `src/plugins/loader.ts`
- `src/plugins/discovery.ts`
- `src/plugins/manifest-registry.ts`
- `src/gateway/model-pricing-cache.ts`
- `src/acp/control-plane/runtime-cache.ts`
- `src/infra/outbound/directory-cache.ts`

Routing cache 按 config object 和可变 config section 的内容签名建立 identity，例如 `bindings`、`agents` 和 `session`。这样稳定 config 仍然快，同时测试或 reload flow 中的原地 mutation 也能被识别。

Plugin discovery 和 manifest cache 使用短 TTL 窗口来折叠启动期间的 bursty reload。Loader registry cache 使用有界 entries 和显式 clear function。

## Memory And File Caches

主要代码：

- `src/memory/session-summary/store.ts`
- `src/memory/engine/built-in-memory-runtime.ts`
- `src/memory/durable/body-index.ts`
- `src/media-understanding/attachments.cache.ts`

这些 cache 由 domain 自己拥有。File cache 通常使用 `mtimeMs + size` fingerprint，这适合作为 best-effort read acceleration，但不应当成 cryptographic content identity。

## Extension Caches

示例：

- `extensions/slack/src/sent-thread-cache.ts`
- `extensions/msteams/src/sent-message-cache.ts`
- `extensions/telegram/src/sent-message-cache.ts`
- `extensions/telegram/src/sticker-cache.ts`
- `extensions/qqbot/src/utils/upload-cache.ts`

Extension cache 应该把 channel account、conversation、recipient、provider 或 file scope 纳入 identity，避免跨账号复用。长生命周期或持久化的 extension cache 还需要 size bound、TTL 或显式 cleanup path。

当 credentials 或 account config 会改变结果时，单独使用 account ID 不够。此时 cache key 应包含非明文的 credential fingerprint 或收窄后的 config signature。

## Maintenance Rules

新增或修改 cache 时：

1. 把 ownership 和 invalidation 放在 domain module 里，不要塞进通用 shared cache layer。
2. 对关键 cache 新增或更新 governance descriptor。
3. 为 cross-session、cross-account、cross-provider、external-file-write 或 config-mutation 边界补回归测试。
4. 安全敏感 cache 使用显式 structured key。
5. 区分 provider prompt cache、response cache、runtime TTL cache、client-side cache 和 file cache，不要混成一个概念。

## Related Docs

- [Context](/concepts/context)
- [Memory](/concepts/memory)
- [Session](/concepts/session)
- [Plugins Architecture](/plugins/architecture)
