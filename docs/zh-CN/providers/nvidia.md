---
read_when:
  - 你想在 CrawClaw 中使用 NVIDIA 模型
  - 你需要 NVIDIA_API_KEY 设置
summary: 在 CrawClaw 中使用 NVIDIA 的 OpenAI 兼容 API
title: NVIDIA
x-i18n:
  generated_at: "2026-06-05T14:44:28Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 15b7bb3b562e863f32ed7e41640dc486f9133078803f0f9f7b2133365f340eae
  source_path: providers/nvidia.md
  workflow: 15
---

# NVIDIA

NVIDIA 在 `https://integrate.api.nvidia.com/v1` 提供 OpenAI 兼容 API，用于 Nemotron 和 NeMo 模型。使用来自 [NVIDIA NGC](https://catalog.ngc.nvidia.com/) 的 API key 进行认证。

## Desktop 设置

导出 key 一次，然后运行新手引导并设置 NVIDIA 模型：

```bash
export NVIDIA_API_KEY="nvapi-..."
```

然后使用 CrawClaw Desktop 或本地 Gateway API 选择 NVIDIA 模型。

如果你仍然传入 `--token`，请记住它会留在 shell 历史记录和 `ps` 输出中；尽量优先使用环境变量。

## 配置片段

```json5
{
  env: { NVIDIA_API_KEY: "nvapi-..." },
  models: {
    providers: {
      nvidia: {
        baseUrl: "https://integrate.api.nvidia.com/v1",
        api: "openai-completions",
      },
    },
  },
  agents: {
    defaults: {
      model: { primary: "nvidia/nvidia/llama-3.1-nemotron-70b-instruct" },
    },
  },
}
```

## 模型 ID

- `nvidia/llama-3.1-nemotron-70b-instruct`（默认）
- `meta/llama-3.3-70b-instruct`
- `nvidia/mistral-nemo-minitron-8b-8k-instruct`

## 注意事项

- OpenAI 兼容 `/v1` 端点；使用来自 NVIDIA NGC 的 API key。
- 当设置 `NVIDIA_API_KEY` 时提供商自动启用；使用静态默认值（131,072-token 上下文窗口，4,096 最大 token）。
