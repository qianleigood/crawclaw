---
name: feishu-update-doc
description: 更新飞书云文档内容。支持追加、覆盖、定位替换、全文替换、前插入、后插入和删除等模式，适合在已有文档上做精确改写。
---

# Feishu Update Doc

Use this skill when the user wants to modify an existing Feishu document instead of creating a new one.

## Use this skill for

- 文末追加内容
- 定位替换一段内容
- 在指定位置前后插入
- 删除某个范围
- 必要时整体覆盖重写

## Preferred strategy

1. Prefer narrow, local edits.
2. Use title-based or ellipsis-based selection when possible.
3. Avoid `overwrite` unless the user clearly wants a full rebuild.
4. Update the title only when the title itself should change.

## Working rules

- Smaller replacement ranges are safer than broad rewrites.
- Avoid touching regions that may contain non-text blocks unless necessary.
- Treat images, comments, and embedded content as fragile during full overwrites.
- For repeated replacements, use an all-replace style only when multi-match behavior is intended.
