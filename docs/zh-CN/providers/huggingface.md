---
read_when:
  - 你想在 CrawClaw 中使用 Hugging Face Inference
  - 你需要 HF token 环境变量或 CLI 认证选项
summary: Hugging Face Inference 设置（认证 + 模型选择）
title: Hugging Face (Inference)
x-i18n:
  generated_at: "2026-06-05T14:44:08Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: fa42f46b6d9dae5c46e4648dbcbfc69252b6c190a02625f9315d8caaa0659146
  source_path: providers/huggingface.md
  workflow: 15
---

# Hugging Face (Inference)

[Hugging Face Inference Providers](https://huggingface.co/docs/inference-providers) 通过单一路由 API 提供 OpenAI 兼容的聊天补全。你用一个 token 就能访问多种模型（DeepSeek、Llama 等）。CrawClaw 使用 **OpenAI 兼容端点**（仅聊天补全）；对于文生图、嵌入或语音，请直接使用 [HF inference clients](https://huggingface.co/docs/api-inference/quicktour)。

- 提供商：`huggingface`
- 认证：`HUGGINGFACE_HUB_TOKEN` 或 `HF_TOKEN`（细粒度 token，具有 **Make calls to Inference Providers** 权限）
- API：OpenAI 兼容（`https://router.huggingface.co/v1`）
- 计费：单一 HF token；[定价](https://huggingface.co/docs/inference-providers/pricing) 遵循提供商费率，有免费层级。

## 快速开始

1. 在 [Hugging Face → Settings → Tokens](https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained) 创建具有 **Make calls to Inference Providers** 权限的细粒度 token。
2. 运行新手引导并在提供商下拉列表中选择 **Hugging Face**，然后在提示时输入你的 API key：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

3. 在 **Default Hugging Face model** 下拉列表中，选择你想要的模型（当你有有效 token 时，列表从 Inference API 加载；否则显示内置列表）。你的选择将保存为默认模型。
4. 你也可以稍后在配置中设置或更改默认模型：

```json5
{
  agents: {
    defaults: {
      model: { primary: "huggingface/deepseek-ai/DeepSeek-R1" },
    },
  },
}
```

## 非交互式示例

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

这会将 `huggingface/deepseek-ai/DeepSeek-R1` 设置为默认模型。

## 环境说明

如果 Gateway 作为守护进程运行（launchd/systemd），请确保 `HUGGINGFACE_HUB_TOKEN` 或 `HF_TOKEN`对该进程可用（例如，在 `~/.crawclaw/.env` 或通过 `env.shellEnv`）。

## 模型发现和新手引导下拉列表

CrawClaw 通过直接调用 **Inference 端点**来发现模型：

```bash
GET https://router.huggingface.co/v1/models
```

（可选：发送 `Authorization: Bearer $HUGGINGFACE_HUB_TOKEN` 或 `$HF_TOKEN` 以获取完整列表；某些端点在没有认证时返回子集。）响应是 OpenAI 风格的 `{ "object": "list", "data": [ { "id": "Qwen/Qwen3-8B", "owned_by": "Qwen", ... }, ... ] }`。

当你配置 Hugging Face API key（通过新手引导、`HUGGINGFACE_HUB_TOKEN` 或 `HF_TOKEN`）时，CrawClaw 使用此 GET 发现可用的聊天补全模型。在**交互式设置**期间，在你输入 token 后，你会看到 **Default Hugging Face model** 下拉列表，其中填充了该列表（如果请求失败则为内置目录）。在运行时（例如 Gateway 启动），当 key 存在时，CrawClaw 再次调用 **GET** `https://router.huggingface.co/v1/models` 来刷新目录。该列表与内置目录合并（用于上下文窗口和成本等元数据）。如果请求失败或未设置 key，则仅使用内置目录。

## 模型名称和可编辑选项

- **API 返回的名称：** 模型显示名称在 API 返回 `name`、`title` 或 `display_name` 时从 **GET /v1/models** 提取；否则从模型 id 派生（例如 `deepseek-ai/DeepSeek-R1` → "DeepSeek R1"）。
- **覆盖显示名称：** 你可以在配置中为每个模型设置自定义标签，以便在 CLI 和 UI 中按你想要的方式显示：

```json5
{
  agents: {
    defaults: {
      models: {
        "huggingface/deepseek-ai/DeepSeek-R1": { alias: "DeepSeek R1 (fast)" },
        "huggingface/deepseek-ai/DeepSeek-R1:cheapest": { alias: "DeepSeek R1 (cheap)" },
      },
    },
  },
}
```

- **提供商/策略选择：** 在 **模型 id** 后附加后缀以选择路由器选择后端的方式：
  - **`:fastest`** — 最高吞吐量（路由器选择；提供商选择**已锁定**——无交互式后端选择器）。
  - **`:cheapest`** — 每输出 token 最低成本（路由器选择；提供商选择**已锁定**）。
  - **`:provider`** — 强制使用特定后端（例如 `:sambanova`、`:together`）。

  当你选择 **:cheapest** 或 **:fastest**（例如在新手引导模型下拉列表中）时，提供商已锁定：路由器按成本或速度决定，不显示可选的"偏好特定后端"步骤。你可以将这些作为 `models.providers.huggingface.models` 中的单独条目添加，或使用后缀设置 `model.primary`。你也可以在 [Inference Provider 设置](https://hf.co/settings/inference-providers) 中设置默认顺序（无后缀 = 使用该顺序）。

- **配置合并：** 在配置合并时保留 `models.providers.huggingface.models` 中的现有条目（例如在 `models.json` 中）。因此你在那里设置的任何自定义 `name`、`alias` 或模型选项都会被保留。

## 模型 ID 和配置示例

模型引用使用 `huggingface/<org>/<model>` 形式（Hub 风格 ID）。以下列表来自 **GET** `https://router.huggingface.co/v1/models`；你的目录可能包含更多。

**示例 ID（来自 inference 端点）：**

| 模型                   | 引用（添加 `huggingface/` 前缀）    |
| ---------------------- | ----------------------------------- |
| DeepSeek R1            | `deepseek-ai/DeepSeek-R1`           |
| DeepSeek V3.2          | `deepseek-ai/DeepSeek-V3.2`         |
| Qwen3 8B               | `Qwen/Qwen3-8B`                     |
| Qwen2.5 7B Instruct    | `Qwen/Qwen2.5-7B-Instruct`          |
| Qwen3 32B              | `Qwen/Qwen3-32B`                    |
| Llama 3.3 70B Instruct | `meta-llama/Llama-3.3-70B-Instruct` |
| Llama 3.1 8B Instruct  | `meta-llama/Llama-3.1-8B-Instruct`  |
| GPT-OSS 120B           | `openai/gpt-oss-120b`               |
| GLM 4.7                | `zai-org/GLM-4.7`                   |
| Kimi K2.5              | `moonshotai/Kimi-K2.5`              |

你可以将 `:fastest`、`:cheapest` 或 `:provider`（例如 `:together`、`:sambanova`）附加到模型 id。在 [Inference Provider 设置](https://hf.co/settings/inference-providers) 中设置默认顺序；请参见 [Inference Providers](https://huggingface.co/docs/inference-providers) 和 **GET** `https://router.huggingface.co/v1/models` 获取完整列表。

### 完整配置示例

**以 DeepSeek R1 为主，Qwen 为备选：**

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "huggingface/deepseek-ai/DeepSeek-R1",
        fallbacks: ["huggingface/Qwen/Qwen3-8B"],
      },
      models: {
        "huggingface/deepseek-ai/DeepSeek-R1": { alias: "DeepSeek R1" },
        "huggingface/Qwen/Qwen3-8B": { alias: "Qwen3 8B" },
      },
    },
  },
}
```

**Qwen 为默认，带 :cheapest 和 :fastest 变体：**

```json5
{
  agents: {
    defaults: {
      model: { primary: "huggingface/Qwen/Qwen3-8B" },
      models: {
        "huggingface/Qwen/Qwen3-8B": { alias: "Qwen3 8B" },
        "huggingface/Qwen/Qwen3-8B:cheapest": { alias: "Qwen3 8B (cheapest)" },
        "huggingface/Qwen/Qwen3-8B:fastest": { alias: "Qwen3 8B (fastest)" },
      },
    },
  },
}
```

**DeepSeek + Llama + GPT-OSS 带别名：**

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "huggingface/deepseek-ai/DeepSeek-V3.2",
        fallbacks: [
          "huggingface/meta-llama/Llama-3.3-70B-Instruct",
          "huggingface/openai/gpt-oss-120b",
        ],
      },
      models: {
        "huggingface/deepseek-ai/DeepSeek-V3.2": { alias: "DeepSeek V3.2" },
        "huggingface/meta-llama/Llama-3.3-70B-Instruct": { alias: "Llama 3.3 70B" },
        "huggingface/openai/gpt-oss-120b": { alias: "GPT-OSS 120B" },
      },
    },
  },
}
```

**使用 :provider 强制特定后端：**

```json5
{
  agents: {
    defaults: {
      model: { primary: "huggingface/deepseek-ai/DeepSeek-R1:together" },
      models: {
        "huggingface/deepseek-ai/DeepSeek-R1:together": { alias: "DeepSeek R1 (Together)" },
      },
    },
  },
}
```

**多个 Qwen 和 DeepSeek 模型，带策略后缀：**

```json5
{
  agents: {
    defaults: {
      model: { primary: "huggingface/Qwen/Qwen2.5-7B-Instruct:cheapest" },
      models: {
        "huggingface/Qwen/Qwen2.5-7B-Instruct": { alias: "Qwen2.5 7B" },
        "huggingface/Qwen/Qwen2.5-7B-Instruct:cheapest": { alias: "Qwen2.5 7B (cheap)" },
        "huggingface/deepseek-ai/DeepSeek-R1:fastest": { alias: "DeepSeek R1 (fast)" },
        "huggingface/meta-llama/Llama-3.1-8B-Instruct": { alias: "Llama 3.1 8B" },
      },
    },
  },
}
```
