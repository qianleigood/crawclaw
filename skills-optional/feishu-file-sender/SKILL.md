---
name: feishu-file-sender
description: 飞书文件发送器。通过飞书 OpenAPI 上传并发送 agent 生成的本地文件或图片，补齐飞书渠道缺失的文件投递能力。
license: MIT
metadata:
  version: "1.0.9"
  tags: [feishu, file, upload, im, messaging, openapi]
  author: wen-ai
  crawclaw:
    emoji: "📎"
    requires:
      bins: [python3]
      config:
        - ~/.crawclaw/crawclaw.json
---

# Feishu File Sender

Use this skill when a local artifact must be delivered back into Feishu chat as a file or image.

## Use this skill for

- 上传 agent 生成的本地文件到飞书
- 把二维码、截图、报表、导出文件回传到聊天
- 以文件消息或图片消息发送

Do not use this skill for Bitable attachment columns or for plain text replies.

## Default workflow

1. Confirm the local file path is absolute.
2. Prefer sending to the current chat when possible.
3. Let the script auto-detect id type unless there is a reason to force it.
4. Keep credentials in `~/.crawclaw/crawclaw.json`; do not duplicate them elsewhere.

## Working rules

- `oc_` -> chat_id
- `ou_` -> open_id
- `on_` -> user_id
- Prefer image mode only for real image assets.

## Read references as needed

- `references/README.md`
  For extended setup notes, examples, and background.

## Bundled script

- `scripts/feishu_file_sender.py`
