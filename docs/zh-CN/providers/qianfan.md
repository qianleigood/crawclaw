---
read_when:
  - 你想要一个 API 密钥访问多种 LLM
  - 你需要 Baidu Qianfan 设置指南
summary: 使用 Qianfan 统一 API 在 CrawClaw 中访问多种模型
title: Qianfan
x-i18n:
  generated_at: "2026-06-05T14:45:10Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: aa997efa6e680974ec0e6bf53abd2a99535b11e3c3705078aa956832dc0bb07b
  source_path: providers/qianfan.md
  workflow: 15
---

# Qianfan 提供商指南

Qianfan 是百度的大模型 MaaS 平台，提供**统一 API**，通过单一端点和 API 密钥将请求路由到多种模型。它与 OpenAI 兼容，因此大多数 OpenAI SDK 通过切换 base URL 即可工作。

## 前置条件

1. 具有 Qianfan API 访问权限的百度云账户
2. Qianfan 控制台的 API 密钥
3. 系统上已安装 CrawClaw

## 获取你的 API 密钥

1. 访问 [Qianfan 控制台](https://console.bce.baidu.com/qianfan/ais/console/apiKey)
2. 创建新应用或选择现有应用
3. 生成 API 密钥（格式：`bce-v3/ALTAK-...`）
4. 复制 API 密钥用于 CrawClaw

## Desktop 设置

在 CrawClaw Desktop 中打开 **Settings → Models and replies → Add model**，
选择 Qianfan，粘贴 Qianfan API key，并保存 `qianfan/<model>` profile。连接
probe 通过后，Desktop 会把 key 存为本地 file SecretRef。

在 headless hosts 上，将 `QIANFAN_API_KEY` 设到 Gateway environment，或用
`config.patch` 将 `models.providers.qianfan.apiKey` patch 为 `env`、`file` 或
`exec` SecretRef。

## 相关文档

- [CrawClaw 配置](/gateway/configuration)
- [模型提供商](/concepts/model-providers)
- [智能体设置](/concepts/agent)
- [Qianfan API 文档](https://cloud.baidu.com/doc/qianfan-api/s/3m7of64lb)
