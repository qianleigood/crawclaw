---
read_when:
  - 你想在 CrawClaw 中使用 Qwen
  - 你之前使用过 Qwen OAuth
summary: 通过阿里巴巴云 Model Studio 使用 Qwen 模型
title: Qwen
x-i18n:
  generated_at: "2026-06-05T14:45:15Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: a6c8b99d07ddb4998af22ff4cd10169f24d41a53d65ec74c39628ac7a1ba8d04
  source_path: providers/qwen.md
  workflow: 15
---

# Qwen

<Warning>

**Qwen OAuth 已被移除。** 使用 `portal.qwen.ai` 端点的免费层 OAuth 集成
（`qwen-portal`）不再可用。
有关背景信息，请参阅 [Issue #49557](https://github.com/qianleigood/crawclaw/issues/49557)。

</Warning>

## 推荐：Model Studio（阿里云 Coding Plan）

使用 [Model Studio](/providers/qwen_modelstudio) 获取对 Qwen 模型（Qwen 3.5 Plus、GLM-4.7、Kimi K2.5 等）的官方支持访问。

在 CrawClaw Desktop 中打开 **Settings → Models and replies → Add model**，选择
Model Studio，并用你的 Alibaba Cloud API key 保存 Qwen model profile。在
headless hosts 上，按 Model Studio guide 操作，并配合 SecretRef-backed API key
使用 `config.patch`。

有关完整设置详情，请参阅 [Model Studio](/providers/qwen_modelstudio)。
