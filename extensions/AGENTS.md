# Extensions Boundary

This directory contains bundled plugins. Treat it as the same boundary that
third-party plugins see.

## Public Contracts

- Docs:
  - `docs/plugins/building-plugins.md`
  - `docs/plugins/architecture.md`
  - `docs/plugins/sdk-overview.md`
  - `docs/plugins/sdk-entrypoints.md`
  - `docs/plugins/sdk-runtime.md`
  - `docs/plugins/sdk-channel-plugins.md`
  - `docs/plugins/sdk-provider-plugins.md`
  - `docs/plugins/manifest.md`
- Definition files:
  - `src/plugin-sdk/plugin-entry.ts`
  - `src/plugin-sdk/core.ts`
  - `src/plugin-sdk/provider-entry.ts`
  - `src/plugin-sdk/channel-contract.ts`
  - `scripts/lib/plugin-sdk-entrypoints.json`
  - `package.json`

## Boundary Rules

- Extension production code should import from `crawclaw/plugin-sdk/*` and its
  own local barrels such as `./api.ts` and `./runtime-api.ts`.
- Do not import core internals from `src/**`, `src/channels/**`,
  `src/plugin-sdk-internal/**`, or another extension's `src/**`.
- Do not use relative imports that escape the current extension package root.
- Keep plugin metadata accurate in `crawclaw.plugin.json` and the package
  `crawclaw` block so discovery and setup work without executing plugin code.
- Treat files like `src/**`, `onboard.ts`, and other local helpers as private
  unless you intentionally promote them through `api.ts` and, if needed, a
  matching `src/plugin-sdk/<id>.ts` facade.
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

- If an extension needs a new seam, add a typed Plugin SDK subpath or additive
  export instead of reaching into core.
- Keep new plugin-facing seams backwards-compatible and versioned. Third-party
  plugins consume this surface.
- When intentionally expanding the contract, update the docs, exported subpath
  list, package exports, and API/contract checks in the same change.
