# 渠道设置编辑器 Web Awesome 重设计

## 概述

将 `Channels` 的设置与账号编辑子流，重构为基于成熟组件库的多账号编辑器。

这份设计替代上一版“仅做标签页重组”的基线。上一版虽然改善了信息架构，但仍然依赖手写控件，并且没有正确表达 Feishu 这类“每个账号拥有独立 `appId` / `appSecret`”的真实编辑模型。

这次新基线保持同样的范围约束：

- 只重做 `Channels` 的设置 / 账号编辑子流
- 不重做管理表格和渠道目录

这次新基线核心改两件事：

- 在这条子流中引入 `Web Awesome` 作为主要控件层
- 把“账号编辑”提升为一等编辑器，而不是“账号列表 + 默认账号切换”

## 真源

这份文档取代 `docs/superpowers/specs/2026-04-20-channels-settings-editor-redesign-design.md`，成为 `Channels` 设置 / 账号编辑子流的新 canonical spec。

旧文档保留作为历史上下文，但后续实现应以本文件为准。

## 目标

- 用成熟组件系统替换当前手写编辑器控件
- 让 tabs、表单、动作区、账号编辑在视觉和交互上统一
- 正确表达多账号渠道，包括每个账号独立的凭据和默认账号
- 让非技术用户也能看懂并完成基本设置
- 在现有后端能力足够时优先复用，不为重做而重做协议
- 不扩散到其他 Control UI 页面

## 非目标

- 不重做 `Channels` 管理页
- 不重做 `Channel Catalog`
- 不一次性把整个 Control UI 迁移到新组件库
- 不在没有阻塞的前提下重写后端配置协议

## 问题定义

当前编辑器有三个核心问题。

### 1. 控件层视觉质量太弱

现在的 tab 只是裸 `button`，大部分输入控件和状态块也都是手写样式。它们“能用”，但没有生产级设置页面应该有的质量、一致性和交互细节。

这也是为什么即使信息结构比以前清楚了，页面看起来仍然像“手搓面板”。

### 2. 多账号渠道没有被正确表达

后端已经支持：

- 一个渠道下多个账号
- 每个账号独立运行时快照
- `defaultAccountId`

但当前 `Accounts` tab 本质上更像账号清单，而不是账号编辑器。它可以展示账号、切默认账号，但没有真正的“当前账号编辑面”。

这对 Feishu 这类渠道是错误的。不同账号必须可以持有不同的值，例如：

- `appId`
- `appSecret`
- `encryptKey`
- `verificationToken`

当前 UI 的表现方式，会把一个本来支持多账号的渠道，误导成“几乎只有一个账号”。

### 3. 可读性仍然被 raw schema 体验拖累

上一版虽然做了字段分组，但整体还是 schema form 主导。对普通操作用户来说，仍然缺少足够强的结构、字段解释和高质量控件支撑。

## 现有能力证据

当前代码库在协议层和网关层已经支持多账号数据。

- `src/gateway/protocol/schema/channels.ts`
  - `channelAccounts`
  - `channelDefaultAccountId`
- `src/gateway/server-methods/channels.ts`
  - 生成 `ChannelAccountSnapshot[]`
  - 输出 `channelAccounts`
  - 输出 `defaultAccountId`

所以多账号问题主要是 UI / 编辑模型问题，不是后端没有能力。

## 组件库决策

### 推荐方案

在 `Channels` 设置 / 账号编辑子流中采用 `Web Awesome`。

参考：

