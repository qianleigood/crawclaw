---
read_when:
  - 你想为音频附件使用 Deepgram 语音转文字功能
  - 你需要快速 Deepgram 配置示例
summary: 入站语音笔记的 Deepgram 转录
title: Deepgram
x-i18n:
  generated_at: "2026-06-05T14:43:14Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 5ff192743eaa5f7dc1a3e60ec0e93c5f5a235ff555aeef40b21853793a6459ed
  source_path: providers/deepgram.md
  workflow: 15
---

# Deepgram（音频转录）

Deepgram 是一个语音转文字 API。CrawClaw 旧的 TypeScript
媒体理解提供商路径已被移除，因此 Deepgram 转录在进入 Rust 原生媒体理解运行时之前不会被暴露。

网站：[https://deepgram.com](https://deepgram.com)
文档：[https://developers.deepgram.com](https://developers.deepgram.com)

## 状态

不要通过 TypeScript 插件媒体理解提供商配置 Deepgram。下一个支持的路径是 Rust 原生实现。

## 选项

- 在 `tools.media.audio` 可以再次路由到 Deepgram 之前，需要 Rust 原生实现。

## 注意事项

- `DEEPGRAM_API_KEY` 仍然是未来 Rust 原生实现预期的密钥名称。
