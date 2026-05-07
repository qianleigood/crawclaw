---
title: "ESP32 Admin 页面设计"
summary: "CrawClaw Admin 中用于管理 ESP32 配对、审批、设备和低风险运维操作的设计方案"
read_when:
  - 你正在为 apps/crawclaw-admin 实现 ESP32 Admin 页面
  - 你需要 ESP32 配对与设备管理的前后端边界
---

# ESP32 Admin 页面设计

## 摘要

CrawClaw 应该在 `apps/crawclaw-admin` 中新增一个一级 `ESP32` 管理页。
这个页面不应该藏在通用 `Nodes` 页面里，也不应该硬塞进 `Channels`
页面。ESP32 这条管理面和现有 node UI 的形状不同，它同时包含渠道状态、
短时配对会话、待审批请求、已配对设备清单、在线状态以及设备声明能力。

第一版页面应当优先优化 `配对与审批`，因为这是当前用户流程仍然依赖 CLI
的地方。Admin 页面应让操作员能够发起配对会话、查看待审批请求、批准或拒绝
请求、查看已配对设备、吊销设备，并查看设备能力摘要。它应通过新的
Admin-facing RPC 层复用现有批准和配对原语，而不是让前端去模拟 CLI 命令。

第一版实现目标是已经跟踪在仓库里的 Vue Admin 应用
`apps/crawclaw-admin`，复用现有的 router、Pinia store、i18n、RPC client
以及 Naive UI 模式，风格与 `Channels`、`Nodes`、`ComfyUI` 等页面保持一致。

## 目标

- 在 CrawClaw Admin 导航中新增一个独立的 `ESP32` 路由。
- 展示 ESP32 bundled plugin 是否启用，以及其 managed MQTT broker 和 UDP
  服务是否已配置。
- 允许操作员从 Admin UI 发起一个短期配对会话。
- 展示待审批配对请求，并带上足够的元数据供操作员做批准决策。
- 允许操作员在 Admin UI 中批准或拒绝一个待配对请求。
- 展示已配对设备，包括在线/离线状态、最后上线时间和声明能力。
- 允许操作员吊销一个已配对设备。
- 展示设备详情，包括 display、affect、audio 和 tool 能力。
- 在设备已配对后，提供一小组低风险测试动作，例如发送短显示文本或下发静音状态。

## 非目标

- 第一版不在 Admin 页面中实现 ESP32 固件侧 UI。
- 第一版不暴露原始 MQTT topic 发布或 UDP packet 调试能力。
- 第一版不实现一个可以调用任意高风险工具的通用 device-tool 控制台。
- 第一版不做 OTA 升级管理。
- 第一版不做多房间、多团队或大规模 fleet 分组。
- 第一版不把现有 `Nodes` 页面改造成第二个 ESP32 运维页。
- 第一版不把该页面做成一个完整的 plugin 配置编辑器。

## 与现有代码的契合点

当前仓库已经具备 ESP32 channel 和服务端能力：

- `extensions/esp32` 已包含 pairing、MQTT、UDP、renderer、device store 和
  device registry 逻辑。
- `docs/channels/esp32.md` 已经文档化当前操作员流程：
  `crawclaw esp32 pair start --name desk`，然后执行
  `crawclaw devices approve <requestId>`。
- `apps/crawclaw-admin` 当前还没有任何 `esp32` 页面、路由或 store。
- `apps/crawclaw-admin/src/views/nodes/NodesPage.vue` 是一个通用 node 页面，
  假设的是现有 node pairing RPC 语义，应继续保持通用。
- `apps/crawclaw-admin/src/views/channels/ChannelsPage.vue` 更适合渠道配置卡片，
  不适合承载待审批设备请求或已配对设备运维。

因此当前缺口不在协议层或 plugin runtime，本质缺的是一个运维面，把现在的
CLI 配对流程变成正常的 Admin 操作流程。

