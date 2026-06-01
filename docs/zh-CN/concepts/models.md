---
read_when:
  - 更改模型回退行为或选择 UX
  - 更新模型提供商设置或探测逻辑
summary: 模型选择、默认值、别名、回退和提供商状态
title: 模型
---

# 模型

使用 CrawClaw Desktop 添加提供商、认证账户、选择默认模型并检查可用模型。自动化场景使用本地 Gateway API。

凭证配置轮换、冷却时间以及它们如何与回退交互，请参阅 [/concepts/model-failover](/concepts/model-failover)。快速提供商概览和示例请参阅 [/concepts/model-providers](/concepts/model-providers)。

## 模型选择的工作方式

CrawClaw 按以下顺序选择模型：

1. **主模型**（`agents.defaults.model.primary` 或 `agents.defaults.model`）。
2. **回退模型**（`agents.defaults.model.fallbacks`，按顺序）。
3. **提供商凭证故障切换**，在单个提供商内部先发生，然后才移动到下一个模型。

相关配置：

- `agents.defaults.models` 是 CrawClaw 可使用的模型 allowlist/catalog 和别名。
- `agents.defaults.imageModel` 只在主模型不能接受图像时使用。
- 单个 agent 可以通过 `agents.list[].model` 覆盖默认模型。

## 快速模型策略

- 将主模型设置为你可用的最新一代强模型。
- 对成本、延迟敏感或风险较低的聊天任务使用回退模型。
- 对启用工具的 agent 或不可信输入，避免使用较旧或较弱的模型层级。

## 设置

从 CrawClaw Desktop 设置页配置 provider。高级自动化可以通过 Gateway API patch provider config，然后刷新 Desktop 状态。

## 配置键

- `agents.defaults.model.primary` 和 `agents.defaults.model.fallbacks`
- `agents.defaults.imageModel.primary` 和 `agents.defaults.imageModel.fallbacks`
- `agents.defaults.models`，用于 allowlist、catalog 和 aliases
- `models.providers`，用于写入 `models.json` 的自定义 provider

模型引用会被规范化为小写。`z.ai/*` 这类 provider alias 会规范化为 `zai/*`。

## 聊天中的模型切换

用户可以在聊天中使用 `/model`、`/model list`、`/model status` 和 `/model <provider/model>` 为当前会话选择模型。具体命令行为见 [Slash commands](/tools/slash-commands)。

## 动态上下文窗口

不同模型支持的上下文窗口不同。当前 runtime 不应依赖文档里的固定窗口值；它通过 provider catalog 和 runtime model metadata 取得模型能力，再结合 `reserveTokens`、`keepRecentTokens`、工具结果投影和压缩策略决定是否压缩或裁剪。

## 模型注册表

`models.providers` 中的自定义 provider 会写入 agent 目录下的 `models.json`（默认是 `~/.crawclaw/agents/<agentId>/agent/models.json`）。默认行为是合并该文件，除非将 `models.mode` 设置为 `replace`。

匹配 provider ID 时：

- agent `models.json` 中已有的非空 `baseUrl` 优先。
- SecretRef 管理的 `apiKey` 和 header 值会从源标记刷新，而不是把解析后的 secret 持久化。
- 空或缺失的 `apiKey`/`baseUrl` 会回退到配置中的 `models.providers`。

## 延伸阅读

- [模型提供商](/concepts/model-providers)
- [模型故障切换](/concepts/model-failover)
- [多智能体路由](/concepts/multi-agent)
