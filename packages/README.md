# Packages

This directory contains support packages that do not fit cleanly inside the
main runtime tree under `src/` and are not modeled as extensions under
`extensions/`.

Use `packages/` for:

- internal support packages
- package-contract or packaging-related support code
- side packages that are part of the monorepo but not part of the main runtime

Do not add a new package here by default. First decide whether it belongs to:

- `src/` for runtime core
- `extensions/` for capability ecosystem packages
- `ui/` for interface code
- `apps/` or `experiments/` if it is actually a sidecar product
