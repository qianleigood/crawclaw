---
read_when:
  - 构建或调试原生 CrawClaw 插件
  - 理解插件能力模型或所有权边界
  - 从事插件加载管道或注册表工作
  - 实现非 LLM 提供商能力
sidebarTitle: Internals
summary: 插件内部机制：能力模型、所有权、契约、加载管道和运行时辅助函数
title: 插件内部机制
x-i18n:
  generated_at: "2026-06-10T18:15:58Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: bc40bbd9db0bfb92832bebd4c56b0c8340351b493fc3be9119ef979d255b17a4
  source_path: plugins/architecture.md
  workflow: 15
---

# 插件内部机制

<Info>
  这是**深度架构参考**。如需实用指南，请参阅：
  - [安装和使用插件](/tools/plugin) — 用户指南
  - [入门指南](/plugins/building-plugins) — 第一个插件教程
  - [提供商配置](/plugins/sdk-provider-plugins) — 配置 Rust 所有权的模型提供商
  - [SDK 概览](/plugins/sdk-overview) — 导入映射和注册 API
</Info>

本页面涵盖 CrawClaw 插件系统的内部架构。

## 公共能力模型

能力是 CrawClaw 内部的公共 **原生插件** 模型。每个原生 CrawClaw 插件都注册一个或多个能力类型：

| 能力     | 注册方法        | 示例插件           |
| -------- | --------------- | ------------------ |
| 语音     | Rust 原生描述符 | `qwen3-tts`        |
| 媒体理解 | Rust 原生描述符 | `openai`、`google` |
| 网络搜索 | Rust 原生描述符 | `searxng`          |

注册零能力但提供工具、命令或服务的插件是 **非能力** 插件。

### 外部兼容性立场

能力模型已落地到核心并被当前捆绑/原生插件使用，但外部插件兼容性仍需要比“已导出即冻结”更高的门槛。

当前指导：

- **现有外部插件：** 保持清单和已文档化的 Rust SDK 契约稳定；避免随意破坏已发布的插件元数据
- **新的捆绑/原生插件：** 优先使用显式能力注册，而非厂商特定的内嵌访问
- **采用能力注册的外部插件：** 允许，但将能力特定的辅助表面视为演进中，除非文档明确将某契约标记为稳定

实用规则：

- 能力注册 API 是预期方向
- 公共创作契约位于清单元数据和 Rust 插件 SDK 中
- 导出的辅助表面并不完全等价；优先使用狭窄的文档化契约，而非偶然的内部辅助函数

### 插件形态

CrawClaw 根据插件的实际注册行为（而非静态元数据）将每个已加载插件分类为某种形态：

- **plain-capability** — 仅注册一种能力类型（例如仅提供商的插件如 `mistral`）
- **hybrid-capability** — 注册多种能力类型（例如 `openai` 拥有文本推理、媒体理解和图像生成）
- **non-capability** — 注册工具、命令、服务或路由，但不注册任何能力

