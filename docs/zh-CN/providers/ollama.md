---
read_when:
  - 你想通过 Ollama 使用云端或本地模型运行 CrawClaw
  - 你需要 Ollama 设置和配置指导
summary: 通过 Ollama 运行 CrawClaw（云端和本地模型）
title: Ollama
x-i18n:
  generated_at: "2026-06-05T14:45:10Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 143d3e0616eb430a2355568fff078dfc756592beece6bd76e1255a64c908588c
  source_path: providers/ollama.md
  workflow: 15
---

# Ollama

Ollama 是一个本地 LLM 运行时，可让你轻松在本地机器上运行开源模型。CrawClaw 与 Ollama 的原生 API（`/api/chat`）集成，支持流式传输和工具调用，并且当你能通过 `OLLAMA_API_KEY`（或认证配置文件）选择加入且未定义显式 `models.providers.ollama` 条目时，可以自动发现本地 Ollama 模型。

<Warning>
**远程 Ollama 用户**：请勿将 `/v1` OpenAI 兼容 URL（`http://host:11434/v1`）与 CrawClaw 一起使用。这会破坏工具调用功能，模型可能将原始工具 JSON 输出为纯文本。请改用原生 Ollama API URL：`baseUrl: "http://host:11434"`（无 `/v1`）。
</Warning>

## 快速开始

### 新手引导（推荐）

设置 Ollama 最快的方式是通过新手引导：

打开 **CrawClaw Desktop → Settings → Models and replies → Add model**，选择
**Ollama**，然后输入 Ollama base URL 和 mode。

从提供商列表中选择 **Ollama**。新手引导将：

1. 询问你的实例可访问的 Ollama base URL（默认为 `http://127.0.0.1:11434`）。
2. 让你选择 **Cloud + Local**（云端模型和本地模型）或 **Local**（仅本地模型）。
3. 如果你选择 **Cloud + Local** 且未登录 ollama.com，则打开浏览器登录流程。
4. 发现可用模型并建议默认值。
5. 如果所选模型在本地不可用，则自动拉取。

也支持非交互式模式：

对于自动化，将 `OLLAMA_API_KEY` 暴露给 Gateway 进程。当你没有定义显式
`models.providers.ollama` 条目时，任何非空值都会让 CrawClaw opt in 到 Ollama
discovery。

可选指定自定义 base URL 或模型：

使用 `config.patch` 设置 `models.providers.ollama.baseUrl` 和
`agents.defaults.model.primary`：

```json5
{
  method: "config.patch",
  params: {
    baseHash: "<hash from config.get>",
    raw: '{ agents: { defaults: { model: { primary: "ollama/glm-4.7-flash" } } }, models: { mode: "merge", providers: { ollama: { baseUrl: "http://127.0.0.1:11434", apiKey: "${OLLAMA_API_KEY}" } } } }',
  },
}
```

### 手动设置

