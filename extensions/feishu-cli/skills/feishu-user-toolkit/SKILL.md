---
name: feishu-user-toolkit
description: Use the official lark-cli as the authenticated user to work with personal Feishu calendar, tasks, and messages. This complements the Feishu bot/channel plugin instead of replacing it.
---

# Feishu User Toolkit

Use this skill when the task needs **user identity** inside Feishu, not the bot identity.

Use it for:
- checking your agenda
- creating or reviewing your tasks
- searching your messages

Do not use it for:
- channel replies
- bot cards
- group mention handling
- streaming response delivery

Identity boundary:
- `extensions/feishu` = bot/app identity
- `extensions/feishu-cli` = user identity via `lark-cli`

Preferred tools:
- `feishu_user_calendar`
- `feishu_user_task`
- `feishu_user_messages`

If these tools fail because Feishu CLI auth is missing, check:
- `crawclaw feishu-cli status`
- `crawclaw feishu-cli auth login`
