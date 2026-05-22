---
title: "Location Resolution"
summary: "Location-oriented channel metadata and routing notes"
read_when:
  - Handling location data from channels
  - Updating channel metadata behavior
---

# Location Resolution

Some channels can send location-like metadata. Channel adapters should normalize
that metadata at the Gateway boundary and avoid leaking channel-specific payload
shapes into provider or tool code.

## Related

- [Channels](/channels)
- [Messages](/concepts/messages)
