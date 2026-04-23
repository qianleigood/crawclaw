# Channels Boundary

`src/channels/**` is core channel implementation. Plugin authors should not
import from this tree directly.

## Public Contracts

- Docs:
  - `docs/plugins/sdk-channel-plugins.md`
  - `docs/plugins/architecture.md`
  - `docs/plugins/sdk-overview.md`
- Definition files:
  - `src/channels/plugins/types.plugin.ts`
  - `src/channels/plugins/types.core.ts`
  - `src/channels/plugins/types.adapters.ts`
  - `src/plugin-sdk/core.ts`
  - `src/plugin-sdk/channel-contract.ts`

## Boundary Rules

- Keep extension-facing channel surfaces flowing through `crawclaw/plugin-sdk/*`
  instead of direct imports from `src/channels/**`.
- When a bundled or third-party channel needs a new seam, add a typed SDK
  contract or facade first.
- Remember that shared channel changes affect both built-in and extension
  channels. Check routing, pairing, allowlists, command gating, onboarding, and
  reply behavior across the full set.

## Hot Import Paths

Channel discovery and setup run on startup and CLI metadata paths. Keep these
paths lightweight and free of provider runtimes, network clients, and large SDKs:

- `channel.ts`
- `shared.ts`
- `channel.setup.ts`
- `gateway.ts`
- `outbound.ts`
- `src/channels/plugins/**` discovery helpers

If discovery needs message actions, config presence, auth presence, or setup
promotion metadata, prefer a small public artifact such as `message-tool-api.ts`,
`configured-state.ts`, `auth-presence.ts`, or a setup contract export. Runtime
handlers should stay behind `*.runtime.ts` boundaries and be loaded with dynamic
`import()`.

After changing a lazy-loading or module-boundary path, run `pnpm build` and
check for ineffective dynamic import warnings.
