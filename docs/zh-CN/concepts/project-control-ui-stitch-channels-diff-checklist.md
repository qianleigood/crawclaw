---
read_when:
  - 你要先收敛 Stitch 的 Channels 设计，再继续改代码
  - 你需要逐页检查 Channels / 渠道目录 / Feishu 编辑页和 Stitch 的差异
summary: Channels 三张关键 Stitch 页面与当前实现的逐页差异清单
title: Control UI Stitch Channels 差异清单
---

# Control UI Stitch Channels 差异清单

> 说明：当前唯一的 canonical screen 清单以 `project-control-ui-stitch-baseline.md` 为准。本文是 Channels 专项差异分析文档；如果提到旧 screen 名称，只表示历史稿或中间稿，不再作为实现与评审基线。

这份文档只覆盖当前最优先的三张 Stitch 页面：

- `Channels / 渠道管理`
- `Channel Catalog / 渠道目录`
- `Feishu Channel Editor / 飞书编辑器 (Final)`

目标不是再次讨论方向，而是明确：

- 当前实现已经对上的部分
- 仍然没有对上的部分
- 后续应该按什么顺序继续收

## 当前前提

当前 Stitch 项目的读接口可用：

- `list_screens`
- `get_screen`

但写接口仍不稳定：

- `edit_screens`
- `generate_screen_from_text`

因此这份文档的作用是：

1. 先把差异固定下来
2. 等 Stitch 写接口恢复后，按这里逐项收敛

---

## 一. `Channels / 渠道管理`

### 当前实现已经对上的部分

- 已经从“全局登录块”改成了以渠道为中心的页面
- 页面主目标已经收成：
  - 看当前渠道
  - 编辑现有渠道
  - 新增渠道
  - 看账号
- 已经去掉“先选下一步”的复杂 workspace chooser
- 渠道目录卡已经减重，不再堆太多动作 chips

代码位置：

- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts)
  - `renderChannels()`：`4814`

### 仍未对上的部分

#### 1. 页头和主结构还偏“状态面板”，不够像 Stitch 那种更克制的管理页

当前实现仍保留：

- 顶部 `renderPageHeader("channels", ...)`
- 目录页顶部再放一组 metrics band

见：

- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts:5810)
- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts:5836)

问题：

- 信息密度仍然偏高
- 第一屏仍然更像控制台 dashboard，而不是简洁的渠道管理页

#### 2. 选中渠道后的详情区仍然有偏重的“摘要 + 建议动作”结构

当前详情区保留：

- `renderSummaryPanel()`
- `renderAccountsPanel()`
- `renderSetupPanel()`
- `renderCatalogOnlyPanel()`

见：

- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts:4919)
- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts:5207)
- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts:5049)
- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts:4973)

问题：

- 区块仍然偏多
- Stitch 稿更强调“当前渠道 + 当前可执行动作”，而不是同时摆很多解释性模块

#### 3. `setup` 区块还没有彻底降级

虽然已经不再是独立工作台，但 `renderSetupPanel()` 仍存在完整的一块面板。

问题：

- 对小白用户仍然会产生“我是不是还要先走一个 setup 流”的感觉
- 和 Stitch 更简洁的频道管理基线相比，还是过于复杂

### 建议收敛目标

`Channels / 渠道管理` 的最终状态应该是：

- 顶部只有一层轻量标题和少量关键指标
- 主体以“渠道列表 + 当前渠道详情”为中心
- 详情区只突出：
  - 当前状态
  - 账号
  - 主动作
- `setup` 和 `guide` 应继续弱化

---

## 二. `Channel Catalog / 渠道目录`

### 当前实现已经对上的部分

- 已经从“沿用当前渠道工作流”改成独立新增目录页
- 已经不再错误复用当前已选的 Feishu 渠道
- 已经列出 `catalogOrder` 里的渠道，而不是只看当前已接入渠道
- 已接入和未接入渠道都能在同一个目录里被看见

代码位置：

- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts:5010)
- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts:5094)

### 仍未对上的部分

#### 1. 已接入渠道和可新增渠道还没有做成足够清晰的双层关系

当前目录页仍然只是一个统一网格：

- `addChannelIds`
- `renderCatalogCard(...)`

见：

- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts:5008)
- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts:5094)

问题：

- Stitch 方向更适合明确区分：
  - 已接入的渠道
  - 可以新增的渠道
- 现在仍然需要靠 badge 和按钮文案自己猜状态

#### 2. 卡片还不够像“选择目录”，仍然偏“动作卡”

当前卡片里包含：

- 状态
- 账号数
- 问题数
- 推荐动作
- 多个按钮

问题：

- 仍偏操作台卡片，而不是选择目录卡片
- Stitch 基线更强调“易于浏览和比较”，而不是卡内直接塞太多动作

