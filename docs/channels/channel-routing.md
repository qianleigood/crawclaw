---
title: "Channel Routing"
summary: "How channel messages map to agents, sessions, and delivery targets"
read_when:
  - Routing channel traffic to agents
  - Updating multi-agent channel behavior
---

# Channel Routing

Channel routing decides which agent and session should handle an inbound
message. The Gateway evaluates channel identity, sender or room identity,
allowlists, and configured routing rules before starting the agent loop.

## Routing model

- Direct messages usually map by channel account plus sender.
- Groups, rooms, and threads use their channel-specific room or thread identity.
- Multi-agent setups bind senders or rooms to agent IDs.
- The agent runtime receives a normalized channel envelope from the Gateway.

## Related

- [Multi-agent](/concepts/multi-agent)
- [Messages](/concepts/messages)
- [Groups](/channels/groups)
