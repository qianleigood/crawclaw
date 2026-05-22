---
read_when:
  - 你需要添加或配置 LLM 提供商
  - 你正在从旧的 TypeScript 提供商插件 API 迁移
  - 你需要了解 models.providers
sidebarTitle: Providers
summary: 提供商插件已迁移到 Rust，现在如何配置模型提供商
title: 提供商配置
x-i18n:
  generated_at: "2026-05-22T02:13:06Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 3b1cdf35d8b8a2a1123a0bfbabbad038a9daad819f43084dc1de83718f16323b
  source_path: plugins/sdk-provider-plugins.md
  workflow: 15
---

# 提供商配置

CrawClaw 不再支持 TypeScript 模型提供商插件。旧的 TypeScript 提供商注册入口点、提供商目录钩子和提供商运行时钩子已被 Rust 插件 SDK、清单元数据和本机注册表取代。

提供商元数据、凭证选择、模型目录、配置 schema 和本机传输行为归 Rust 提供商注册表所有。Gateway 网关从该 Rust 注册表构建 `models.list`、`runtime.status`、`config.schema` 和 `config.schema.lookup`。

## 添加提供商

使用配置中的 `models.providers` 来添加自定义提供商：

```json
{
  "models": {
    "providers": {
      "acme-ai": {
        "baseUrl": "https://api.acme-ai.example/v1",
        "apiKey": { "source": "env", "id": "ACME_AI_API_KEY" },
        "api": "openai-completions",
        "models": [
          {
            "id": "acme-large",
            "name": "Acme Large",
            "reasoning": true,
            "input": ["text", "image"],
            "cost": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 },
            "contextWindow": 200000,
            "maxTokens": 32768
          }
        ]
      }
    }
  }
}
```

Rust schema 验证提供商条目结构、SecretRef 处理、传输适配器枚举和模型条目字段。

## 插件边界

TypeScript 插件不再注册生产工具、命令、服务、渠道、语音提供商、媒体理解提供商、Web 获取提供商、Web 搜索提供商、LLM 提供商或类型化生命周期钩子。

如果提供商需要成为内置的，请将其添加到 Rust 提供商注册表或相应的 Rust 本机插件注册表。保持包元数据声明式且非执行。

## 相关

- [模型提供商](/concepts/model-providers)
- [配置参考](/gateway/configuration-reference)
- [SDK 概览](/plugins/sdk-overview)
