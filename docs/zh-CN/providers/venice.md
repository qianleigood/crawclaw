---
read_when:
  - 你想在 CrawClaw 中进行隐私优先推理
  - 你需要 Venice AI 设置指导
summary: 在 CrawClaw 中使用 Venice AI 隐私优先模型
title: Venice AI
x-i18n:
  generated_at: "2026-06-05T14:46:12Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: e9c86f41fdc4160159c3efd5f59915ba06111ddcc10f8c210c91d71839ecb961
  source_path: providers/venice.md
  workflow: 15
---

# Venice AI（Venice 亮点）

**Venice** 是我们为隐私优先推理（可选匿名访问专有模型）精选的 Venice 设置。

Venice AI 提供注重隐私的 AI 推理，支持未审查模型并可通过其匿名代理访问主要专有模型。所有推理默认私密——不对你的数据进行训练，不记录日志。

## 为什么在 CrawClaw 中使用 Venice

- **私密推理**：开源模型（无日志记录）。
- **未审查模型**：当你需要时。
- **匿名访问**：当质量重要时，通过专有模型（Opus/GPT/Gemini）的匿名代理访问。
- OpenAI 兼容 `/v1` 端点。

## 隐私模式

Venice 提供两个隐私级别——理解这一点对于选择模型至关重要：

| 模式     | 描述                                                                                         | 模型                                                        |
| -------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **私密** | 完全私密。提示/响应**永不存储或记录**。临时性的。                                            | Llama、Qwen、DeepSeek、Kimi、 MiniMax、Venice Uncensored 等 |
| **匿名** | 通过 Venice 代理，剥离元数据。底层提供商（OpenAI、Anthropic、Google、xAI）看到的是匿名请求。 | Claude、GPT、Gemini、Grok                                   |

## 功能

- **注重隐私**：在"私密"（完全私密）和"匿名"（代理）模式之间选择
- **未审查模型**：访问无内容限制的模型
- **主要模型访问**：通过 Venice 的匿名代理使用 Claude、GPT、Gemini 和 Grok
- **OpenAI 兼容 API**：标准 `/v1` 端点，易于集成
- **流式传输**：✅ 所有模型均支持
- **函数调用**：✅ 部分模型支持（检查模型能力）
- **视觉**：✅ 具有视觉能力的模型支持
- **无硬速率限制**：极端使用情况下可能适用公平使用节流

## 设置

### 1. 获取 API Key

