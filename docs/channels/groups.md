---
title: "Groups"
summary: "Group and room channel setup, allowlists, and context visibility"
read_when:
  - Configuring group chats
  - Reviewing group allowlists or context visibility
---

# Groups

Group chats and channel rooms need stricter setup than direct messages. They can
have more participants, shared context, and different mention or reply rules.

## Context visibility and allowlists

Use channel allowlists to decide which rooms the Gateway accepts. Use context
visibility settings to decide what prior messages can be included when a group
message becomes an agent request.

## Pattern personal DMs public groups single agent

A common setup is one agent for personal DMs and selected public groups. Keep DM
allowlists and group allowlists separate, then route both surfaces to the same
agent only when shared context is acceptable.

## Related

- [Group messages](/channels/group-messages)
- [Broadcast groups](/channels/broadcast-groups)
- [Channel routing](/channels/channel-routing)