## 信息架构

新增一个顶级 Admin 路由：

- path: `/esp32`
- page component: `apps/crawclaw-admin/src/views/esp32/ESP32Page.vue`
- store: `apps/crawclaw-admin/src/stores/esp32.ts`
- API types: `apps/crawclaw-admin/src/api/types/esp32.ts`

这个页面应当像 `ComfyUI`、`Channels`、`Voice` 一样，是一个一级页面，
而不是挂在 `Channels` 或 `Nodes` 之下。

页面整体应当是一个紧凑的运维工作台，而不是营销式仪表盘，结构分成四块：

1. 状态条
2. 配对工作区
3. 已配对设备清单
4. 设备详情抽屉

## 页面结构

### 1. 顶部状态条

顶部状态条应在一条横向信息带里汇总 ESP32 channel 的运行状态：

- plugin 是否启用
- managed MQTT broker 的 host 和 port
- UDP 的 host 和 port
- renderer model 摘要
- TTS provider 摘要
- 待审批配对请求数
- 在线设备数

主要动作：

- `Start Pairing Session`
- `Refresh`

这一块主要回答操作员一个问题：“当前 ESP32 channel 是否已经准备好接收新设备配对？”

### 2. 配对工作区

这是 v1 的主区域，应包含两个子面板：

- 当前活动配对会话卡片
- 待审批配对请求列表

#### 活动配对会话卡片

当操作员发起一个配对会话后，页面显示：

- 会话名
- `pairId`
- MQTT 用户名
- pairing code
- broker host 和 port
- 过期时间
- 剩余 TTL

支持的动作：

- `Copy Pairing Info`
- `Expire Now`
- `Start New Session`

v1 只需要前台展示一个活动中的会话，不必额外做一个历史会话表格。

#### 待审批配对请求列表

每个待审批请求卡片应展示：

- `requestId`
- `deviceId`
- `deviceFamily`
- `hardwareTarget`
- `fingerprint`
- 能力摘要
- 请求时间
- 来源配对会话（如果可得）

支持的动作：

- `Approve`
- `Reject`
- `Copy CLI`
- `View Raw`

`Copy CLI` 只是兜底和操作员辅助，不是主流程。正常批准应留在页面内完成。

### 3. 已配对设备清单

以紧凑列表或网格方式展示已配对设备。预期规模大约在 `10 台以内`，
因此第一版用密集列表加详情展开就够了。

每条设备记录应展示：

- 显示名，如果没有则显示 `deviceId`
- 在线或离线状态
- 最后上线时间
- device family 和 hardware target
- MQTT 当前是否在线
- UDP endpoint 是否已经学习到
- 一条紧凑能力摘要，例如 display、audio、affect、tools

支持的动作：

- `Open Details`
- `Revoke`
- `Send Test Display`
- 如果支持则显示 `Mute` 或 `Unmute`

`Revoke` 必须要求二次确认。

### 4. 设备详情抽屉

点击某个已配对设备后，使用右侧抽屉展示详情，而不是跳转到新页面。
抽屉内容包括：

- 身份信息：`deviceId`、显示名、fingerprint
- 配对元数据：配对时间、最后上线时间、是否已吊销
- 传输摘要：MQTT 用户、UDP session 就绪状态、已知 endpoint
- 支持的 affect 状态或 expression
- 支持的 LED 或 chime 标识
- 声明的 device tools 及其风险级别
- 最近命令结果或最近一次命令执行状态

这个抽屉用于让操作员在批准更广泛的使用前先理解设备形状。

## 主要用户流程

### 流程 1：发起配对会话

1. 操作员打开 `/esp32`。
2. 点击 `Start Pairing Session`。
3. 弹窗要求输入：
   - 会话名
   - TTL，默认 5 分钟
   - 可选备注
