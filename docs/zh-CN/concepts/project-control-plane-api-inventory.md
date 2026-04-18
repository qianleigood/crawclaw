---
summary: 当前前端真实依赖的 Gateway 控制面 method surface 清单，包含 method 分类、schema 覆盖和 capability 探测现状
title: 控制面 API Inventory
---

# 控制面 API Inventory

这份文档是 **控制面 API 重构** 的第一步基线，用来冻结当前前端真实依赖的 Gateway method surface。

用途：

1. 防止后续边改边漂移。
2. 让 `PR-CPA-02` 的 shared contract 有明确输入。
3. 让 schema 覆盖和 capability 收口有一份统一参照。

## 范围

当前 inventory 统计的是：

- `ui/src/ui/controllers/*`
- `ui/src/ui/chat/slash-command-executor.ts`

不包含：

- Debug 页手工输入的任意 raw RPC
- CLI / HTTP API
- node-mode client 私有 surface

## 当前 method surface

## 1. Chat / Sessions

### Chat

- `chat.send`
- `chat.abort`

### Sessions

- `sessions.subscribe`
- `sessions.list`
- `sessions.patch`
- `sessions.delete`
- `sessions.compact`
- `sessions.steer`

这组是当前 Control UI 最稳定的一条资源型主线。

## 2. Config

- `config.get`
- `config.schema`
- `config.set`
- `config.apply`
- `config.openFile`

说明：

- UI 当前还没有把 `config.patch` 用成主写路径。
- 当前 config 编辑更接近“配置文件编辑器”，不是 section-first 的 patch 流程。

## 3. Workflows

- `workflow.list`
- `workflow.get`
- `workflow.runs`
- `workflow.status`
- `workflow.deploy`
- `workflow.republish`
- `workflow.diff`
- `workflow.update`
- `workflow.rollback`
- `workflow.delete`
- `workflow.run`
- `workflow.cancel`
- `workflow.resume`

这组是当前**最重的前端资源域之一**，也是最值得先纳入 shared contract 的主线。

## 4. Agents / Tools / Files / Models / Skills

### Agents

- `agents.list`
- `agent.inspect`
- `agent.identity.get`

### Agent files

- `agents.files.list`
- `agents.files.get`
- `agents.files.set`

### Tools

- `tools.catalog`
- `tools.effective`

### Models

- `models.list`

### Skills

- `skills.status`
- `skills.update`
- `skills.install`

## 5. Channels

- `channels.status`
- `channels.logout`
- `web.login.start`
- `web.login.wait`
- `feishu.cli.status`

说明：

- 这里已经存在**正式 UI 主线 + optional capability surface** 混用。
- `feishu.cli.status` 当前仍通过 unknown-method 探测。
- `web.login.*` 虽然表现为 channel 登录，但命名仍不在 `channels.*` 资源域里。

## 6. Cron

- `cron.status`
- `cron.list`
- `cron.update`
- `cron.add`
- `cron.run`
- `cron.remove`
- `cron.runs`

## 7. Nodes / Devices / Approvals / Presence / Logs / Usage

### Nodes

- `node.list`

### Devices

- `device.pair.approve`
- `device.pair.reject`
- `device.token.revoke`

### Presence / System

- `system-presence`
- `health`
- `status`
- `last-heartbeat`

### Logs

- `logs.tail`

### Usage

- `sessions.usage`
- `usage.cost`
- `sessions.usage.timeseries`
- `sessions.usage.logs`

## Method 分类

## A. Stable resource-like surface

这批已经比较像稳定的前端资源 API：

- `config.*`
- `sessions.*`
- `workflow.*`
- `agents.*`
- `agents.files.*`
- `tools.*`
- `cron.*`
- `node.list`
- `device.*`
- `usage.*`

## B. Optional first-class surface

这批是正式支持，但不一定每个部署都有：

- `channels.status`
- `web.login.*`
- `feishu.cli.status`

这批后续必须统一进入 capability gating，不应再靠报错探测。

## C. Flat / legacy-shaped surface

这批仍然存在命名不一致问题：

- `health`
- `status`
- `last-heartbeat`
- `system-presence`
- `web.login.*`

它们后续应进入 preferred-name 收口，但不建议在 inventory 阶段直接改名。

## 当前 capability 探测现状

### 已存在机制

Gateway `hello-ok` 已经下发：

- `features.methods`
- `features.events`

UI 连接后也会保存这份 hello payload。

### 当前正式 UI 里真实使用情况

目前前端主页面**没有普遍使用** `hello.features` 进行 capability gating。

当前唯一确认的运行时探测点是：

- `feishu.cli.status`
  - 先调用
  - 再根据 `unknown method` 判断是否支持

也就是说：

- capability 机制已经存在
- 但产品层还没有正式接入

这就是 `PR-CPA-06` 的直接输入。

## 当前 schema 覆盖基线

## 已有较明确 schema 覆盖

从现有 TypeBox / protocol schema 看，前端主线里已经覆盖或部分覆盖的包括：

- `config.*`
- `sessions.*`
- `channels.status`
- `channels.logout`
- `web.login.*`
- `cron.*`
- `devices.*`
- `models.list`
- `tools.catalog`
- `tools.effective`
- `agents.list`
- `agents.files.*`
- `skills.*`
- `wizard.*`

## 当前明显未完整覆盖的前端重度 surface

- `workflow.*`
- `agent.inspect`
- `system-presence`
- `last-heartbeat`
- `health`
- `status`
- `usage.*`

这意味着当前 TypeBox 还不是“前端控制面 API 的完整 source of truth”。

## 配置编辑现状基线

前端当前设置主线虽然是围绕 `config.*`，但写路径仍偏文件导向：

- `config.get`
- `config.schema`
- `config.set`
- `config.apply`

`config.patch` 虽然已经存在于 gateway 端，但还没有成为 UI 表单主路径。

因此后续改造目标应是：

- 表单写：`config.patch`
- Raw 写：`config.set`
- 应用：`config.apply`

同时补齐 `config.schema` / `uiHints` 元信息，而不是额外发明一层 `settings.*`。

## 对 `PR-CPA-02` 的直接输入

下一步 shared contract 第一批应优先覆盖：

1. `config.*`
2. `sessions.*`
3. `workflow.*`
4. `agents.*`
5. `tools.*`
6. `channels.status`
7. `web.login.*`
8. `health`
9. `status`
10. `system-presence`
11. `last-heartbeat`
12. `usage.*`

理由：

- 这是当前前端最核心、最频繁、最容易漂移的一批 surface。

## 当前阶段结论

`PR-CPA-01` 的结论可以浓缩成 4 点：

1. 前端当前依赖的 Gateway method surface 已经足够大，不能再继续完全靠字符串维护。
2. capability 机制已经存在，但还没有被正式接入产品层。
3. TypeBox 当前只覆盖了前端控制面的一部分主线。
4. 配置主线应继续坚持 `config.*`，但要把 `config.patch` 真正扶正。

## 相关文档

- [控制面 API 重构方案](/concepts/project-control-plane-api-refactor)
- [控制面 API 实施清单](/concepts/project-control-plane-api-implementation-plan)
- [控制面 API PR 计划](/concepts/project-control-plane-api-pr-plan)
