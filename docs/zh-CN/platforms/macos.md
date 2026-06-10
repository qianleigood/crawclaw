---
summary: "CrawClaw Desktop、Gateway host mode、desktop runtime startup 和 Apple-local capabilities 的 macOS support matrix"
read_when:
  - 在 macOS 上安装 CrawClaw
  - 定义 macOS support scope
  - 查找 Apple-local capability boundaries
title: "macOS"
x-i18n:
  generated_at: "2026-06-10T11:18:34Z"
  model: codex
  provider: openai
  source_hash: 269dfdc3d2addaa337c75610842e806f347642caeadf68b8f2d2491ec5c32fe4
  source_path: platforms/macos.md
  workflow: 15
---

# macOS

CrawClaw 支持 **native macOS** 作为 Gateway host。macOS product boundary 是 CrawClaw Desktop、本地 Gateway、plugins、install/runtime setup，以及 Mac 上的 desktop runtime startup。

Native macOS support **不**表示 npm install smoke 覆盖了所有 Apple-local integration。Apple-local features 依赖 host permissions、signing，或在 feature 需要时依赖单独的 bridge service。

## Native capability states

macOS matrix 使用两种 support states：

- `supported`：CrawClaw 拥有 native macOS path，并通过 automated 或 smoke-backed gates 验证。
- `external`：capability 依赖 npm package 本身之外的另一个本地 service、account 或 provider。

## Native capability matrix

| Surface                             | Status      | macOS boundary                                                                                |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| Desktop installer                   | `supported` | GitHub Releases desktop assets 安装 app package 和 embedded runtime setup。                   |
| Gateway automation API              | `supported` | Automation clients 调用 desktop-managed local Gateway API。                                   |
| Gateway foreground                  | `supported` | CrawClaw Desktop 或 local Gateway API 直接在 Mac 上启动 Gateway。                             |
| Gateway runtime                     | `supported` | CrawClaw Desktop 拥有 local Rust Gateway lifecycle。                                          |
| Browser automation                  | `supported` | 通过 Chrome-family discovery 和 install-time browser runtime 支持。                           |
| Common provider plugins             | `supported` | Provider catalog 和 transports 由 Rust 拥有；bundled defaults 使用 native runtime resources。 |
| Weixin and Apple-local messaging    | `external`  | 需要 Apple-local services、credentials 和 permissions；仅 npm install 不足够。                |
| Camera, microphone, and screen APIs | `external`  | Permission-sensitive APIs 依赖 macOS TCC prompts、signing 和单独的 local runtime。            |

## Install

从 [GitHub Releases](https://github.com/qianleigood/crawclaw/releases) 安装 CrawClaw Desktop。

验证安装：

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

引导式 setup：

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

## Gateway references

在 foreground 运行 Gateway：

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

安装 managed startup：

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

macOS managed startup 使用 per-user LaunchAgent。它不是会在任何 user 登录前运行的 system daemon。

## Compatibility gate

repo 在 CI 中保留 focused macOS npm install smoke：

```bash
pnpm desktop:tauri:release-check
```

这个 gate 会打包当前 checkout，把它安装到 temporary global npm prefix，验证 CLI，检查 bundled plugin dependency staging，验证 install-time native runtime manifest，列出 plugins，并在临时 loopback port 上启动 foreground Gateway。

完整 VM validation 保持独立：

```bash
pnpm desktop:tauri:release-check
pnpm desktop:tauri:release-check
```

## Current boundaries

- npm smoke 覆盖 CLI、native runtime setup 和 foreground Gateway startup。它不验证 notarization 或 TCC permission prompts。
- LaunchAgent behavior 是 native managed-startup path。
- Apple-local integrations 可能需要 CrawClaw npm package 之外的 local services、Apple accounts 或 device permissions。

## Related

- [Platforms](/platforms)
- [Gateway runbook](/gateway)
- [Install updates](/install/updating)
- [macOS VMs](/install/macos-vm)
