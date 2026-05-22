---
title: "Channel Pairing"
summary: "Pairing model for trusted DMs, devices, and channel access"
read_when:
  - Setting up a private channel
  - Debugging channel approval or allowlist behavior
---

# Channel Pairing

Pairing is the user approval layer for channel access. It keeps local Gateway
control explicit: CrawClaw Desktop shows pending requests, the Gateway stores the
approved state, and channel delivery uses the resulting trust decision.

## How it fits

- Pairing is a Gateway security decision, not a provider decision.
- Channel-specific setup can request pairing, but the shared security model
  remains under the Gateway.
- Device and DM pairing should use stable identifiers from the channel adapter.

## When to use allowlists

Use allowlists when a channel has known senders, rooms, or groups that should be
accepted without an interactive approval step. Use pairing when the operator
should approve a sender or device from CrawClaw Desktop.

## Related

- [Security](/gateway/security)
- [Channels](/channels)
- [Groups](/channels/groups)
