---
summary: "Reaction tool semantics across all supported channels"
read_when:
  - Working on reactions in any channel
  - Understanding how emoji reactions differ across platforms
title: "Reactions"
---

# Reactions

The agent can add and remove emoji reactions on messages using the `message`
tool with the `react` action. Reaction behavior varies by channel.

## How it works

```json
{
  "action": "react",
  "messageId": "msg-123",
  "emoji": "thumbsup"
}
```

- `emoji` is required when adding a reaction.
- Set `emoji` to an empty string (`""`) to remove the bot's reaction(s).
- Set `remove: true` to remove a specific emoji (requires non-empty `emoji`).

## Channel behavior

<AccordionGroup>
  <Accordion title="QQBot and DingTalk">
    - Empty `emoji` removes all of the bot's reactions on the message.
    - `remove: true` removes just the specified emoji.
  </Accordion>

  <Accordion title="Feishu">
    - Empty `emoji` removes the app's reactions on the message.
    - `remove: true` removes just the specified emoji.
  </Accordion>

  <Accordion title="Feishu">
    - Empty `emoji` removes the bot's reactions.
    - `remove: true` also removes reactions but still requires a non-empty `emoji` for tool validation.
  </Accordion>

  <Accordion title="Weixin">
    - Empty `emoji` removes the bot reaction.
    - `remove: true` maps to empty emoji internally (still requires `emoji` in the tool call).
  </Accordion>

  <Accordion title="Feishu Personal (feishu)">
    - Requires non-empty `emoji`.
    - `remove: true` removes that specific emoji reaction.
  </Accordion>

  <Accordion title="Signal">
    - Inbound reaction notifications are controlled by the active Rust-native channel adapter when that adapter exposes reaction events.
  </Accordion>
</AccordionGroup>

## Reaction level

Per-channel `reactionLevel` config controls how broadly the agent uses reactions. Values are typically `off`, `ack`, `minimal`, or `extensive`.

- [Feishu reactionLevel](/channels/index#reaction-notifications) — `channels.feishu.reactionLevel`
- [Weixin reactionLevel](/channels/index#reaction-level) — `channels.weixin.reactionLevel`

Set `reactionLevel` on individual channels to tune how actively the agent reacts to messages on each platform.

## Related

- [Agent Send](/tools/agent-send) — the `message` tool that includes `react`
- [Channels](/channels) — channel-specific configuration
