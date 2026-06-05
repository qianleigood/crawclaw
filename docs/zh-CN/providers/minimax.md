---
read_when:
  - 你想在 CrawClaw 中使用 MiniMax 模型
  - 你需要 MiniMax 设置指导
summary: 在 CrawClaw 中使用 MiniMax 模型
title: MiniMax
x-i18n:
  generated_at: "2026-06-05T14:44:08Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 2b4ccb88a58fdeb08f4c6d36513b127848a68c518c387bc8edb15f338fbe0248
  source_path: providers/minimax.md
  workflow: 15
---

# MiniMax

CrawClaw 的 MiniMax 提供商默认使用 **MiniMax M2.7**。

## 模型阵容

- `MiniMax-M2.7`：默认托管文本模型。
- `MiniMax-M2.7-highspeed`：更快的 M2.7 文本层。
- `image-01`：图像生成模型（生成和图生图编辑）。

## 选择设置方式

### MiniMax M2.7（API 密钥）

**最适合：** 使用 Anthropic 兼容 API 的托管 MiniMax。

通过 CrawClaw Desktop 或本地 Gateway API 进行配置：

- 打开模型/认证设置
- 选择 **Model/auth**
- 选择 **MiniMax** 认证选项

```json5
{
  env: { MINIMAX_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "minimax/MiniMax-M2.7" } } },
  models: {
    mode: "merge",
    providers: {
      minimax: {
        baseUrl: "https://api.minimax.io/anthropic",
        apiKey: "${MINIMAX_API_KEY}",
        api: "anthropic-messages",
        models: [
          {
            id: "MiniMax-M2.7",
            name: "MiniMax M2.7",
            reasoning: true,
            input: ["text"],
            cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.12 },
            contextWindow: 200000,
            maxTokens: 8192,
          },
          {
            id: "MiniMax-M2.7-highspeed",
            name: "MiniMax M2.7 Highspeed",
            reasoning: true,
            input: ["text"],
            cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.12 },
            contextWindow: 200000,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
}
```

### MiniMax M2.7 作为备用（示例）

**最适合：** 将你最强大的最新一代模型作为主模型，失败时切换到 MiniMax M2.7。
以下示例使用 Opus 作为具体的主模型；请替换为你首选的最新一代主模型。

```json5
{
  env: { MINIMAX_API_KEY: "sk-..." },
  agents: {
    defaults: {
      models: {
        "anthropic/claude-opus-4-6": { alias: "primary" },
        "minimax/MiniMax-M2.7": { alias: "minimax" },
      },
      model: {
        primary: "anthropic/claude-opus-4-6",
        fallbacks: ["minimax/MiniMax-M2.7"],
      },
    },
  },
}
```

## 通过 CrawClaw Desktop 或本地 Gateway API 进行配置

使用交互式配置向导无需编辑 JSON 即可设置 MiniMax：

1. 运行 CrawClaw Desktop 或本地 Gateway API。
2. 选择 **Model/auth**。
3. 选择 **MiniMax** 认证选项。
4. 出现提示时选择你的默认模型。

## 配置选项

- `models.providers.minimax.baseUrl`：优先使用 `https://api.minimax.io/anthropic`（Anthropic 兼容）；`https://api.minimax.io/v1` 可选用于 OpenAI 兼容负载。
- `models.providers.minimax.api`：优先使用 `anthropic-messages`；`openai-completions` 可选用于 OpenAI 兼容负载。
- `models.providers.minimax.apiKey`：MiniMax API 密钥（`MINIMAX_API_KEY`）。
- `models.providers.minimax.models`：定义 `id`、`name`、`reasoning`、`contextWindow`、`maxTokens`、`cost`。
- `agents.defaults.models`：为你想要在白名单中的模型设置别名。
- `models.mode`：如果要将 MiniMax 与内置模型一起添加，请保持 `merge`。

## 注意事项

- 模型引用格式为 `minimax/<model>`。
- 默认文本模型：`MiniMax-M2.7`。
- 备用文本模型：`MiniMax-M2.7-highspeed`。
- Coding Plan 使用量 API：`https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains`（需要 coding plan 密钥）。
- 如果你需要精确的成本跟踪，请在 `models.json` 中更新定价值。
- MiniMax Coding Plan 推荐链接（九折）：[https://platform.minimax.io/subscribe/coding-plan?code=DbXJTRClnb&source=link](https://platform.minimax.io/subscribe/coding-plan?code=DbXJTRClnb&source=link)
- 有关提供商规则，请参阅 [/concepts/model-providers](/concepts/model-providers)。
- 使用 CrawClaw Desktop 或本地 Gateway API 切换模型。

## 故障排除

### "Unknown model: minimax/MiniMax-M2.7"

这通常意味着 **MiniMax 提供商未配置**（没有提供商条目且未找到 MiniMax 认证配置/环境密钥）。此检测的修复在 **2026.1.12** 中。修复方法：

- 升级到 **2026.1.12**（或从源码 `main` 运行），然后重启 gateway。
- 运行 CrawClaw Desktop 或本地 Gateway API 并选择 **MiniMax** 认证选项，或
- 手动添加 `models.providers.minimax` 块，或
- 设置 `MINIMAX_API_KEY`（或 MiniMax 认证配置）以便注入提供商。

确保模型 id **区分大小写**：

- `minimax/MiniMax-M2.7`
- `minimax/MiniMax-M2.7-highspeed`

然后重新检查：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 实现自动化。
