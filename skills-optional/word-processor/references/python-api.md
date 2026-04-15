# Python API Guide for word-processor

Use this reference when the user wants to call the library directly from Python.

## Basic usage

```python
from scripts.word_lib import WordDocument

# create
doc = WordDocument()
doc.add_heading("标题", level=1)
doc.add_paragraph("内容...")
doc.add_table(rows=3, cols=3)
doc.save("output.docx")

# read
doc = WordDocument("input.docx")
text = doc.get_text()
tables = doc.get_tables()

# edit
doc = WordDocument("input.docx")
doc.replace_text("旧", "新")
doc.add_paragraph("新内容")
doc.save("output.docx")

# template fill
doc = WordDocument("template.docx")
doc.fill_template({"name": "张三", "date": "2026-03-04"})
doc.save("filled.docx")
```

## Template syntax

Placeholders use `{{变量名}}`.

Example:

```text
合同编号：{{contract_id}}
甲方：{{party_a}}
乙方：{{party_b}}
日期：{{date}}
```
