---
read_when:
  - 你需要 CrawClaw 的默认本地桌面入口点
  - 你需要了解桌面应用捆绑和启动的内容
  - 你需要验证平台支持或发布资源
summary: 安装并运行 CrawClaw Desktop，这是本地优先的桌面应用程序
title: Desktop
x-i18n:
  generated_at: "2026-06-10T18:34:58Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: ecb48074c47a6553265754c7b4d00c8912f1a310f0371785940f5473aa427f15
  source_path: install/desktop.md
  workflow: 15
---

# Desktop

## Tauri 和 Rust 运行时

CrawClaw Desktop 位于 `apps/crawclaw-desktop`，使用以下技术：

- Tauri v2 用于桌面 shell 和本地进程边界。
- React 和 Vite 用于桌面工作台 UI。
- 绑定到 `127.0.0.1` 的 Rust Gateway，用于本地 HTTP 和 SSE。
- `runtime/crawclaw/bin/` 下的 Rust 运行时二进制文件。
- 用于捆绑/默认桌面工具的 Rust 原生插件执行。
- 用于桌面聊天、`sessions_*` 和子智能体的 Rust 原生 Agent 和会话控制。
- 通过捆绑的 `qwen3-tts` 本地路径进行本地语音输出。

桌面 UI 通过本地 Rust Gateway 与 `/api/desktop/bootstrap`、`/api/desktop/state`、`/api/desktop/runtime`、`/api/desktop/events`、`/api/desktop/search` 以及匹配的变更路由进行通信。桌面会话 API（如 `/api/desktop/sessions/spawn`、`/api/desktop/sessions/send` 和 `/api/desktop/sessions/yield`）由 Rust 运行时存储支持，不会启动遗留的 TypeScript Gateway。遗留的 Electron 桌面包已弃用；新的桌面工作应针对 Tauri 应用。

CrawClaw Desktop 是受支持的 Apple 平台用户入口点。自动化和集成使用本地 Gateway API，而不是公共 shell 命令。

## 信任模型

CrawClaw Desktop 是当前机器的本地控制面。它可以通过 Rust Gateway 暴露主机级能力，包括文件访问、终端会话、备份、系统指标和支持的桌面控制。

Tauri 主机将系统集成保留在 shell 中，并通过本地 Rust Gateway HTTP 和 SSE 层面发送普通业务操作。

后端以桌面模式运行，具有以下约束：

- 仅绑定到 loopback。
- 使用由桌面主机选择的随机本地端口。
- 将可变状态存储在应用包之外。
- 仅管理本地 Rust Gateway。
- 不使用 npm 全局自我更新行为；桌面更新来自 GitHub Releases。

## 捆绑运行时

桌面包在应用资源目录下包含生产级 CrawClaw 运行时：

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

打包的应用使用这个嵌入式 Rust 运行时进行本地 Gateway 状态检查、Agent/会话状态、子智能体路由、本地插件执行和桌面运行时资源。终端用户不需要全局安装的 `crawclaw` 二进制文件，也不需要为桌面流程预配置 shell `PATH`。

捆绑/默认桌面插件使用 Rust 原生条目。桌面产品路径不包含 JS 运行时支持或 QuickJS 兼容性回退。

桌面语音特意设计为本地优先。桌面包为文本转语音暴露本地 `qwen3-tts` 路径；云语音插件不属于默认桌面 Gateway 层面。

自动化环境使用打包的 `automation-assets` 目录从 Desktop 设置安装和管理本地 n8n 和 ComfyUI 服务。相同的安装程序清单和脚本也作为版本化 GitHub release 资产发布，以便打包的应用在需要刷新本地缓存时可以下载匹配的资产。Cron 内置于 Gateway 调度器中，不是从自动化环境安装的。

## 支持的平台

桌面发布资产为以下平台构建：

| 平台    | 目标产物        |
| ------- | --------------- |
| macOS   | `dmg` 和 `zip`  |
| Windows | `nsis` 安装程序 |
| Linux   | `AppImage`      |

平台敏感功能可能因操作系统而异。应用从桌面 bootstrap、state、runtime 和 event 端点读取运行时和功能状态，然后使用后端提供的理由禁用不支持的操作，而不是完全隐藏路由。

## Gateway 运行时

首次启动时，CrawClaw Desktop 在 `~/.crawclaw` 中准备本地运行时状态，并写入缺失的本地默认值：

- `gateway.mode=local`
- loopback 绑定
- 默认本地 Gateway 端口
- 在线重新配置行为
- 桌面 Gateway 的本地认证材料

桌面应用启动或发现本地 Rust Gateway，并将每次启动的会话令牌传递给渲染器。Rust Gateway 拥有桌面 Agent 聊天、会话历史记录、子智能体 spawn/send/yield 和本地插件调用。关闭桌面窗口会隐藏 UI。退出桌面应用会退出 Tauri shell 及其本地 Gateway 进程。

## 状态位置

运行时状态存储在：

```text
~/.crawclaw
```

Tauri 应用数据仅存储桌面 UI 和 shell 状态。布局为：

```text
config.json
data/
backups/
logs/
```

运行时状态、对话记录、记忆、插件清单和提供商配置保留在已安装应用包之外。

## Gateway 连接

CrawClaw Desktop 使用以下方式连接到本地 Gateway：

```text
ws://127.0.0.1:18789
```

远程 Gateway、VPS 和无头服务器部署使用 Gateway API 和 server/runtime 文档，而不是桌面 UI。

## 更新

桌面构建作为单一桌面包更新：应用、嵌入式 Rust 运行时和 UI 一起交付。

当桌面更新可用时，从 [GitHub Releases](https://github.com/qianleigood/crawclaw/releases) 安装平台资产。

## Beta 限制

- 本次版本不包含自动桌面更新下载。
- 不包含商店分发。
- 不保证所有平台的远程桌面功能对等。
- 签名和公证取决于发布工作流输入和维护者凭证。

## 从源码构建

对于本地打包工作：

```bash
pnpm desktop:tauri:stage-runtime
pnpm desktop:tauri:dev
pnpm desktop:tauri:build
```

对于发布验证：

```bash
pnpm desktop:tauri:release-check
```

桌面应用更新通过 GitHub Releases 处理。
