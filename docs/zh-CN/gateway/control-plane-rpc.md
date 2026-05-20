---
summary: 当前控制面 RPC 边界已并入 Rust Gateway protocol contract
read_when:
  - 你在扩展浏览器 Browser client
  - 你想确认前端可以稳定依赖哪些 Gateway methods
  - 你在迁移旧 TypeScript control-plane contract 说明
title: 控制面 RPC
---

# 控制面 RPC

这页是旧浏览器控制面 RPC 文档的归档入口。当前控制面 contract 已由 Rust Gateway
protocol contract 和 Gateway runtime handlers 拥有，不再由 TypeScript method
map 或 TypeBox helpers 作为事实来源。

当前入口：

- [Gateway protocol](/gateway/protocol)
- [TypeBox helper schemas](/concepts/typebox)
- Rust contract module: `crates/crawclaw-gateway/src/protocol_contract.rs`
- Stable schema snapshot:
  `crates/crawclaw-gateway/src/protocol_contract/protocol.schema.stable.json`
- Generated schema artifact: `dist/protocol.schema.json`

浏览器或桌面客户端应以 Gateway hello payload、documented method payloads 和
generated JSON Schema 为准。不要重新依赖旧 TypeScript control-plane files。
