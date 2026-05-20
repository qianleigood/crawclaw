# Plugins

The old TypeScript plugin control plane has been removed.

Current ownership:

- Public plugin authoring contract: `crates/crawclaw-plugin-sdk`
- Native plugin descriptors and operations: `crates/crawclaw-native-plugins`
- Runtime discovery/dispatch: `crates/crawclaw-runtime/src/native_plugin_registry.rs`
- Generated package metadata: `src/generated/plugins`

This directory is retained for non-executable migration notes only.
