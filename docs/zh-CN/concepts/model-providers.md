---
read_when:
  - 你需要按提供商查看的模型设置参考
  - 你想要模型提供商的示例配置或桌面设置指导
summary: 模型提供商概览，包含示例配置和设置界面
title: 模型提供商
x-i18n:
  generated_at: "2026-06-05T14:14:52Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 91db316970364c78be95f57be09eb1d1e9026e23a58bae51720d1ec8cd9d2c8e
  source_path: concepts/model-providers.md
  workflow: 15
---

# 模型提供商

本页面涵盖 **LLM/模型提供商**（非 Weixin/Feishu 等聊天渠道）。
模型选择规则见 [/concepts/models](/concepts/models)。

## 快速规则

- 模型引用使用 `provider/model`（示例：`opencode/claude-opus-4-6`）。
- 如果你设置了 `agents.defaults.models`，它将成为允许列表。
- 设置界面：使用 CrawClaw Desktop 进行交互式模型/认证设置，或使用本地 Gateway API 进行自动化。
- 提供商元数据、认证选择、模型目录、配置 schema 和原生传输行为由 Rust 提供商注册表拥有。
- TypeScript 插件无法注册 LLM 提供商。使用 `models.providers` 添加自定义提供商条目。
- 原生提供商运行时 `capabilities` 是共享运行器元数据（提供商系列、转录/工具怪癖、传输/缓存提示）。它与[公共能力模型](/plugins/architecture#public-capability-model)不同。

## Rust 拥有的提供商行为

Rust 拥有 `models.list` 使用的提供商列表、`runtime.status` 显示的提供商状态，以及 `config.schema` 和 `config.schema.lookup` 暴露的配置 schema。捆绑的原生插件描述符注册非提供商能力，如语音、媒体理解或网络搜索。

只需共享 OpenAI 兼容聊天适配器的简单捆绑提供商在 `openai-completions` 上被编目为轻量预设。其提供商 ID 仍会出现在 `models.list`、桌面设置和模型选择器元数据中，但 Rust 仅在提供商需要自定义认证、URL、转录或响应处理时保留专用传输条目。

原生提供商传输通过类型化 Rust 传输枚举选择，然后路由到传输适配器，如 OpenAI Responses、OpenAI 兼容聊天补全、Anthropic Messages、Google Generate Content、Ollama 或 Bedrock Converse。配置文件仍使用稳定的字符串值如 `openai-completions`；字符串在请求构建边界处解析，因此提供商逻辑不会在临时字符串匹配上分支。

## API 密钥轮换

- 支持所选提供商的通用提供商轮换。
- 通过以下方式配置多个密钥：
  - `CRAWCLAW_LIVE_<PROVIDER>_KEY`（单个实时覆盖，最高优先级）
  - `<PROVIDER>_API_KEYS`（逗号或分号分隔列表）
  - `<PROVIDER>_API_KEY`（主密钥）
  - `<PROVIDER>_API_KEY_*`（编号列表，例如 `<PROVIDER>_API_KEY_1`）
- 对于 Google 提供商，`GOOGLE_API_KEY` 也作为后备包含。
- 密钥选择顺序保持优先级并去重值。
- 请求仅在速率限制响应时重试下一个密钥（例如 `429`、`rate_limit`、`quota`、`resource exhausted`）。
- 非速率限制失败立即失败；不尝试密钥轮换。
- 当所有候选密钥都失败时，返回最后尝试的错误。

## 内置提供商（Rust 注册表）

CrawClaw 附带 Rust 拥有的提供商注册表。这些提供商**不需要** `models.providers` 配置；只需设置认证并选择模型。

### OpenAI

- 提供商：`openai`
- 认证：`OPENAI_API_KEY`
- 可选轮换：`OPENAI_API_KEYS`、`OPENAI_API_KEY_1`、`OPENAI_API_KEY_2`，以及 `CRAWCLAW_LIVE_OPENAI_KEY`（单个覆盖）
- 示例模型：`openai/gpt-5.4`、`openai/gpt-5.4-pro`
- 设置：CrawClaw Desktop 或本地 Gateway API
- 默认传输为 `auto`（WebSocket 优先，SSE 后备）
- 通过 `agents.defaults.models["openai/<model>"].params.transport` 按模型覆盖（`"sse"`、`"websocket"` 或 `"auto"`）
- OpenAI Responses WebSocket 预热通过 `params.openaiWsWarmup` 默认启用（`true`/`false`）
- 可通过 `agents.defaults.models["openai/<model>"].params.serviceTier` 启用 OpenAI 优先处理
- `/fast` 和 `params.fastMode` 将直接的 `openai/*` Responses 请求映射到 `api.openai.com` 上的 `service_tier=priority`
- 当你想要显式层级而非共享 `/fast` 切换时，使用 `params.serviceTier`
- `openai/gpt-5.3-codex-spark` 在 CrawClaw 中故意被抑制，因为 live OpenAI API 会拒绝它；Spark 被视为仅限 Codex

```json5
{
  agents: { defaults: { model: { primary: "openai/gpt-5.4" } } },
}
```

### Anthropic

- 提供商：`anthropic`
- 认证：`ANTHROPIC_API_KEY` 或 `claude setup-token`
- 可选轮换：`ANTHROPIC_API_KEYS`、`ANTHROPIC_API_KEY_1`、`ANTHROPIC_API_KEY_2`，以及 `CRAWCLAW_LIVE_ANTHROPIC_KEY`（单个覆盖）
- 示例模型：`anthropic/claude-opus-4-6`
- 设置：CrawClaw Desktop 或本地 Gateway API；使用 Anthropic 订阅认证时粘贴 `claude setup-token`。
- 直接公共 Anthropic 请求支持共享的 `/fast` 切换和 `params.fastMode`，包括发送到 `api.anthropic.com` 的 API 密钥和 OAuth 认证流量；CrawClaw 将其映射到 Anthropic `service_tier`（`auto` vs `standard_only`）
- 策略注意：setup-token 支持是技术兼容性；Anthropic 过去曾在 Claude Code 之外阻止某些订阅使用。根据你的风险承受能力验证当前 Anthropic 条款。
- 建议：Anthropic API 密钥认证比订阅 setup-token 认证更安全，是推荐路径。

```json5
{
  agents: { defaults: { model: { primary: "anthropic/claude-opus-4-6" } } },
}
```

### OpenAI Code (Codex)

- 提供商：`openai-codex`
- 认证：现有的兼容 Codex 令牌配置文件或外部工具
- 示例模型：`openai-codex/gpt-5.4`
- 设置：CrawClaw Desktop 或本地 Gateway API
- 默认传输为 `auto`（WebSocket 优先，SSE 后备）
- 通过 `agents.defaults.models["openai-codex/<model>"].params.transport` 按模型覆盖（`"sse"`、`"websocket"` 或 `"auto"`）
- `params.serviceTier` 也在原生 Codex Responses 请求上转发（`chatgpt.com/backend-api`）
- 与直接的 `openai/*` 共享相同的 `/fast` 切换和 `params.fastMode` 配置；CrawClaw 将其映射到 `service_tier=priority`
- 当 Codex 目录暴露时，`openai-codex/gpt-5.3-codex-spark` 仍然可用；取决于授权
- CrawClaw 不再启动捆绑的 JavaScript Codex OAuth 登录流程。

```json5
{
  agents: { defaults: { model: { primary: "openai-codex/gpt-5.4" } } },
}
```

### OpenCode

- 认证：`OPENCODE_API_KEY`（或 `OPENCODE_ZEN_API_KEY`）
- Zen 运行时提供商：`opencode`
- Go 运行时提供商：`opencode-go`
- 示例模型：`opencode/claude-opus-4-6`、`opencode-go/kimi-k2.5`
- 设置：CrawClaw Desktop 或本地 Gateway API

```json5
{
  agents: { defaults: { model: { primary: "opencode/claude-opus-4-6" } } },
}
```

### Google Gemini (API 密钥)

- 提供商：`google`
- 认证：`GEMINI_API_KEY`
- 可选轮换：`GEMINI_API_KEYS`、`GEMINI_API_KEY_1`、`GEMINI_API_KEY_2`、`GOOGLE_API_KEY` 后备，以及 `CRAWCLAW_LIVE_GEMINI_KEY`（单个覆盖）
- 示例模型：`google/gemini-3.1-pro-preview`、`google/gemini-3-flash-preview`
- 兼容性：使用 `google/gemini-3.1-flash-preview` 的旧版 CrawClaw 配置已规范化为 `google/gemini-3-flash-preview`
- 设置：CrawClaw Desktop 或本地 Gateway API

### Google Vertex

- 提供商：`google-vertex`
- 认证：Vertex 使用 gcloud ADC。
  - 启用：CrawClaw Desktop 或本地 Gateway API
  - 登录：CrawClaw Desktop 或本地 Gateway API

### Z.AI (GLM)

- 提供商：`zai`
- 认证：`ZAI_API_KEY`
- 示例模型：`zai/glm-5`
- 设置：CrawClaw Desktop 或本地 Gateway API
  - 别名：`z.ai/*` 和 `z-ai/*` 规范化为 `zai/*`

### Vercel AI Gateway

- 提供商：`vercel-ai-gateway`
- 认证：`AI_GATEWAY_API_KEY`
- 示例模型：`vercel-ai-gateway/anthropic/claude-opus-4.6`
- 设置：CrawClaw Desktop 或本地 Gateway API

### Kilo Gateway

- 提供商：`kilocode`
- 认证：`KILOCODE_API_KEY`
- 示例模型：`kilocode/anthropic/claude-opus-4.6`
- 设置：CrawClaw Desktop 或本地 Gateway API
- Base URL：`https://api.kilo.ai/api/gateway/`
- 扩展的内置目录包括 GLM-5 Free、MiniMax M2.7 Free、GPT-5.2、Gemini 3 Pro Preview、Gemini 3 Flash Preview、Grok Code Fast 1 和 Kimi K2.5。

有关设置详情参见 [/providers/kilocode](/providers/kilocode)。

### 其他捆绑提供商插件

- BytePlus：`byteplus`（`BYTEPLUS_API_KEY`）
- Cerebras：`cerebras`（`CEREBRAS_API_KEY`）
  - Cerebras 上的 GLM 模型使用 id `zai-glm-4.7` 和 `zai-glm-4.6`。
  - OpenAI 兼容 base URL：`https://api.cerebras.ai/v1`。
- Chutes：`chutes`（`CHUTES_API_KEY`）。参见 [Chutes](/providers/chutes)。
- Cloudflare AI Gateway：`cloudflare-ai-gateway`（`CLOUDFLARE_AI_GATEWAY_API_KEY`）
- GitHub Copilot：`github-copilot`（`COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN`）
- Groq：`groq`（`GROQ_API_KEY`）
- Hugging Face Inference：`huggingface`（`HUGGINGFACE_HUB_TOKEN` 或 `HF_TOKEN`）
  - 示例模型：`huggingface/deepseek-ai/DeepSeek-R1`
  - CLI：CrawClaw Desktop 或本地 Gateway API
  - 参见 [Hugging Face (Inference)](/providers/huggingface)。
- Kilo Gateway：`kilocode`（`KILOCODE_API_KEY`）
  - 示例模型：`kilocode/anthropic/claude-opus-4.6`
- Kimi Coding：`kimi-coding`（`KIMI_API_KEY` 或 `KIMICODE_API_KEY`）
- MiniMax：`minimax`（`MINIMAX_API_KEY`）
- Mistral：`mistral`（`MISTRAL_API_KEY`）
  - 示例模型：`mistral/mistral-large-latest`
  - CLI：CrawClaw Desktop 或本地 Gateway API
- Model Studio：`modelstudio`（`MODELSTUDIO_API_KEY`）
- Moonshot：`moonshot`（`MOONSHOT_API_KEY`）
- NVIDIA：`nvidia`（`NVIDIA_API_KEY`）
- OpenRouter：`openrouter`（`OPENROUTER_API_KEY`）
  - 示例模型：`openrouter/anthropic/claude-sonnet-4-6`
- Qianfan：`qianfan`（`QIANFAN_API_KEY`）
- Synthetic：`synthetic`（`SYNTHETIC_API_KEY`）
- Together：`together`（`TOGETHER_API_KEY`）
- Venice：`venice`（`VENICE_API_KEY`）
- Vercel AI Gateway：`vercel-ai-gateway`（`AI_GATEWAY_API_KEY`）
- Volcengine：`volcengine`（`VOLCANO_ENGINE_API_KEY`）
- xAI：`xai`（`XAI_API_KEY`）
- Xiaomi：`xiaomi`（`XIAOMI_API_KEY`）

## 通过 `models.providers` 的提供商（自定义/base URL）

使用 `models.providers`（或 `models.json`）添加**自定义**提供商或 OpenAI/Anthropic 兼容代理。

下面许多捆绑提供商插件已经发布了默认目录。仅当你想要覆盖默认 base URL、headers 或模型列表时，使用显式 `models.providers.<id>` 条目。

### Moonshot AI (Kimi)

Moonshot 使用 OpenAI 兼容端点，因此将其配置为自定义提供商：

- 提供商：`moonshot`
- 认证：`MOONSHOT_API_KEY`
- 示例模型：`moonshot/kimi-k2.5`

Kimi K2 模型 ID：

[//]: # "moonshot-kimi-k2-model-refs:start"

- `moonshot/kimi-k2.5`
- `moonshot/kimi-k2-0905-preview`
- `moonshot/kimi-k2-turbo-preview`
- `moonshot/kimi-k2-thinking`
- `moonshot/kimi-k2-thinking-turbo`

[//]: # "moonshot-kimi-k2-model-refs:end"

```json5
{
  agents: {
    defaults: { model: { primary: "moonshot/kimi-k2.5" } },
  },
  models: {
    mode: "merge",
    providers: {
      moonshot: {
        baseUrl: "https://api.moonshot.ai/v1",
        apiKey: "${MOONSHOT_API_KEY}",
        api: "openai-completions",
        models: [{ id: "kimi-k2.5", name: "Kimi K2.5" }],
      },
    },
  },
}
```

### Kimi Coding

Kimi Coding 使用 Moonshot AI 的 Anthropic 兼容端点：

- 提供商：`kimi-coding`
- 认证：`KIMI_API_KEY`
- 示例模型：`kimi-coding/k2p5`

```json5
{
  env: { KIMI_API_KEY: "sk-..." },
  agents: {
    defaults: { model: { primary: "kimi-coding/k2p5" } },
  },
}
```

### Volcano Engine (Doubao)

Volcano Engine（字节豆包）在中国提供豆包和其他模型的访问。

- 提供商：`volcengine`（编程：`volcengine-plan`）
- 认证：`VOLCANO_ENGINE_API_KEY`
- 示例模型：`volcengine/doubao-seed-1-8-251228`
- 设置：CrawClaw Desktop 或本地 Gateway API

```json5
{
  agents: {
    defaults: { model: { primary: "volcengine/doubao-seed-1-8-251228" } },
  },
}
```

可用模型：

- `volcengine/doubao-seed-1-8-251228`（豆包 Seed 1.8）
- `volcengine/doubao-seed-code-preview-251028`
- `volcengine/kimi-k2-5-260127`（Kimi K2.5）
- `volcengine/glm-4-7-251222`（GLM 4.7）
- `volcengine/deepseek-v3-2-251201`（DeepSeek V3.2 128K）

编程模型（`volcengine-plan`）：

- `volcengine-plan/ark-code-latest`
- `volcengine-plan/doubao-seed-code`
- `volcengine-plan/kimi-k2.5`
- `volcengine-plan/kimi-k2-thinking`
- `volcengine-plan/glm-4.7`

### BytePlus（国际版）

BytePlus ARK 为国际用户提供与 Volcano Engine 相同的模型访问。

- 提供商：`byteplus`（编程：`byteplus-plan`）
- 认证：`BYTEPLUS_API_KEY`
- 示例模型：`byteplus/seed-1-8-251228`
- 设置：CrawClaw Desktop 或本地 Gateway API

```json5
{
  agents: {
    defaults: { model: { primary: "byteplus/seed-1-8-251228" } },
  },
}
```

可用模型：

- `byteplus/seed-1-8-251228`（Seed 1.8）
- `byteplus/kimi-k2-5-260127`（Kimi K2.5）
- `byteplus/glm-4-7-251222`（GLM 4.7）

编程模型（`byteplus-plan`）：

- `byteplus-plan/ark-code-latest`
- `byteplus-plan/doubao-seed-code`
- `byteplus-plan/kimi-k2.5`
- `byteplus-plan/kimi-k2-thinking`
- `byteplus-plan/glm-4.7`

### Synthetic

Synthetic 在 `synthetic` 提供商背后提供 Anthropic 兼容模型：

- 提供商：`synthetic`
- 认证：`SYNTHETIC_API_KEY`
- 示例模型：`synthetic/hf:MiniMaxAI/MiniMax-M2.5`
- 设置：CrawClaw Desktop 或本地 Gateway API

```json5
{
  agents: {
    defaults: { model: { primary: "synthetic/hf:MiniMaxAI/MiniMax-M2.5" } },
  },
  models: {
    mode: "merge",
    providers: {
      synthetic: {
        baseUrl: "https://api.synthetic.new/anthropic",
        apiKey: "${SYNTHETIC_API_KEY}",
        api: "anthropic-messages",
        models: [{ id: "hf:MiniMaxAI/MiniMax-M2.5", name: "MiniMax M2.5" }],
      },
    },
  },
}
```

### MiniMax

MiniMax 通过 `models.providers` 配置，因为它使用自定义端点：

- MiniMax（Anthropic 兼容）：配置 `models.providers.minimax`
- 认证：`MINIMAX_API_KEY`

有关设置详情、模型选项和配置片段参见 [/providers/minimax](/providers/minimax)。

### Ollama

Ollama 作为捆绑提供商插件提供，使用 Ollama 的原生 API：

- 提供商：`ollama`
- 认证：无需（本地服务器）
- 示例模型：`ollama/llama3.3`
- 安装：[https://ollama.com/download](https://ollama.com/download)

```bash
# 安装 Ollama，然后拉取模型：
ollama pull llama3.3
```

```json5
{
  agents: {
    defaults: { model: { primary: "ollama/llama3.3" } },
  },
}
```

当你通过 `OLLAMA_API_KEY` 选择加入时，Ollama 会在 `http://127.0.0.1:11434` 本地检测，并且捆绑的提供商插件将 Ollama 直接添加到 CrawClaw Desktop 或本地 Gateway API 以及模型选择器。参见 [/providers/ollama](/providers/ollama) 了解入门、云/本地模式和自定义配置。

### vLLM

vLLM 作为捆绑提供商插件提供，用于本地/自托管 OpenAI 兼容服务器：

- 提供商：`vllm`
- 认证：可选（取决于你的服务器）
- 默认 base URL：`http://127.0.0.1:8000/v1`

要选择加入本地自动发现（如果你的服务器不强制认证，任何值都可以）：

```bash
export VLLM_API_KEY="vllm-local"
```

然后设置模型（替换为 `/v1/models` 返回的 ID 之一）：

```json5
{
  agents: {
    defaults: { model: { primary: "vllm/your-model-id" } },
  },
}
```

详情参见 [/providers/vllm](/providers/vllm)。

### SGLang

SGLang 作为捆绑提供商插件提供，用于快速自托管 OpenAI 兼容服务器：

- 提供商：`sglang`
- 认证：可选（取决于你的服务器）
- 默认 base URL：`http://127.0.0.1:30000/v1`

要选择加入本地自动发现（如果你的服务器不强制认证，任何值都可以）：

```bash
export SGLANG_API_KEY="sglang-local"
```

然后设置模型（替换为 `/v1/models` 返回的 ID 之一）：

```json5
{
  agents: {
    defaults: { model: { primary: "sglang/your-model-id" } },
  },
}
```

详情参见 [/providers/sglang](/providers/sglang)。

### 本地代理（LM Studio、vLLM、LiteLLM 等）

示例（OpenAI 兼容）：

```json5
{
  agents: {
    defaults: {
      model: { primary: "lmstudio/my-local-model" },
      models: { "lmstudio/my-local-model": { alias: "Local" } },
    },
  },
  models: {
    providers: {
      lmstudio: {
        baseUrl: "http://localhost:1234/v1",
        apiKey: "LMSTUDIO_KEY",
        api: "openai-completions",
        models: [
          {
            id: "my-local-model",
            name: "Local Model",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200000,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
}
```

注意：

- 对于自定义提供商，`reasoning`、`input`、`cost`、`contextWindow` 和 `maxTokens` 是可选的。
  省略时，CrawClaw 默认为：
  - `reasoning: false`
  - `input: ["text"]`
  - `cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }`
  - `contextWindow: 200000`
  - `maxTokens: 8192`
- 建议：设置与你的代理/模型限制匹配的显式值。
- 智能体运行时在计算每轮的有效提示预算时使用所选模型的 `contextWindow` 和 `maxTokens`。未知模型回退到保守默认值；当你想要更低的全局限制时，`agents.defaults.contextTokens` 可以限制解析的模型窗口。
- 原生提供商请求接收计算出的输出保留作为传输特定的输出令牌字段，如 `max_output_tokens`、`max_tokens`、`generationConfig.maxOutputTokens`、`options.num_predict` 或 `inferenceConfig.maxTokens`。
- 模型能力元数据控制每轮降级。`reasoning: false` 或 `compat.supportsReasoningEffort: false` 阻止发送推理努力控制，`compat.supportsTools: false` 保留工具 schema，`input: ["text"]` 在提供商请求前省略图像块。
- 对于非原生端点上的 `api: "openai-completions"`（任何 host 不是 `api.openai.com` 的非空 `baseUrl`），CrawClaw 强制 `compat.supportsDeveloperRole: false` 以避免不支持的 `developer` 角色导致提供商 400 错误。
- 如果 `baseUrl` 为空/省略，CrawClaw 保持默认 OpenAI 行为（解析为 `api.openai.com`）。
- 为安全起见，在非原生 `openai-completions` 端点上，显式 `compat.supportsDeveloperRole: true` 仍会被覆盖。

## Gateway API 示例

交互式设置使用 CrawClaw Desktop -> Settings -> Models -> Add model。自动化应通过 `config.patch` 写入 provider config，API keys 使用 SecretRefs，然后用 `models.list`、`usage.status` 和一个小的 test agent turn 验证，再把 provider 设为 default 或 fallback。

另请参见：[/gateway/configuration](/gateway/configuration) 了解完整配置示例。

## 相关

- [模型](/concepts/models) — 模型配置和别名
- [模型故障转移](/concepts/model-failover) — 后备链和重试行为
- [配置参考](/gateway/configuration-reference#agent-defaults) — 模型配置键
- [提供商](/providers) — 按提供商的设置指南
