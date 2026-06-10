---
summary: "Maintainer audit of provider and plugin metadata ownership"
read_when:
  - You are adding or changing bundled provider or native plugin metadata
  - You need to decide which metadata source is authoritative
  - You are reviewing provider, plugin, or generated metadata drift
title: "Provider and Plugin Metadata Drift"
---

# Provider and Plugin Metadata Drift

This page records the current ownership split for bundled provider and plugin
metadata. Several implementation files in this area are CODEOWNERS-restricted,
so future runtime contract changes still need explicit owner review before
editing those files.

## Current Sources

- `crates/crawclaw-providers` owns the runtime provider catalog, provider
  defaults, transport metadata, config schema, and request normalization.
- `crates/crawclaw-native-plugins` owns built-in native plugin descriptors,
  tools, native web providers, speech providers, media providers, services, and
  native gateway method descriptors.
- `extensions/*/crawclaw.plugin.json` owns package identity, native entry
  declaration, config schema, bundled skills, runtime assets, and the public
  manifest snapshot that guards compatibility.
- `src/generated/` stores generated JSON read models consumed by docs, package
  checks, and desktop or runtime guardrails.

## Manifest Guard Metadata

These fields still appear in manifests because they are part of the public
bundled plugin contract, but runtime and generated metadata derive them from the
Rust catalogs first:

- Provider-to-plugin mappings come from `BUNDLED_PROVIDER_PLUGINS`.
- Provider auth environment variables come from
  `BUNDLED_PROVIDER_AUTH_ENV_VAR_CANDIDATES`.
- Provider legacy plugin aliases and auto-enable mappings come from
  `BUNDLED_PROVIDER_PLUGIN_CONTRACT_OVERRIDES`.
- Native tool names appear in native plugin descriptors and in manifest
  contracts for bundled plugins.
- Web, speech, and media provider descriptors appear in native plugin
  descriptors and generated capability metadata.

The provider crate keeps guard tests that compare the Rust catalog against the
manifest snapshot so the public manifest contract cannot silently drift.

## Current Rule

Keep Rust as the runtime source of truth:

- Provider runtime behavior stays in `crates/crawclaw-providers`.
- Native tool and sidecar behavior stays in `crates/crawclaw-native-plugins` and
  the runtime native plugin registry.
- Extension manifests stay as package and distribution contracts, not as a
  second runtime catalog.
- Generated metadata remains derived output and should be checked, not edited by
  hand.

Do not remove manifest fields that third-party plugin packaging or docs still
treat as public contract without a separate compatibility decision.

## Validation

Use the existing generated checks before and after metadata changes:

- `pnpm check:bundled-capability-metadata`
- `pnpm check:bundled-provider-auth-env-vars`
- `pnpm check:provider-runtime-constants`
- `pnpm release:check`
