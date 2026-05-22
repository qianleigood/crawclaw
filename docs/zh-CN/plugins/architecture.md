---
read_when:
  - 构建或调试原生 CrawClaw 插件
  - 理解插件能力模型或所有权边界
  - 处理插件加载管道或注册表
  - 实现非 LLM 提供商能力
sidebarTitle: Internals
summary: 插件内部机制：能力模型、所有权边界、契约、加载管道和运行时辅助函数
title: 插件内部机制
x-i18n:
  generated_at: "2026-05-22T03:02:28Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 2cc8933ec61ba1a91c76689c98a40ea74a5d3b9d84904372d66ad6c1e6464132
  source_path: plugins/architecture.md
  workflow: 15
---

# 插件内部机制

<Info>
  这是**深度架构参考**。有关实用指南，请参阅：
  - [安装和使用插件](/tools/plugin) — 用户指南
  - [入门指南](/plugins/building-plugins) — 首个插件教程
  - [提供商配置](/plugins/sdk-provider-plugins) — 配置 Rust 所有权的模型提供商
  - [SDK 概览](/plugins/sdk-overview) — 导入映射和注册 API
</Info>

本页涵盖 CrawClaw 插件系统的内部架构。

## 公共能力模型

能力是 CrawClaw 内部的公共**原生插件**模型。每个原生 CrawClaw 插件针对一个或多个能力类型进行注册：

| 能力                | 注册方法        | 示例插件           |
| ------------------- | --------------- | ------------------ |
| Speech              | Rust 原生描述符 | `qwen3-tts`        |
| Media understanding | Rust 原生描述符 | `openai`、`google` |
| Web search          | Rust 原生描述符 | `searxng`          |

注册零能力但提供工具、命令或服务的插件是**非能力**插件。

### 外部兼容性立场

能力模型已落地到核心并被捆绑/原生插件使用，但外部插件兼容性仍需要比"已导出即为冻结"更高的标准。

当前指导：

- **现有外部插件：**保持清单和文档化的 Rust SDK 契约稳定；避免随意破坏已发布的插件元数据
- **新捆绑/原生插件：**优先使用显式能力注册而非供应商特定的内省访问
- **采用能力注册的外部插件：**允许，但将能力特定的辅助表面视为演进中的，除非文档明确标记某个契约是稳定的

实用规则：

- 能力注册 API 是预期方向
- 公共创作契约存活于清单元数据和 Rust 插件 SDK 中
- 导出的辅助表面并非全部等价；优先使用窄的文档化契约，而非偶然的内部辅助函数

### 插件形态

CrawClaw 根据每个已加载插件的实际注册行为（而非仅静态元数据）将其分类为一种形态：

- **plain-capability** — 仅注册一种能力类型（例如仅提供商的插件如 `mistral`）
- **hybrid-capability** — 注册多种能力类型（例如 `openai` 拥有文本推理、媒体理解和图像生成）
- **non-capability** — 注册工具、命令、服务或路由但不注册能力

