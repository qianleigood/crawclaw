---
name: gemini-browser-image
description: Drive the logged-in Gemini web app in a real browser to generate or edit images without API keys. Use when browser persistence, existing login state, uploads, or real Gemini page behavior matter more than direct API access.
---

# Gemini Browser Image

Use this skill for Gemini website image workflows, not API-based image generation.

## Use this skill for

- text-to-image in Gemini Web
- edit or reference-image generation
- browser-login-dependent image work
- saving real local outputs from the Gemini UI

## Mandatory workflow

1. Reuse the logged-in browser profile.
2. Normalize Gemini into a stable image-generation state before acting.
3. Collect only minimum prompt/edit constraints.
4. Submit, wait, and verify a real local file exists before declaring success.

## Working rules

- One Gemini tab per job.
- Stop on CAPTCHA, login friction, or other human-verification walls.
- Do not claim success from a visible button alone; confirm a saved local artifact.

## Read references as needed

- `references/upload-and-attach.md`
  For uploads and attachment behavior.
- `references/output-capture.md`
  For save, verification, export, and fallback capture rules.
