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

| Surface                             | Status      | Windows boundary                                                                              |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| Installer                           | `supported` | `install.ps1` 默认安装 Node 24，接受 Node 22.14+，检查 Git/PATH 前提，并安装 CrawClaw。       |
| CLI                                 | `supported` | 命令从 PowerShell 运行，并处理 Windows 安全的参数、路径、shell 和进程启动。                   |
| Gateway foreground                  | `supported` | `crawclaw gateway run` 直接在 Windows 主机上启动 Gateway 网关。                               |
| Gateway service                     | `supported` | 每用户登录服务：允许时使用 Scheduled Task；任务创建被拒绝时回退到 Startup 文件夹。            |
| `exec` and `system.run` tools       | `supported` | 优先使用 PowerShell 7，并回退到 Windows PowerShell；命令 shim 必须避免不安全的 shell 回退。   |
| Browser automation                  | `supported` | 在 Windows smoke 覆盖 Chrome/Edge/Brave 发现和浏览器运行时后支持。                            |
| Docker sandbox                      | `supported` | 在 Windows drive-path、Docker Desktop bind 和 sandbox 安全门禁通过后支持。                    |
| Telegram, Discord, Slack, Matrix    | `supported` | 通过内置或捆绑 channel/plugin 路径支持；在 provider 凭据允许时提供 smoke 覆盖。               |
| Common provider plugins             | `supported` | 基于 Node 的 provider 通过捆绑插件运行时和安装期依赖设置加载。                                |
| BlueBubbles and iMessage            | `bridged`   | 通过 Mac server 或 Apple host 桥接；Windows 运行 Gateway/client 侧，而不是 Apple 本地消息栈。 |
| Apple skills and macOS-only tooling | `bridged`   | 通过 Mac 或 headless 节点桥接，由该主机持有 Apple 本地运行时和权限。                          |

## 安装

以普通用户身份运行 PowerShell：

```powershell
iwr -useb https://crawclaw.ai/install.ps1 | iex
```

Dry run 或 beta 安装：

```powershell
& ([scriptblock]::Create((iwr -useb https://crawclaw.ai/install.ps1))) -DryRun
& ([scriptblock]::Create((iwr -useb https://crawclaw.ai/install.ps1))) -Tag beta
```

验证安装：

```powershell
crawclaw --version
crawclaw doctor --non-interactive
crawclaw plugins list --json
```

如果新终端中的 PowerShell 找不到 `crawclaw`，参阅 [Node.js troubleshooting](/install/node#troubleshooting)。

## Gateway 网关参考

前台运行 Gateway 网关：

```powershell
crawclaw gateway run
```

安装受管启动：

```powershell
crawclaw gateway install
crawclaw gateway status --json
```

如果 Scheduled Task 创建被拒绝，CrawClaw 会回退到每用户 Startup 文件夹登录项，并立即启动 Gateway 网关。这是每用户登录服务，不是在任何用户登录前运行的机器服务。Scheduled Tasks 仍然是首选，因为它们提供更好的 supervisor 状态和重启可见性。

仅 CLI 设置可跳过带健康门禁的新手引导：

```powershell
crawclaw onboard --non-interactive --skip-health
```

## 兼容性门禁

仓库保留了聚焦 Windows 兼容性的门禁，可从任意开发主机验证相关代码路径：

```bash
pnpm test:windows:compat
```

该门禁覆盖安装器 wrapper 回归、Windows 进程启动、PowerShell shell 选择、路径规范化、Scheduled Task 回退行为、startup 回退处理、Docker 调用形状、浏览器可执行文件发现，以及插件运行时 spawn helper。

完整原生验证仍需要 Windows VM 或主机：

```bash
pnpm test:parallels:windows
pnpm test:parallels:npm-update
```

## First-class 接受标准

当以下条件全部成立时，才应将原生 Windows 描述为 first-class：

- `install.ps1` 可以在干净且受支持的 Windows 11 机器上安装或更新 CrawClaw，无需手动设置 Node 或 Git。
- `crawclaw --version` 可在新的 PowerShell 会话中运行，无需手动修复 PATH。
- `crawclaw doctor --non-interactive` 没有 blocking errors。
- `crawclaw onboard --non-interactive --install-daemon` 可为本地 Gateway 设置完成。
- `crawclaw gateway status --deep --require-rpc` 报告 Gateway 可达。
- `crawclaw agent --local --agent main --message "Reply OK only." --json` 可完成第一个本地 turn。
- 浏览器运行时检查要么通过，要么返回清晰、可执行的修复说明。
- 声明 Windows 支持的 provider 和 channel 插件会在 install 或 postinstall 期间安装其运行时依赖，而不是在第一次用户请求时懒安装。
- 从已发布的 `latest` package 升级到当前 package 成功。
- CI 和 release gates 覆盖 Windows install、postinstall manifest、Gateway lifecycle、第一个 agent turn，以及 smoke-backed runtime checks。

## 当前边界

- Gateway 自动启动是每用户登录模式。若要在任何 Windows 用户登录前运行，需要由管理员安装 Windows Service，这是后续阶段。
- Docker sandbox 支持依赖 Docker Desktop 或其他可工作的 Windows Docker engine，并需要通过 Windows path 和 sandbox security checks。
- 部分插件可能需要 provider 凭据、原生二进制、浏览器安装，或 CrawClaw package 外的运行时依赖。
- Apple 本地集成需要 Apple 设备或桥接主机，属于 `bridged`，不是原生 Windows 能力。
- 在本文档的门禁在 CI、nightly 和 release validation 中为绿之前，不应把原生 Windows 支持描述为完整 Windows parity。

## Gateway 网关

- [Gateway runbook](/gateway)
- [Configuration](/gateway/configuration)

## Gateway 服务安装（CLI）

```
crawclaw onboard --install-daemon
```

或：

```
crawclaw gateway install
```

或：

```
crawclaw configure
```

出现提示时，选择 **Gateway service**。

修复/迁移：

```
crawclaw doctor
```

## Windows 节点主机

当前没有 Windows 节点主机。受支持的 Windows 表面是本页描述的 CLI、Gateway 网关、插件和安装/运行时路径。

## 相关页面

- [Installer internals](/install/installer)
- [Node.js install and troubleshooting](/install/node)
- [Gateway runbook](/gateway)
- [Gateway configuration](/gateway/configuration)