使用 CrawClaw Desktop 或本地 Gateway API 查看插件的形态和能力细分。详情请参阅 [Gateway API 参考](/tools/plugin#gateway-api-reference)。

### 运行时钩子

TypeScript 类型化运行时钩子已被移除。提供商/模型解析、提示词组装和智能体生命周期行为现在通过 Rust 提供商目录和 Rust 智能体运行时运行。渠道配置和投递元数据位于 `crates/crawclaw-channels`；桌面插件读取模型位于 `crates/crawclaw-plugin-host`。

### 兼容性信号

当你运行 CrawClaw Desktop 或本地 Gateway API 时，你可能会看到以下标签之一：

| 信号                       | 含义                                         |
| -------------------------- | -------------------------------------------- |
| **config valid**           | 配置解析正常且插件可解析                     |
| **compatibility advisory** | 插件使用支持但较旧的模式（例如 `hook-only`） |
| **hard error**             | 配置无效或插件加载失败                       |

这些信号也会出现在 CrawClaw Desktop 和 Gateway 诊断中。

## 架构概览

CrawClaw 的插件系统有四层：

1. **清单 + 发现**
   CrawClaw 从配置的路径、工作区根目录、全局扩展根目录和捆绑扩展中找到候选插件。发现通过 Rust 运行时注册表读取原生 `crawclaw.plugin.json` 清单。
2. **启用 + 验证**
   核心决定已发现的插件是启用、禁用、阻止还是为独占槽（如记忆）选中。
3. **运行时加载**
   CrawClaw 将插件元数据和 Rust 原生描述符读取到中央注册表。
4. **表面消费**
   CrawClaw 的其余部分读取注册表以暴露 Rust 所有者的能力、提供商设置、桌面表面和 Gateway API 操作。

重要的设计边界：

- 发现 + 配置验证应从**清单/模式元数据**工作，而无需执行插件代码
- 生产运行时行为来自 Rust Gateway/运行时或 Rust 原生插件描述符

这种分离让 CrawClaw 可以在完整运行时激活之前验证配置、解释缺失/禁用的插件，以及构建 UI/模式提示。

### Rust 原生渠道适配器

TypeScript 渠道插件不再是生产契约。共享消息工具和渠道控制平面现在通过 Rust 原生渠道描述符和适配器契约路由到 `crates/crawclaw-channels`。运行时能力（如提供商、工具、命令、服务、语音、媒体、网络获取和网络搜索）由 Rust 原生注册表或 Rust Gateway/运行时代码拥有。

请参阅[加载管道](#load-pipeline)了解完整的启动序列。

## 能力所有权模型

CrawClaw 将原生插件视为**公司**或**功能**的所有权边界，而不是无关集成的杂烩袋。

这意味着：

- 一个公司插件通常应拥有该公司所有面向 CrawClaw 的表面
- 一个功能插件通常应拥有它引入的完整功能表面
- 渠道应消费共享核心能力，而不是重新实现提供商行为

示例：

- 捆绑的 `openai` 插件拥有 OpenAI 模型提供商行为和 OpenAI 媒体理解行为
- 捆绑的 `qwen3-tts` 插件拥有本地语音合成行为
- 捆绑的 `google` 插件拥有 Google 模型提供商行为以及 Google 媒体理解和网络搜索行为
- 捆绑的 `minimax`、`mistral`、`moonshot` 和 `zai` 插件拥有各自的媒体理解后端

预期的最终状态是：

- OpenAI 存在于一个插件中，即使它跨越文本模型、图像和未来的视频
- 另一个供应商可以为它自己的表面区域做同样的事情
- 渠道不关心哪个供应商插件拥有提供商；它们消费由核心暴露的共享能力契约

这是关键区别：

- **插件** = 所有权边界
- **能力** = 多个插件可以实现或消费的核心契约

因此，如果 CrawClaw 添加了新领域（如视频），第一个问题不是"哪个提供商应该硬编码视频处理？"第一个问题是"核心视频能力契约是什么？"一旦该契约存在，供应商插件可以针对它注册，渠道/功能插件可以消费它。

如果该能力尚不存在，正确的做法通常是：

1. 在核心中定义缺失的能力
2. 通过 Rust 原生注册表或类型化 Gateway RPC 暴露它
3. 将渠道/功能连接到该能力
4. 让供应商插件声明 Rust 原生实现

这保持所有权明确，同时避免依赖于单一供应商或一次性插件特定代码路径的核心行为。

### 能力分层

在决定代码归属时使用此心智模型：

- **核心能力层**：共享编排、策略、回退、配置合并规则、投递语义和类型化契约
- **供应商插件层**：供应商特定 API、认证、模型目录、语音合成、图像生成、未来的视频后端、使用量端点
- **渠道/功能层**：消费核心能力并在其表面上呈现它们的原生集成

例如，TTS 遵循此形态：

- 核心拥有回复时 TTS 策略、回退顺序、首选项和渠道投递
- `qwen3-tts` 拥有捆绑的原生合成实现
- 原生渠道和功能运行时消费共享语音辅助函数

未来能力应优先采用相同的模式。

### 多能力公司插件示例

公司插件从外部应该感觉是一个整体。如果 CrawClaw 有模型、语音、媒体理解和网络搜索的共享契约，供应商可以在一个地方拥有其所有表面：

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

重要的不是确切的辅助函数名称。形态很重要：

- 一个插件拥有供应商表面
- 核心仍然拥有能力契约
- 渠道和功能运行时消费 Rust 所有者能力契约，而非供应商代码
- 契约测试可以断言插件声明了它声称拥有的能力

### 能力示例：视频理解

CrawClaw 已经将图像/音频/视频理解视为一个共享能力。同样的所有权模型适用于此：

1. 核心定义媒体理解契约
2. 供应商插件通过 Rust 原生描述符根据适用情况暴露 `describeImage`、`transcribeAudio` 和 `describeVideo`
3. 渠道和功能插件消费共享核心行为，而不是直接连接到供应商代码

这避免了将一个提供商的视频假设烘焙到核心中。插件拥有供应商表面；核心拥有能力契约和回退行为。

如果 CrawClaw 稍后添加新领域（如视频生成），再次使用相同序列：首先定义核心能力，然后让供应商插件声明针对它的实现。

需要具体的推广检查清单？请参阅[能力扩展手册](/tools/capability-cookbook)。

## 契约与执行

插件表面有意地在清单模式、Rust 原生描述符和 Gateway RPC 定义中类型化并集中。这些契约定义了插件可能依赖的支持运行时表面。

为什么这很重要：

- 插件作者获得一个稳定的内部标准
- 核心可以拒绝重复所有权，例如两个插件注册相同的提供商 ID
- 启动可以为格式错误的描述符提供可操作的诊断
- 契约测试可以强制执行捆绑插件所有权并防止静默漂移

有两层执行：

1. **运行时描述符执行**
   插件注册表在插件加载时验证描述符。示例：重复的提供商 ID、重复的语音提供商 ID 和格式错误的描述符会产生插件诊断，而不是未定义行为。
2. **契约测试**
   捆绑插件通过清单/原生描述符测试进行检查，以便 CrawClaw 可以显式断言所有权。目前这用于模型提供商、语音提供商、网络搜索提供商和捆绑描述符所有权。

实际效果是 CrawClaw 从一开始就知道哪个插件拥有哪个表面。这让核心和渠道能够无缝组合，因为所有权是声明的、类型化的和可测试的，而非隐式的。

### 契约应包含什么

好的插件契约是：

- 类型化的
- 小型的
- 能力特定的
- 核心拥有的
- 可被多个插件重用的
- 渠道/功能可在不了解供应商的情况下消费的

坏的插件契约是：

- 隐藏在核心中的供应商特定策略
- 绕过注册表的一次性插件逃生口
- 渠道代码直接进入供应商实现
- 绕过 Rust 原生边界的临时 TypeScript 运行时对象

如有疑问，提高抽象级别：首先定义能力，然后让插件插入其中。

## 执行模型

Rust 原生 CrawClaw 插件在 Rust Gateway/运行时边界内运行。它们不是 TypeScript 扩展代码。

含义：

- Rust 原生插件可以暴露工具、网络处理器、钩子和服务
- 原生插件错误可能导致 Gateway/运行时崩溃或不稳定
- 恶意原生插件相当于在 CrawClaw 运行时边界内执行任意代码

兼容包默认更安全，因为 CrawClaw 目前将它们视为元数据/内容包。在当前版本中，这主要指捆绑的 Skills。

对非捆绑插件使用白名单和显式安装/加载路径。将工作区插件视为开发时代码，而非生产默认值。

对于捆绑的工作区包名称，将插件 ID 锚定在 npm 名称中：默认情况下为 `@crawclaw/<id>`，或经批准的类型化后缀（如包有意暴露更窄的插件角色）。

重要信任说明：

- `plugins.allow` 信任**插件 ID**，而非来源出处。
- 具有与捆绑插件相同 ID 的工作区插件，在该工作区插件被启用/列入白名单时会有意遮蔽捆绑副本。
- 这对于本地开发、补丁测试和热修复是正常且有用的。

## 导出边界

CrawClaw 导出能力，而非实现便利性。

保持能力注册公开。精简非契约辅助函数导出：

- 捆绑插件特定的辅助子路径
- 不打算作为公共 API 的运行时管道子路径
- 供应商特定的便利辅助函数
- 作为实现细节的设置/入门引导辅助函数

## 加载管道

在启动时，CrawClaw 大致执行以下操作：

1. 发现候选插件根目录
2. 读取原生清单和包元数据
3. 拒绝不安全的候选
4. 规范化插件配置（`plugins.enabled`、`allow`、`deny`、`entries`、`slots`、`load.paths`）
5. 决定每个候选的启用状态
6. 收集声明性元数据和 Rust 原生描述符
7. 向 Gateway/运行时表面暴露注册表

安全门禁发生在**运行时执行之前**。当条目逃离插件根目录、路径是全局可写的，或者路径所有权对非捆绑插件看起来可疑时，候选会被阻止。

### 清单优先行为

清单是控制平面的真实来源。CrawClaw 使用它来：

- 识别插件
- 发现声明的渠道、Skills 和配置模式元数据
- 验证 `plugins.entries.<id>.config`
- 增强浏览器客户端标签/占位符
- 显示安装/目录元数据

对于原生插件，Rust 描述符/运行时是数据平面部分。它拥有实际行为，如钩子、工具、命令、服务或提供商流程。

### 加载器缓存什么

CrawClaw 为以下内容保持短期的进程内缓存：

- 发现结果
- 清单注册表数据
- 已加载插件注册表

这些缓存减少了突发启动和重复命令开销。可以将它们视为短期性能缓存，而非持久化。

性能说明：

- 设置 `CRAWCLAW_DISABLE_PLUGIN_DISCOVERY_CACHE=1` 或 `CRAWCLAW_DISABLE_PLUGIN_MANIFEST_CACHE=1` 以禁用这些缓存。
- 使用 `CRAWCLAW_PLUGIN_DISCOVERY_CACHE_MS` 和 `CRAWCLAW_PLUGIN_MANIFEST_CACHE_MS` 调整缓存窗口。

## 注册表模型

已加载插件不直接修改随机核心全局变量。它们注册到中央插件注册表。

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
- 插件自有命令

核心功能然后从该注册表读取，而不是直接与插件模块通信。这保持加载单向：

- 插件模块 -> 注册表注册
- 核心运行时 -> 注册表消费

这种分离对可维护性很重要。这意味着大多数核心表面只需要一个集成点："读取注册表"，而非"特殊处理每个插件模块"。

## 会话绑定事件

会话绑定事件由 Rust 运行时和内部 Gateway 事件总线拥有。TypeScript 插件不能注册用于绑定解析的生产回调。

## 提供商运行时所有权

TypeScript 插件不再注册模型提供商或运行时提供商钩子。内置提供商元数据和运行时行为位于 `crates/crawclaw-providers`；打包的桌面清单接收 Rust 暂存的提供商记录，并通过声明性元数据保持提供商设置/状态廉价。

提供商插件仍可暴露清单元数据：

- `providerAuthEnvVars` 描述环境凭证探测。
- `providerAuthChoices` 描述入门引导/设置标签。
- `models.providers` 配置条目描述自定义提供商端点和模型行。

模型解析、认证准备、请求传输、使用量快照、 transcript 策略、提示词缓存策略、模型目录增强和提供商特定兼容性是 Rust 自有的运行时行为。通过 Rust 提供商注册表和原生描述符契约添加新提供商能力，然后将仅必需的清单字段暴露给 TypeScript 渲染器或设置表面。

## 运行时辅助函数

TTS 是 Rust Gateway 和原生插件表面。默认桌面路径使用 Rust `tts.*` Gateway 方法和捆绑的 Rust 原生 `qwen3-tts` 描述符，而非 TypeScript 运行时辅助函数。

语音提供商现在来自 Rust 原生插件描述符。TypeScript 插件不在运行时注册语音提供商。

说明：

- 将 TTS 策略和提供商元数据保留在 Rust Gateway/原生描述符中。
- 通过原生描述符使用语音提供商获取供应商自有的合成行为。
- 首选的所有权模型是面向公司的：一个供应商插件可以拥有文本、语音、图像和未来媒体提供商，因为 CrawClaw 添加了这些能力契约。

对于图像/音频/视频理解，Rust 原生插件描述符声明提供商和调用目标，而不是通用的键/值袋。

说明：

- 将编排、回退、配置和渠道连接保留在核心中。
- 将供应商行为保留在提供商插件中。
- 增量扩展应保持类型化：新可选方法、新可选结果字段、新可选能力。
- 如果 CrawClaw 稍后添加新能力（如视频生成），首先定义核心能力契约，然后让供应商插件针对它注册。

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
- CrawClaw 仅对受信任调用者遵守这些覆盖字段。
- 对于插件自有的回退运行，操作员必须使用 `plugins.entries.<id>.subagent.allowModelOverride: true` 选择加入。
- 使用 `plugins.entries.<id>.subagent.allowedModels` 将受信任插件限制为特定的规范 `provider/model` 目标，或使用 `"*"` 显式允许任何目标。
- 不受信任的插件子智能体运行仍然有效，但覆盖请求会被拒绝而非静默回退。

对于网络搜索，插件可以消费共享运行时辅助函数，而不是深入智能体工具连接：

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
- 使用网络搜索提供商获取供应商特定的搜索传输。
- `api.runtime.webSearch.*` 是功能/渠道插件需要搜索行为而不依赖智能体工具包装器的首选共享表面。

## Gateway HTTP 路由

生产 Gateway HTTP 路由由 Rust Gateway 或内部运行时服务拥有。TypeScript 插件不能注册 HTTP 处理器。

## Rust 插件 SDK 边界

公共插件创作 SDK 是 Rust crate `crawclaw-plugin-sdk`。JavaScript 插件 SDK 包导出已从 npm 包中移除。

- 使用 `NativePluginDescriptor` 和能力描述符辅助函数获取公共插件元数据。
- 保持插件发现清单优先。发现不应需要执行 JavaScript 插件代码。
- 将新的面向插件的运行时能力添加到 Rust crate 并保持 JSON 线格式增量。
- 捆绑扩展内部保持私有。核心和测试应为仓库拥有的包读取清单/包元数据和 Rust/原生描述符；外部插件应使用 Rust SDK。
- 仓库私有的 TypeScript 辅助函数不是运行时边界的一部分。不要将它们作为 Rust/原生契约的替代品添加。

## 消息工具模式

插件应通过 Rust/原生描述符拥有渠道特定的消息工具模式贡献。将提供商特定字段保留在插件中，而非共享核心。

如果模式形状仅对一个提供商有意义，在该插件自己的源代码中定义它，而不是将其提升到共享 SDK 中。

## 渠道目标解析

渠道插件应拥有渠道特定的目标语义。保持共享出站主机通用，并使用消息适配器表面进行提供商规则：

- `messaging.inferTargetChatType({ to })` 决定在目录查找之前是否应将规范化目标视为 `direct`、`group` 或 `channel`。
- `messaging.targetResolver.looksLikeId(raw, normalized)` 告诉核心输入是否应跳过直转到类似 ID 的解析而不是目录搜索。
- `messaging.targetResolver.resolveTarget(...)` 是核心在规范化后或目录未命中后需要最终提供商自有解析时的插件回退。
- `messaging.resolveOutboundSessionRoute(...)` 在目标解析后拥有提供商特定的会话路由构建。

推荐拆分：

- 对应在搜索对等体/群组之前应发生的类别决策使用 `inferTargetChatType`。
- 对"将此作为显式/原生目标 ID 处理"检查使用 `looksLikeId`。
- 对提供商特定的规范化回退使用 `resolveTarget`，而非用于宽泛目录搜索。
- 将提供商原生 ID（如聊天 ID、线程 ID、JID、句柄和房间 ID）保留在 `target` 值或提供商特定参数内，而非通用 SDK 字段中。

## 配置支持的目录

从配置派生目录条目的插件应将该逻辑保留在插件或 Rust 原生渠道适配器中。

在以下情况下使用：当渠道需要配置支持的对等体/群组时，例如：

- 白名单驱动的私信对等体
- 配置的渠道/群组映射
- 账户范围的静态目录回退

`directory-runtime` 中的共享辅助函数仅处理通用操作：

- 查询过滤
- 限制应用
- 去重/规范化辅助函数
- 构建 `ChannelDirectoryEntry[]`

渠道特定的账户检查和 ID 规范化应保留在插件实现中。

## 提供商配置

TypeScript 插件不再注册 LLM 提供商或模型目录。提供商元数据、默认模型、配置模式、认证选择、设置选项和原生传输能力由 Rust 提供商注册表拥有。

自定义提供商条目在 `models.providers` 下仍为配置支持。使用该配置路径用于 OpenAI 兼容端点、本地适配器或应用户管理而非在 Rust 目录中提供的提供商条目。

## 只读渠道检查

如果你的插件注册了渠道，通过原生描述符/状态表面以及运行时账户解析公开只读账户检查。

原因：

- 运行时账户解析是运行时路径。它可以假设凭证已完全具体化，并且在缺少所需密钥时可以快速失败。
- 只读命令路径（如 CrawClaw Desktop 或本地 Gateway API、CrawClaw Desktop 或本地 Gateway API、CrawClaw Desktop 或本地 Gateway API、CrawClaw Desktop 或本地 Gateway API 和 doctor/配置修复流程）不应仅为描述配置而需要将运行时凭证具体化。

推荐的 `inspectAccount(...)` 行为：

- 仅返回描述性账户状态。
- 保留 `enabled` 和 `configured`。
- 在相关时包含凭证源/状态字段，例如：
  - `tokenSource`、`tokenStatus`
  - `botTokenSource`、`botTokenStatus`
  - `appTokenSource`、`appTokenStatus`
  - `signingSecretSource`、`signingSecretStatus`
- 你不需要仅为报告只读可用性而返回原始令牌值。返回 `tokenStatus: "available"`（以及匹配的源字段）足以用于状态风格的命令。
- 当凭证通过 SecretRef 配置但在当前命令路径中不可用时，使用 `configured_unavailable`。

这让只读命令报告"在此命令路径中已配置但不可用"，而不是崩溃或错误报告账户未配置。

## 包元数据

原生插件必须将其可执行文件/运行时文件打包在 `crawclaw.plugin.json` 旁边。CrawClaw Desktop 和本地 Gateway API 在安装插件时不再运行 `npm install`，并且已发布包内容不能依赖生成的 `node_modules` 树。

旧的 `crawclaw.extensions`、`crawclaw.setupEntry` 和 `deferConfiguredChannelFullLoadUntilAfterListen` 包路径已随 TypeScript 插件运行时移除。原生能力设置/状态表面由 Rust 拥有。

## 记忆插件

自定义会话记忆行为现在位于内置记忆运行时路径上。插件仍可在其清单中声明 `kind: "memory"` 以参与独占记忆槽选择，但旧的 `context-engine` 注册 API 和插件自有压缩桥已移除。

## 添加新能力

当插件需要当前 API 不适合的行为时，不要通过私有内省访问绕过插件系统。添加缺失的能力。

推荐序列：

1. 定义核心契约
   决定核心应拥有的共享行为：策略、回退、配置合并、生命周期、面向渠道的语义和运行时辅助函数形状。
2. 添加 Rust 原生描述符或 Gateway RPC 表面
   使用最小有用的类型化能力表面扩展 Rust 自有的契约。
3. 连接核心 + 渠道/功能消费者
   渠道和功能插件应通过核心消费新能力，而不是直接导入供应商实现。
4. 声明供应商实现
   供应商插件然后通过 Rust 原生描述符声明其后端。
5. 添加契约覆盖
   添加测试以使所有权和描述符形状随时间保持明确。

这就是 CrawClaw 保持有主见而不会变得硬编码到单个提供商世界观的方式。请参阅[能力扩展手册](/tools/capability-cookbook)获取具体的文件检查清单和工作示例。

### 能力检查清单

当你添加新能力时，实现通常应一起触及这些表面：

- 拥有 crate 中的 Rust 契约类型
- 当功能/渠道插件需要消费运行时能力时的 Rust/原生描述符暴露
- 当操作员需要控制平面方法或状态表面时的 Gateway/运行时连接
- Rust 生成的捆绑能力元数据中的所有权/契约断言
- `docs/` 中的操作员/插件文档

如果其中一个表面缺失，这通常是该能力尚未完全集成的迹象。

### 能力模板

使用 Rust 插件 SDK 和原生描述符辅助函数作为模板。不要为新的生产级能力添加 TypeScript 注册回调或 TypeScript 契约测试。

这保持规则简单：

- 核心拥有能力契约 + 编排
- 供应商插件拥有供应商实现
- 功能/渠道插件消费运行时辅助函数
- 契约测试保持所有权明确
