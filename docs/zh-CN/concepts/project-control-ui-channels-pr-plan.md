---
summary: 把 Channels 从“全局登录面板”重构成“按渠道、账号、能力组织的管理界面”的 PR 计划
title: Control UI Channels 模块 PR 计划
---

# Control UI Channels 模块 PR 计划

这份文档对应的是一轮**把 Channels 页面重构成真正可管理多渠道、多账号、可编辑配置的产品界面**的 PR 计划。

目标不是继续修补现在这块“登录与修复”面板，而是把 `Channels` 变成：

- 按渠道组织
- 按账号展示
- 按能力渲染动作
- 支持渠道配置编辑

一句话：

**做一个“渠道与账号管理界面”，而不是一个“全局登录面板”。**

## 结论先说

当前 `Channels` 页最大的问题，不是文案，而是模型错位。

现在 UI 之所以总显得不对，是因为后端暴露出来的“登录能力”本身是：

- 全局 `channels.login.start`
- 全局 `channels.login.wait`

而不是：

- 针对某个渠道
- 某个账号
- 某个登录流程

这导致 UI 只能在页面里放一个“全局登录与修复”区域，然后再用文案去解释它其实更接近 `WhatsApp Web`。

这条路不应该再继续修下去。

这一轮 PR 的正确目标是：

1. 把 `Channels` 的前台模型从“全局面板”改成“渠道 -> 账号 -> 动作”
2. 把登录、验证、重连、退出、编辑等动作全都变成**按渠道/账号执行**
3. 把渠道配置编辑从全局 `Config` 页抽成**渠道级编辑面板**

## 为什么当前设计不成立

### 1. UI 假装这是多渠道通用登录

现在页面里那块“登录与修复”，在产品表达上看起来像：

- 所有渠道都共用一块登录区
- 所有渠道都能走同一套登录流程

但事实不是这样。

### 2. 后端这条能力本身是单 provider 级别

当前控制面登录能力在：

- [web.ts](/Users/qianlei/crawclaw/src/gateway/server-methods/web.ts)

关键逻辑是：

- `resolveWebLoginProvider()`
- 它会从 `listChannelPlugins()` 里找**第一个**暴露 `web.login.start / wait` 的插件

也就是说，当前这条 API 的真实语义是：

- “找一个支持网页登录的渠道 provider”

而不是：

- “对某个具体渠道/账号启动登录”

### 3. 这让 UI 永远没法对齐真实能力

所以现在无论文案写：

- `登录与修复`
- `WhatsApp Web 登录`
- `浏览器登录`

都只是止血，不是正确架构。

## 当前代码现实

这一轮设计必须贴着当前项目的可实现边界来做。

### 已有能力

#### 1. `channels.status` 已经有不错的基础结构

当前 `channels.status` 已经会返回：

- `channelOrder`
- `channelLabels`
- `channelDetailLabels`
- `channelSystemImages`
- `channelMeta`
- `channels`
- `channelAccounts`
- `channelDefaultAccountId`

见：

- [channels.ts](/Users/qianlei/crawclaw/src/gateway/server-methods/channels.ts)

这意味着：

- UI 已经能拿到渠道目录
- 已经能拿到各渠道账号快照
- 已经有按账号渲染列表的基础

#### 2. channel plugin 已经有配置与账号抽象

当前各渠道插件已经普遍具备这些能力：

- `listAccountIds`
- `resolveAccount`
- `isConfigured`
- `configSchema`
- `uiHints`
- `setupWizard`

这些能力散布在：

- `extensions/*/src/channel.ts`
- `extensions/*/crawclaw.plugin.json`

这说明：

- “按渠道编辑配置”不是从零开始
- 底层 schema 和 UI hints 已经有不少资产

#### 3. 部分账号动作已经存在

例如：

- `channels.logout`

当前后端已经能按：

- `channelId`
- `accountId`

执行退出动作。

见：

- [channels.ts](/Users/qianlei/crawclaw/src/gateway/server-methods/channels.ts)

这说明：

- 按渠道/账号执行动作，本身是成立的
- 只是登录链还没拆成同样粒度

### 仍然缺的

#### 1. 渠道能力模型没有正式暴露给前端

现在前端能看到状态，但还不能稳定知道：

