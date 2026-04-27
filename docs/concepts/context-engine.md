---
title: "Context Engine Removal"
summary: "Migration note for the removed legacy context-engine plugin surface"
read_when:
  - You are migrating an older context-engine plugin
  - You are checking current context assembly and compaction boundaries
---

# Context Engine Removal

The legacy `context-engine` plugin surface has been removed from CrawClaw.

Current state:

- Context assembly and compaction run through the built-in memory runtime.
- Plugin manifests may still use `kind: "memory"` for the exclusive memory slot.
- `api.registerContextEngine(...)`, `plugins.slots.contextEngine`, and the
  old compaction delegation bridge are no longer supported.

If you are migrating an older plugin, move custom context behavior onto the
memory runtime and typed hook surfaces instead of trying to recreate the old
engine registry.
