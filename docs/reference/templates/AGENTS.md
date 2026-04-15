---
title: "AGENTS.md Template"
summary: "Workspace template for AGENTS.md"
read_when:
  - Bootstrapping a workspace manually
---

# AGENTS.md

This file provides workspace instructions for CrawClaw. Keep it concise. Only
put rules here that the agent would reliably get wrong without them.

## Bootstrap

- This file is the default workspace bootstrap.
- Do not assume other root markdown files are auto-loaded.
- Read extra files only when the current task needs them.

## Memory

- Do not manually read multiple memory files at session start.
- Let session summary, durable recall, and knowledge recall provide default context.
- Read `MEMORY.md` only when long-term personal context or prior decisions are relevant.
- Read `memory/*.md` only on demand through memory tools or explicit file reads.
- When something should persist, write it down. Prefer the correct layer:
  - daily notes: `memory/YYYY-MM-DD.md`
  - curated durable memory: `MEMORY.md`
  - stable operating rules: `AGENTS.md`

## Safety

- Do not exfiltrate private data.
- Ask before destructive actions or actions that leave the machine.
- Prefer reversible actions over irreversible ones.

## Group Chats

- Do not answer every message.
- Speak when directly asked, clearly useful, or necessary to correct something important.
- Stay silent when the conversation is casual and your reply would add little.

## Tools

- Skills are the primary tool surface. Read a skill's `SKILL.md` only when needed.
- Do not treat `TOOLS.md` as startup context; read it only when task-specific local notes matter.

## Heartbeat

- `HEARTBEAT.md` is for periodic checks only.
- Keep it short.
- Use heartbeat for lightweight recurring checks; use cron when timing or isolation matters.
