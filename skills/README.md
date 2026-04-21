# Core Skills

This directory is the default bundled skill surface for CrawClaw.

For the repo-wide skill map across bundled, optional, and extension-owned
surfaces, see https://docs.crawclaw.ai/maintainers/skills-catalog.

Only core skills belong here. The bundled skill loader resolves `<packageRoot>/skills`,
so anything placed in this directory ships as part of the default runtime skill set.

Current core set:

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

Rules:

- Keep this list intentionally small.
- Do not add vertical, channel-specific, or experimental skills here by default.
- Move non-core candidates to `../skills-optional/`.