- [Web Awesome](https://webawesome.com/)
- [Components](https://webawesome.com/docs/components)

### 备选方案

#### Spectrum Web Components

优点：

- 可访问性成熟
- 企业后台风格控件质量高
- 基于 Lit，和现有技术栈兼容

缺点：

- 视觉风格更重
- 和当前这套“运营控制台但仍然现代”的目标不完全贴合
- 接入成本略高于本次目标

#### FAST

优点：

- 标准化程度高
- design token 能力强

缺点：

- 更偏底层基础设施
- 为了避免“通用基础控件”观感，需要补更多样式工作

### 为什么选 Web Awesome

`Web Awesome` 最适合这次任务，因为：

- 它在维护中，而不是 sunset 状态
- 它本身就是基于 web components
- 它覆盖了这条子流最需要的控件：tabs、input、select、button、badge、card、dialog、layout
- 不需要切换框架，就能明显提升视觉和交互质量

## 采用范围

这次只在 `Channels` 设置 / 账号编辑子流里采用 `Web Awesome`。

不要求整个 Control UI 一次迁过去。

也就是说：

- 现有 Control UI shell 保持不动
- 现有 route 结构保持不动
- `channels` 编辑器内容区成为第一块正式引入组件库的编辑面

## 信息架构

route 和 `channelId` 的上下文保持不变。

编辑器内部仍然保留四个 tab：

- `Overview`
- `Accounts`
- `Settings`
- `Advanced`

但每个 tab 的职责会更明确，且统一使用更成熟的控件体系。

### Overview

目的：

- 在编辑前先让用户理解当前渠道状态

内容：

- 渠道名称和类型
- 当前状态
- 已配置账号数
- 已连接账号数
- 默认账号
- 最近检查时间
- 最近一次保存 / 应用摘要

行为：

- 不放重型可编辑表单
- 只放轻量导航动作，例如跳到 `Accounts` / `Settings`

### Accounts

目的：

- 完整管理某个渠道下的账号级配置

这是本次 redesign 最重要的变化。

`Accounts` tab 改成双栏编辑器：

- 左边：账号列表
- 右边：当前选中账号编辑器

左边列表展示：

- 显示名
- `accountId`
- 状态 badge
- 默认账号 badge
- 最近检查时间
- 新增账号动作

右边编辑器只负责当前账号，并且所有账号级凭据只在这里编辑。

对于 Feishu 这类渠道，右边必须支持每个账号独立配置：

- `appId`
- `appSecret`
- `encryptKey`
- `verificationToken`

UI 必须明确区分“渠道级配置”和“账号级配置”，不能让用户混淆。

### Settings

目的：

- 只编辑渠道级配置

规则：

- 不展示 raw `accounts` 字段
- 当账号管理器启用时，不展示 raw `defaultAccount`
- 不在这里编辑账号凭据

这个 tab 只负责渠道共有行为和操作级选项，并按照用户任务做分组。

### Advanced

目的：

- 放低频、危险、技术性更强的选项

规则：

- 视觉上和普通设置页明显区分
- 危险动作必须确认

## 布局

### Header

编辑器头部保持稳定，包含：

- 返回渠道工作区
- 渠道名称
- 渠道类型 / detail
- 状态 badge

旧的重复摘要模式不能再回流。

### 共享状态条

header 下保留一条共享提交状态条。

它负责表达：

- clean
- dirty
- saving
- applying
- error
- 最近一次成功 save / apply 时间
- 最近一次失败原因

这条状态条在所有 tab 上共享。

### Tab Strip

用 `Web Awesome` tabs 替换当前裸按钮 tabs。

采用：

- `wa-tab-group`
- `wa-tab`
- `wa-tab-panel`

要求：

- active 态更清晰
- keyboard / focus 行为更好
- 层级和间距更合理
- 在必要时支持图标

### Accounts Tab 布局

使用 split layout 或双栏布局，替代当前单块列表。

桌面端：

- 左栏固定或窄流体宽度作为账号导航
- 右栏作为主编辑面

移动端：

- 上下堆叠
- 账号导航退化成顶部列表或分段选择

### Settings Tab 布局

使用 card / section 组织表单，强化阅读节奏。

每个 section 包含：

- section 标题
- 一句目的说明
- 分组字段

低频组允许折叠。

## 控件系统

### Tabs

使用 `Web Awesome` tabs。

现有 raw button tabs 必须移除。

### 表单控件

优先使用 `Web Awesome` 已有控件：

- text input
- textarea
- select
- radio group
- switch
- button
- dialog
- badge / tag 类状态控件

如果当前 schema renderer 不能直接使用 `Web Awesome` 控件，就增加一层薄 adapter，让最终可见控件仍然是库组件，而不是继续暴露原始自制控件。

## 视觉方向

编辑器应该像“高质量运营控制台”，而不是营销站，也不是调试面板。

原则：

- 信息密度高但可读
- 字段分组强
- focus 和状态高对比
- 克制使用强调色
- tabs 和主动作区有明确设计感
- 摘要、列表、表单之间的层级清楚

## 数据模型与编辑规则

### 渠道级与账号级拆分

编辑器必须明确拆分：

- channel-level config
- account-level config

渠道级值放在 `Settings`。

账号级值放在 `Accounts`。

对于 schema 里暴露账号集合的渠道，编辑器必须把这些字段映射到账号编辑器里，而不是把整个对象直接暴露成通用 object form。

### 默认账号

`defaultAccount` / `defaultAccountId` 仍然是渠道级概念，但在 UI 上放在 `Accounts` tab 中编辑，因为只有在账号上下文里，用户才能理解自己在切什么。

账号导航区必须清楚表达：

- 当前哪个账号是默认账号
- 如何切换默认账号

### 账号草稿

新增账号草稿仍然支持，但入口只能放在 `Accounts`，不再混到 `Settings`。

新增草稿后：

- 立刻出现在账号列表
- 自动成为当前选中账号
- 右侧编辑器自动聚焦到最重要的必填字段

## 提交流程

共享状态条继续作为唯一的编辑状态真源。

### 动作

- `Save`
- `Apply`
- `Reload`
- `Reset edits`

### 规则

- `Save` 保存当前草稿
- `Apply` 作为主动作，强调立即生效
- `Reload` 在 dirty 时必须确认
- `Reset edits` 只丢弃未保存本地改动

### Dirty State

以下两部分的变化都必须汇总到同一份 dirty state：

- 当前账号编辑器
- 当前渠道设置编辑器

tab 切换绝不能丢改动。

## 可读性要求

每个用户可见字段都必须有：

- 人话标签
- 一句 plain-language 解释
- 必要时才展开的技术说明

不能把 placeholder 当文档。

不能直接把 raw schema key 作为主标签，除非它本身就足够清楚。

例如：

- 显示 `默认发送账号`，而不是 `defaultAccount`
- 显示 `App ID`、`App Secret`、`Verification Token`，并说明它们分别在什么情况下需要修改

## 组件库接入策略

采用方式必须局部、渐进。

### 初始包范围

只在 `ui/package.json` 中加入 `Web Awesome`。

只按需引入这条子流真正需要的组件。

不要一次性引入整库自动注册。

### 样式策略

- 以 `Web Awesome` theme + 组件样式为基线
- 只在必要处加本地 token / class 让它贴近 CrawClaw 当前暗色运营控制台方向
- 不要保留旧 tab/button/input 的手写视觉并行存在

### Adapter 策略

对于当前 schema renderer 假设原生 input 或本地 primitive 的位置，引入窄适配层，不一次性重写整个表单系统。

## 测试

必须覆盖：

- controller 层 dirty / apply / save / reset 状态
- tab 渲染与切换的 browser tests
- 多账号编辑流的 browser tests
- 验证账号级凭据只在 `Accounts` 编辑、不在 `Settings` 出现
- 默认账号切换
- `pnpm --dir ui build`

## 迁移步骤

推荐按这个顺序实现：

1. 在 `ui` 中加入 `Web Awesome` 依赖和最小 bootstrap
2. 先替换 tab strip
3. 重建 `Accounts` 为“导航 + 账号编辑器”
4. 把账号字段从 `Settings` 中移除
5. 调整共享状态条和动作区样式
6. 逐步替换这条子流里剩余手写控件
7. 用真实浏览器对稿并继续收细节

## 风险

### 风险：schema 到账号编辑映射变得模糊

缓解：

- 维护明确的账号字段映射规则
- 当渠道 schema 不符合已知模式时，安全回退，不静默吞字段

### 风险：局部引入组件库导致视觉混搭

缓解：

- 这次采用的是整个子流一起替换，而不是只换一个 widget
- tabs 和主表单控件一起换

### 风险：账号编辑重做破坏 save/apply 语义

缓解：

- controller 状态继续集中管理
- 后端调用保持不变
- 为草稿、新增账号、save、apply、reload、默认账号切换补回归

## 验收标准

满足以下条件才算完成：

- tabs 不再像裸按钮
- 编辑器主要控件来自成熟组件库
- 多账号渠道可以为不同账号编辑不同凭据
- `Settings` 不再错误地把账号凭据表现成渠道全局配置
- 账号列表与账号编辑器清楚分开
- 非技术用户也能看懂这页
- 浏览器对稿确认视觉与交互质量明显提升
