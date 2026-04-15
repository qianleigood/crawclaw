# Lark-flavored Markdown Guide for feishu-create-doc

Use this reference when the task needs rich document formatting details.

## Core rules

- Keep heading depth sensible (usually <= 4 for business docs).
- Do not repeat the document title as the first Markdown H1 if `title` already carries it.
- Let Feishu generate the table of contents automatically.
- Prefer structure, readability, and visual rhythm over decorative formatting.

## Common block types

### Basic blocks

- paragraphs
- headings
- lists
- blockquotes
- code blocks
- horizontal rules

### Rich formatting

- bold / italic / inline code
- links
- text colors
- inline LaTeX

### Advanced blocks

- callout
- grid / columns
- markdown tables / enhanced tables
- images
- files
- Mermaid / PlantUML diagrams
- mentions
- reminders / date blocks

## Recommended formatting strategy

Use richer elements when they improve comprehension:

- callout for highlights, warnings, decisions
- tables for structured comparisons
- diagrams for workflows / architecture
- grids for compact side-by-side blocks

Avoid overusing every block type in one document.

## Typical scenarios

- meeting notes
- project plans
- technical docs
- weekly reports
- knowledge base pages
- structured proposals

## When to stay in SKILL.md instead

If the task only needs quick document creation with plain headings, lists, and a couple of tables, the main skill file is enough. Read this reference only when rich formatting or block syntax becomes important.
