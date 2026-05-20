---
summary: "Legacy bundle compatibility notes"
read_when:
  - You are migrating an older Codex, Claude, or Cursor bundle
  - You need to replace legacy bundle compatibility with a native plugin
title: "Plugin Bundles"
---

# Plugin Bundles

CrawClaw Desktop no longer maps Codex, Claude, or Cursor bundle manifests
through the TypeScript plugin runtime. New plugin work should use a native
CrawClaw plugin with `crawclaw.plugin.json` and a Rust native descriptor.

<Info>
  This page is kept as migration guidance for older installations. It does not
  describe an active desktop runtime loader.
</Info>

## Migration Path

Use the native plugin path instead of a compatible bundle:

1. Create a native plugin root with `crawclaw.plugin.json`.
2. Move static metadata into the manifest.
3. Move executable behavior into a Rust native descriptor and sidecar when
   needed.
4. Use the Rust plugin SDK contract for tools, services, providers, and runtime
   callbacks.

Related docs:

- [Plugin manifest](/plugins/manifest)
- [SDK overview](/plugins/sdk-overview)
- [SDK entry points](/plugins/sdk-entrypoints)
- [Plugin architecture](/plugins/architecture)
