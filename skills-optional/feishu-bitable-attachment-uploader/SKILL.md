---
name: feishu-bitable-attachment-uploader
description: 通过飞书 OpenAPI 向多维表格附件字段上传本地文件，并支持大文件分片、批量追加、按 record_id 直接更新，或按字段搜索后更新/补建记录。适合把本地图片、视频、文档回填到 Bitable 附件列。
---

# Feishu Bitable Attachment Uploader

Use this skill when the real problem is writing local files into a Bitable attachment field.

## Use this skill for

- 把本地文件写入 Bitable 附件列
- 大于 `20MB` 的文件自动分片上传
- 追加很多附件到同一条记录
- 先查记录，再写附件

Do not use this skill for ordinary text/number fields or for sending files into Feishu chat.

## Default workflow

1. Confirm `app_token`, `table_id`, and the attachment field name.
2. Prefer `record_id` if known.
3. If `record_id` is unknown, use a stable lookup field first.
4. Default to append; only replace attachments when the user explicitly wants replacement.
5. For many files, lower append batch size and slow down if needed.

## Working rules

- Keep `FEISHU_APP_ID` and `FEISHU_APP_SECRET` in env, never in code.
- Treat `append` as the safe default.
- Use stable lookup keys such as URL, external id, or unique title.
- If only normal fields are being changed, use the base Feishu Bitable tools instead of this attachment-specific workflow.

## Read references as needed

- `references/feishu-bitable-attachment-api.md`
  For API details, payload shape, and upload/update semantics.