1. 安装 Ollama：[https://ollama.com/download](https://ollama.com/download)

2. 如果你希望本地推理，请拉取本地模型：

```bash
ollama pull glm-4.7-flash
# 或
ollama pull gpt-oss:20b
# 或
ollama pull llama3.3
```

3. 如果你也想要云端模型，请登录：

```bash
ollama signin
```

4. 运行新手引导并选择 `Ollama`：

使用 CrawClaw Desktop 的 **Add model** flow 并选择 `Ollama`，或应用上面相同形状的
`config.patch`。

- `Local`：仅本地模型
- `Cloud + Local`：本地模型加上云端模型
- 云端模型如 `kimi-k2.5:cloud`、`minimax-m2.5:cloud` 和 `glm-5:cloud` **不需要**本地 `ollama pull`

CrawClaw 当前建议：

- 本地默认：`glm-4.7-flash`
- 云端默认：`kimi-k2.5:cloud`、`minimax-m2.5:cloud`、`glm-5:cloud`

5. 如果你更喜欢手动设置，直接为 CrawClaw 启用 Ollama（任何值都可以；Ollama 不需要真实密钥）：

```bash
# 设置环境变量
export OLLAMA_API_KEY="ollama-local"
```

或通过 CrawClaw Desktop 或本地 Gateway API 配置提供商。

6. 检查或切换模型：

使用 CrawClaw Desktop 模型选择器，或调用 `models.list` 检查 Ollama entries，并用
`config.patch` 更新 `agents.defaults.model.primary`。

7. 或在配置中设置默认值：

```json5
{
  agents: {
    defaults: {
      model: { primary: "ollama/glm-4.7-flash" },
    },
  },
}
```

## 显式模型条目

CrawClaw 仅写入你在 `models.providers.ollama` 中配置的 Ollama 模型。使用 Ollama CLI 检查本地模型 ID，然后添加你希望 CrawClaw 使用的条目。

查看可用模型：

```bash
ollama list
```

然后通过 CrawClaw Desktop、本地 Gateway API 或配置添加模型。

要添加新模型，只需用 Ollama 拉取它：

```bash
ollama pull mistral
```

新模型将自动被发现并可供使用。

如果你显式设置 `models.providers.ollama`，则跳过自动发现，你必须手动定义模型（见下文）。

## 配置

### 基本设置（隐式发现）

启用 Ollama 最简单的方式是通过环境变量：

```bash
export OLLAMA_API_KEY="ollama-local"
```

### 显式设置（手动模型）

在以下情况下使用显式配置：

- Ollama 在另一台主机/端口上运行。
- 你想强制指定特定上下文窗口或模型列表。
- 你想要完全手动定义模型。

```json5
{
  models: {
    providers: {
      ollama: {
        baseUrl: "http://ollama-host:11434",
        apiKey: "ollama-local",
        api: "ollama",
        models: [
          {
            id: "gpt-oss:20b",
            name: "GPT-OSS 20B",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 8192,
            maxTokens: 8192 * 10
          }
        ]
      }
    }
  }
}
```

如果设置了 `OLLAMA_API_KEY`，你可以在提供商条目中省略 `apiKey`，CrawClaw 将为其可用性检查填充该值。

### 自定义 base URL（显式配置）

如果 Ollama 在不同主机或端口上运行（显式配置禁用自动发现，因此请手动定义模型）：

```json5
{
  models: {
    providers: {
      ollama: {
        apiKey: "ollama-local",
        baseUrl: "http://ollama-host:11434", // 无 /v1 - 使用原生 Ollama API URL
        api: "ollama", // 显式设置以保证原生工具调用行为
      },
    },
  },
}
```

<Warning>
请勿在 URL 中添加 `/v1`。`/v1` 路径使用 OpenAI 兼容模式，工具调用不可靠。使用无路径后缀的基本 Ollama URL。
</Warning>

### 模型选择

配置后，所有 Ollama 模型都可用：

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "ollama/gpt-oss:20b",
        fallbacks: ["ollama/llama3.3", "ollama/qwen2.5-coder:32b"],
      },
    },
  },
}
```

## 云端模型

云端模型让你可以运行云端托管的模型（例如 `kimi-k2.5:cloud`、`minimax-m2.5:cloud`、`glm-5:cloud`），以及你的本地模型。

要使用云端模型，请在设置期间选择 **Cloud + Local** 模式。向导检查你是否已登录，必要时会打开浏览器登录流程。如果无法验证认证，向导会回退到本地模型默认值。

你也可以直接在 [ollama.com/signin](https://ollama.com/signin) 登录。

## Skills 语义发现嵌入

Ollama 还可以提供 Skills 语义发现使用的嵌入模型。这与上面配置的主聊天模型是分开的。在 CrawClaw Desktop 或本地 Gateway API 期间，**Skills** 步骤可以使用提供商 `ollama` 启用 `skills.discovery.semantic`，然后选择嵌入模型。

推荐的嵌入模型：

- `nomic-embed-text`：默认，小下载量，适用于大多数笔记本电脑和短 Skills 描述。
- `qwen3-embedding:0.6b`：更强的多语言和代码检索行为，中等下载量；当你有许多混合语言 Skills 时很好用。
- `mxbai-embed-large`：用于更高质量英文检索的更大嵌入模型；当额外磁盘和内存可接受时使用。

如果选定的嵌入模型在本地缺失，CrawClaw 会通过 Ollama 自动拉取，然后再嵌入 Skills。

手动配置：

```json5
{
  skills: {
    discovery: {
      semantic: {
        enabled: true,
        provider: "ollama",
        model: "nomic-embed-text",
      },
    },
  },
}
```

## 高级

### 推理模型

CrawClaw 默认将名称包含 `deepseek-r1`、`reasoning` 或 `think` 的模型视为具有推理能力：

```bash
ollama pull deepseek-r1:32b
```

### 模型成本

Ollama 是免费的且在本地运行，因此所有模型成本都设置为 $0。

### 流式配置

CrawClaw 的 Ollama 集成默认使用**原生 Ollama API**（`/api/chat`），它完全支持同时进行流式传输和工具调用。无需特殊配置。

#### 旧版 OpenAI 兼容模式

<Warning>
**在 OpenAI 兼容模式下工具调用不可靠。**仅当你需要 OpenAI 格式的代理且不依赖原生工具调用行为时，才使用此模式。
</Warning>

如果需要改用 OpenAI 兼容端点（例如在仅支持 OpenAI 格式的代理后面），请显式设置 `api: "openai-completions"`：

```json5
{
  models: {
    providers: {
      ollama: {
        baseUrl: "http://ollama-host:11434/v1",
        api: "openai-completions",
        injectNumCtxForOpenAICompat: true, // 默认：true
        apiKey: "ollama-local",
        models: [...]
      }
    }
  }
}
```

此模式可能不支持同时进行流式传输和工具调用。你可能需要在模型配置中使用 `params: { streaming: false }` 禁用流式传输。

当 `api: "openai-completions"` 与 Ollama 一起使用时，CrawClaw 默认注入 `options.num_ctx`，这样 Ollama 就不会静默回退到 4096 上下文窗口。如果你的代理/上游拒绝未知的 `options` 字段，请禁用此行为：

```json5
{
  models: {
    providers: {
      ollama: {
        baseUrl: "http://ollama-host:11434/v1",
        api: "openai-completions",
        injectNumCtxForOpenAICompat: false,
        apiKey: "ollama-local",
        models: [...]
      }
    }
  }
}
```

### 上下文窗口

对于自动发现的模型，CrawClaw 在可用时使用 Ollama 报告的上下文窗口，否则回退到 CrawClaw 使用的默认 Ollama 上下文窗口。你可以在显式提供商配置中覆盖 `contextWindow` 和 `maxTokens`。

## 故障排除

### 未检测到 Ollama

确保 Ollama 正在运行且你设置了 `OLLAMA_API_KEY`（或认证配置文件），且你**没有**定义显式 `models.providers.ollama` 条目：

```bash
ollama serve
```

并确保 API 可访问：

```bash
curl http://localhost:11434/api/tags
```

### 没有可用模型

如果你的模型未列出，请执行以下操作之一：

- 在本地拉取模型，或
- 在 `models.providers.ollama` 中显式定义模型。

添加模型：

```bash
ollama list  # 查看已安装的模型
ollama pull glm-4.7-flash
ollama pull gpt-oss:20b
ollama pull llama3.3     # 或其他模型
```

### 连接被拒绝

检查 Ollama 是否在正确端口上运行：

```bash
# 检查 Ollama 是否在运行
ps aux | grep ollama

# 或重启 Ollama
ollama serve
```

## 另请参阅

- [模型提供商](/concepts/model-providers) - 所有提供商概述
- [模型选择](/concepts/models) - 如何选择模型
- [配置](/gateway/configuration) - 完整配置参考
