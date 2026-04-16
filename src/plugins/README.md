# Plugins

`src/plugins/**` owns the capability platform.

It covers:

- discovery and manifest loading
- registry assembly
- plugin runtime activation
- provider and channel capability wiring
- contract enforcement for bundled and external plugins

Top-level plugin boundary notes already live in `src/plugins/AGENTS.md`. This
README is the maintainer entry point for the core plugin runtime.

## Start Here

- `loader.ts`
- `registry.ts`
- `runtime.ts`
- `provider-runtime.ts`
- `manifest.ts`
- `public-artifacts.ts`

## Boundary Rules

- Keep bundled and external plugins on the same contract surface whenever possible.
- Do not create private core backdoors that bypass manifest, runtime, or SDK contracts.
- If core needs new plugin-owned data, add an explicit manifest field, helper, or runtime seam instead of reaching into plugin implementation files.
- Preserve plugin disablement, SecretRef handling, and manifest-first behavior when adding provider or tool wiring.

## Review Notes

- Changes here usually require contract tests or SDK-facing docs updates.
- If a change would only work for bundled plugins, it is probably the wrong seam.
