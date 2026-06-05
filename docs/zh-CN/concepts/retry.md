---
read_when:
  - 更新提供商重试行为或默认值
  - 调试提供商发送错误或速率限制
summary: 出站提供商调用的重试策略
title: 重试策略
x-i18n:
  generated_at: "2026-06-05T14:14:22Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: d18f375ef343f161406c5c9e2ea20c07f45ef083874e20192a94cb9bb3656450
  source_path: concepts/retry.md
  workflow: 15
---

# 重试策略

## 目标

- 按 HTTP 请求重试，而非按多步骤流程重试。
- 仅重试当前步骤以保持顺序。
- 避免重复非幂等操作。

## 默认值

- 重试次数：3
- 最大延迟上限：30000 毫秒
- 抖动：0.1（10%）
- 提供商默认值：
  - Feishu 最小延迟：400 毫秒
  - QQBot 最小延迟：500 毫秒

## 行为

### QQBot

- 仅在速率限制错误（HTTP 429）时重试。
- 优先使用 QQBot `retry_after`，否则使用指数退避。

### Feishu

- 在临时错误（429、超时、连接/重置/关闭、暂时不可用）时重试。
- 优先使用 `retry_after`，否则使用指数退避。
- Markdown 解析错误不会重试；回退到纯文本。

## 配置

在 `~/.crawclaw/crawclaw.json` 中按提供商设置重试策略：

```json5
{
  channels: {
    feishu: {
      retry: {
        attempts: 3,
        minDelayMs: 400,
        maxDelayMs: 30000,
        jitter: 0.1,
      },
    },
    qqbot: {
      retry: {
        attempts: 3,
        minDelayMs: 500,
        maxDelayMs: 30000,
        jitter: 0.1,
      },
    },
  },
}
```

## 注意事项

- 重试按请求（消息发送、媒体上传、反应、投票、贴纸）进行。
- 复合流程不会重试已完成的步骤。
