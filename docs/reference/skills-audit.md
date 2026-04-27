---
title: "Skills Audit"
summary: "Audit of repo-level core and optional skill catalog structure"
read_when:
  - You are cleaning skill catalog structure
  - You are checking whether skill docs follow the current skill-creator standard
---

# Skills Audit

This audit covers the repo-level core and optional skill catalogs, currently
`56` skills total:

- `skills/` for `18` bundled core skills
- `skills-optional/` for `38` optional skills

Extension-owned skills are tracked separately in
[Skills catalog](/maintainers/skills-catalog).

This audit applies the current `skill-creator` standard:

- `SKILL.md` stays lean and frontmatter-backed
- supporting material moves into `references/`
- top-level extra docs inside skill directories should be avoided
- structural errors are fixed first; content compression comes after

## Fixed in this pass

- Restored valid frontmatter in `taskflow-inbox-triage/SKILL.md` before that example skill was later removed
- Added missing `references/` routing in:
  - `skills-optional/tikhub/SKILL.md`
- Moved extra top-level `README.md` files into `references/README.md` for:
  - `skills-optional/feishu-file-sender`
  - `skills-optional/feishu-office-toolkit`
  - `skills-optional/humanizer-zh`
  - `skills-optional/minimax-pdf`
  - `skills-optional/redbook-skills`
  - `tavily-web-search-for-crawclaw`
  - `skills-optional/transnetv2-scene-detect`
  - `skills-optional/vercel-react-best-practices`

## Final status

Current audit result:

- missing `SKILL.md`: `0`
- missing frontmatter: `0`
- top-level extra docs (`README.md` / `CHANGELOG.md` / `TODO.md`): `0`
- `references/` present but not mentioned from `SKILL.md`: `0`
- oversized `SKILL.md` files (>120 lines): `0`

The skill pack is now fully on the thin `SKILL.md` + deeper `references/` pattern.

## Follow-up priority

1. Keep new and updated skills on the same thin-router pattern.
2. Avoid reintroducing top-level `README.md` files in skill directories.
3. Prefer references and helper scripts for detail, not long `SKILL.md` files.

## Removed in the final cleanup

- `graph-memory-writeback`
- `low-fan-content-lab`
- `crawclaw-release-maintainer`
- `feishu-doc`
- `feishu-drive`
- `feishu-wiki`
- `feishu-bitable`
- `feishu-calendar`
- `feishu-task`
- `feishu-im-read`
- `clawhub`
- `exa-web-search-free`
- `seedance`
- `seedance-2-prompt-engineering-skill`
- `seedance2-skill`
- `xiaohongshuskills`
- `office`
- `tavily-web-search-for-crawclaw`
- `taskflow-inbox-triage`
- `scene-detect`
- `frontend-design`
- `xhs-transcriber`
- `ai-goofish-monitor-client`
- `jimeng-seedance-web`
- `video-frames`
- `bing-search-cn`
- `scrapling-official`
- `xhs-auto-import`
- `ima-skill`
- `gpt-best-image`
- `gemini`
