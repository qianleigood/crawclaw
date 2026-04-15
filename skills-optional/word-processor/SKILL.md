---
name: word-processor
description: 本地 Word / DOCX 文档处理技能。支持读取、创建、编辑、模板填充、批量处理与格式转换，并在本地完成 Word 文档工作流。Use when 用户要求读取或生成 .docx、批量套模板出文档、抽取表格/元数据、替换或追加文档内容、在 Word 与 PDF/Markdown 之间转换，或明确要求“本地处理”“不要走云端”。Do not use for飞书云文档协作（优先 feishu-create-doc / feishu-update-doc）or 非 Word 文档格式的专用处理。
---

# Word 文档处理技能

完全本地的 Word / DOCX 文档处理工具，适合本地读取、生成、修改、模板填充和批量转换。

## 核心能力

- 读取文本、表格、图片、元数据
- 从零创建新文档
- 编辑现有文档内容和结构
- 基于模板批量生成文档
- 批量处理多个文件
- DOCX 与 PDF / Markdown 之间转换

## 基本工作流

### 1. 准备环境

```bash
pip3 install -r requirements.txt
```

### 2. 判断任务类型

- **读取**：抽取文本 / 表格 / 元数据
- **创建**：从零生成新文档
- **编辑**：替换、追加、插入内容
- **模板填充**：用 JSON 或数据目录批量出文档
- **批量处理 / 转换**：对多份文件做统一动作

### 3. 选择调用方式

- **命令行方式**：用户只需要完成具体任务时，优先用 CLI
- **Python API 方式**：任务需要嵌入脚本或程序时，直接调用库

## 何时读取参考文档

### CLI 示例
读 `references/cli-recipes.md`，当你需要：
- create / read / edit / template / batch 命令示例
- 常见批量处理命令
- 典型业务场景参考

### Python API
读 `references/python-api.md`，当你需要：
- 在 Python 中直接创建 / 读取 / 编辑文档
- 模板占位符示例
- 代码级集成方式

## 注意事项

- 仅支持 `.docx`，不处理旧版 `.doc`
- 复杂格式（如 SmartArt）可能无法完整保留
- 宏（VBA）不会保留
- PDF 转换通常依赖 LibreOffice 等外部能力
- 若用户明确要求云端协作，改用飞书文档类技能

## 交付时说明

完成后应告诉用户：
- 生成或修改了哪些文件
- 输出文件在哪里
- 若涉及转换，哪些格式需要额外依赖
- 有哪些格式保真限制
