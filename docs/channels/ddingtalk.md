---
summary: "DingTalk Stream mode setup, config, routing, and media support"
read_when:
  - You want to connect CrawClaw to DingTalk
  - You need DingTalk Stream mode credentials and allowlist setup
  - You want DingTalk text, image, file, or group message routing
title: DingTalk
---

# DingTalk

DingTalk connects CrawClaw through the community OpenClaw-compatible
`@largezhou/ddingtalk` plugin, now bundled as a primary China channel. The
plugin id and channel id remain `ddingtalk`.

## Capabilities

- Stream mode robot connection through DingTalk Open Platform.
- Direct and group chat routing.
- Text, image, file, audio, and video outbound messages.
- `allowFrom` access control for DingTalk user IDs.
- Group policy routing through configured DingTalk group IDs.

## Install

Current CrawClaw installs bundle DingTalk. Existing community installs can keep
using the same package identity:

```bash
crawclaw plugins install @largezhou/ddingtalk
```

For first-time setup, use the channel wizard:

```bash
crawclaw channels add
```

Choose **DingTalk (钉钉 Stream)**.

## Credentials

Create an internal enterprise app in DingTalk Open Platform and enable the
robot Stream mode.

Required values:

- `DINGTALK_CLIENT_ID`: DingTalk AppKey or Client ID.
- `DINGTALK_CLIENT_SECRET`: DingTalk AppSecret or Client Secret.

Manual config example:

```json
{
  "channels": {
    "ddingtalk": {
      "enabled": true,
      "clientId": "DINGTALK_CLIENT_ID",
      "clientSecret": "DINGTALK_CLIENT_SECRET",
      "allowFrom": ["userId123"]
    }
  }
}
```

## Targets

DingTalk accepts these target forms:

- `userId123`
- `ddingtalk:user:userId123`
- `chat:<openConversationId>`
- `ddingtalk:chat:<openConversationId>`

When no explicit target is provided, CrawClaw can use the first `allowFrom`
entry as the default outbound target.

## Access Control

Keep `allowFrom` scoped to trusted DingTalk user IDs. DingTalk user IDs are
usually alphanumeric strings from DingTalk admin tools or message logs.

For group chats, configure group IDs and per-group tool policy under
`channels.ddingtalk.groups`.

## Related

- [Channels](/channels)
- [Pairing](/channels/pairing)
- [Groups](/channels/groups)
