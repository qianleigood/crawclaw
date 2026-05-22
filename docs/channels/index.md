---
title: "Channels"
summary: "Messaging channel architecture, built-in native channels, and the shared Gateway routing model"
read_when:
  - Connecting a messaging channel
  - Updating channel docs, pairing, allowlists, or routing behavior
---

# Channels

CrawClaw channels connect external conversations to the local Gateway. CrawClaw
Desktop owns the setup and status surface; the Gateway owns auth, routing,
session binding, and delivery; Rust channel contracts own native channel
capabilities and desktop configuration metadata.

## Current architecture

- Native channel capability descriptors live in `crates/crawclaw-channels`.
- Desktop channel configuration fields are read from the same channel catalog.
- Bundled plugins can still contribute channel-facing capabilities through
  manifests and Rust native descriptors.
- TypeScript channel hooks are not a public production contract.

## Built-in native channels

| Channel  | Purpose                           | Notes                                    |
| -------- | --------------------------------- | ---------------------------------------- |
| DingTalk | DingTalk bot control plane        | Rust-native config and lifecycle surface |
| Feishu   | Feishu or Lark bot control plane  | Rust-native config and lifecycle surface |
| ESP32    | ESP32 device pairing and delivery | Rust-native device channel               |
| QQ Bot   | QQ Bot control plane              | Rust-native config and lifecycle surface |
| Weixin   | Weixin QR-login channel           | Rust-native desktop and Gateway surface  |

## Access control and activation

Channel access is configured through Gateway security settings and channel-owned
settings. Use pairing for private access, allowlists for room or sender policy,
and multi-agent routing when different senders or rooms should map to different
agents.

## Access control DMs and groups

Direct messages and group conversations use the same Gateway trust boundary, but
they should be reviewed separately. DMs usually start with pairing or explicit
sender allowlists. Groups usually need room allowlists, mention policy, and an
agent routing rule.

## Reaction notifications

Reaction behavior is channel-specific. Feishu and similar channels expose
reaction notification settings through channel configuration and the local
Gateway state.

## Reaction level

Weixin and other channels may expose a reaction level setting when the channel
supports reaction-like events. Keep these settings under the owning channel
surface instead of adding provider-specific behavior to core tools.

## Related

- [Pairing](/channels/pairing)
- [Channel routing](/channels/channel-routing)
- [Groups](/channels/groups)
- [Channel troubleshooting](/channels/troubleshooting)
