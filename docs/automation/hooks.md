---
summary: "Hooks: event-driven automation for commands and lifecycle events"
read_when:
  - You want event-driven automation for /new, /stop, and agent lifecycle events
  - You want to build, install, or debug hooks
title: "Hooks"
---

# Hooks

Hooks are small scripts that run when something happens inside the Gateway. They are automatically discovered from directories and can be inspected with CrawClaw Desktop or the local Gateway API.

There are two kinds of hooks in CrawClaw:

- **Internal hooks** (this page): run inside the Gateway when agent events fire, like `/new`, `/stop`, or lifecycle events.
- **Webhooks**: external HTTP endpoints that let other systems trigger work in CrawClaw. See [Webhooks](/automation/cron-jobs#webhooks).

Hooks can also be bundled inside plugins. CrawClaw Desktop or the local Gateway API shows both standalone hooks and plugin-managed hooks.

## Quick start

```bash
# List available hooks
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Enable a hook
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Check hook status
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Get detailed information
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

## Event types

| Event                    | When it fires                                    |
| ------------------------ | ------------------------------------------------ |
| `command:new`            | `/new` command issued                            |
| `command:stop`           | `/stop` command issued                           |
| `command`                | Any command event (general listener)             |
| `session:compact:before` | Before compaction summarizes history             |
| `session:compact:after`  | After compaction completes                       |
| `session:patch`          | When session properties are modified             |
| `agent:bootstrap`        | Before workspace bootstrap files are injected    |
| `gateway:startup`        | After channels start and hooks are loaded        |
| `message:received`       | Inbound message from any channel                 |
| `message:transcribed`    | After audio transcription completes              |
| `message:preprocessed`   | After all media and link understanding completes |
| `message:sent`           | Outbound message delivered                       |

## Writing hooks

### Hook structure

Each hook is a directory containing two files:

```
my-hook/
├── HOOK.md          # Metadata + documentation
└── handler.ts       # Handler implementation
```

### HOOK.md format

```markdown
---
name: my-hook
description: "Short description of what this hook does"
metadata:
  { "crawclaw": { "emoji": "🔗", "events": ["command:new"], "requires": { "bins": ["node"] } } }
---

# My Hook

Detailed documentation goes here.
```

**Metadata fields** (`metadata.crawclaw`):

| Field      | Description                                          |
| ---------- | ---------------------------------------------------- |
| `emoji`    | Display emoji for CLI                                |
| `events`   | Array of events to listen for                        |
| `export`   | Named export to use (defaults to `"default"`)        |
| `os`       | Required platforms (e.g., `["darwin", "linux"]`)     |
| `requires` | Required `bins`, `anyBins`, `env`, or `config` paths |
| `always`   | Bypass eligibility checks (boolean)                  |
| `install`  | Installation methods                                 |

### Handler implementation

```typescript
const handler = async (event) => {
  if (event.type !== "command" || event.action !== "new") {
    return;
  }

  console.log(`[my-hook] New command triggered`);
  // Your logic here

  // Optionally send message to user
  event.messages.push("Hook executed!");
};

export default handler;
```

Each event includes: `type`, `action`, `sessionKey`, `timestamp`, `messages` (push to send to user), and `context` (event-specific data).

### Event context highlights

**Command events** (`command:new`): `context.sessionEntry`, `context.previousSessionEntry`, `context.commandSource`, `context.workspaceDir`, `context.cfg`.

**Message events** (`message:received`): `context.from`, `context.content`, `context.channelId`, `context.metadata` (provider-specific data including `senderId`, `senderName`, `guildId`).

**Message events** (`message:sent`): `context.to`, `context.content`, `context.success`, `context.channelId`.

**Message events** (`message:transcribed`): `context.transcript`, `context.from`, `context.channelId`, `context.mediaPath`.

**Message events** (`message:preprocessed`): `context.bodyForAgent` (final enriched body), `context.from`, `context.channelId`.

**Bootstrap events** (`agent:bootstrap`): `context.bootstrapFiles` (mutable array), `context.agentId`.

**Session patch events** (`session:patch`): `context.sessionEntry`, `context.patch` (only changed fields), `context.cfg`. Only privileged clients can trigger patch events.

**Compaction events**: `session:compact:before` includes `messageCount`, `tokenCount`. `session:compact:after` adds `compactedCount`, `summaryLength`, `tokensBefore`, `tokensAfter`.

## Hook discovery

Hooks are discovered from these directories, in order of increasing override precedence:

1. **Managed hooks**: `~/.crawclaw/hooks/` (user-installed, shared across workspaces). Extra directories from `hooks.internal.load.extraDirs` share this precedence.
2. **Workspace hooks**: `<workspace>/hooks/` (per-agent, disabled by default until explicitly enabled)

Workspace hooks can add new hook names but cannot override managed hooks with the same name.

### Hook modules

Standalone hook-pack install/update commands have been removed from the default product path. Put trusted hook modules in the managed or workspace hook directories, or ship native plugin capabilities for distributable extension behavior.

## Removed bundled hooks

CrawClaw no longer ships TypeScript bundled hook handlers. The old
`bootstrap-extra-files`, `command-logger`, and `boot-md` handlers were removed
from the product runtime boundary; use a managed hook module or a workspace hook
when you need local automation.

## Plugin hooks

Typed Plugin SDK lifecycle hooks have been removed. Plugins no longer register
`before_tool_call`, `before_agent_reply`, `before_install`, model resolution, or
message-flow hooks through the removed typed plugin API; use the internal hook and webhook
systems on this page for operational automation.

## Configuration

```json
{
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "my-hook": { "enabled": true }
      }
    }
  }
}
```

Per-hook environment variables:

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "my-hook": {
          "enabled": true,
          "env": { "MY_CUSTOM_VAR": "value" }
        }
      }
    }
  }
}
```

Extra hook directories:

```json
{
  "hooks": {
    "internal": {
      "load": {
        "extraDirs": ["/path/to/more/hooks"]
      }
    }
  }
}
```

<Note>
The legacy `hooks.internal.handlers` array config format has been removed. Use managed or workspace hook directories for trusted local automation.
</Note>

## Gateway API reference

```bash
# List all hooks (add --eligible, --verbose, or --json)
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Show detailed info about a hook
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Show eligibility summary
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Enable/disable
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

## Best practices

- **Keep handlers fast.** Hooks run during command processing. Fire-and-forget heavy work with `void processInBackground(event)`.
- **Handle errors gracefully.** Wrap risky operations in try/catch; do not throw so other handlers can run.
- **Filter events early.** Return immediately if the event type/action is not relevant.
- **Use specific event keys.** Prefer `"events": ["command:new"]` over `"events": ["command"]` to reduce overhead.

## Troubleshooting

### Hook not discovered

```bash
# Verify directory structure
ls -la ~/.crawclaw/hooks/my-hook/
# Should show: HOOK.md, handler.ts

# List all discovered hooks
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

### Hook not eligible

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Check for missing binaries (PATH), environment variables, config values, or OS compatibility.

### Hook not executing

1. Verify the hook is enabled: CrawClaw Desktop or the local Gateway API
2. Restart your gateway process so hooks reload.
3. Check gateway logs: `./scripts/clawlog.sh | grep hook`

## Related

- [Gateway API Reference: hooks](/automation/hooks)
- [Webhooks](/automation/cron-jobs#webhooks)
- [Configuration](/gateway/configuration-reference#hooks)
