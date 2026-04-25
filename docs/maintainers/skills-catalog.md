---
summary: Repo-level map of bundled, optional, and extension-scoped skills
read_when:
  - You are deciding where a new skill belongs
  - You need a single inventory of the skills already in this repository
title: Skills Catalog
---

# Skills Catalog

This document explains how skills are organized across the repository and where
maintainers should look before adding, moving, or deprecating a skill.

The short version:

- `skills/` is the default bundled skill surface
- `skills-optional/` is the in-repo optional catalog
- `extensions/*/skills/` plus rare extension-root `SKILL.md` files are extension-local skill surface owned by that extension

If you are deciding placement for a new skill, start with ownership first, then
distribution model:

1. Put it in `extensions/*/skills/` when it only makes sense with one extension's tools or config.
2. Put it in `skills/` when it is part of the default bundled skill surface and broadly useful.
3. Put it in `skills-optional/` when it is valuable to keep in-repo but should not ship as part of the default bundled set.

## Current Inventory

The repository currently has three skill surfaces:

- `skills/`: 18 bundled core skills
- `skills-optional/`: 38 optional catalog skills
- extension-owned surfaces under `extensions/`: 12 skills

Treat these as different distribution surfaces, not three random directories.

## Bundled Core Skills

`skills/` is the default bundled skill surface for CrawClaw.
It ships in published installs, and the runtime resolves bundled skills from
that install root. Treat removals or publish-whitelist changes here as package
surface changes, not cleanup.

Use this directory for repo-wide, broadly reusable skills that make sense as part
of the default runtime experience.

Current bundled set:

- `coding-agent`
- `find-skills`
- `frontend-dev`
- `fullstack-dev`
- `gh-issues`
- `github`
- `healthcheck`
- `link-checker`
- `node-connect`
- `openai-whisper`
- `pptx-generator`
- `react`
- `session-logs`
- `skill-creator`
- `skill-vetter`
- `summarize`
- `superpowers`
- `weather`

Rules of thumb:

- Keep the bundled set intentionally small.
- Prefer bundled placement only for general-purpose skills that are likely to be useful across many workspaces.
- Do not use `skills/` as a holding area for experiments, one-off integrations, or extension-owned instructions.

## Optional Catalog Skills

`skills-optional/` is an in-repo catalog for skills that are useful, but not part
of the default bundled surface.

Use it for:

- optional capability packs
- experiments worth preserving
- domain-specific skills that should stay in-repo without becoming default runtime surface

Current optional catalog:

- `1password`
- `android-native-dev`
- `apple-notes`
- `apple-reminders`
- `canvas`
- `feishu-bitable-attachment-uploader`
- `feishu-channel-rules`
- `feishu-create-doc`
- `feishu-fetch-doc`
- `feishu-file-sender`
- `feishu-office-toolkit`
- `feishu-troubleshoot`
- `feishu-update-doc`
- `flutter-dev`
- `gemini-browser-image`
- `gif-sticker-maker`
- `gog`
- `grok-video-web`
- `humanizer-zh`
- `ios-application-dev`
- `markdown-converter`
- `minimax-pdf`
- `minimax-xlsx`
- `platform-login-helper`
- `qwen3-tts-apple-silicon`
- `react-native-dev`
- `redbook-skills`
- `security-triage`
- `suno-api-client`
- `taskflow`
- `tikhub`
- `transnetv2-scene-detect`
- `ui-ux-pro-max`
- `vercel-react-best-practices`
- `video-analysis-workflow`
- `video-clip-skill`
- `video-understand`
- `word-processor`

Rules of thumb:

- Prefer this directory over `skills/` when the skill is specialized, optional, experimental, or ecosystem-specific.
- Do not describe this directory as product runtime architecture.
- If a skill graduates into the default experience, move it into `skills/` intentionally instead of treating both directories as interchangeable.

## Extension-Scoped Skills

Extension-local skills usually live under `extensions/*/skills/`, with a small
number defined directly at the extension root when the package itself is the
skill surface.

Use this surface when the instructions are tightly coupled to one extension's
tooling, config, identity, or workflow boundary. Keep these skills close to the
owning extension instead of copying them into the repo-wide bundled surface.

Current extension-scoped set:

- `extensions/lobster`
- `extensions/acpx/skills/acp-router`
- `extensions/diffs/skills/diffs`
- `extensions/feishu-cli/skills/feishu-user-toolkit`
- `extensions/feishu/skills/feishu-doc`
- `extensions/feishu/skills/feishu-drive`
- `extensions/feishu/skills/feishu-perm`
- `extensions/feishu/skills/feishu-wiki`
- `extensions/open-prose/skills/prose`
- `extensions/qqbot/skills/qqbot-channel`
- `extensions/qqbot/skills/qqbot-media`
- `extensions/qqbot/skills/qqbot-remind`

Rules of thumb:

- Keep extension-owned skills with the extension that owns the tools and config.
- Do not move extension-local skills into `skills/` just to make the repo root look simpler.
- If a skill depends on one extension's user/bot identity split, tool names, or config contract, it belongs with that extension.
- Prefer `extensions/<name>/skills/<skill>/SKILL.md` for multi-skill extensions; keep a root-level `extensions/<name>/SKILL.md` only when the extension package itself is the single skill surface.

## Ownership and Reading Order

When you need to understand the repo skill surface, read in this order:

1. `docs/tools/skills.md` for load order, precedence, and gating behavior
2. `skills/README.md` for the bundled core surface
3. `skills-optional/README.md` for the optional catalog boundary
4. `extensions/README.md` plus the owning extension package for extension-local skills

This keeps packaging questions separate from runtime loading questions.

## Maintenance Rules

When adding or reorganizing skills:

- Update the nearest local README when you change the meaning of a skill surface.
- Keep skill placement aligned with ownership, not just with naming similarity.
- Prefer docs-first clarification before moving large batches of skills between surfaces.
- Treat extension-local skills as part of the extension contract, not as generic repo clutter.

If the repository later introduces a dedicated catalog root, treat that as a
packaging move after the boundaries are already documented clearly here.