4. Admin 调用一个专用的 ESP32 pairing-start RPC。
5. UI 展示会话卡片，包含生成出来的 pairing code 和连接信息。
6. 操作员把这些字段填入实体设备的设置页面。

这个流程用来替代手动执行 `crawclaw esp32 pair start`。

### 流程 2：查看并批准配对请求

1. 设备发出 pairing hello。
2. 后端记录一条 pending request。
3. `Pairing Requests` 列表自动更新。
4. 操作员打开请求卡片并检查：
   - 目标硬件
   - device id
   - fingerprint
   - 能力摘要
5. 点击 `Approve`。
6. Admin 调用一个 ESP32 approval RPC，该 RPC 底层复用现有批准路径。
7. 请求从 pending 列表中消失，设备出现在 `Paired Devices` 中。

### 流程 3：拒绝配对请求

1. 操作员点击 `Reject`。
2. 弹出确认框。
3. 后端将请求标记为 rejected，并在可能时把拒绝状态发回临时 pairing topic。

### 流程 4：吊销已配对设备

1. 操作员打开某个设备卡片或详情抽屉。
2. 点击 `Revoke`。
3. 确认框明确说明：现有 MQTT 凭证会失效，设备需要重新配对。
4. 后端吊销该设备 token，并更新持久化状态。
5. 设备仍保留在历史列表中，但被标记为 revoked。

## 后端 RPC 设计

Admin 应用不应直接调用 CLI 命令，而应消费一组小而明确的
ESP32 专用管理 RPC。后端内部可以桥接到现有 pairing 和 approval 原语。

推荐方法：

- `esp32.status.get`
  - 返回 plugin 启用状态、broker 摘要、UDP 摘要、renderer 摘要、
    TTS 摘要、pending 数和 online 数

- `esp32.pairing.start`
  - 输入：session name、TTL、可选 note
  - 输出：`pairId`、username、pairing code、broker 摘要、expiry

- `esp32.pairing.session.expire`
  - 输入：`pairId`

- `esp32.pairing.requests.list`
  - 返回 pending 和最近已处理请求

- `esp32.pairing.request.get`
  - 返回单个请求详情，包括必要时的原始 capability 数据

- `esp32.pairing.request.approve`
  - 输入：`requestId`
  - 后端复用现有批准路径

- `esp32.pairing.request.reject`
  - 输入：`requestId`，可选拒绝原因

- `esp32.devices.list`
  - 返回从持久态和在线 registry 聚合出的 paired device 列表

- `esp32.devices.get`
  - 返回单个设备详情

- `esp32.devices.revoke`
  - 输入：`deviceId`

- `esp32.devices.command.send`
  - 只允许低风险 Admin 动作，例如测试显示或静音状态

这层 RPC 是面向页面语义设计的。前端不应需要理解 MQTT topic、
临时 pairing topic、UDP session 结构或 device store 存储布局。

## 数据模型

### Pairing Request Summary

Admin 页面需要一个持久化请求摘要，独立于原始 MQTT payload：

- `requestId`
- `pairId`
- `status`: `pending | approved | rejected | expired`
- `deviceId`
- `deviceFamily`
- `hardwareTarget`
- `fingerprint`
- `requestedAtMs`
- `resolvedAtMs?`
- `capabilities`
- `displaySupport`
- `audioSupport`
- `toolSummary`

### Paired Device Summary

- `deviceId`
- `displayName?`
- `deviceFamily`
- `hardwareTarget`
- `fingerprint`
- `pairedAtMs`
- `lastSeenAtMs`
- `online`
- `mqttOnline`
- `udpReady`
- `revoked`
- `capabilities`
- `tools`

### Device Detail

在 summary 字段基础上，再补充：

- 支持的 affect 标识
- 支持的 LED 标识
- 支持的 chime 标识
- 最近一次已知 UDP endpoint
- 最近命令结果
- 最近错误状态

## 前端状态设计

新增一个独立的 Pinia store，而不是扩展 `node.ts` 或
`channel-management.ts`。

