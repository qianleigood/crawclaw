# Extensions

This directory is the CrawClaw capability ecosystem layer.

It is not the same thing as the main runtime under `src/`.

Typical extension roles here include:

- channel integrations
- model/provider integrations
- browser/runtime helpers
- tool-oriented capability packages
- shared extension support code

Practical reading order:

1. Read `src/` if you want to understand the product runtime.
2. Read `extensions/` if you want to understand how CrawClaw is extended.

This directory is intentionally broad, but maintainers should treat it as a
single conceptual layer: product extensions, not core runtime code.

Some extensions also ship extension-local skills under `extensions/*/skills/`,
and a small number expose a single skill directly from the extension root.
Those skills are owned by the extension that ships them and should stay close to
that extension's tools and config surface. For the repo-wide skill map, see
https://docs.crawclaw.ai/maintainers/skills-catalog.
