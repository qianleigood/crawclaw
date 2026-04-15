# minimax-pdf CLI and Environment Guide

Use this reference for concrete commands and dependency checks.

## Main scripts

- `scripts/make.sh`
- `scripts/palette.py`
- `scripts/cover.py`
- `scripts/render_cover.js`
- `scripts/render_body.py`
- `scripts/merge.py`
- `scripts/fill_inspect.py`
- `scripts/fill_write.py`
- `scripts/reformat_parse.py`

## Environment checks

Run:

```bash
bash scripts/make.sh check
bash scripts/make.sh fix
bash scripts/make.sh demo
```

## Typical command groups

- CREATE: `bash scripts/make.sh run ...`
- FILL: `python3 scripts/fill_inspect.py ...` then `python3 scripts/fill_write.py ...`
- REFORMAT: `bash scripts/make.sh reformat ...`
