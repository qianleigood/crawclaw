---
read_when:
  - 在 Windows 上安装 CrawClaw
  - 定义 Windows 支持范围
  - 查找 Windows 节点主机状态
summary: Windows 原生安装、Gateway 服务模式、插件和验证门禁的支持矩阵
title: Windows
x-i18n:
  generated_at: "2026-04-24T16:45:00Z"
  model: manual
  provider: local
  source_path: platforms/windows.md
  workflow: manual
---

# Windows

CrawClaw 支持 **原生 Windows** 作为 Gateway 网关主机。Windows 产品边界包括 CLI、Gateway 网关、插件、安装/运行时设置，以及 Windows 主机上的每用户启动。

原生 Windows 支持并不意味着与 macOS 专用本地集成或每一种 Linux sandbox 行为完全等价。它表示 Windows 主机可以安装 CrawClaw、运行 CLI、运行 Gateway 网关、管理每用户启动、加载受支持插件，并在不需要 Linux 兼容层的情况下通过 Windows 兼容性门禁。

## 原生能力状态

Windows 矩阵使用三种支持状态：

- `supported`：CrawClaw 拥有原生 Windows 路径，并通过自动化或 smoke-backed 门禁验证。
- `bridged`：CrawClaw 可从 Windows 使用该能力，但原生能力运行在另一台主机上，例如 Mac 或 headless 节点。
- `not-native`：该能力不在当前原生 Windows 产品边界内。

## 原生能力矩阵

| Surface                             | Status       | Windows boundary                                                                                |
| ----------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| Desktop installer                   | `supported`  | GitHub Releases desktop assets 安装 CrawClaw Desktop 和 embedded runtime。                      |
| CLI                                 | `supported`  | PowerShell 中的命令需要保持 Windows-safe 参数、路径、shell 和进程启动行为。                     |
| Gateway foreground                  | `supported`  | CrawClaw Desktop 或本地 Gateway API 直接在 Windows 主机上启动 Gateway。                         |
| Gateway runtime                     | `supported`  | CrawClaw Desktop 或本地 Gateway API 启动本地 Rust Gateway。                                     |
| `exec` and `system.run` tools       | `supported`  | 优先使用 PowerShell 7，并回退到 Windows PowerShell；命令 shim 必须避免不安全的 shell fallback。 |
| Browser automation                  | `supported`  | Windows smoke 覆盖 Chrome/Edge/Brave discovery 和 browser runtime 后支持。                      |
| Feishu, QQBot, DingTalk, Weixin     | `supported`  | 通过内置或捆绑 channel/plugin 路径支持；在 provider 凭据允许时提供 smoke coverage。             |
| Common provider plugins             | `supported`  | Provider catalog 和 transports 由 Rust 拥有；bundled defaults 使用 native runtime resources。   |
| legacy messaging and Weixin         | `not-native` | 需要 Windows runtime 之外的 Mac-side legacy messaging 或 Apple messaging host。                 |
| Apple skills and macOS-only tooling | `not-native` | 需要 Windows runtime 之外的 Apple host。                                                        |

## 安装

以普通用户身份安装 [GitHub Releases](https://github.com/qianleigood/crawclaw/releases) 中最新的 Windows desktop asset。

验证安装：

打开 CrawClaw Desktop 并确认本地 Gateway 状态；自动化验证时，调用本地 Gateway API。

Desktop 用户不需要全局 `crawclaw` 命令。操作入口是 CrawClaw Desktop 或本地 Gateway API。

## Gateway 网关参考

前台运行 Gateway：

使用 CrawClaw Desktop 启动本地 Rust Gateway。Source checkout development 应使用仓库的 desktop 或 Gateway package scripts。

Managed OS startup 不属于默认 desktop runtime 路径。使用 CrawClaw Desktop 或本地 Gateway API 启动本地 Rust Gateway。

Gateway API-only 设置应在配置 provider credentials 和 auth 后直接调用本地 Gateway API。

## 兼容性门禁

仓库将 Windows 相关兼容性覆盖保留在原生 Rust 工作区 gate 中：

```bash
pnpm test
```

该 gate 覆盖可从任意开发主机验证的原生运行时 spawn helper 以及跨平台路径/进程行为。

完整原生验证仍需要 Windows VM 或主机：

```bash
pnpm test:parallels:windows
pnpm test:parallels:npm-update
```

## First-class 接受标准

当以下条件全部成立时，才应将原生 Windows 描述为 first-class：

- CrawClaw Desktop 可以在干净且受支持的 Windows 11 机器上安装或更新 CrawClaw，无需手动设置 Node 或 Git。
- packaged desktop version check 可在新的 PowerShell 会话中运行，无需手动修复 PATH。
- CrawClaw Desktop 或本地 Gateway API 没有 blocking errors。
- CrawClaw Desktop 或本地 Gateway API 完成本地 Gateway 设置。
- CrawClaw Desktop 或本地 Gateway API 报告 Gateway 可达。
- CrawClaw Desktop 或本地 Gateway API 完成第一个本地 turn。
- 浏览器运行时检查要么通过，要么返回清晰、可执行的修复说明。
- 声明 Windows 支持的 provider 和 channel 插件会在 install 或 postinstall 期间安装其运行时依赖，而不是在第一次用户请求时懒安装。
- 从已发布的 `latest` package 升级到当前 package 成功。
- CI 和 release gates 覆盖 Windows install、postinstall manifest、Gateway lifecycle、第一个 agent turn，以及 smoke-backed runtime checks。

## 当前边界

- Gateway 自动启动是每用户登录模式。若要在任何 Windows 用户登录前运行，需要由管理员安装 Windows Service，这是后续阶段。
- 部分插件可能需要 provider 凭据、原生二进制、浏览器安装，或 CrawClaw package 外的运行时依赖。
- Apple 本地集成需要 Apple 设备或桥接主机，不属于原生 Windows 能力。
- 在本文档的门禁在 CI、nightly 和 release validation 中为绿之前，不应把原生 Windows 支持描述为完整 Windows parity。

## Gateway 网关

- [Gateway runbook](/gateway)
- [Configuration](/gateway/configuration)

## Gateway runtime

使用 CrawClaw Desktop 或本地 Gateway API。旧的 CLI-managed Scheduled OS task 和 login-item 路径已从默认 desktop product path 中退役。

## Windows 节点主机

当前没有 Windows 节点主机。受支持的 Windows 表面是本页描述的 CLI、Gateway 网关、插件和安装/运行时路径。

## 相关页面

- [Desktop](/install/desktop)
- [Node.js install and troubleshooting](/install/node)
- [Gateway runbook](/gateway)
- [Gateway configuration](/gateway/configuration)
