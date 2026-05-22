---
title: "Broadcast Groups"
summary: "Broadcast-style group routing and delivery boundaries"
read_when:
  - Configuring one-to-many channel delivery
  - Reviewing group routing behavior
---

# Broadcast Groups

Broadcast groups are shared delivery targets where one agent response may be
sent to a configured group or room. Use them only when the room is explicitly
approved and the expected audience is clear.

## Guardrails

- Keep broadcast targets allowlisted.
- Prefer explicit agent bindings over implicit default routing.
- Confirm channel-specific reply behavior before enabling broad delivery.

## Related

- [Groups](/channels/groups)
- [Channel routing](/channels/channel-routing)
- [Security](/gateway/security)
