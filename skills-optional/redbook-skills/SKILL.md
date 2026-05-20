---
name: redbook-skills
description: 将图文/视频内容发布到小红书（XHS），并支持登录检查、二维码登录辅助、搜索笔记、获取详情、评论/回复、读取内容数据和多账号/多端口运行。使用 Python/CDP 控制面。
---

# Redbook Skills

Use this as the main Xiaohongshu publishing and retrieval skill.

## Use this skill for

- 登录检查、二维码登录辅助、切账号
- 搜索笔记、看详情、看通知和内容数据
- 图文发布、视频发布、评论与回复
- 多账号、多端口、保守人类化交互

## Default execution model

- Python/CDP control plane through `scripts/*.py`

## Mandatory workflow

1. Distinguish login, read, comment, and publish flows first.
2. Require final user confirmation before any real publish.
3. Treat comment and publish as high-risk actions; use safer interaction mode by default.
4. Keep image-only and video-only publish paths separate.

## Working rules

- Use absolute file paths.
- Do not publish if the user only asked to test or open the browser.
- Prefer `safe` interaction mode for publish and comment tasks.
- Stop on risk signals; do not brute-force repeated actions.

## Read references as needed

- `references/python-legacy.md`
  For command flows and compatibility notes.
- `references/risk-guard.md`
  For throttling, cooldown, and risk handling.
- `references/multi-account.md`
  For profile, port, and launcher conventions.
- `references/README.md`
  For broader background and historical notes.
