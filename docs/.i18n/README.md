# CrawClaw docs i18n assets

This folder stores **generated** and **config** files for documentation translations.

## Files

- `glossary.<lang>.json` — preferred term mappings (used in prompt guidance).
- `<lang>.tm.jsonl` — translation memory (cache) keyed by workflow + model + text hash.

## Glossary format

`glossary.<lang>.json` is an array of entries:

```json
{
  "source": "troubleshooting",
  "target": "故障排除",
  "ignore_case": true,
  "whole_word": false
}
```

Fields:

- `source`: English (or source) phrase to prefer.
- `target`: preferred translation output.

## Notes

- Glossary entries are passed to the model as **prompt guidance** (no deterministic rewrites).
- The translation memory is updated by `scripts/docs-i18n`.
- `scripts/docs-i18n` materializes Pi `0.70.0` by default and uses
  `minimax/MiniMax-M2.7-highspeed` unless `CRAWCLAW_DOCS_I18N_PROVIDER` and
  `CRAWCLAW_DOCS_I18N_MODEL` override it.
- Generic model environment variables such as `MINIMAX_MODEL` do not override
  the docs i18n model. Use `CRAWCLAW_DOCS_I18N_MODEL` for docs-specific model
  experiments.
- For the domestic MiniMax endpoint, set `MINIMAX_CN_API_KEY`. The script writes
  a local Pi `models.json` that references the env var name; it must not write
  the secret value into the repo or cache file.
