---
name: pptx-generator
description: Generate, edit, or read PowerPoint presentations. Use when creating a deck from scratch with PptxGenJS, editing an existing PPTX through structured XML workflows, or extracting content for analysis.
license: MIT
metadata:
  version: "1.0"
  category: productivity
  sources:
    - https://gitbrent.github.io/PptxGenJS/
    - https://github.com/microsoft/markitdown
---

# PPTX Generator

Use this skill for PowerPoint creation, editing, and reading.

## Choose the path

- read or analyze: use `python -m markitdown presentation.pptx`
- edit an existing deck: follow `references/editing.md`
- create from scratch: use PptxGenJS and the slide workflow below

## Create-from-scratch workflow

1. Clarify audience, purpose, tone, and slide count.
2. Choose palette, fonts, and style from `references/design-system.md`.
3. Plan every slide using `references/slide-types.md`.
4. Generate one JS module per slide in `slides/`.
5. Compile with `slides/compile.js`.
6. Run QA using `references/pitfalls.md`.

## Output structure

```text
slides/
├── slide-01.js
├── slide-02.js
├── imgs/
└── output/
    └── presentation.pptx
```

## Rules

- Use `LAYOUT_16x9`.
- Colors are 6-char hex without `#`.
- Chinese font default: `Microsoft YaHei`.
- English font default: `Arial`.
- Every non-cover slide needs a page number badge.
- Keep variant details and API specifics in references instead of bloating `SKILL.md`.

## References

- `references/slide-types.md`
- `references/design-system.md`
- `references/editing.md`
- `references/pitfalls.md`
- `references/pptxgenjs.md`
