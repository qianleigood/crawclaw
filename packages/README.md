# Packages

This directory contains support packages that do not fit cleanly inside the
Rust product runtime under `crates/` and are not modeled as extensions under
`extensions/`.

Use `packages/` for:

- internal support packages
- packaging-related support code
- side packages that are part of the monorepo but not part of the main runtime

Do not add a new package here by default. First decide whether it belongs to:

- `crates/` for runtime core
- `extensions/` for capability ecosystem packages
- `apps/crawclaw-desktop/` for desktop interface code
- `apps/` or `experiments/` if it is actually a sidecar product
