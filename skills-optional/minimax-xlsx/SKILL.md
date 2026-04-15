---
name: minimax-xlsx
description: Create, read, analyze, edit, validate, or repair spreadsheet files such as .xlsx, .xlsm, .csv, and .tsv. Use when the user needs Excel-style output, spreadsheet analysis, formula validation, or structural edits without losing workbook integrity.
license: MIT
metadata:
  version: "1.0"
  category: productivity
---

# MiniMax XLSX Skill

Use this skill for spreadsheet work where workbook structure and formula integrity matter.

## Task routing

- Read/analyze -> `references/read-analyze.md`
- Create new workbook -> `references/create.md` and `references/format.md`
- Edit existing workbook -> `references/edit.md`
- Repair formulas -> `references/fix.md`
- Validate formulas -> `references/validate.md`

## Working rules

- Always produce the requested output file.
- Treat existing-file edits as edit tasks, not rebuild tasks.
- Prefer XML unpack/edit/pack when workbook integrity matters.
- Keep formulas as formulas; do not replace calculated cells with hardcoded numbers.
- Validate before delivery.

## Use these scripts as needed

- `scripts/xlsx_reader.py`
- `scripts/xlsx_unpack.py`
- `scripts/xlsx_pack.py`
- `scripts/formula_check.py`
- helper scripts such as `xlsx_add_column.py` and `xlsx_insert_row.py`

## Read references as needed

- `references/read-analyze.md`
- `references/create.md`
- `references/edit.md`
- `references/fix.md`
- `references/validate.md`
- `references/format.md`
- `references/ooxml-cheatsheet.md`
