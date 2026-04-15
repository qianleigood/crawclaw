---
name: grok-video-web
description: Automate Grok web video workflows through the real grok.com UI. Use when generation, extend, redo, waiting, download, or result-page actions must happen through the website with persistent browser login state.
metadata: { "crawclaw": { "workflow": { "portability": "crawclaw_agent", "allowedTools": ["browser"], "requiresApproval": true, "notes": "Runs through a real logged-in browser session and should stay on the CrawClaw agent side." } } }
---

# Grok Video Web

Use this skill for Grok video work that must happen through the live website, not an API.

## Use this skill for

- generate a new Grok video
- resume or inspect a result page
- extend or redo an existing result
- wait for completion and download the artifact

## Mandatory workflow

1. Verify login state first.
2. Keep one job on one persisted browser profile.
3. Distinguish generate, extend, redo, and resume flows.
4. Confirm completion and real download before declaring success.

## Working rules

- Stop on CAPTCHA, Cloudflare, or human-verification blockers.
- Do not run concurrent jobs on the same shared profile.
- Preserve source/derived lineage for extend and redo runs.

## Read references as needed

- `references/page-observations.md`
- `references/extend-rules.md`
- `references/runtime-contract.md`
- `references/result-detection.md`
