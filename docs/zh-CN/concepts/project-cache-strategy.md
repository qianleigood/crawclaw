---
read_when:
  - 审查 prompt cache、memory cache、web fetch cache 或 routing cache 行为
  - 需要识别 cache owners、cache keys、invalidation rules 或 validation gates
summary: CrawClaw 的分层 cache model、当前 ownership boundaries 和 governance rules
title: Project Cache Strategy
---

# Project Cache Strategy

CrawClaw 没有一个中心化 cache service。它在 Rust agent runtime、native
plugins、routing、Gateway control plane、media 和 desktop UI 中使用
domain-owned caches。

重要的审查问题不是“Map 在哪里”，而是：

- 谁拥有这个 cache
- 什么 identity 构成 cache key
- cache 如何过期或失效
- 相关 Rust/native gate 如何证明 cache 不会跨 user、session、provider 或 config
  boundaries 复用

## Cache Governance

旧 TypeScript cache governance registry 已被移除。每个关键 cache 现在都应由
它的 Rust/native owner 负责文档和测试，覆盖：

- `owner`
- `key`
- `lifecycle`
- `invalidation`
- `observability`

当 cache 会跨 session、provider、account 或 config boundary 时，在 test names
和 docs 中保持 identifiers 稳定。

## Query And Prompt Identity

这一层定义 query-layer cache envelope 和 hashes：

- `queryContextHash`
- `forkContextMessagesHash`
- `envelopeHash`

Tool inventory、thinking config、system prompt text 和 fork context 都是
identity 的一部分。User prompt content 不是这些 hashes 的隐藏输入；调用方必须
把它当作 prompt-prefix identity contract，而不是通用 response cache。

## Runtime Acceleration Caches

Rust AgentRuntime session 和 context caches 用于减少重复 runtime work。它们通常
是短生命周期、process-local，并按 TTL、session 或 workspace scoped。领域特定的
invalidation 应归属于该数据的 Rust/native owner。

## Session Store Cache

Session store cache 有两部分：

- object cache，key 是 store path 加文件 `mtimeMs` 和 size
- serialized write-through cache，key 是同一组 file fingerprint

外部进程改变 session file 后，serialized cache 不能跳过写入。修改 cache
semantics 前，应通过 Rust/native session persistence gate 验证行为。

## Web Fetch Response Cache

Primary code：

- `crates/crawclaw-native-plugins/src/web.rs`

`web_fetch` 在 process memory 中缓存 Rust native fetch responses。cache key 包含
requested URL、output shape、fetch settings、provider ID、sticky `sessionId`
和 provider wait hints。

这是 security-sensitive cache。某个 sticky browser session 的 rendered
response 绝不能复用于另一个 session。Regression coverage 位于 Rust native web
fetch tests。

## Routing And Control Plane Caches

Primary code：

- `crates/crawclaw-runtime/src/native_plugin_registry.rs`
- `crates/crawclaw-gateway/src/lib.rs`
- `crates/crawclaw-providers/src/lib.rs`

Routing caches 按 config object 以及 mutable config sections 的 content
signatures 建 key，例如 `bindings`、`agents` 和 `session`。这样稳定 config 的路径
仍然快，同时测试或 reload flows 中的 in-place mutations 也会被检测到。

Native plugin discovery 由 Rust runtime registry 拥有。Loader registry caches
使用 bounded entries 和 explicit clear functions。

## Memory And File Caches

这些 cache 由 domain 拥有。File caches 通常使用 `mtimeMs + size`
fingerprints，适合作为 best-effort read acceleration，但不应视为 cryptographic
content identity。

## Extension Caches

Extension caches 应包含 channel account、conversation、recipient、provider 或
file scope，以避免跨账号复用。Long-lived 或 persistent extension caches 还需要
bounded size、TTL 或 explicit cleanup path。

当 credentials 或 account config 会改变结果时，单独使用 account ID 不够。这种
情况下，cache key 应包含 non-secret credential fingerprint 或 narrow config
signature。

## Maintenance Rules

新增或修改 cache 时：

1. 把 ownership 和 invalidation 放在 domain module 中，而不是 generic shared
   cache layer。
2. 为 critical caches 添加或更新 governance descriptor。
3. 为 cross-session、cross-account、cross-provider、external-file-write 或
   config-mutation boundaries 添加 regression test。
4. 为 security-sensitive caches 使用 explicit structured keys。
5. 保持 provider prompt cache、response cache、runtime TTL cache、client-side
   cache 和 file cache 的概念分离。

## Related Docs

- [Context](/concepts/context)
- [Memory](/concepts/memory)
- [Session](/concepts/session)
- [Plugins Architecture](/plugins/architecture)
