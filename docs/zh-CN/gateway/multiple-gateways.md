---
read_when:
  - 在同一台机器上运行多个 Gateway
  - 你需要每个 Gateway 隔离的配置/状态/端口
summary: 在同一主机上使用隔离的配置、状态、工作区和端口运行多个 CrawClaw Gateway
title: 多 Gateway
x-i18n:
  generated_at: "2026-06-10T20:16:06Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 3fbe2cbdf2df186a688a4303f837fb3cc6c72231494370fdf940642c3be6ae9d
  source_path: gateway/multiple-gateways.md
  workflow: 15
---

# 多 Gateway（同主机）

大多数设置应该使用一个 Gateway，因为单个 Gateway 可以处理多个消息连接和智能体。如果你需要更强的隔离或冗余（例如救援机器人），请使用隔离的配置、状态、工作区和端口运行单独的 Gateway。

## 隔离清单（必需）

- `CRAWCLAW_CONFIG_PATH` — 每个实例的配置文件
- `CRAWCLAW_STATE_DIR` — 每个实例的会话、凭证、缓存
- `agents.defaults.workspace` — 每个实例的工作区根目录
- `gateway.port`（或 `--port`）— 每个实例唯一
- 派生端口（browser/canvas）不得重叠

如果这些被共享，你将遇到配置竞争和端口冲突。

## 推荐：环境隔离的实例

Gateway 二进制通过环境变量和配置值来隔离实例，而不是通过 `--profile` 标志。为每个实例分配自己的 `CRAWCLAW_CONFIG_PATH`、`CRAWCLAW_STATE_DIR`、工作区和基础端口。如果同时设置 `CRAWCLAW_PROFILE`，请把它当作工作区/名称标签；不要依赖它单独隔离配置或状态。

安装 OS 服务时，为每个服务使用单独的服务名和包含这些值的环境文件。

两个服务绝不能指向同一个配置路径或状态目录。

## 救援机器人指南

在同一主机上运行第二个 Gateway，拥有自己的：

- 配置路径（和可选的 `CRAWCLAW_PROFILE` 标签）
- 状态目录
- 工作区
- 基础端口（加上派生端口）

这使救援机器人与主机器人隔离，以便在主机器人宕机时可以调试或应用配置更改。

端口间隔：基础端口之间至少留出 20 个端口，以便派生的 browser/canvas/CDP 端口永远不会冲突。

### 如何安装（救援机器人）

先创建救援机器人的配置、状态目录和工作区，然后用独立的环境变量和端口启动第二个 Gateway。下面的手动环境示例是本地运行的标准模式。

## 端口映射（派生）

基础端口 = `gateway.port`（或 `CRAWCLAW_GATEWAY_PORT` / `--port`）。

- 浏览器控制服务端口 = 基础端口 + 2（仅限 local loopback）
- 浏览器配置 CDP 端口从 `browser.controlPort + 9 .. + 108` 自动分配

如果你在配置或环境变量中覆盖了这些，必须保持每个实例唯一。

## 浏览器/CDP 注意事项（常见陷阱）

- 不要在多个实例上将 `browser.cdpUrl` 固定到相同的值。
- 每个实例需要自己的浏览器控制端口和 CDP 范围（从其 Gateway 端口派生）。
- 如果你需要显式 CDP 端口，按实例设置 `browser.profiles.<name>.cdpPort`。
- 远程 Chrome：使用 `browser.profiles.<name>.cdpUrl`（每个配置，每个实例）。

## 手动环境示例

```bash
CRAWCLAW_CONFIG_PATH=~/.crawclaw/main.json \
CRAWCLAW_STATE_DIR=~/.crawclaw-main \
cargo run -q -p crawclaw-gateway -- --bind loopback --port 18789

CRAWCLAW_CONFIG_PATH=~/.crawclaw/rescue.json \
CRAWCLAW_STATE_DIR=~/.crawclaw-rescue \
cargo run -q -p crawclaw-gateway -- --bind loopback --port 18790
```

## 快速检查

- `lsof -nP -iTCP:<port> -sTCP:LISTEN` 显示每个基础端口由预期进程占用。
- 每个进程都有不同的 `CRAWCLAW_CONFIG_PATH` 和 `CRAWCLAW_STATE_DIR`。
- 浏览器控制端口和 CDP 派生端口不重叠。
- 每个消息账号或浏览器配置只被一个实例占用。
