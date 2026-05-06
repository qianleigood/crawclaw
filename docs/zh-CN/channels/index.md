---
read_when:
  - 你想为 CrawClaw 选择聊天渠道
  - 你需要快速了解支持的即时通讯平台
summary: CrawClaw 可连接的即时通讯平台
title: 聊天渠道
x-i18n:
  generated_at: "2026-05-06T12:28:28Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: fffa6e3ffc6ee3616f2acf7dbec70b2402fe62395c6bf59c6a45a1d7fc5898fd
  source_path: channels/index.md
  workflow: 15
---

# 聊天渠道

CrawClaw 默认以中国优先的渠道界面呈现。快速开始和主要渠道选择器优先展示飞书、钉钉、QQ Bot 和微信。其他渠道插件仍可通过显式安装或高级设置获取。

## 主要中国渠道

- [DingTalk](/channels/ddingtalk) — 钉钉企业机器人，采用 Stream 模式；支持文本、图片、文件、群路由和白名单。
- [Feishu](/channels/feishu) — 飞书/Lark 机器人，采用 WebSocket 连接，支持文档、Wiki、网盘、聊天和机器人工具。
- [QQ Bot](/channels/qqbot) — QQ Bot API；支持私聊、群聊、频道和富媒体。
- [Weixin](/channels/weixin) — 腾讯 iLink 机器人，通过二维码登录；仅支持私聊。

## 可选和遗留渠道

这些渠道仍作为可选或遗留插件路径维护。它们不会作为默认快速开始推荐显示。

- [BlueBubbles](/channels/bluebubbles) — 通过 BlueBubbles macOS 服务器 REST API 实现的老旧 iMessage 替代方案。
- [Discord](/channels/discord) — Discord 机器人 API + Gateway；支持服务器、频道和私信。
- [ESP32](/channels/esp32) — 通过 MQTT+UDP 连接 ESP32-S3-BOX-3 桌面助手（插件，实验性，默认禁用）。
- [Google Chat](/channels/googlechat) — Google Chat API 应用，通过 HTTP webhook。
- [iMessage（遗留）](/channels/imessage) — 通过 imsg CLI 实现的老旧 macOS 集成（已弃用，新设置请使用 BlueBubbles）。
- [IRC](/channels/irc) — 经典 IRC 服务器；支持频道和私信，带配对/白名单控制。
- [LINE](/channels/line) — LINE Messaging API 机器人（插件，需单独安装）。
- [Matrix](/channels/matrix) — Matrix 协议（插件，需单独安装）。
- [Mattermost](/channels/mattermost) — 机器人 API + WebSocket；支持频道、群组和私信（插件，需单独安装）。
- [Microsoft Teams](/channels/msteams) — Bot Framework；支持企业（插件，需单独安装）。
- [Nextcloud Talk](/channels/nextcloud-talk) — 通过 Nextcloud Talk 实现的自托管聊天（插件，需单独安装）。
- [Nostr](/channels/nostr) — 通过 NIP-04 实现去中心化私信（插件，需单独安装）。
- [Signal](/channels/signal) — signal-cli；注重隐私。
- [Slack](/channels/slack) — Bolt SDK；工作区应用。
- [Synology Chat](/channels/synology-chat) — 群晖 NAS Chat，通过出站+入站 webhook（插件，需单独安装）。
- [Telegram](/channels/telegram) — 机器人 API，通过 grammY；支持群组。
- [Tlon](/channels/tlon) — 基于 Urbit 的通讯应用（插件，需单独安装）。
- [Twitch](/channels/twitch) — 通过 IRC 连接实现的 Twitch 聊天（插件，需单独安装）。
- [语音通话](/plugins/voice-call) — 通过 Plivo 或 Twilio 实现电话功能（插件，需单独安装）。
- [WhatsApp](/channels/whatsapp) — 最流行；使用 Baileys，需要二维码配对。
- [Zalo](/channels/zalo) — Zalo Bot API；越南流行通讯应用（插件，需单独安装）。
- [Zalo 个人](/channels/zalouser) — 通过二维码登录的 Zalo 个人账号（插件，需单独安装）。

## 注意事项

- 渠道可同时运行；配置多个渠道后，CrawClaw 将按聊天路由。
- 快速开始默认高亮主要中国渠道。可选和遗留渠道插件需使用高级或手动设置。
- 群组行为因渠道而异；参见[群组](/channels/groups)。
- 为安全起见，私信配对和白名单会强制执行；参见[安全](/gateway/security)。
- 故障排除：[渠道故障排除](/channels/troubleshooting)。
- 模型提供商文档独立说明；参见[模型提供商](/providers/models)。