store 内部建议拆成以下几组状态：

- `status`
- `activePairingSession`
- `pairingRequests`
- `devices`
- `selectedDeviceDetail`

这个页面是一个运维面，而不是纯配置页。复用 channel-management store
会把不相关的状态生命周期混在一起；复用 node store 则会强迫 ESP32 去伪装成
一个通用 node pairing 模型，而这和 bundled ESP32 plugin 的实际语义并不一致。

## 国际化

这个页面必须完整接入现有 Admin 的语言切换模型，不能把 `ESP32` 页面做成一个
只有英文的运维面。

要求如下：

- 路由标题、菜单名称、区块标题、按钮文案、表头、空状态、确认弹窗和错误提示
  都必须走现有 Admin i18n 消息系统。
- 当操作员在运行时切换 Admin 界面语言时，`ESP32` 页面必须正确响应。
- 设备声明出来的字面值，例如 `deviceId`、`hardwareTarget`、tool 名称、
  affect 标识和 MQTT 字段名，应保留为原始标识符，不做翻译。
- 围绕这些标识符的操作员说明文字必须本地化。
- 第一版实现至少要覆盖 `en-US` 和 `zh-CN` 两套消息，并沿用其他 Admin 页面
  现有的 message key 组织方式。

## UI 行为约束

- 使用紧凑、偏运维的布局。
- 对 `pending`、`approved`、`offline`、`revoked`、`error` 使用明确的 tag。
- 不从自由文本推断情绪或设备支持能力；只展示设备已经声明过的能力。
- 详情使用 drawer，不做多余页面跳转。
- 审批拒绝和设备吊销都要求显式确认。
- 所有低风险测试动作都应可见返回结果，不能静默失败。

## 错误处理

- 如果 ESP32 plugin 被禁用，页面应展示 setup 状态，并给出明确提示：
  需要启用 `plugins.entries.esp32.enabled`。
- 如果 managed broker 不可用，展示当前配置的 host 和 port 以及失败摘要。
- 如果配对会话在设备发起请求前就过期，应把它标记为 expired，并提示操作员重新创建。
- 如果批准失败是因为底层请求已经被处理过，应刷新请求列表并展示新状态。
- 如果某个设备在当前在线时被 revoke，行状态应立即显示为 revoked。
- 如果一个低风险命令执行失败，应在设备详情抽屉中展示结果，而不是悄悄吞掉。

## 安全与权限说明

- Approval 和 revoke 都是 operator 级动作，应要求和其他高权限设备管理动作同等级别的管理权限。
- 第一版页面不应暴露任意 `esp32_call_tool` 调用能力。
- 高风险工具仍由后端策略阻止或要求额外审批，Admin 页面不应提供绕过路径。
- 批准后不应把原始 device token 或类似敏感值展示给用户。

## 测试

后端：

- 单测配对会话创建和过期时间格式化。
- 单测 pairing request 列表归一化。
- 单测 approve/reject 对现有批准路径的适配。
- 单测 paired device 列表对 persisted device store 和 online registry 的聚合。
- 单测 revoke 行为。

前端：

- 路由测试：`/esp32` 已注册并在 CrawClaw gateway 菜单中可见。
- Store 测试：发起配对、加载请求、批准请求、吊销设备。
- 组件测试：pending request 动作和 device detail drawer 渲染。
- 手工 smoke：
  - plugin disabled 状态
  - 发起配对会话
  - pending request 出现
  - approve 后设备进入 paired list
  - revoke 后设备状态失效

## 第一版决策

- 新增一个顶级 `ESP32` Admin 页面。
- 优先做配对与审批，而不是广义设备运维。
- 通过新的 Admin-facing RPC 复用现有批准和配对内部能力。
- v1 同时包含 paired device inventory 和 revoke。
- 第一版不做高级 MQTT/UDP 调试能力。
