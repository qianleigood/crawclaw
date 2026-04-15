---
name: tikhub
description: Use TikHub APIs and helper scripts for Douyin, TikTok, Xiaohongshu, and related social-media data workflows.
---

# TikHub

Use this skill when the task needs TikHub-backed fetch, download, or metadata lookup flows.

- Keep API usage scoped to the requested platform and object type.
- Prefer bundled helper scripts over ad-hoc HTTP calls when they already exist.
- Surface API-cost, rate-limit, and auth requirements before running expensive workflows.
- Read `references/validated-endpoints.md` first for currently supported routes; use `references/backlog-endpoints.md` only as a backlog/reference list.
