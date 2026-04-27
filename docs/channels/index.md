---
summary: "Messaging platforms CrawClaw can connect to"
read_when:
  - You want to choose a chat channel for CrawClaw
  - You need a quick overview of supported messaging platforms
title: "Chat Channels"
---

# Chat Channels

CrawClaw defaults to a China-first channel surface. QuickStart and the main
channel picker prioritize Feishu, DingTalk, QQ Bot, and Weixin. Other channel
plugins remain available for explicit installation or advanced setup.

## Primary China channels

- [DingTalk](/channels/ddingtalk) — DingTalk enterprise robot via Stream mode; supports text, images, files, group routing, and allowlists.
- [Feishu](/channels/feishu) — Feishu/Lark bot via WebSocket with docs, wiki, drive, chat, and bot tools.
- [QQ Bot](/channels/qqbot) — QQ Bot API; private chats, group chats, channels, and rich media.
- [Weixin](/channels/weixin) — Tencent iLink Bot via QR login; private chats only.

## Optional and legacy channels

These channels are still maintained as optional or legacy plugin paths. They are
not shown as the default QuickStart recommendation.

- [BlueBubbles](/channels/bluebubbles) — Legacy iMessage-adjacent option through the BlueBubbles macOS server REST API.
- [Discord](/channels/discord) — Discord Bot API + Gateway; supports servers, channels, and DMs.
- [Google Chat](/channels/googlechat) — Google Chat API app via HTTP webhook.
- [iMessage (legacy)](/channels/imessage) — Legacy macOS integration via imsg CLI (deprecated, use BlueBubbles for new setups).
- [IRC](/channels/irc) — Classic IRC servers; channels + DMs with pairing/allowlist controls.
- [LINE](/channels/line) — LINE Messaging API bot (plugin, installed separately).
- [Matrix](/channels/matrix) — Matrix protocol (plugin, installed separately).
- [Mattermost](/channels/mattermost) — Bot API + WebSocket; channels, groups, DMs (plugin, installed separately).
- [Microsoft Teams](/channels/msteams) — Bot Framework; enterprise support (plugin, installed separately).
- [Nextcloud Talk](/channels/nextcloud-talk) — Self-hosted chat via Nextcloud Talk (plugin, installed separately).
- [Nostr](/channels/nostr) — Decentralized DMs via NIP-04 (plugin, installed separately).
- [Signal](/channels/signal) — signal-cli; privacy-focused.
- [Slack](/channels/slack) — Bolt SDK; workspace apps.
- [Synology Chat](/channels/synology-chat) — Synology NAS Chat via outgoing+incoming webhooks (plugin, installed separately).
- [Telegram](/channels/telegram) — Bot API via grammY; supports groups.
- [Tlon](/channels/tlon) — Urbit-based messenger (plugin, installed separately).
- [Twitch](/channels/twitch) — Twitch chat via IRC connection (plugin, installed separately).
- [Voice Call](/plugins/voice-call) — Telephony via Plivo or Twilio (plugin, installed separately).
- [WebChat](/web/webchat) — Gateway WebChat UI over WebSocket.
- [WhatsApp](/channels/whatsapp) — Most popular; uses Baileys and requires QR pairing.
- [Zalo](/channels/zalo) — Zalo Bot API; Vietnam's popular messenger (plugin, installed separately).
- [Zalo Personal](/channels/zalouser) — Zalo personal account via QR login (plugin, installed separately).

## Notes

- Channels can run simultaneously; configure multiple and CrawClaw will route per chat.
- QuickStart highlights the primary China channels by default. Use advanced or
  manual setup for optional and legacy channel plugins.
- Group behavior varies by channel; see [Groups](/channels/groups).
- DM pairing and allowlists are enforced for safety; see [Security](/gateway/security).
- Troubleshooting: [Channel troubleshooting](/channels/troubleshooting).
- Model providers are documented separately; see [Model Providers](/providers/models).
