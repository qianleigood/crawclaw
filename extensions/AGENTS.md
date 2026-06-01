# Extensions Boundary

This directory contains repo-owned bundled plugins. Third-party authoring now
uses the Rust plugin SDK in `crates/crawclaw-plugin-sdk`.

## Public Contracts

- Docs:
  - `docs/plugins/building-plugins.md`
  - `docs/plugins/architecture.md`
  - `docs/plugins/sdk-overview.md`
  - `docs/plugins/sdk-entrypoints.md`
  - `docs/plugins/sdk-runtime.md`
  - `docs/plugins/sdk-provider-plugins.md`
  - `docs/plugins/manifest.md`
- Definition files:
  - `crates/crawclaw-plugin-sdk/src/lib.rs`
  - `crates/crawclaw-native-plugins/src/registry.rs`
  - `package.json`

## Boundary Rules

- Extension production code should import from private helper seams such as
  `src/internal-plugin-helpers/**` only when the helper is repo-owned and not a
  public authoring contract. Prefer local barrels such as `./api.ts` and
  `./runtime-api.ts` for extension-owned code.
- Do not import core internals from `src/**`, `src/channels/**`,
  or another extension's `src/**`.
- Keep plugin metadata accurate in `crawclaw.plugin.json` and the package
  `crawclaw` block so discovery and setup work without executing plugin code.
- Treat files like `src/**`, `onboard.ts`, and other local helpers as private
  unless you intentionally promote them through `api.ts`.
- If core or core tests need a bundled plugin helper, export it from `api.ts`
  first instead of letting them deep-import extension internals.

## Channel Hot Paths

For channel plugins, keep these files as lightweight metadata/setup surfaces:

- `channel.ts`
- `shared.ts`
- `channel.setup.ts`
- `gateway.ts`
- `outbound.ts`
- top-level artifacts such as `api.ts`, `message-tool-api.ts`,
  `configured-state.ts`, `auth-presence.ts`, and `setup-entry.ts`

Do not statically import heavy runtimes from discovery, schema, status, setup,
or message-tool discovery paths. Put action handlers, long-running gateway
monitors, SDK clients, and media runtimes behind `*.runtime.ts` files and load
them with dynamic `import()` from the execution path.

When changing lazy-loading or module-boundary behavior, run `pnpm build` and
inspect the output for ineffective dynamic import warnings.

## Expanding The Boundary

- If an extension needs a new public authoring seam, add it to the Rust plugin
  SDK or the native registry instead of creating a JS package export.
- Keep new plugin-facing seams versioned. Third-party plugins consume the Rust
  SDK surface.
- When intentionally expanding the contract, update the Rust crate docs, plugin
  docs, and native contract tests in the same change.