1. 在 [venice.ai](https://venice.ai) 注册
2. 进入 **Settings → API Keys → Create new key**
3. 复制你的 API key（格式：`vapi_xxxxxxxxxxxx`）

### 2. 配置 CrawClaw

**选项 A：环境变量**

```bash
export VENICE_API_KEY="vapi_xxxxxxxxxxxx"
```

**选项 B：交互式设置（推荐）**

打开 **CrawClaw Desktop → Settings → Models and replies → Add model**，选择
**Venice AI**，粘贴 API key，然后选择默认 Venice 模型。Desktop 会在保存前探测
Venice 目录，并将凭证材料保存为本地 runtime secret。

这将：

1. 提示输入你的 API key（或使用现有 `VENICE_API_KEY`）
2. 显示所有可用的 Venice 模型
3. 让你选择默认模型
4. 自动配置提供商

**选项 C：非交互式**

对于 headless 自动化，将 `VENICE_API_KEY` 暴露给 Gateway 进程，并使用本地
Gateway API patch 提供商和默认模型。先用 `config.get` 获取当前 config hash，
然后用 merge patch 调用 `config.patch`：

```json5
{
  method: "config.patch",
  params: {
    baseHash: "<hash from config.get>",
    raw: '{ agents: { defaults: { model: { primary: "venice/kimi-k2-5" } } }, models: { mode: "merge", providers: { venice: { baseUrl: "https://api.venice.ai/api/v1", apiKey: "${VENICE_API_KEY}", api: "openai-completions" } } } }',
  },
}
```

### 3. 验证设置

使用 CrawClaw Desktop 的模型状态界面，或在活动聊天中使用 `/model status`。
自动化场景下，调用 `models.list` 确认 Venice 目录可见，并调用
`usage.status` 确认 Venice provider 已配置：

```bash
curl -sS http://127.0.0.1:18789/api/gateway/rpc \
  -H 'Authorization: Bearer <gateway-token-or-password>' \
  -H 'Content-Type: application/json' \
  -d '{ "method": "models.list", "params": {} }'

curl -sS http://127.0.0.1:18789/api/gateway/rpc \
  -H 'Authorization: Bearer <gateway-token-or-password>' \
  -H 'Content-Type: application/json' \
  -d '{ "method": "usage.status", "params": {} }'
```

## 模型选择

设置后，CrawClaw 显示所有可用的 Venice 模型。根据你的需求选择：

- **默认模型**：`venice/kimi-k2-5` 用于强大的私密推理加视觉。
- **高能力选项**：`venice/claude-opus-4-6` 用于最强的匿名 Venice 路径。
- **隐私**：选择"私密"模型进行完全私密推理。
- **能力**：选择"匿名"模型通过 Venice 代理访问 Claude、GPT、Gemini。

随时更改默认模型：

使用 CrawClaw Desktop 模型选择器，或通过本地 Gateway API patch
`agents.defaults.model.primary`：

```json5
{
  method: "config.patch",
  params: {
    baseHash: "<hash from config.get>",
    raw: '{ agents: { defaults: { model: { primary: "venice/claude-opus-4-6" } } } }',
  },
}
```

列出所有可用模型：

调用 `models.list`，并筛选返回的模型条目中 `provider == "venice"` 的项。

## 通过 CrawClaw Desktop 或本地 Gateway API 配置

1. 运行 CrawClaw Desktop 或本地 Gateway API
2. 选择 **Model/auth**
3. 选择 **Venice AI**

## 我应该使用哪个模型？

| 用例                 | 推荐模型                         | 原因                                 |
| -------------------- | -------------------------------- | ------------------------------------ |
| **通用聊天（默认）** | `kimi-k2-5`                      | 强大的私密推理加视觉                 |
| **最佳整体质量**     | `claude-opus-4-6`                | 最强的匿名 Venice 选项               |
| **隐私 + 编码**      | `qwen3-coder-480b-a35b-instruct` | 具有大上下文窗口的私密编码模型       |
| **私密视觉**         | `kimi-k2-5`                      | 无需离开私密模式即可获得视觉支持     |
| **快速 + 便宜**      | `qwen3-4b`                       | 轻量级推理模型                       |
| **复杂私密任务**     | `deepseek-v3.2`                  | 强大的推理能力，但无 Venice 工具支持 |
| **未审查**           | `venice-uncensored`              | 无内容限制                           |

## 可用模型（41 个总计）

### 私密模型（26 个）——完全私密，无日志记录

| 模型 ID                                | 名称                                 | 上下文 | 功能             |
| -------------------------------------- | ------------------------------------ | ------ | ---------------- |
| `kimi-k2-5`                            | Kimi K2.5                            | 256k   | 默认、推理、视觉 |
| `kimi-k2-thinking`                     | Kimi K2 Thinking                     | 256k   | 推理             |
| `llama-3.3-70b`                        | Llama 3.3 70B                        | 128k   | 通用             |
| `llama-3.2-3b`                         | Llama 3.2 3B                         | 128k   | 通用             |
| `hermes-3-llama-3.1-405b`              | Hermes 3 Llama 3.1 405B              | 128k   | 通用，工具禁用   |
| `qwen3-235b-a22b-thinking-2507`        | Qwen3 235B Thinking                  | 128k   | 推理             |
| `qwen3-235b-a22b-instruct-2507`        | Qwen3 235B Instruct                  | 128k   | 通用             |
| `qwen3-coder-480b-a35b-instruct`       | Qwen3 Coder 480B                     | 256k   | 编码             |
| `qwen3-coder-480b-a35b-instruct-turbo` | Qwen3 Coder 480B Turbo               | 256k   | 编码             |
| `qwen3-5-35b-a3b`                      | Qwen3.5 35B A3B                      | 256k   | 推理、视觉       |
| `qwen3-next-80b`                       | Qwen3 Next 80B                       | 256k   | 通用             |
| `qwen3-vl-235b-a22b`                   | Qwen3 VL 235B（视觉）                | 256k   | 视觉             |
| `qwen3-4b`                             | Venice Small（Qwen3 4B）             | 32k    | 快速、推理       |
| `deepseek-v3.2`                        | DeepSeek V3.2                        | 160k   | 推理，工具禁用   |
| `venice-uncensored`                    | Venice Uncensored（Dolphin-Mistral） | 32k    | 未审查，工具禁用 |
| `mistral-31-24b`                       | Venice Medium（Mistral）             | 128k   | 视觉             |
| `google-gemma-3-27b-it`                | Google Gemma 3 27B Instruct          | 198k   | 视觉             |
| `openai-gpt-oss-120b`                  | OpenAI GPT OSS 120B                  | 128k   | 通用             |
| `nvidia-nemotron-3-nano-30b-a3b`       | NVIDIA Nemotron 3 Nano 30B           | 128k   | 通用             |
| `olafangensan-glm-4.7-flash-heretic`   | GLM 4.7 Flash Heretic                | 128k   | 推理             |
| `zai-org-glm-4.6`                      | GLM 4.6                              | 198k   | 通用             |
| `zai-org-glm-4.7`                      | GLM 4.7                              | 198k   | 推理             |
| `zai-org-glm-4.7-flash`                | GLM 4.7 Flash                        | 128k   | 推理             |
| `zai-org-glm-5`                        | GLM 5                                | 198k   | 推理             |
| `minimax-m21`                          | MiniMax M2.1                         | 198k   | 推理             |
| `minimax-m25`                          | MiniMax M2.5                         | 198k   | 推理             |

### 匿名模型（15 个）——通过 Venice 代理

| 模型 ID                         | 名称                             | 上下文 | 功能             |
| ------------------------------- | -------------------------------- | ------ | ---------------- |
| `claude-opus-4-6`               | Claude Opus 4.6（通过 Venice）   | 1M     | 推理、视觉       |
| `claude-opus-4-5`               | Claude Opus 4.5（通过 Venice）   | 198k   | 推理、视觉       |
| `claude-sonnet-4-6`             | Claude Sonnet 4.6（通过 Venice） | 1M     | 推理、视觉       |
| `claude-sonnet-4-5`             | Claude Sonnet 4.5（通过 Venice） | 198k   | 推理、视觉       |
| `openai-gpt-54`                 | GPT-5.4（通过 Venice）           | 1M     | 推理、视觉       |
| `openai-gpt-53-codex`           | GPT-5.3 Codex（通过 Venice）     | 400k   | 推理、视觉、编码 |
| `openai-gpt-52`                 | GPT-5.2（通过 Venice）           | 256k   | 推理             |
| `openai-gpt-52-codex`           | GPT-5.2 Codex（通过 Venice）     | 256k   | 推理、视觉、编码 |
| `openai-gpt-4o-2024-11-20`      | GPT-4o（通过 Venice）            | 128k   | 视觉             |
| `openai-gpt-4o-mini-2024-07-18` | GPT-4o Mini（通过 Venice）       | 128k   | 视觉             |
| `gemini-3-1-pro-preview`        | Gemini 3.1 Pro（通过 Venice）    | 1M     | 推理、视觉       |
| `gemini-3-pro-preview`          | Gemini 3 Pro（通过 Venice）      | 198k   | 推理、视觉       |
| `gemini-3-flash-preview`        | Gemini 3 Flash（通过 Venice）    | 256k   | 推理、视觉       |
| `grok-41-fast`                  | Grok 4.1 Fast（通过 Venice）     | 1M     | 推理、视觉       |
| `grok-code-fast-1`              | Grok Code Fast 1（通过 Venice）  | 256k   | 推理、编码       |

## 模型发现

当设置 `VENICE_API_KEY` 时，CrawClaw 自动从 Venice API 发现模型。如果 API 不可达，它会回退到静态目录。

`/models` 端点是公开的（列表无需认证），但推理需要有效的 API key。

## 流式传输和工具支持

| 功能          | 支持情况                                                 |
| ------------- | -------------------------------------------------------- |
| **流式传输**  | ✅ 所有模型                                              |
| **函数调用**  | ✅ 大多数模型（在 API 中检查 `supportsFunctionCalling`） |
| **视觉/图像** | ✅ 标有"视觉"功能的模型                                  |
| **JSON 模式** | ✅ 通过 `response_format` 支持                           |

## 定价

Venice 使用积分系统。查看 [venice.ai/pricing](https://venice.ai/pricing) 了解当前费率：

- **私密模型**：通常成本较低
- **匿名模型**：类似于直接 API 定价加上少量 Venice 费用

## 对比：Venice 与直接 API

| 方面     | Venice（匿名）   | 直接 API     |
| -------- | ---------------- | ------------ |
| **隐私** | 元数据剥离，匿名 | 你的账户关联 |
| **延迟** | +10-50ms（代理） | 直接         |
| **功能** | 支持大多数功能   | 完整功能     |
| **计费** | Venice 积分      | 提供商计费   |

## 使用示例

配置完成后，在 CrawClaw Desktop 中选择 `venice/...` 模型，或将其设为 agent
默认模型：

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "venice/kimi-k2-5",
        fallbacks: ["venice/claude-opus-4-6"],
      },
    },
  },
}
```

## 故障排除

### API key 无法识别

```bash
echo $VENICE_API_KEY
```

确保 key 以 `vapi_` 开头。

### 模型不可用

Venice 模型目录动态更新。运行 CrawClaw Desktop 或本地 Gateway API 查看当前可用的模型。某些模型可能暂时离线。

### 连接问题

Venice API 位于 `https://api.venice.ai/api/v1`。确保你的网络允许 HTTPS 连接。

## 配置文件示例

```json5
{
  env: { VENICE_API_KEY: "vapi_..." },
  agents: { defaults: { model: { primary: "venice/kimi-k2-5" } } },
  models: {
    mode: "merge",
    providers: {
      venice: {
        baseUrl: "https://api.venice.ai/api/v1",
        apiKey: "${VENICE_API_KEY}",
        api: "openai-completions",
        models: [
          {
            id: "kimi-k2-5",
            name: "Kimi K2.5",
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 256000,
            maxTokens: 65536,
          },
        ],
      },
    },
  },
}
```

## 链接

- [Venice AI](https://venice.ai)
- [API 文档](https://docs.venice.ai)
- [定价](https://venice.ai/pricing)
- [状态](https://status.venice.ai)
