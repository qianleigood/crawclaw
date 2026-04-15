---
name: summarize
description: Summarize URLs or files with the summarize CLI (web, PDFs, images, audio, YouTube).
metadata:
  {
    "clawdbot":
      {
        "emoji": "🧾",
        "requires": { "bins": ["summarize"] },
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "steipete/tap/summarize",
              "bins": ["summarize"],
              "label": "Install summarize (brew)",
            },
          ],
      },
  }
---

# Summarize

Fast CLI to summarize URLs, local files, and YouTube links.

## Quick start

```bash
summarize "https://example.com" --model google/gemini-3-flash-preview
summarize "/path/to/file.pdf" --model google/gemini-3-flash-preview
summarize "https://youtu.be/dQw4w9WgXcQ" --youtube auto
```

## Model + keys

Set the API key for your chosen provider:

- OpenAI: `OPENAI_API_KEY`
- Anthropic: `ANTHROPIC_API_KEY`
- xAI: `XAI_API_KEY`
- Google: `GEMINI_API_KEY` (aliases: `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_API_KEY`)

Default model is `google/gemini-3-flash-preview` if none is set.

## Useful flags

- `--length short|medium|long|xl|xxl|<chars>`
- `--max-output-tokens <count>`
- `--extract-only` (URLs only)
- `--json` (machine readable)
- `--youtube auto` (Apify fallback if `APIFY_API_TOKEN` set)

## Config

Optional config file: `~/.summarize/config.json`

```json
{ "model": "openai/gpt-5.2" }
```

Optional services:

- `APIFY_API_TOKEN` for YouTube fallback

## 子代理执行策略

- **默认执行模式**：优先使用子代理独立执行；主会话负责接单、补齐必要上下文、控制范围，并在最后整合结果回报给用户。
- **适合交给子代理的任务**：预计超过 30 秒的处理、多步骤流水线、多文件/多产物生成、批处理、审计、转写、总结、离线分析。
- **主会话保留职责**：只在必要时追问关键缺口、确认边界、挑选最终结果，并把输出改写成面向用户的完成答复。
- **不建议默认交给子代理的情况**：一次性极短任务、需要高频来回确认的对话、强依赖当前聊天即时上下文的动作。
- **回报节点**：默认只保留“已受理 / 已开始 / 已完成 / 已失败”四类关键节点，避免刷屏。
