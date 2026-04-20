---
read_when:
  - 你要先把 Control UI 的 Stitch 设计收敛成唯一基线，再继续改代码
  - 你需要知道哪些 Stitch screen 可以保留，哪些应废弃，哪些还缺稿
summary: Control UI 在 Stitch 中的最终保留页、废弃页和缺失页清单
title: Control UI Stitch 基线清单
---

# Control UI Stitch 基线清单

这份文档的目标不是讨论实现细节，而是先把 `Stitch` 项目收敛成一份**唯一可执行的设计基线**。

除非特别说明，这份文档就是当前唯一的 canonical source of truth：

- 后续代码实现只对齐这里列出的 canonical screens
- 其他 Stitch 计划文档和差异文档只能引用这份清单，不能覆盖它
- 重复或旧版 screen 即使仍保留在 Stitch 项目里，也只视为 deprecated reference

当前结论已经更新为：

- `Stitch` 现在**已经足够作为最终设计基线**
- 但前提是**必须先冻结一份 canonical screen 清单**
- 后续如果继续改前端代码，应只对齐这里列出的 canonical screen

## 当前判断

`Stitch` 项目当前的状态是：

1. 设计覆盖面已经完整
   - 主页面
   - `Channels`
   - `Feishu` 编辑器
   - `Memory`
   - `Agent Runtime`
     都已经有可用 screen
2. 仍存在大量重复或相近变体
3. `Stitch MCP` 的写接口仍会误报失败，但服务端经常已经异步落稿

因此这份清单的作用不再是“等设计补完”，而是：

1. 冻结最终保留页
2. 标记废弃页
3. 让代码开始按固定基线对齐

## 项目

- Stitch 项目：`CrawClaw Control Plane UI v2`
- Project ID：`12343540501702426619`

## 一. 保留为最终基线的页面

下面这些 screen 应作为后续代码对齐和设计收敛的 canonical baseline。

### 主页面

- `System Overview / 系统概览`
  - `473b4ae90e254041b2d61c3d9b53b7a4`
- `Sessions & Chat / 会话控制台`
  - `73503951db59496783293ae67a71a195`
- `Channels / 渠道管理`
  - `12f4a77ed4084d6e8db8a942712da0da`
- `Workflows / 工作流运行`
  - `0e30f81937e84791838df4fa6bc9f985`
- `Agents / 智能体自省`
  - `e70176b04b3948baa9bd1df1f629c38a`
- `Usage / 用量与观察`
  - `925d43c673954d50be0c3932c93d381e`
- `Config / 审批与配置`
  - `f8b84a23a46c4d13bb99d385ab9354ea`
- `Debug / RPC 调试`
  - `fcb4503abc6c4528bcda1ba53d4769bf`

### 补齐后的新增正式页面

- `Memory / 记忆`
  - `c60336493f9948a195084d5fa65a6238`
- `Agent Runtime / 后台运行`
  - `64a8b0da28794e9dac0ec9d58dc108c5`

### Channels 专项页面

- `Channel Catalog / 渠道目录`
  - `8bac2914eaab4c04b1150d49796ed579`
- `Feishu Channel Editor / 飞书编辑器 (Final)`
  - `5963ef4c2fc6418a8f1beafd24002655`

## 二. 建议废弃或归档的页面

这些 screen 大多属于：

- 旧版本
- 重复变体
- 中途探索稿
- 文案体系已偏离最终方向的草稿

它们不该继续作为代码实现时的参考来源。

更准确地说：

- 它们可以继续保留在 Stitch 项目中作为历史材料
- 但一律只算 deprecated reference
- 不再参与实现、评审或 parity 判断

### 重复或旧版 Overview / Sessions / Channels

- `System Overview Console`
  - `4ded7c3140b94e15ad13f0ea656e5011`
- `CrawClaw System Overview`
  - `0b59289a7a704a4cacd2294791a0070d`
- `Sessions & Chat Console`
  - `7d76ed1059d04705923a6d79cd56398b`
- `Sessions & Chat Console`
  - `4822f49fa240440c9f2b3f7f30e8d377`
- `Channels Infrastructure Console`
  - `926f5d4937904208acf3217aabdb42f3`
- `Channels Management Console`
  - `7f6614cb49624de899ebf68a121e278f`
  - `07d517a7103d4ecb89c03aaed7a8fdba`
  - `bed6d7e40026494cbd019f71d93cae23`

### 重复或旧版 Feishu 编辑器

- `Feishu Channel Editor Refined`
  - `101e4ce49e5743c8b48dc76337b16b35`
