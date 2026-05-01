# Core Skills

This directory is the default bundled skill surface for CrawClaw.

For the repo-wide skill map across bundled, optional, and extension-owned
surfaces, see https://docs.crawclaw.ai/maintainers/skills-catalog.

Only core skills belong here. The bundled skill loader resolves `<packageRoot>/skills`,
so anything placed in this directory ships as part of the default runtime skill set.

Python helper dependencies for bundled core skills belong in
`skills/.runtime/requirements.lock.txt` and are installed into the managed
`core-skills` runtime during project install/postinstall. Core skill scripts
should use that runtime or point users to `crawclaw runtimes install`; they
should not install packages on first use.

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
