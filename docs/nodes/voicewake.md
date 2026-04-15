---
summary: "Global voice wake words (Gateway-owned) and how they sync across nodes"
read_when:
  - Changing voice wake words behavior or defaults
  - Adding new node platforms that need wake word sync
title: "Voice Wake"
---

# Voice Wake (Global Wake Words)

CrawClaw treats **wake words as a single global list** owned by the **Gateway**.

- There are **no per-node custom wake words**.
- **Any node/app UI may edit** the list; changes are persisted by the Gateway and broadcast to everyone.
- macOS keeps a local **Voice Wake enabled/disabled** toggle.
- Other node clients consume the gateway-owned trigger list; archived mobile runtimes are not shipped in this repository.

## Storage (Gateway host)

Wake words are stored on the gateway machine at:

- `~/.crawclaw/settings/voicewake.json`

Shape:

```json
{ "triggers": ["crawclaw", "claude", "computer"], "updatedAtMs": 1730000000000 }
```

## Protocol

### Methods

- `voicewake.get` → `{ triggers: string[] }`
- `voicewake.set` with params `{ triggers: string[] }` → `{ triggers: string[] }`

Notes:

- Triggers are normalized (trimmed, empties dropped). Empty lists fall back to defaults.
- Limits are enforced for safety (count/length caps).

### Events

- `voicewake.changed` payload `{ triggers: string[] }`

Who receives it:

- All WebSocket clients (Control UI, WebChat, etc.)
- All connected nodes, and also on node connect as an initial “current state” push.

## Client behavior

### Node hosts

- Uses the global list to gate `VoiceWakeRuntime` triggers.
- Editing “Trigger words” in Voice Wake settings calls `voicewake.set` and then relies on the broadcast to keep other clients in sync.

### Other node clients

- Consume the same gateway-owned trigger list over the Gateway WS.
- Historical mobile implementations used the same broadcast model, but those runtimes are no longer shipped here.
