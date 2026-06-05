---
read_when:
  - 调试实例选项卡
  - 调查重复或过时的实例行
  - 更改网关 WS 连接或系统事件信标
summary: CrawClaw 在线状态条目的生成、合并和显示方式
title: 在线状态
x-i18n:
  generated_at: "2026-06-05T14:13:45Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: c8da8edec058739b8480292e28e195d948b3783810cb961744a2b711fd2801a7
  source_path: concepts/presence.md
  workflow: 15
---

# 在线状态

CrawClaw "在线状态"是一种轻量级、尽力而为的视图，展示：

- **Gateway 网关**本身，以及
- **连接到 Gateway 网关的客户端**（CLI、自动化、浏览器认证客户端等）

在线状态主要用于渲染面向操作员的**实例**视图，并提供快速的操作员可见性。

## 在线状态字段（显示内容）

在线状态条目是结构化对象，包含以下字段：

- `instanceId`（可选但强烈推荐）：稳定的客户端标识（通常为 `connect.client.instanceId`）
- `host`：人类可读的主机名
- `ip`：尽力获取的 IP 地址
- `version`：客户端版本字符串
- `deviceFamily` / `modelIdentifier`：硬件提示
- `mode`：`ui`、`cli`、`backend`、`probe`、`test`、`node`、...
- `lastInputSeconds`："距离上次用户输入的秒数"（如果已知）
- `reason`：`self`、`connect`、`node-connected`、`periodic`、...
- `ts`：上次更新时间戳（自纪元以来的毫秒数）

## 生产者（在线状态来源）

在线状态条目由多个来源产生并**合并**。

### 1) Gateway 自条目

Gateway 网关在启动时始终会生成一个"self"条目，以便 UI 在任何客户端连接之前就显示网关主机。

### 2) WebSocket 连接

每个 WS 客户端以 `connect` 请求开始。成功握手后，Gateway 网关会为该连接 upsert 一个在线状态条目。

#### 为什么一次性 Desktop 和 Gateway API 操作不显示

CLI 通常为短时的一次性命令连接。为避免实例列表被刷屏，`client.mode === "cli"` **不会**转换为在线状态条目。

### 3) `system-event` 信标

客户端可以通过 `system-event` 方法发送更丰富的周期性信标。Desktop 和 Web 客户端使用此方法报告主机名、IP 和 `lastInputSeconds`。

### 4) 节点连接（role: node）

当节点通过 Gateway WebSocket 以 `role: node` 连接时，Gateway 网关会为该节点 upsert 一个在线状态条目（与其他 WS 客户端流程相同）。

## 合并 + 去重规则（为什么 `instanceId` 很重要）

在线状态条目存储在单个内存映射中：

- 条目以**在线状态键**为键。
- 最好的键是稳定的 `instanceId`（来自 `connect.client.instanceId`），它在重启后保持不变。
- 键不区分大小写。

如果客户端在没有稳定 `instanceId` 的情况下重连，可能会显示为**重复**行。

## TTL 和有界大小

在线状态有意设计为短暂的：

- **TTL：**超过 5 分钟的条目会被清除
- **最大条目数：**200（最旧的先删除）

这保持了列表的新鲜度并避免无限制的内存增长。

## 远程/隧道注意事项（loopback IP）

当客户端通过 SSH 隧道/本地端口转发连接时，Gateway 网关可能将远程地址视为 `127.0.0.1`。为避免覆盖良好的客户端报告 IP，loopback 远程地址会被忽略。

## 消费者

### 实例视图

面向浏览器的客户端可以渲染 `system-presence` 的输出，并根据上次更新的时间应用小的状态指示器（活跃/空闲/过时）。

## 调试提示

- 要查看原始列表，请对 Gateway 网关调用 `system-presence`。
- 如果看到重复项：
  - 确认客户端在握手中发送了稳定的 `client.instanceId`
  - 确认周期性信标使用相同的 `instanceId`
  - 检查连接派生的条目是否缺少 `instanceId`（重复是预期的）
