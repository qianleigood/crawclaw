---
name: acp-router
description: Route ACP-backed agent requests through the bundled acpx backend.
---

# ACP Router

Use this skill when a request explicitly targets ACP agents, ACP sessions, or
the `acpx` backend.

## Behavior

- Prefer configured CrawClaw ACP agent definitions before raw adapter commands.
- Keep ACP sessions non-interactive; use configured permission policy instead
  of prompting from inside the harness.
- Use `plugins.entries.acpx.config.mcpServers` for ACP-local MCP servers.
- Treat `permissionMode=approve-all` as a high-trust operator setting.

## Configuration

The bundled plugin id is `acpx`. Runtime configuration lives under:

```json
{
  "plugins": {
    "entries": {
      "acpx": {
        "enabled": true,
        "config": {}
      }
    }
  }
}
```
