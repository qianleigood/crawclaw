---
summary: "安装和运行 CrawClaw Desktop，本地优先的桌面应用"
read_when:
  - 你想要 CrawClaw 默认的本地桌面入口
  - 你需要了解桌面应用捆绑和启动了什么
  - 你正在验证平台支持或 release assets
title: "Desktop"
x-i18n:
  generated_at: "2026-06-10T11:18:34Z"
  model: codex
  provider: openai
  source_hash: 2c6d9593f195e8fbfc6796b6e5bfbda87da4e5aa734e0ea1eb904f5dc20471d0
  source_path: install/desktop.md
  workflow: 15
---

# Desktop

## Tauri 和 Rust runtime

CrawClaw Desktop 位于 `apps/crawclaw-desktop`，使用：

- Tauri v2 作为 desktop shell 和本地 process boundary。
- React 和 Vite 作为 desktop workbench UI。
- 绑定到 `127.0.0.1` 的 Rust Gateway，用于本地 HTTP 和 SSE。
- `runtime/crawclaw/bin/` 下的 Rust runtime binaries。
- bundled/default desktop tools 通过 Rust-native plugin execution 运行。
- desktop chat、`sessions_*` 和 sub-agents 使用 Rust-native Agent 和 session control。
- 通过 bundled `qwen3-tts` native path 输出本地语音。

desktop UI 会调用 `/api/desktop/bootstrap`、`/api/desktop/state`、`/api/desktop/runtime`、`/api/desktop/events`、`/api/desktop/search`，以及本地 Rust Gateway 上匹配的 mutation routes。`/api/desktop/sessions/spawn`、`/api/desktop/sessions/send` 和 `/api/desktop/sessions/yield` 等 Desktop session APIs 由 Rust runtime store 支撑，不会启动 legacy TypeScript Gateway。旧 Admin Desktop package 已退休；新的 desktop work 应以 Tauri app 为目标。

CrawClaw Desktop 是受支持的 Apple-platform user entrypoint。Automation 和 integrations 使用本地 Gateway API，而不是公共 shell command。

## Trust model

CrawClaw Desktop 是当前机器的本地 control surface。它可以通过 Rust Gateway 暴露 host-level capabilities，包括 file access、terminal sessions、backups、system metrics 和受支持的 desktop controls。

Tauri host 把 system integration 保留在 shell 中，并通过本地 Rust Gateway HTTP 和 SSE surface 发送普通业务动作。

backend 以 desktop mode 运行，并带有以下约束：

- 它只绑定 loopback。
- 它使用 desktop host 选择的 random local port。
- 它把 mutable state 存储在 app bundle 之外。
- 它只管理本地 Rust Gateway。
- 它不使用 npm global self-update behavior；desktop updates 来自 GitHub Releases。

## Bundled runtime

Desktop packages 在 app resources directory 下包含 production CrawClaw runtime：

```text
runtime/crawclaw/bin/crawclaw-runtime
runtime/crawclaw/bin/crawclaw-gateway
runtime/crawclaw/bin/crawclaw-native-plugins
runtime/crawclaw/runtimes/manifest.json
runtime/crawclaw/providers/manifest.json
runtime/crawclaw/plugins/manifest.json
runtime/crawclaw/automation-assets/comfyui/manifest.json
runtime/crawclaw/automation-assets/comfyui/install.sh
runtime/crawclaw/automation-assets/n8n/manifest.json
runtime/crawclaw/automation-assets/n8n/install.sh
```

打包应用使用这个 embedded Rust runtime 做本地 Gateway status checks、Agent/session state、sub-agent routing、本地 plugin execution 和 desktop runtime resources。终端用户在 desktop flow 中不需要 globally installed `crawclaw` binary，也不需要预配置 shell `PATH`。

Bundled/default desktop plugins 使用 Rust-native entries。desktop product path 不会 stage JS runtime support 或 QuickJS compatibility fallback。

Desktop speech 是 local-first。desktop package 为 text-to-speech 暴露 native `qwen3-tts` path；cloud speech plugins 不是默认 desktop Gateway surface 的一部分。

Automation Environment 使用 packaged `automation-assets` directory，从 Desktop settings 安装和管理本地 n8n 与 ComfyUI services。相同 installer manifests 和 scripts 也会作为 versioned GitHub release assets 发布，这样 packaged app 需要刷新本地 cache 时可以下载匹配 assets。Cron 内置于 Gateway scheduler，不从 Automation Environment 安装。

## Supported platforms

Desktop release assets 面向以下平台构建：

| Platform | Target artifact  |
| -------- | ---------------- |
| macOS    | `dmg` and `zip`  |
| Windows  | `nsis` installer |
| Linux    | `AppImage`       |

Platform-sensitive features 仍可能因 OS 而不同。app 从 desktop bootstrap、state、runtime 和 event endpoints 读取 runtime 与 feature state，然后用 backend 提供的 reason 禁用 unsupported actions，而不是完全隐藏 route。

## Gateway runtime

首次启动时，CrawClaw Desktop 会在 `~/.crawclaw` 准备本地 runtime state，并写入缺失的 local defaults：

- `gateway.mode=local`
- loopback binding
- 默认 local Gateway port
- online reconfigure behavior
- desktop Gateway 的 local authentication material

desktop app 会启动或发现本地 Rust Gateway，并把 per-launch session token 传给 renderer。Rust Gateway 拥有 desktop Agent chat、session history、sub-agent spawn/send/yield 和 local plugin calls。关闭 desktop window 只隐藏 UI。退出 desktop app 会退出 Tauri shell 及其本地 Gateway process。

## State locations

Runtime state 存储在：

```text
~/.crawclaw
```

Tauri app data 只存储 desktop UI 和 shell state。layout 是：

```text
config.json
data/
backups/
logs/
```

Runtime state、transcripts、memory、plugin manifests 和 provider configuration 仍保留在已安装 application bundle 之外。

## Gateway connection

CrawClaw Desktop 使用以下地址连接本地 Gateway：

```text
ws://127.0.0.1:18789
```

Remote Gateway、VPS 和 headless server deployments 使用 Gateway API 和 server/runtime documentation，而不是 desktop UI。

## Updates

Desktop builds 作为单个 desktop package 更新：app、embedded Rust runtime 和 UI 一起交付。

当 desktop update 可用时，从 [GitHub Releases](https://github.com/qianleigood/crawclaw/releases) 安装对应 platform asset。

## Beta limitations

- 这一版不包含 automatic desktop update downloads。
- 不包含 store distribution。
- Remote desktop parity 不保证覆盖所有平台。
- Signing 和 notarization 取决于 release workflow inputs 和 maintainer credentials。

## Build from source

本地 packaging work：

```bash
pnpm desktop:tauri:stage-runtime
pnpm desktop:tauri:dev
pnpm desktop:tauri:build
```

release validation：

```bash
pnpm desktop:tauri:release-check
```

Desktop app updates 通过 GitHub Releases 处理。