- 这个渠道支不支持二维码登录
- 支不支持 OAuth
- 支不支持重连
- 支不支持退出
- 支不支持编辑
- 支不支持多账号

这导致 UI 只能硬编码推断。

#### 2. 登录动作不是按渠道/账号工作

这也是当前最核心的架构问题。

#### 3. 渠道编辑没有正式控制面 API

虽然插件侧已经有 `configSchema / uiHints / setupWizard`，但浏览器控制面还没有一套正式的：

- `channels.config.get`
- `channels.config.schema`
- `channels.config.patch`
- `channels.config.apply`

## 这轮 PR 的定位

建议把这轮收成：

- `PR-UI-C1`

它不是简单样式修正，而是：

- 一轮 `Channels` 的信息架构与控制面接口重构

它和已经完成的：

- `Control UI Stitch 重写`
- `Control UI 产品化重构`

是下一层补全关系。

## 正确的数据模型

这一轮必须先把 UI 和 API 的基本模型对齐。

### 1. Channel

表示一个渠道类型，例如：

- `feishu`
- `whatsapp`
- `telegram`
- `slack`

### 2. Account

表示这个渠道下的一个具体账号或实例，例如：

- 一个 WhatsApp 账号
- 一个 Slack workspace 连接
- 一个 Feishu app account

### 3. Capability

表示某个渠道/账号支持哪些动作，例如：

- `qrLogin`
- `oauthLogin`
- `logout`
- `reconnect`
- `verify`
- `editConfig`
- `multiAccount`

### 4. Action

表示用户在 UI 里能直接执行的操作，例如：

- 登录
- 检查结果
- 重连
- 退出
- 验证
- 编辑配置

没有这四层拆分，`Channels` 就只能继续是一个混乱页面。

## 页面结构应该怎么改

`Channels` 应该变成一个真正的“渠道与账号管理台”。

### 顶部摘要

建议固定 4 个：

1. `已启用渠道`
2. `需要处理`
3. `已连接账号`
4. `最近检查`

这些指标要来自真实 `channels.status` 聚合，不再出现全局登录状态概念。

### 主区第一层：渠道卡片网格

每个渠道一张卡，不再把所有渠道塞进一条列表和一个全局动作框。

渠道卡需要显示：

- 渠道名
- 简短说明
- 已配置 / 未配置
- 已连接账号数
- 是否有异常
- 最近检查时间
- 支持的动作摘要

例如：

- `WhatsApp`
  - 支持：二维码登录、退出、检查结果、编辑
- `Slack`
  - 支持：验证、重连、编辑
- `Telegram`
  - 支持：编辑、验证

### 主区第二层：渠道详情

点开某个渠道后，显示：

- 左侧：账号列表
- 中间：账号详情
- 右侧：动作与编辑入口

#### 账号列表

每条账号显示：

- 账号显示名
- 状态
- 最近活动
- 最近检查
- 是否需要修复

#### 账号详情

显示：

- 状态摘要
- 连接信息
- 最近 inbound / outbound
- 最近 probe
- 最近错误
- 配置摘要

#### 动作区

按能力渲染，不再写死：

- `开始登录`
- `检查结果`
- `重新连接`
- `验证`
- `退出`
- `编辑`

## 渠道编辑应该怎么做

渠道编辑不应该继续只靠全局 `Config` 页。

正确做法是：

- `Channels` 页内打开侧边编辑面板

### 编辑面板内容

顶部：

- 渠道名
- 账号名
- 当前状态

主体：

- schema 驱动表单
- 按 `configSchema + uiHints` 渲染

底部动作：

- `保存`
- `应用`
- `验证`
- `重连`

提示区：

- 这次改动是否需要：
  - reload
  - reconnect
  - restart

### 为什么这样更对

因为用户心智会更清楚：

- 去 `Channels` 管渠道和账号
- 去 `Config` 管全局系统配置

## 控制面 API 应该怎么补

### A. 保留但降级旧接口

保留：

- `channels.login.start`
- `channels.login.wait`

但它们应标成兼容层，不再作为前端主路径。

### B. 新增按渠道/账号的动作接口

建议新增：

- `channels.account.login.start`
- `channels.account.login.wait`
- `channels.account.logout`
- `channels.account.verify`
- `channels.account.reconnect`

参数统一形态：

```ts
type ChannelsAccountTarget = {
  channel: string;
  accountId?: string | null;
};
```

