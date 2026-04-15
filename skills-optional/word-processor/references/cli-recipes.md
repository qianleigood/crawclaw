# CLI Recipes for word-processor

Use this reference when the user needs concrete command examples.

## Create

```bash
python3 scripts/word_tool.py create --output report.docx --title "季度报告" --content "这是报告内容..."
```

## Read

```bash
python3 scripts/word_tool.py read --input document.docx --output text
python3 scripts/word_tool.py read --input document.docx --output table --table-index 0
python3 scripts/word_tool.py read --input document.docx --output metadata
```

## Edit

```bash
python3 scripts/word_tool.py edit --input document.docx --replace "旧文本：新文本" --output edited.docx
python3 scripts/word_tool.py edit --input document.docx --append "新段落内容" --output edited.docx
```

## Template fill

```bash
python3 scripts/word_tool.py template --input template.docx --data data.json --output filled.docx
python3 scripts/word_tool.py template --input template.docx --data-dir ./data --output-dir ./output
```

## Batch

```bash
python3 scripts/word_tool.py batch --input-dir ./docs --replace "旧：新" --output-dir ./output
python3 scripts/word_tool.py batch --input-dir ./docs --convert-to pdf --output-dir ./output
```

## Example scenarios

- batch contract generation
- table extraction to Excel
- watermarking
