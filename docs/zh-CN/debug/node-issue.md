---
read_when:
  - 排查旧 Node + tsx 开发路径说明时
summary: 旧 Node + tsx 调试记录已归档；当前产品运行时不再走该 TS loader 路径
title: Node + tsx 调试记录（已归档）
---

# Node + tsx 调试记录（已归档）

这页保留为历史排障记录。旧的 Node + `tsx` 开发入口和最小复现脚本已经随
TypeScript runtime 移除，不再是当前 CrawClaw 产品运行路径。

当前验证路径是 Rust/native gate：

- `pnpm check`
- `pnpm build`
- `pnpm test`
- `pnpm check:docs`

如果遇到运行时问题，请优先定位 owning Rust crate，并用 Cargo filter 做聚焦复现，
例如：

```bash
cargo test -p crawclaw-runtime <filter>
```

不要重新引入旧的 Node + `tsx` production/debug harness。桌面 renderer 仍可保留
TypeScript，但它不再承载 CrawClaw runtime。
