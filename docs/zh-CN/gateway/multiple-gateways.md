---
read_when:
  - 在同一台机器上运行多个 Gateway
  - 你需要每个 Gateway 隔离的配置/状态/端口
summary: 在同一主机上运行多个 CrawClaw Gateway（隔离、端口和配置）
title: 多 Gateway
x-i18n:
  generated_at: "2026-06-05T14:17:48Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: a1bc1addf44cf5df9bffc4f61ae2ff59e7878916c2943a8da03c747c79c2bc82
  source_path: gateway/multiple-gateways.md
  workflow: 15
---

# 多 Gateway（同主机）

大多数设置应该使用一个 Gateway，因为单个 Gateway 可以处理多个消息连接和智能体。如果你需要更强的隔离或冗余（例如救援机器人），请使用隔离的配置/端口运行单独的 Gateway。

## 隔离清单（必需）

- `CRAWCLAW_CONFIG_PATH` — 每个实例的配置文件
- `CRAWCLAW_STATE_DIR` — 每个实例的会话、凭证、缓存
- `agents.defaults.workspace` — 每个实例的工作区根目录
- `gateway.port`（或 `--port`）— 每个实例唯一
- 派生端口（browser/canvas）不得重叠

如果这些被共享，你将遇到配置竞争和端口冲突。

## 推荐：配置（`--profile`）

配置自动限定 `CRAWCLAW_STATE_DIR` + `CRAWCLAW_CONFIG_PATH` 的范围并为服务名称添加后缀。

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。

每个配置的服务：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。

## 救援机器人指南

在同一主机上运行第二个 Gateway，拥有自己的：

- 配置/配置文件
- 状态目录
- 工作区
- 基础端口（加上派生端口）

这使救援机器人与主机器人隔离，以便在主机器人宕机时可以调试或应用配置更改。

端口间隔：基础端口之间至少留出 20 个端口，以便派生的 browser/canvas/CDP 端口永远不会冲突。

### 如何安装（救援机器人）

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。

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

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。