#### 3. `新增账号` 与 `新增渠道` 还混在同一层心智里

当前逻辑里：

- 已接入且多账号渠道，会出现 `新增账号`
- 未接入渠道，会出现 `开始配置` / `查看说明`

问题：

- 这对专业用户合理
- 但对第一次接触的用户，仍然容易把“给现有渠道加账号”和“新增一个渠道”混在一起

### 建议收敛目标

`Channel Catalog / 渠道目录` 最终应更接近：

- 首先是一个“选择你要接入哪种渠道”的页面
- 已接入渠道作为次级分组显示
- 频道卡主要解决“识别和选择”，不是承担太多动作

---

## 三. `Feishu Channel Editor / 飞书编辑器 (Final)`

### 当前实现已经对上的部分

- 已经改成左侧主表单 + 右侧栏
- 已经把表单拆成分区：
  - 基础设置
  - 登录与凭据
  - 账号与目标位置
  - 回复与行为
  - 高级选项
- 右侧已经把：
  - `保存与应用`
  - `当前状态`
  - `命令与参考`
  - `技术详情`
    这些区块做了层级区分
- 分区标题和说明已经改成中文

代码位置：

- [channels.config.ts](/Users/qianlei/crawclaw/ui/src/ui/views/channels.config.ts:49)
- [channels.config.ts](/Users/qianlei/crawclaw/ui/src/ui/views/channels.config.ts:295)
- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts:5576)

### 仍未对上的部分

#### 1. 它本质上仍然是 schema 分组渲染，不是 Stitch 那种更手工编排的编辑页

当前关键逻辑仍然是：

- `classifyChannelField(...)`
- `collectChannelEntries(...)`
- `renderChannelConfigSectionGroup(...)`

见：

- [channels.config.ts](/Users/qianlei/crawclaw/ui/src/ui/views/channels.config.ts:115)
- [channels.config.ts](/Users/qianlei/crawclaw/ui/src/ui/views/channels.config.ts:174)
- [channels.config.ts](/Users/qianlei/crawclaw/ui/src/ui/views/channels.config.ts:249)

问题：

- 仍然受 schema 和 hint 驱动
- 不是 Feishu 场景专门编排过的编辑器
- 因此仍会出现：
  - 字段顺序不够自然
  - `Unsupported schema node` 之类的兜底表达

#### 2. 右侧栏还是比 Stitch 目标更重

当前右侧栏有 4 块：

- 保存与应用
- 当前状态
- 命令与参考
- 技术详情

见：

- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts:5632)
- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts:5703)
- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts:5740)
- [app-root.ts](/Users/qianlei/crawclaw/ui/src/ui/rewrite/app-root.ts:5761)

问题：

- Stitch 基线里最强的右栏只需要：
  - `保存与应用`
  - `当前状态`
- 另外两块应该更弱、更后置，甚至不该默认出现在第一屏

#### 3. 控件风格虽然已经改善，但还没有完全达到 Stitch 的平直感

当前控件已经比旧版好，但仍然存在：

- 面板层级较多
- 卡片感偏重
- 控件边框和容器关系还不够利落

问题：

- 更像“整理过一轮的代码表单”
- 还不像 Stitch 那种“最终产品设置页”

#### 4. 字段级本地化和说明还不够彻底

虽然分区标题已中文化，但当前字段仍然依赖 schema/uiHints 原始信息。

问题：

- 某些字段标签和帮助说明仍会保留英文
- 这与 Stitch 最终目标不一致

### 建议收敛目标

`Feishu Channel Editor / 飞书编辑器 (Final)` 最终应继续朝这几条收：

1. 左侧主表单继续手工编排
2. 右侧只保留两块强信息：
   - 保存与应用
   - 当前状态
3. `命令与参考` 和 `技术详情` 继续弱化
4. 字段级标签、帮助说明、空态全部中文化
5. 尽量减少 schema-driven 的“通用表单感”

---

## 四. 优先级排序

如果后续要继续按 Stitch 收敛，这三张的执行顺序建议固定为：

1. `Feishu Channel Editor / 飞书编辑器 (Final)`
2. `Channel Catalog / 渠道目录`
3. `Channels / 渠道管理`

原因：

- 编辑页最影响质感和可用性
- 新增渠道页最影响首次使用体验
- 管理页最后再整体减重和统一

---

## 五. 当前结论

这三张页面的当前状态可以概括为：

- 结构方向已经大致对上
- 但还没有达到真正的 Stitch parity

更准确地说：

- `Channels / 渠道管理`
  - 还偏重，仍像控制台管理页
- `Channel Catalog / 渠道目录`
  - 已经可用，但还不够像一个真正简单的渠道选择目录
- `Feishu Channel Editor / 飞书编辑器 (Final)`
  - 已经明显进步，但仍然不是最终产品级编辑器

一句话：

**方向对了，但还没完全对齐。**
