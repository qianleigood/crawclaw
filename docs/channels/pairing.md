---
summary: "Pairing overview: approve who can DM you + which nodes can join"
read_when:
  - Setting up DM access control
  - Pairing a new node device
  - Reviewing CrawClaw security posture
title: "Pairing"
---

# Pairing

“Pairing” is CrawClaw’s explicit **owner approval** step.
It is used in two places:

1. **DM pairing** (who is allowed to talk to the bot)
2. **Node pairing** (which devices/nodes are allowed to join the gateway network)

Security context: [Security](/gateway/security)

## 1) DM pairing (inbound chat access)

When a channel is configured with DM policy `pairing`, unknown senders get a short code and their message is **not processed** until you approve.

Default DM policies are documented in: [Security](/gateway/security)

Pairing codes:

- 8 characters, uppercase, no ambiguous chars (`0O1I`).
- **Expire after 1 hour**. The bot only sends the pairing message when a new request is created (roughly once per hour per sender).
- Pending DM pairing requests are capped at **3 per channel** by default; additional requests are ignored until one expires or is approved.

### Approve a sender

```bash
crawclaw pairing list telegram
crawclaw pairing approve telegram <CODE>
```

Primary QuickStart channels: `ddingtalk`, `feishu`, `qqbot`, `weixin`.

Advanced setup can still use optional and legacy channels: `bluebubbles`,
`discord`, `googlechat`, `imessage`, `irc`, `line`, `matrix`, `mattermost`,
`msteams`, `nextcloud-talk`, `nostr`, `signal`, `slack`,
`synology-chat`, `telegram`, `twitch`, `weixin`, `whatsapp`, `zalo`, `zalouser`.

### Where the state lives

Stored under `~/.crawclaw/credentials/`:

- Pending requests: `<channel>-pairing.json`
- Approved allowlist store:
  - Default account: `<channel>-allowFrom.json`
  - Non-default account: `<channel>-<accountId>-allowFrom.json`

Account scoping behavior:

- Non-default accounts read/write only their scoped allowlist file.
- Default account uses the channel-scoped unscoped allowlist file.

Treat these as sensitive (they gate access to your assistant).

## 2) Node device pairing (macOS/headless nodes)

Nodes connect to the Gateway as **devices** with `role: node`. The Gateway
creates a device pairing request that must be approved.

Historical note: archived mobile node flows also used the same device-pair handshake,
but those source trees have been removed from this repository.

### Approve a node device

```bash
crawclaw devices list
crawclaw devices approve <requestId>
crawclaw devices reject <requestId>
```

If the same device retries with different auth details (for example different
role/scopes/public key), the previous pending request is superseded and a new
`requestId` is created.

### Node pairing state storage

Stored under `~/.crawclaw/devices/`:

- `pending.json` (short-lived; pending requests expire)
- `paired.json` (paired devices + tokens)

### Notes

- The legacy `node.pair.*` API (CLI: `crawclaw nodes pending/approve`) is a
  separate gateway-owned pairing store. WS nodes still require device pairing.

## Related docs

- Security model + prompt injection: [Security](/gateway/security)
- Updating safely (run doctor): [Updating](/install/updating)
- Channel configs:
  - DingTalk: [DingTalk](/channels/ddingtalk)
  - Feishu: [Feishu](/channels/feishu)
  - QQ Bot: [QQ Bot](/channels/qqbot)
  - Optional channel index: [Channels](/channels)