例如：

```ts
type ChannelsAccountLoginStartParams = ChannelsAccountTarget & {
  force?: boolean;
  timeoutMs?: number;
};
```

### C. 新增能力接口

建议：

- `channels.capabilities`

返回：

- 渠道级能力
- 账号级能力
- 可用动作

例如：

```ts
type ChannelAccountCapabilities = {
  qrLogin: boolean;
  oauthLogin: boolean;
  logout: boolean;
  reconnect: boolean;
  verify: boolean;
  editConfig: boolean;
  multiAccount: boolean;
};
```

如果不想单独新开 method，也可以先把它并进 `channels.status`。

### D. 新增渠道配置编辑接口

建议：

- `channels.config.get`
- `channels.config.schema`
- `channels.config.patch`
- `channels.config.apply`

其中：

- `schema` 应复用插件已有的 `configSchema + uiHints`
- `patch` 要支持按渠道/账号 scope 写入
- `apply` 要返回：
  - `none`
  - `reload`
  - `reconnect`
  - `restart`

### E. 可选补充：setup surface

如果插件已经提供 `setupWizard / setupSurface`，可再补：

- `channels.setup.surface`

这样 UI 可以在“未配置”状态下直接渲染引导表单，而不是只给一个空卡片。

## Feishu CLI 不属于这里

需要明确：

- `Feishu CLI`
- 以及未来同类的用户工具授权

不属于 `Channels`。

它们应该放在：

- `Agents` 下的 `Connected accounts`
- 或未来单独的 `Accounts / Connected Apps`

`Channels` 只放真正的消息 transport。

## 第一版实施顺序

### Phase 1

先做最关键的结构修正：

- `Channels` 页面改成渠道卡片 + 账号列表结构
- `channels.status` 增加 capability / action summary
- 前端去掉全局登录面板

这一阶段先不做完整编辑 drawer。

当前状态：

- 已完成
- 已落地渠道卡片、账号列表、账号详情和按能力渲染动作
- 已把“全局登录与修复”改成按渠道/账号的页面结构

### Phase 2

补按渠道/账号执行的动作接口：

- `channels.account.login.start`
- `channels.account.login.wait`
- `channels.account.verify`
- `channels.account.reconnect`
- `channels.account.logout`

UI 改成按渠道/账号显示按钮。

当前状态：

- 已完成
- 已落地：
  - `channels.account.login.start`
  - `channels.account.login.wait`
  - `channels.account.verify`
  - `channels.account.reconnect`
  - `channels.account.logout`
- UI 已改成对选中渠道/账号执行动作，不再走全局登录面板

### Phase 3

补渠道编辑：

- `channels.config.get / schema / patch / apply`
- 前端编辑侧栏

当前状态：

- 已完成
- 已落地：
  - `channels.config.get`
  - `channels.config.schema`
  - `channels.config.patch`
  - `channels.config.apply`
- `Channels` 页面已经切到独立的渠道配置状态
- 渠道编辑不再复用全局 `ConfigState`

### Phase 4

补 setup surface：

- 未配置渠道的引导页
- 多账号新增/切换

当前状态：

- 已完成
- 已落地：
  - `channels.setup.surface`
  - `Channels` 页面里的 setup surface
  - 多账号渠道的默认账号切换
  - 多账号渠道的新增账号草稿入口

## 非目标

这一轮不做：

- Feishu CLI / 用户工具授权页
- 重做整个 `Config` 页
- 所有渠道 setup wizard 的统一视觉重写
- 跨渠道统一登录流程抽象到 OAuth 中心

这些可以留给后续单独 PR。

## 验收标准

这轮完成后，应该达到：

1. `Channels` 页面不再有一个误导性的全局“登录与修复”面板
2. 用户能看出每个渠道有哪些账号、哪些状态、哪些动作
3. 登录/验证/重连/退出至少有一部分已经能按 `channel + accountId` 工作
4. UI 不再把 WhatsApp 特例伪装成全渠道通用能力
5. 渠道编辑已经有清晰的控制面 API 方向和页面入口

## 建议提交信息

如果按阶段拆：

- `refactor: redesign channels ui around channel accounts`
- `feat: add channel account control plane actions`
- `feat: add channel config editing to control ui`

如果收成一轮：

- `feat: redesign control ui channels management`
