# Plugins Boundary

Rust owns plugin discovery, manifest validation, runtime registry assembly, and
native execution. This directory contains non-executable migration notes only;
do not add a new TypeScript or JavaScript plugin runtime surface here.

## Public Contracts

- Docs:
  - `docs/plugins/architecture.md`
  - `docs/plugins/manifest.md`
  - `docs/plugins/sdk-overview.md`
  - `docs/plugins/sdk-entrypoints.md`
- Definition files:
  - `crates/crawclaw-plugin-sdk/src/lib.rs`
  - `crates/crawclaw-native-plugins/src/registry.rs`
  - `crates/crawclaw-runtime/src/native_plugin_registry.rs`
  - `src/generated/plugins/bundled-capability-metadata.generated.json`

## Boundary Rules

- Preserve manifest-first behavior in Rust: discovery, config validation, and
  setup should work from metadata before plugin runtime executes.
- Keep loader behavior aligned with the documented Rust plugin SDK and native
  manifest contracts. Do not create private backdoors that bundled plugins can
  use but external plugins cannot.
- If a loader or registry change affects plugin authors, update the Rust SDK,
  docs, and contract tests instead of relying on incidental internals.
- Do not normalize "plugin-owned" into "core-owned" by scattering direct reads
  of `plugins.entries.<id>.config` through unrelated core paths. Prefer generic
  helpers, manifest metadata, and explicit auto-enable wiring.
- When plugin-owned tools or provider fallbacks need core participation, keep
  the contract generic and honor plugin disablement plus SecretRef semantics.
- Keep contract loading and contract tests on the dedicated bundled registry
  path. Do not make contract validation depend on activating providers through
  unrelated production resolution flows.
