---
read_when:
  - 诊断凭证配置轮换、冷却或模型回退行为
  - 更新凭证配置或模型的故障转移规则
summary: CrawClaw 如何轮换凭证配置并在模型间回退
title: 模型故障转移
x-i18n:
  generated_at: "2026-06-05T14:13:28Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: ead948e4f2972bc22a2731c1aed264d31b33271a83c2ebf8944711a0b1fc4f43
  source_path: concepts/model-failover.md
  workflow: 15
---

# 模型故障转移

CrawClaw 分两个阶段处理故障：

1. 在当前提供商内**轮换凭证配置**。
2. **模型回退**到 `agents.defaults.model.fallbacks` 中的下一个模型。

本文档解释了运行时规则及其背后的数据。

## 凭证存储（密钥 + OAuth）

CrawClaw 对 API 密钥和 OAuth 令牌都使用**凭证配置**。

- 密钥存储在 `~/.crawclaw/agents/<agentId>/agent/auth-profiles.json`（旧版：`~/.crawclaw/agent/auth-profiles.json`）。
- 配置 `auth.profiles` / `auth.order` 仅为**元数据 + 路由**（不含密钥）。
- 旧版仅导入的 OAuth 文件：`~/.crawclaw/credentials/oauth.json`（首次使用时导入到 `auth-profiles.json`）。

更多详情：[/concepts/oauth](/concepts/oauth)

凭证类型：

- `type: "api_key"` → `{ provider, key }`
- `type: "oauth"` → `{ provider, access, refresh, expires, email? }`（+ 部分提供商的 `projectId`/`enterpriseUrl`）

## 配置 ID

OAuth 登录会创建独立的配置，以便多个账户共存。

- 默认值：无邮箱时为 `provider:default`。
- OAuth 带邮箱：`provider:<email>`（例如 `google-antigravity:user@gmail.com`）。

配置存储在 `auth-profiles.json` 的 `profiles` 下。

## 轮换顺序

当提供商有多个配置时，CrawClaw 按以下顺序选择：

1. **显式配置**：`auth.order[provider]`（如果已设置）。
2. **已配置的配置**：按提供商过滤的 `auth.profiles`。
3. **已存储的配置**：该提供商在 `auth-profiles.json` 中的条目。

如果没有配置显式顺序，CrawClaw 使用轮询顺序：

- **主键**：配置类型（**OAuth 优先于 API 密钥**）。
- **次键**：`usageStats.lastUsed`（每种类型内按最早使用排序）。
- **冷却/禁用的配置**移至末尾，按最早过期排序。

### 会话粘性（缓存友好）

CrawClaw **为每个会话固定所选凭证配置**以保持提供商缓存热状态。
它**不会**在每个请求时轮换。固定配置会重复使用直到：

- 会话重置（`/new`）
- 压缩完成（压缩计数递增）
- 配置处于冷却/禁用状态

通过 `/model …@<profileId>` 手动选择会为该会话设置**用户覆盖**，在新会话开始前不会自动轮换。

自动固定的配置（由会话路由器选择）被视为**偏好**：它们优先尝试，但 CrawClaw 可能会在速率限制/超时时轮换到其他配置。用户固定的配置会锁定到该配置；如果失败且配置了模型回退，CrawClaw 会转到下一个模型而不是切换配置。

### 为什么 OAuth 可能"看起来丢失"

如果你有同一提供商的 OAuth 配置和 API 密钥配置，除非已固定，否则轮询可能会在消息间切换。要强制使用单一配置：

- 通过 `auth.order[provider] = ["provider:profileId"]` 固定，或
- 通过 `/model …` 使用配置覆盖（当你的 UI/聊天界面支持时）。

## 冷却

当配置因认证/速率限制错误（或看起来像速率限制的超时）失败时，CrawClaw 会将其标记为冷却并转到下一个配置。格式/无效请求错误（例如 Cloud Code Assist 工具调用 ID 验证失败）被视为值得故障转移，使用相同的冷却机制。
OpenAI 兼容的停止原因错误，如 `Unhandled stop reason: error`、`stop reason: error` 和 `reason: error`，被归类为超时/故障转移信号。

冷却使用指数退避：

- 1 分钟
- 5 分钟
- 25 分钟
- 1 小时（上限）

状态存储在 `auth-profiles.json` 的 `usageStats` 下：

```json
{
  "usageStats": {
    "provider:profile": {
      "lastUsed": 1736160000000,
      "cooldownUntil": 1736160600000,
      "errorCount": 2
    }
  }
}
```

## 计费禁用

计费/信用失败（例如"积分不足"/"信用余额过低"）被视为值得故障转移，但它们通常不是瞬态的。CrawClaw 不是使用短期冷却，而是将配置标记为**禁用**（使用更长的退避时间）并轮换到下一个配置/提供商。

状态存储在 `auth-profiles.json`：

```json
{
  "usageStats": {
    "provider:profile": {
      "disabledUntil": 1736178000000,
      "disabledReason": "billing"
    }
  }
}
```

默认值：

- 计费退避从 **5 小时**开始，每次计费失败翻倍，上限为 **24 小时**。
- 如果配置 24 小时未失败，退避计数器会重置（可配置）。
- 过载重试允许 **1 次同提供商配置轮换**后再进行模型回退。
- 过载重试默认使用 **0 毫秒退避**。

## 模型回退

如果提供商的所有配置都失败，CrawClaw 会转到 `agents.defaults.model.fallbacks` 中的下一个模型。这适用于认证失败、速率限制和耗尽配置轮换的超时（其他错误不会推进回退）。

过载和速率限制错误的处理比计费冷却更积极。默认情况下，CrawClaw 允许一次同提供商凭证配置重试，然后切换到下一个配置的模型回退而不等待。可通过 `auth.cooldowns.overloadedProfileRotations`、`auth.cooldowns.overloadedBackoffMs` 和 `auth.cooldowns.rateLimitedProfileRotations` 调整。

当运行以模型覆盖开始时（hooks 或 CLI），回退在尝试任何配置的回退后仍以 `agents.defaults.model.primary` 结束。

## 相关配置

参见 [Gateway 配置](/gateway/configuration)：

- `auth.profiles` / `auth.order`
- `auth.cooldowns.billingBackoffHours` / `auth.cooldowns.billingBackoffHoursByProvider`
- `auth.cooldowns.billingMaxHours` / `auth.cooldowns.failureWindowHours`
- `auth.cooldowns.overloadedProfileRotations` / `auth.cooldowns.overloadedBackoffMs`
- `auth.cooldowns.rateLimitedProfileRotations`
- `agents.defaults.model.primary` / `agents.defaults.model.fallbacks`
- `agents.defaults.imageModel` 路由

参见 [模型](/concepts/models) 获取更广泛的模型选择和回退概述。