- `Channel Editor — Feishu`
  - `3f0f00f32cf0485394910ca71f7a53b0`
- `Channel Editor — Feishu / 飞书编辑器`
  - `54c0d0800f864cf9a45a0f838f6944a0`
- `Feishu Channel Editor / 飞书编辑器`
  - `73f5ab54093142458246379d73734a31`
  - `91e670b08be94fd3b88abaf36f61efa5`
  - `611a98d1877e4bd7aa2e8d73e2472499`
  - `1bf756ba7b9648f3b5b2f59e835f7ca5`
  - `9c9a4adc80df4646ac70ba64def87d30`
  - `90efcd9fa52540f28723cb2d90cdda02`
  - `bfdad3b7523a4528ad45b86056bd31d8`
  - `a6d6277fc3284c9aab9a2d6565949f7f`
- `Feishu Channel Editor`
  - `298529dfbe7c4c228203155bd2a29bd5`
  - `a773d02cdd7f40debe41599e909cd6c8`

### 重复或旧版其他主页面

- `Usage & Observability Console`
  - `42ae6c5ca0224fe2aa64f9f710c0cdd9`
  - `a326c70f4f034cd291c2336b948c74da`
- `Workflows & Runtime Console`
  - `6a9896a6c3254414bf143072898b5812`
  - `7f54029aa8e041a68b1cffbc5f58ef28`
- `Agents & Introspection Console`
  - `4cedd1b083724fe8b74c67d89ec57ddf`
  - `20d1ce62f751437b8da29d0e4c74e272`
- `Approvals & Config Console`
  - `f9ff81068e7c428faec4a6bf3297dd82`
  - `52d67e91b75c42ae9dedb0e97f275856`
- `Debug & RPC Console`
  - `5c206aaf96124eeb99363df4776edecc`
  - `c9fcc9a67b0c4a9f811271bd5358fe59`

### 重复或可归档的 Memory / Runtime

- `Memory Console / 记忆控制平面`
  - `871249397a6f44ada3dea5b4678cc074`
- `Memory Console / 记忆`
  - `3bc6a0df56684ab08118db9391447e38`
- `Agent Runtime / 后台运行`
  - `1c62699ad47e43128a19b2d9c24a8a6e`

## 三. 现在还需要继续收敛的点

虽然设计覆盖已经完整，但仍然不代表所有页面都已经完全定稿。

当前仍需继续收的部分是：

### 1. 文案体系还没完全统一

当前 `Stitch` 里仍混有两套语言：

- 偏工程化：
  - `Console`
  - `Introspection`
  - `Infrastructure`
  - `RPC`
- 偏产品化：
  - `新增渠道`
  - 更用户向的说明文案

### 2. 控件系统还没统一成最终版

尤其是：

- 输入框
- 下拉
- 分段按钮
- 步进器
- 数组编辑
- 右侧状态卡

这些在不同 screen 里的成熟度不一致。

### 3. 空态、错误态、加载态还不够完整

目前大多数 screen 更像高保真结构稿，而不是完整的产品交互稿。

### 4. `Channels + Feishu Editor` 仍需一轮最终收敛

虽然现在已经有了更适合的中文最终稿，但这条线仍然是最需要继续精修的区域：

- 字段级文案还不够统一
- 中英混排不彻底
- 仍有示例值和技术提示偏重的问题
- 右侧栏的信息减重还可以继续做

## 五. 后续执行规则

在 `Stitch` 设计收敛后，后续也不应再任意切换基线。

执行规则应该固定为：

1. 只以上面列出的 canonical screens 为参考
2. 不再使用已废弃或重复变体做代码比对
3. 不再继续补缺页，改为对现有 canonical screens 做最终收敛
4. `Channels + Feishu Channel Editor` 仍然是当前最优先的精修对象

## 六. 推荐收敛顺序

建议按下面顺序继续完善 Stitch：

1. `Channels / 渠道管理`
2. `Channel Catalog / 渠道目录`
3. `Feishu Channel Editor / 飞书编辑器 (Final)`
4. `System Overview / 系统概览`
5. `Sessions & Chat / 会话控制台`
6. `Memory / 记忆`
7. `Agent Runtime / 后台运行`
8. 其他主页面统一控件和文案

## 七. 结论

当前最准确的判断已经更新为：

- `Stitch` 现在**已经足够作为代码对齐基线**
- 当前主问题不再是“缺页”，而是“重复稿太多，必须冻结 canonical screens”
- 后续可以开始代码对齐，但只能以上面这份 canonical 清单为准

一句话：

**先冻结基线，再按基线对齐代码。**