使用 CrawClaw Desktop 或本地 Gateway API 查看插件的形态和能力细分。详见 [Gateway API 参考](/tools/plugin#gateway-api-reference)。

### 运行时钩子

TypeScript 类型化运行时钩子已被移除。提供商/模型解析、提示词组装和智能体生命周期行为现在通过 Rust 提供商目录和 Rust 智能体运行时运行。渠道配置和传递元数据位于 `crates/crawclaw-channels`；桌面插件读取模型位于 `crates/crawclaw-plugin-host`。

### 兼容性信号

运行 CrawClaw Desktop 或本地 Gateway API 时，你可能会看到以下标签之一：

| 信号                       | 含义                                       |
| -------------------------- | ------------------------------------------ |
| **config valid**           | 配置解析正常且插件可解析                   |
| **compatibility advisory** | 插件使用支持但较旧模式（例如 `hook-only`） |
| **hard error**             | 配置无效或插件加载失败                     |

这些信号也会出现在 CrawClaw Desktop 和 Gateway 诊断中。

## 架构概览

CrawClaw 的插件系统有四层：

1. **清单 + 发现**
   CrawClaw 从配置的路径、工作区根目录、全局插件根目录和捆绑插件中查找候选插件。发现通过 Rust 运行时注册表读取原生 `crawclaw.plugin.json` 清单。
2. **启用 + 验证**
   核心决定已发现插件是启用、禁用、阻止还是被选入独占槽（如记忆）。
3. **运行时加载**
   CrawClaw 将插件元数据和 Rust 原生描述符读取到中央注册表中。
4. **表面消费**
   CrawClaw 其余部分读取注册表以暴露 Rust 所有能力、提供商设置、Desktop 表面和 Gateway API 操作。

重要的设计边界：

- 发现 + 配置验证应从 **清单/schema 元数据** 工作，无需执行插件代码
- 生产运行时行为来自 Rust Gateway/运行时或 Rust 原生插件描述符

这种分离让 CrawClaw 可以在完整运行时激活之前验证配置、解释缺失/禁用的插件，以及构建 UI/schema 提示。

### Rust 原生渠道适配器

TypeScript 渠道插件不再是生产契约。共享消息工具和渠道控制平面现在通过 `crates/crawclaw-channels` 中的 Rust 原生渠道描述符和适配器契约路由。运行时能力（如提供商、工具、命令、服务、语音、媒体、网络获取和网络搜索）由 Rust 原生注册表或 Rust Gateway/运行时代码拥有。

详见[加载管道](#load-pipeline)了解完整启动序列。

## 能力所有权模型

CrawClaw 将原生插件视为 **公司** 或 **功能** 的所有权边界，而非一堆不相关的集成。

这意味着：

- 公司插件通常应拥有该公司所有 CrawClaw 面向的表面
- 功能插件通常应拥有其引入的完整功能表面
- 渠道应消费共享的核心能力，而非重新实现提供商行为

示例：

- 捆绑的 `openai` 插件拥有 OpenAI 模型提供商行为和 OpenAI 媒体理解行为
- 捆绑的 `qwen3-tts` 插件拥有本地语音合成行为
- 捆绑的 `google` 插件拥有 Google 模型提供商行为，以及 Google 媒体理解 + 网络搜索行为
- 捆绑的 `minimax`、`mistral`、`moonshot` 和 `zai` 插件拥有各自的媒体理解后端

预期最终状态：

- OpenAI 生存于一个插件中，即使它跨越文本模型、图像和未来的视频
- 另一个厂商可以为自身的表面区域做同样的事情
- 渠道不关心哪个提供商插件拥有该提供商；它们消费核心暴露的共享能力契约

这是关键区别：

- **插件** = 所有权边界
- **能力** = 可由多个插件实现或消费的核心契约

因此，如果 CrawClaw 添加新领域（如视频），第一个问题不是“哪个提供商应该硬编码视频处理？”第一个问题是“核心视频能力契约是什么？”一旦契约存在，厂商插件可以针对它注册，渠道/功能插件可以消费它。

如果能力尚不存在，正确的做法通常是：

1. 在核心中定义缺失的能力
2. 通过 Rust 原生注册表或类型化 Gateway RPC 暴露它
3. 将渠道/功能连接到该能力
4. 让厂商插件声明 Rust 原生实现

这保持所有权明确，同时避免依赖单一厂商或一次性插件特定代码路径的核心行为。

### 能力分层

在决定代码归属时使用此心智模型：

- **核心能力层**：共享编排、策略、备用、配置合并规则、传递语义和类型化契约
- **厂商插件层**：厂商特定 API、认证、模型目录、语音合成、图像生成、未来视频后端、使用量端点
- **渠道/功能层**：消费核心能力并在其上呈现的原生集成

例如，TTS 遵循此形状：

- 核心拥有回复时间 TTS 策略、备用顺序、首选项和渠道传递
- `qwen3-tts` 拥有捆绑的原生合成实现
- 原生渠道和功能运行时消费共享语音辅助函数

未来能力应优先采用相同模式。

### 多能力公司插件示例

公司插件从外部看应该具有内聚性。如果 CrawClaw 有模型、语音、媒体理解和网络搜索的共享契约，厂商可以在一处拥有其所有表面：

```json
{
  "id": "exampleai",
  "name": "ExampleAI",
  "native": {
    "protocol": "crawclaw-native-plugin-jsonrpc",
    "schemaVersion": 1,
    "bin": "exampleai-sidecar"
  }
}
```

重要的不是确切的辅助函数名称。重要的是形态：

- 一个插件拥有厂商表面
- 核心仍然拥有能力契约
- 渠道和功能运行时消费 Rust 拥有的能力契约，而非厂商代码
- 契约测试可以断言插件声明了它声称拥有的能力

### 能力示例：视频理解

CrawClaw 已将图像/音频/视频理解视为一个共享能力。相同的所有权模型适用：

1. 核心定义媒体理解契约
2. 厂商插件通过 Rust 原生描述符暴露适用的 `describeImage`、`transcribeAudio` 和 `describeVideo`
3. 渠道和功能插件消费共享核心行为，而非直接连接到厂商代码

这避免将一个提供商的视频假设烘焙到核心中。插件拥有厂商表面；核心拥有能力契约和备用行为。

如果 CrawClaw 稍后添加新领域（如视频生成），再次使用相同序列：首先定义核心能力，然后让厂商插件声明针对它的实现。

需要具体的推广检查清单？参见[能力扩展手册](/tools/capability-cookbook)。

## 契约与执行

插件表面在清单 schema、 Rust 原生描述符和 Gateway RPC 定义中有意进行了类型化和集中化。这些契约定义了插件可能依赖的支持的运行时表面。

这很重要的原因：

- 插件作者获得一个稳定的内部标准
- 核心可以拒绝重复所有权，例如两个插件注册同一提供商 ID
- 启动可以针对格式错误的描述符显示可操作的诊断
- 契约测试可以强制执行捆绑插件所有权并防止静默漂移

有两层执行：

1. **运行时描述符执行**
   插件注册表在插件加载时验证描述符。例如：重复的提供商 ID、重复的语音提供商 ID 和格式错误的描述符会产生插件诊断，而非未定义行为。
2. **契约测试**
   捆绑插件通过清单/原生描述符测试进行检查，以便 CrawClaw 可以显式断言所有权。当前这用于模型提供商、语音提供商、网络搜索提供商和捆绑描述符所有权。

实际效果是 CrawClaw 从一开始就知道哪个插件拥有哪个表面。这让核心和渠道能够无缝组合，因为所有权是声明性的、类型化的和可测试的，而非隐式的。

### 契约应包含什么

好的插件契约：

- 类型化
- 小型
- 能力特定
- 核心拥有
- 可被多个插件复用
- 可被渠道/功能消费而无需厂商知识

不好的插件契约：

- 隐藏在核心中的厂商特定策略
- 绕过注册表的一次性插件后门
- 渠道代码直接访问厂商实现
- 绕过 Rust 原生边界的临时 TypeScript 运行时对象

如有疑问，提高抽象级别：首先定义能力，然后让插件插入其中。

## 执行模型

Rust 原生 CrawClaw 插件在 Rust Gateway/运行时边界内运行。它们不是 TypeScript 扩展代码。

含义：

- Rust 原生插件可以暴露工具、网络处理器、钩子和服务
- 原生插件错误可能导致 Gateway/运行时崩溃或不稳定
- 恶意原生插件相当于在 CrawClaw 运行时边界内执行任意代码

兼容捆绑包默认更安全，因为 CrawClaw 当前将它们视为元数据/内容包。在当前版本中，这主要指捆绑的 Skills。

对非捆绑插件使用允许列表和显式安装/加载路径。将工作区插件视为开发时代码，而非生产默认值。

对于捆绑的工作区包名，将插件 ID 锚定在 npm 名称中：默认 `@crawclaw/<id>`，或经批准的类型化后缀（例如包有意暴露更窄的插件角色）。

重要信任说明：

- `plugins.allow` 信任 **插件 ID**，而非来源出处。
- 具有与捆绑插件相同 ID 的工作区插件，在该工作区插件被启用/允许列出时会故意遮蔽捆绑副本。
- 这对于本地开发、补丁测试和热修复是正常且有用的。

## 导出边界

CrawClaw 导出能力，而非实现便利。

保持能力注册公开。精简非契约辅助函数导出：

- 捆绑插件特定的辅助子路径
- 不打算作为公共 API 的运行时管道子路径
- 厂商特定便利辅助函数
- 作为实现细节的设置/引导辅助函数

## 加载管道

启动时，CrawClaw 大致执行以下操作：

1. 发现候选插件根目录
2. 读取原生清单和包元数据
3. 拒绝不安全的候选
4. 规范化插件配置（`plugins.enabled`、`allow`、`deny`、`entries`、`slots`、`load.paths`）
5. 决定每个候选的启用状态
6. 收集声明性元数据和 Rust 原生描述符
7. 向 Gateway/运行时表面暴露注册表

安全门发生在 **运行时执行之前**。当入口逃离插件根目录、路径全局可写，或对于非捆绑插件路径所有权可疑时，候选会被阻止。

### 清单优先行为

清单是控制平面的事实来源。CrawClaw 使用它来：

- 识别插件
- 发现声明的渠道、Skills 和配置 schema 元数据
- 验证 `plugins.entries.<id>.config`
- 增强浏览器客户端标签/占位符
- 显示安装/目录元数据

对于原生插件，Rust 描述符/运行时是数据平面部分。它拥有实际行为，如钩子、工具、命令、服务或提供商流程。

### 加载器缓存什么

CrawClaw 为以下内容保留短期的进程内缓存：

- 发现结果
- 清单注册表数据
- 已加载插件注册表

这些缓存减少了突发启动和重复命令开销。它们可以安全地视为短期性能缓存，而非持久化。

性能说明：

- 设置 `CRAWCLAW_DISABLE_PLUGIN_DISCOVERY_CACHE=1` 或 `CRAWCLAW_DISABLE_PLUGIN_MANIFEST_CACHE=1` 以禁用这些缓存。
- 使用 `CRAWCLAW_PLUGIN_DISCOVERY_CACHE_MS` 和 `CRAWCLAW_PLUGIN_MANIFEST_CACHE_MS` 调整缓存窗口。

## 注册表模型

已加载插件不直接修改随机核心全局变量。它们注册到中央插件注册表中。

注册表跟踪：

- 插件记录（身份、来源、来源、状态、诊断）
- 工具
- 工作区钩子包
- 渠道
- 提供商
- Gateway RPC 处理器
- HTTP 路由
- CLI 注册器
- 后台服务
- 插件拥有的命令

核心功能然后从该注册表读取，而非直接与插件模块通信。这保持加载单向：

- 插件模块 -> 注册表注册
- 核心运行时 -> 注册表消费

这种分离对可维护性很重要。它意味着大多数核心表面只需要一个集成点：“读取注册表”，而非“特例化每个插件模块”。

## 会话绑定事件

会话绑定事件由 Rust 运行时和内部 Gateway 事件总线拥有。TypeScript 插件不能注册生产回调进行绑定解析。

## 提供商运行时所有权

TypeScript 插件不再注册模型提供商或运行时提供商钩子。内置提供商元数据和运行时行为位于 `crates/crawclaw-providers`；打包的桌面清单接收 Rust 分阶段的提供商记录，并通过声明性元数据保持提供商设置/状态廉价。

提供商插件仍可暴露清单元数据：

- `providerAuthEnvVars` 描述环境凭证探测。
- `providerAuthChoices` 描述引导/设置标签。
- `models.providers` 配置条目描述自定义提供商端点和模型行。

模型解析、认证准备、请求传输、使用量快照、记录策略、提示缓存策略、模型目录增强和提供商特定兼容性是 Rust 拥有的运行时行为。通过 Rust 提供商注册表和原生描述符契约添加新的提供商能力，然后仅将所需的清单字段暴露给 TypeScript 渲染器或设置表面。

## 运行时辅助函数

TTS 是一个 Rust Gateway 和原生插件表面。默认桌面路径使用 Rust `tts.*` Gateway 方法和捆绑的 Rust 原生 `qwen3-tts` 描述符，而非 TypeScript 运行时辅助函数。

语音提供商现在来自 Rust 原生插件描述符。TypeScript 插件不在运行时注册语音提供商。

说明：

- 将 TTS 策略和提供商元数据保留在 Rust Gateway/原生描述符中。
- 使用语音提供商通过原生描述符获取厂商拥有的合成行为。
- 首选所有权模型是公司导向的：一个厂商插件可以拥有文本、语音、图像和未来媒体提供商，因为 CrawClaw 添加了这些能力契约。

对于图像/音频/视频理解，Rust 原生插件描述符声明提供商和调用目标，而非通用的键值包。

说明：

- 将编排、备用、配置和渠道布线保留在核心中。
- 将厂商行为保留在提供商插件中。
- 增量扩展应保持类型化：新可选方法、新可选结果字段、新可选能力。
- 如果 CrawClaw 稍后添加新能力（如视频生成），首先定义核心能力契约，然后让厂商插件针对它注册。

旧的 TypeScript 媒体理解运行时辅助函数已从公共插件 SDK 中移除。媒体理解现在通过 Rust 原生运行时能力和声明性插件描述符暴露，而非 TS 插件运行时调用。

插件还可以通过 `api.runtime.subagent` 启动后台子智能体运行：

```ts
const result = await api.runtime.subagent.run({
  sessionKey: "agent:main:subagent:search-helper",
  message: "Expand this query into focused follow-up searches.",
  provider: "openai",
  model: "gpt-4.1-mini",
  deliver: false,
});
```

说明：

- `provider` 和 `model` 是可选的每次运行覆盖，而非持久会话更改。
- CrawClaw 仅对受信任调用者才认可这些覆盖字段。
- 对于插件拥有的备用运行，操作员必须通过 `plugins.entries.<id>.subagent.allowModelOverride: true` 选择加入。
- 使用 `plugins.entries.<id>.subagent.allowedModels` 将受信任插件限制为特定的规范 `provider/model` 目标，或使用 `"*"` 显式允许任何目标。
- 不受信任插件的子智能体运行仍然有效，但覆盖请求会被拒绝，而非静默备用。

对于网络搜索，插件可以消费共享运行时辅助函数，而非直接访问智能体工具布线：

```ts
const providers = api.runtime.webSearch.listProviders({
  config: api.config,
});

const result = await api.runtime.webSearch.search({
  config: api.config,
  args: {
    query: "CrawClaw plugin runtime helpers",
    count: 5,
  },
});
```

网络搜索提供商现在来自 Rust 原生插件描述符。

说明：

- 将提供商选择、凭证解析和共享请求语义保留在核心中。
- 使用网络搜索提供商进行厂商特定搜索传输。
- `api.runtime.webSearch.*` 是需要搜索行为但不想依赖智能体工具包装器的功能/渠道插件的首选共享表面。

## Gateway HTTP 路由

生产 Gateway HTTP 路由由 Rust Gateway 或内部运行时服务拥有。TypeScript 插件不能注册 HTTP 处理器。

## Rust 插件 SDK 边界

公共插件创作 SDK 是 Rust crate `crawclaw-plugin-sdk`。JavaScript 插件 SDK 包导出已从 npm 包中移除。

- 使用 `NativePluginDescriptor` 和能力描述符辅助函数获取公共插件元数据。
- 保持插件发现清单优先。发现不应要求执行 JavaScript 插件代码。
- 将新的插件面向运行时能力添加到 Rust crate 中，并保持 JSON 线格式增量。
- 捆绑扩展内部保持私有。核心和测试应读取 repo 拥有的包的清单/包元数据和 Rust/原生描述符；外部插件应使用 Rust SDK。
- Repo 私有 TypeScript 辅助函数不是运行时边界的一部分。不要将它们添加为 Rust/原生契约的替代品。

## 消息工具 schemas

插件应通过 Rust/原生描述符拥有渠道特定的消息工具 schema 贡献。将提供商特定字段保留在插件中，而非共享核心中。

如果 schema 形状仅对某个提供商有意义，请在插件自身的源中定义它，而非将其提升到共享 SDK 中。

## 渠道目标解析

渠道插件应拥有渠道特定目标语义。保持共享出站主机通用，并使用消息适配器表面处理提供商规则：

- `messaging.inferTargetChatType({ to })` 决定是否应将规范化目标在目录查找之前视为 `direct`、`group` 或 `channel`。
- `messaging.targetResolver.looksLikeId(raw, normalized)` 告诉核心输入是否应跳过直接进行 ID 类解析，而非目录搜索。
- `messaging.targetResolver.resolveTarget(...)` 是核心在规范化后或目录未命中后需要最终提供商拥有解析时的插件备用。
- `messaging.resolveOutboundSessionRoute(...)` 拥有在目标解析后提供商特定的会话路由构建。

推荐拆分：

- 对应在搜索对等体/群组之前应发生的类别决策使用 `inferTargetChatType`。
- 对应“将此视为显式/原生目标 ID”检查使用 `looksLikeId`。
- 对应提供商特定规范化备用使用 `resolveTarget`，而非广泛目录搜索。
- 将提供商原生 ID（如聊天 ID、线程 ID、JID、句柄和房间 ID）保留在 `target` 值或提供商特定参数内，而非通用 SDK 字段中。

## 配置支持的目录

从配置派生目录条目的插件应将该逻辑保留在插件或 Rust 原生渠道适配器中。

在渠道需要配置支持的对等体/群组时使用此功能，例如：

- 允许列表驱动的私信对等体
- 配置的渠道/群组映射
- 账户范围的静态目录备用

`directory-runtime` 中的共享辅助函数仅处理通用操作：

- 查询过滤
- 限制应用
- 去重/规范化辅助函数
- 构建 `ChannelDirectoryEntry[]`

渠道特定的账户检查和 ID 规范化应保留在插件实现中。

## 提供商配置

TypeScript 插件不再注册 LLM 提供商或模型目录。提供商元数据、默认模型、配置 schema、认证选择、设置选项和原生传输能力由 Rust 提供商注册表拥有。

自定义提供商条目在 `models.providers` 下仍为配置支持。使用该配置路径处理 OpenAI 兼容端点、本地适配器或应用户管理而非在 Rust 目录中发布的提供商条目。

## 只读渠道检查

如果你的插件注册了渠道，通过原生描述符/状态表面以及运行时账户解析暴露只读账户检查。

原因：

- 运行时账户解析是运行时路径。它可以假设凭证已完全实例化，并在缺少所需密钥时快速失败。
- 只读表面（如 CrawClaw Desktop、Gateway API 检查、状态系列视图和 doctor/配置修复流程）不应仅为描述配置而实例化运行时凭证。

推荐 `inspectAccount(...)` 行为：

- 仅返回描述性账户状态。
- 保留 `enabled` 和 `configured`。
- 在相关时包含凭证源/状态字段，例如：
  - `tokenSource`、`tokenStatus`
  - `botTokenSource`、`botTokenStatus`
  - `appTokenSource`、`appTokenStatus`
  - `signingSecretSource`、`signingSecretStatus`
- 你无需仅为报告只读可用性而返回原始令牌值。返回 `tokenStatus: "available"`（以及匹配的源字段）足以用于状态风格命令。
- 当凭证通过 SecretRef 配置但在当前命令路径中不可用时，使用 `configured_unavailable`。

这让只读命令可以报告“已配置但在此命令路径中不可用”，而非崩溃或错误报告账户未配置。

## 包元数据

原生插件必须将其可执行文件/运行时文件打包在 `crawclaw.plugin.json` 旁边。CrawClaw Desktop 和本地 Gateway API 在安装插件时不再运行 `npm install`，已发布包内容不得依赖生成的 `node_modules` 树。

旧的 `crawclaw.extensions`、`crawclaw.setupEntry` 和 `deferConfiguredChannelFullLoadUntilAfterListen` 包路径已随 TypeScript 插件运行时移除。原生能力设置/状态表面由 Rust 拥有。

## 记忆插件

自定义会话记忆行为现在位于内置记忆运行时路径上。插件仍可在清单中声明 `kind: "memory"` 以参与独占记忆槽选择，但旧的 `context-engine` 注册 API 和插件拥有的压缩桥已被移除。

## 添加新能力

当插件需要当前 API 不适合的行为时，不要通过私有内嵌访问绕过插件系统。添加缺失的能力。

推荐序列：

1. 定义核心契约
   决定核心应拥有的共享行为：策略、备用、配置合并、生命周期、渠道面向语义和运行时辅助函数形状。
2. 添加 Rust 原生描述符或 Gateway RPC 表面
   用最小的有用类型化能力表面扩展 Rust 拥有的契约。
3. 连接核心 + 渠道/功能消费者
   渠道和功能插件应通过核心消费新能力，而非直接导入厂商实现。
4. 声明厂商实现
   厂商插件然后通过 Rust 原生描述符声明其后端。
5. 添加契约覆盖
   添加测试以使所有权和描述符形状随时间保持显式。

这就是 CrawClaw 保持有主见而不变得硬编码于一个提供商世界观的方式。参见[能力扩展手册](/tools/capability-cookbook)获取具体的文件检查清单和示例。

### 能力检查清单

添加新能力时，实现通常应同时触及这些表面：

- 拥有 crate 中的 Rust 契约类型
- 当功能/渠道插件需要消费运行时能力时的 Rust/原生描述符暴露
- 当操作员需要控制平面方法或状态表面时的 Gateway/运行时连接
- Rust 生成的捆绑能力元数据中的所有权/契约断言
- `docs/` 中的操作员/插件文档

如果这些表面中缺少任何一个，这通常表明该能力尚未完全集成。

### 能力模板

使用 Rust 插件 SDK 和原生描述符辅助函数作为模板。不要为新的生产能添加 TypeScript 注册回调或 TypeScript 契约测试。

这保持规则简单：

- 核心拥有能力契约 + 编排
- 厂商插件拥有厂商实现
- 功能/渠道插件消费运行时辅助函数
- 契约测试保持所有权显式
