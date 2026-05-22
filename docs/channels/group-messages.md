---
title: "Group Messages"
summary: "Message handling rules for group chats, rooms, and threaded channels"
read_when:
  - Debugging group message delivery
  - Updating channel message normalization
---

# Group Messages

Group messages are normalized by the Gateway before they reach the agent runtime.
The channel adapter provides the room, sender, thread, and reply metadata; the
Gateway applies access policy and routing; the runtime sees a typed channel
envelope.

## Message shape

- Channel ID identifies the adapter.
- Sender ID identifies the person or bot that sent the message.
- Room or thread ID identifies the shared conversation.
- Reply metadata is preserved when the channel supports it.

## Related

- [Messages](/concepts/messages)
- [Groups](/channels/groups)
- [Channel troubleshooting](/channels/troubleshooting)
