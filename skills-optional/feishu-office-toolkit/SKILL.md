---
name: feishu-office-toolkit
description: |
  飞书办公自动化综合技能，覆盖日历、消息、审批、多维表格、通讯录和考勤等核心办公场景。适合用户明确要“在飞书里”完成办公动作，且需求跨多个飞书模块时使用。
metadata:
  clawdbot:
    emoji: "\U0001F3E2"
    requires:
      bins:
        - uv
      env:
        - FEISHU_APP_ID
        - FEISHU_APP_SECRET
    primaryEnv: FEISHU_APP_ID
---

# Feishu Office Toolkit

Use this as the router skill for broad Feishu office automation.

## Use this skill for

- 预约会议室和管理日程
- 发消息、回消息、发卡片
- 发起或处理审批
- 操作多维表格
- 查询通讯录
- 处理考勤相关读取

If the user is clearly asking for a single domain, prefer the narrower Feishu skill instead of this aggregate one.

## Default routing

- Calendar or room booking -> `references/calendar.md`
- Messaging -> `references/messaging.md`
- Approval -> `references/approval.md`
- Bitable -> `references/bitable.md`
- Contacts -> `references/contacts.md`
- Attendance -> `references/attendance.md`

## Working rules

- Keep credentials in env, not inside prompts or scripts.
- Use this skill to pick the right Feishu execution path; do not keep all domain details in the main `SKILL.md`.
- Keep external writes, permission changes, and login/authorization in the main flow rather than hidden in subagents.

## Read references as needed

- `references/README.md`
  For setup notes and broader background.
