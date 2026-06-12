---
summary: "CrawClaw Desktop、Gateway host mode、desktop runtime startup 和 Apple-local capabilities 的 macOS support matrix"
read_when:
  - 在 macOS 上安装 CrawClaw
  - 定义 macOS support scope
  - 查找 Apple-local capability boundaries
title: "macOS"
x-i18n:
  generated_at: "2026-06-12T07:14:37Z"
  model: codex
  provider: openai
  source_hash: 0fa47b4855a7c14b14ae9cca88e82f58032dc18c8690411d6ad61c1f57e8b667
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

打开 CrawClaw Desktop，并确认 Gateway 状态健康。自动化客户端可以通过
desktop-managed loopback Gateway 调用本地 Gateway API 的 `health` 或
`status` 方法来验证同一个安装。

引导式 setup：

使用 CrawClaw Desktop settings 管理 models、plugins、channels、automation
environment 和 launch-at-login controls。脚本化 setup 应通过 typed Gateway
RPC patch 同一份状态，例如 `config.patch`、`models.list`、`usage.status`、
`channels.status` 和 `channels.config.patch`。

## Gateway references

在 foreground 运行 Gateway：

启动 CrawClaw Desktop 并保持 app 运行；Desktop 在 macOS 上拥有本地 Gateway
lifecycle。Protocol clients 应连接到 loopback Gateway，并使用 `status` 确认
active process，而不是启动第二个 ad-hoc Gateway。

安装 managed startup：

在 CrawClaw Desktop settings 中启用 launch at login。调试启动时，用
`launchctl print gui/$UID | grep crawclaw` 检查 per-user launchd 状态，然后
通过 Desktop 重启 app-managed Gateway。

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
pnpm desktop:e2e:smoke
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
