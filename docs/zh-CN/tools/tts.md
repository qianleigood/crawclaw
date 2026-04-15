---
title: 文本转语音
summary: 把文本转成音频回复的 TTS 工具与配置说明
read_when:
  - 你想启用 TTS 回复
  - 你要配置 TTS provider 或限制
  - 你想使用 tts 工具或 /tts 命令
---

# 文本转语音（TTS）

CrawClaw 可以把文本回复转换成音频，并通过支持的渠道发出。

## 支持的服务

- **ElevenLabs**（可作为主 provider 或回退）
- **Microsoft**（可作为主 provider 或回退；当前 bundled 实现使用 `node-edge-tts`）
- **OpenAI**（可作为主 provider 或回退；也可用于摘要）

### Microsoft 路径说明

当前 bundled 的 Microsoft speech provider 通过 `node-edge-tts` 调用 Microsoft Edge 的在线神经 TTS 服务。
这是一条托管服务路径，不需要 API key。

由于它属于公开 Web 服务、没有正式 SLA 或配额保证，更适合作为 best-effort 方案。
如果你需要更稳定的额度和支持，优先用 OpenAI 或 ElevenLabs。

## 可选密钥

如果你要用 OpenAI 或 ElevenLabs：

- `ELEVENLABS_API_KEY`（或 `XI_API_KEY`）
- `OPENAI_API_KEY`

Microsoft speech **不需要** API key。

如果配置了多个 provider，CrawClaw 会优先使用选定 provider，其余作为回退。
如果启用了自动摘要，`summaryModel` 对应的 provider 也必须有可用认证。

## 默认是否启用

默认不启用。自动 TTS 默认是关闭的。

你可以通过配置里的 `messages.tts.auto` 启用，或者按会话用 `/tts always`（别名 `/tts on`）启用。

如果没有显式设置 `messages.tts.provider`，CrawClaw 会按 registry 自动选择顺序使用第一个可用 speech provider。

## 工具参数

`tts` 工具本身比较简单：

- `text`：要转语音的文本，必填
- `channel`：可选渠道 id，用于选择更合适的输出格式（例如 `telegram`）

工具成功时会自动交付音频媒体；调用成功后，agent 应返回静默回复，避免重复再发一条文本确认。

## 配置

TTS 配置位于 `crawclaw.json` 的 `messages.tts` 下。

### 最小配置

```json5
{
  messages: {
    tts: {
      auto: "always",
      provider: "elevenlabs",
    },
  },
}
```

### OpenAI 主 provider，ElevenLabs 回退

```json5
{
  messages: {
    tts: {
      auto: "always",
      provider: "openai",
      summaryModel: "openai/gpt-4.1-mini",
      modelOverrides: {
        enabled: true,
      },
      providers: {
        openai: {
          apiKey: "openai_api_key",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o-mini-tts",
          voice: "alloy",
        },
        elevenlabs: {
          apiKey: "elevenlabs_api_key",
          baseUrl: "https://api.elevenlabs.io",
          voiceId: "voice_id",
          modelId: "eleven_multilingual_v2",
        },
      },
    },
  },
}
```

### Microsoft 主 provider（无需 API key）

```json5
{
  messages: {
    tts: {
      auto: "always",
      provider: "microsoft",
      providers: {
        microsoft: {
          enabled: true,
          voice: "en-US-MichelleNeural",
          lang: "en-US",
          outputFormat: "audio-24khz-48kbitrate-mono-mp3",
          rate: "+10%",
          pitch: "-5%",
        },
      },
    },
  },
}
```

## 常见字段

- `auto`：自动 TTS 模式（`off`、`always`、`inbound`、`tagged`）
- `mode`：`"final"`（默认）或 `"all"`
- `provider`：speech provider id，例如 `"elevenlabs"`、`"microsoft"`、`"openai"`
- `summaryModel`：长回复自动摘要用的便宜模型，默认回退到 `agents.defaults.model.primary`
- `maxTextLength`：单次转换文本上限
- `timeoutMs`：超时

补充说明：

- `inbound` 只会在收到语音消息后回音频
- `tagged` 只会在回复里出现 `[[tts]]` 标签时发音频
- 旧的 `provider: "edge"` 仍会自动归一化到 `microsoft`

## 相关文档

- [工具总览](/tools)
- [英文 TTS 文档](/tools/tts)
