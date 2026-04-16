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
