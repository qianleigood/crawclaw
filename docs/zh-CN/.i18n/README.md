---
title: "CrawClaw docs i18n assets"
summary: "CrawClaw 文档翻译使用的 generated 和 config 文件"
x-i18n:
  generated_at: "2026-06-10T12:21:02Z"
  model: codex
  provider: openai
  source_hash: 43de7d7093ac75e5e0d85ddeb2551c5ed5a1f16395f8442f68bb0a2e62703efe
  source_path: .i18n/README.md
  workflow: 15
---

# CrawClaw docs i18n assets

这个文件夹存放文档翻译使用的 **generated** 和 **config** 文件。

## Files

- `glossary.<lang>.json` -- preferred term mappings（用于 prompt guidance）。
- `<lang>.tm.jsonl` -- translation memory（cache），以 workflow + model + text hash 为 key。

## Glossary format

`glossary.<lang>.json` 是 entries array：

```json
{
  "source": "troubleshooting",
  "target": "故障排除",
  "ignore_case": true,
  "whole_word": false
}
```

Fields：

- `source`: English（或 source）phrase to prefer。
- `target`: preferred translation output。

## Notes

- Glossary entries 会作为 **prompt guidance** 传给 model（没有 deterministic rewrites）。
- Translation memory 由 `scripts/docs-i18n` 更新。
- `scripts/docs-i18n` 默认 materializes Pi `0.70.0`，并使用 `minimax/MiniMax-M2.7-highspeed`，除非 `CRAWCLAW_DOCS_I18N_PROVIDER` 和 `CRAWCLAW_DOCS_I18N_MODEL` 覆盖它。
- `MINIMAX_MODEL` 等 generic model environment variables 不会 override docs i18n model。Docs-specific model experiments 请使用 `CRAWCLAW_DOCS_I18N_MODEL`。
- 对 domestic MiniMax endpoint，设置 `MINIMAX_CN_API_KEY`。脚本会写入一个 local Pi `models.json`，其中引用 env var name；它不能把 secret value 写入 repo 或 cache file。
