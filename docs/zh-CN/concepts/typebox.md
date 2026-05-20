---
summary: TypeBox helper schemas and Gateway protocol generation boundaries
read_when:
  - 更新 TypeBox helpers 或 Gateway protocol codegen
title: TypeBox helper schemas
---

# TypeBox helper schemas

最后更新：2026-05-18

TypeBox 不再是打包后的 **Gateway WebSocket protocol** 的事实来源。Rust
Gateway contract module 拥有 protocol version、advertised methods、
advertised events，以及稳定 JSON Schema snapshot。

TypeBox 在这个仓库里不再承担 product-runtime 角色。新的 protocol 和 runtime
schema 工作应放在 Rust contract modules 中。

使用这个划分：

- **Gateway protocol**：Rust-owned contract 和 generated artifacts。
- **Desktop renderer TypeScript**：仅 UI 代码，通过已文档化的 API payloads
  消费 Rust-owned protocol surface。

更高层 Gateway 背景请先看 [Gateway architecture](/concepts/architecture) 和
[Gateway protocol](/gateway/protocol)。

## Gateway protocol ownership

Gateway protocol files：

- Rust contract module: `crates/crawclaw-gateway/src/protocol_contract.rs`
- Embedded JSON Schema snapshot:
  `crates/crawclaw-gateway/src/protocol_contract/protocol.schema.stable.json`
- Generated JSON Schema: `dist/protocol.schema.json`

生成器通过 Rust Gateway binary 运行：

```bash
pnpm protocol:gen
pnpm protocol:check
```

`pnpm protocol:gen` 从 Rust contract snapshot 生成 JSON Schema。
`pnpm protocol:check` 验证 tracked generated artifact 与 Rust contract 一致。

## Runtime model

- **Server side**：Rust Gateway 拥有 handshake、auth、method dispatch 和
  runtime behavior。
- **Client side**：clients 消费 generated JSON Schema 或已文档化的 Gateway
  payloads。完整 protocol schema 不再生成为 TypeScript。
- **Advertised surface**：`hello-ok` 从 Rust protocol metadata 暴露 supported
  methods 和 events。

## TypeBox helper usage

不要为 Gateway protocol shapes 新增手写 TypeBox modules。Protocol fields 和
method contracts 应在 Rust 中修改、重新生成，然后通过 generated JSON Schema 或
已文档化的 Gateway payloads 消费。

## Add a Gateway method

1. 在 `crates/crawclaw-gateway/src/protocol_contract.rs` 中添加 method metadata
   和 schema contract。
2. 在 owning Gateway handler 中添加 Rust Gateway behavior。
3. 重新生成 artifacts：

   ```bash
   pnpm protocol:gen
   ```

4. 运行 protocol check：

   ```bash
   pnpm protocol:check
   ```

5. 为 behavior 和 contract coverage 添加 Rust Gateway tests。

## Versioning

- `GATEWAY_PROTOCOL_VERSION` 位于
  `crates/crawclaw-gateway/src/protocol_contract.rs`。
- Clients 发送 `minProtocol` 和 `maxProtocol`；server 会拒绝不匹配的连接。
- Swift models 从 `dist/protocol.schema.json` 生成。
