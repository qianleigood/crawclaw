# Packages

This directory is reserved for support packages that do not fit cleanly inside
the Rust product runtime under `crates/` and are not modeled as bundled plugins
under `extensions/`.

Keep it empty by default. Before adding a package here, decide whether it
belongs under:

- `crates/` for runtime core or Rust repo tooling
- `extensions/` for capability ecosystem packages
- `apps/` for app or sidecar product code
- `scripts/` for shell, Go, or Python delivery helpers
