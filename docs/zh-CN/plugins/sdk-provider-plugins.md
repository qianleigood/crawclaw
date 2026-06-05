---
read_when:
  - 你需要添加或配置一个 LLM 提供商
  - 你正在从旧的 TypeScript provider 插件 API 迁移
  - 你需要理解 models.providers
sidebarTitle: Providers
summary: 模型提供商现在如何在 provider 插件迁移到 Rust 后进行配置
title: 提供商配置
x-i18n:
  generated_at: "2026-06-05T14:42:12Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 155f9a13975e3534494f53bf31e14ef3c70075e205fd36fe97fb3dc905f9ba5c
  source_path: plugins/sdk-provider-plugins.md
  workflow: 15
---

# 提供商配置

CrawClaw 不再支持 TypeScript 模型提供商插件。旧的 TypeScript 提供商注册入口点、提供商目录钩子和提供商运行时钩子已被 Rust 插件 SDK、清单元数据和原生注册表取代。

提供商元数据、认证选项、模型目录、配置 schema 和原生传输行为由 Rust 提供商注册表所有。Gateway 从该 Rust 注册表构建 `models.list`、`runtime.status`、`config.schema` 和 `config.schema.lookup`。

## 添加提供商

使用配置中的 `models.providers` 添加自定义提供商：

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

Rust schema 验证提供商条目形状、SecretRef 处理、传输适配器枚举和模型条目字段。

`contextWindow` 和 `maxTokens` 由 Rust 运行时在编译下一个提供商上下文时使用。选定的提供商/模型在上下文组装之前被解析，然后 CrawClaw 减去输出预留、提供商开销和活跃工具 schema 估计值，以计算有效的提示词预算。

提供商模型能力应声明为模型元数据，而不是硬编码在核心路径中。`reasoning: false` 禁用该模型的推理努力控制，`input: ["text"]` 导致图像块被省略，`compat.supportsTools: false` 在一轮中保留工具 schema。同样的模型元数据也驱动桌面 `contextSummary` 能力字段，以便用户能看到请求被降级的原因。

提供商传输字符串仅是配置契约值。运行时将它们解析为类型化传输枚举，并通过 Rust 传输适配器分发，因此新的内置提供商应扩展注册表和适配器表，而不是在运行时代码中添加分散的字符串分支。

## 插件边界

TypeScript 插件不再注册生产工具、命令、服务、渠道、语音提供商、媒体理解提供商、Web 获取提供商、Web 搜索提供商、LLM 提供商或类型化生命周期钩子。

如果一个提供商需要成为内置的，请将其添加到 Rust 提供商注册表或适当的 Rust 原生插件注册表。保持包元数据声明性且非执行性。

## 相关

- [模型提供商](/concepts/model-providers)
- [配置参考](/gateway/configuration-reference)
- [SDK 概览](/plugins/sdk-overview)
