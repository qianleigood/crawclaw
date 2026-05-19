---
read_when:
  - 你希望获得最快的本地开发循环（bun + watch）
  - 你遇到 Bun 安装/补丁/生命周期脚本问题
summary: Bun 工作流（实验性）：安装和与 pnpm 的对比
title: Bun（实验性）
x-i18n:
  generated_at: "2026-05-19T00:51:32Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: a24131920e6ac0cd0c61699993657bd353e6a9c7e9d0e2fd1a8621d40f619499
  source_path: install/bun.md
  workflow: 15
---

# Bun（实验性）

<Warning>
Bun **不建议用于 Gateway 网关运行时**（已知与 Weixin 和 Feishu 存在兼容性问题）。生产环境请使用 Node。
</Warning>

Bun 是一个可选的本地运行时，用于直接运行 TypeScript（`bun run ...`, `bun --watch ...`）。默认包管理器仍然是 `pnpm`，它完全受支持并被文档工具使用。Bun 无法使用 `pnpm-lock.yaml` 并会忽略它。

## 安装

<Steps>
  <Step title="Install dependencies">
    ```sh
    bun install
    ```

    `bun.lock` / `bun.lockb` are gitignored, so there is no repo churn. To skip lockfile writes entirely:

    ```sh
    bun install --no-save
    ```

  </Step>
  <Step title="Build and test">
    ```sh
    bun run build
    pnpm test
    ```
  </Step>
</Steps>

## 生命周期脚本

Bun 默认会阻止依赖的生命周期脚本，除非明确信任。对于此仓库，常见的被阻止脚本不是必需的：

- `@whiskeysockets/baileys` `preinstall` -- 检查 Node major >= 20（CrawClaw 使用 Node 24.x）
- `protobufjs` `postinstall` -- 发出关于不兼容版本方案的警告（无构建产物）

如果你遇到需要这些脚本的运行时问题，请显式信任它们：

```sh
bun pm trust @whiskeysockets/baileys protobufjs
```

## 注意事项

有些脚本仍然硬编码了 pnpm（例如 `docs:build`, `ui:*`, `protocol:check`）。请暂时通过 pnpm 运行它们。
