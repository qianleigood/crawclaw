---
summary: "Community-maintained CrawClaw plugins: browse, install, and submit your own"
read_when:
  - You want to find third-party CrawClaw plugins
  - You want to publish or list your own plugin
title: "Community Plugins"
---

# Community Plugins

Community plugins are third-party packages that extend CrawClaw with new
channels, tools, providers, or other capabilities. They are built and maintained
by the community, published on [ClawHub](/tools/clawhub) or npm, and
installable with a single command.

```bash
crawclaw plugins install <package-name>
```

CrawClaw checks ClawHub first and falls back to npm automatically.

## Listed plugins

### Codex App Server Bridge

Independent CrawClaw bridge for Codex App Server conversations. Bind a chat to
a Codex thread, talk to it with plain text, and control it with chat-native
commands for resume, planning, review, model selection, compaction, and more.

- **npm:** `crawclaw-codex-app-server`
- **repo:** [github.com/pwrdrvr/crawclaw-codex-app-server](https://github.com/pwrdrvr/crawclaw-codex-app-server)

```bash
crawclaw plugins install crawclaw-codex-app-server
```

### DingTalk

DingTalk is now bundled as a primary China channel. CrawClaw keeps the original
community package identity and plugin id (`@largezhou/ddingtalk`, `ddingtalk`)
for compatibility.

- **npm:** `@largezhou/ddingtalk`
- **repo:** [github.com/largezhou/openclaw-dingtalk](https://github.com/largezhou/openclaw-dingtalk)
- **docs:** [DingTalk](/channels/ddingtalk)

```bash
crawclaw channels add
```

### Lossless Claw (LCM)

Lossless Context Management plugin for CrawClaw. DAG-based conversation
summarization with incremental compaction — preserves full context fidelity
while reducing token usage.

- **npm:** `@martian-engineering/lossless-claw`
- **repo:** [github.com/Martian-Engineering/lossless-claw](https://github.com/Martian-Engineering/lossless-claw)

```bash
crawclaw plugins install @martian-engineering/lossless-claw
```

### Opik

Official plugin that exports agent traces to Opik. Monitor agent behavior,
cost, tokens, errors, and more.

- **npm:** `@opik/opik-crawclaw`
- **repo:** [github.com/comet-ml/opik-crawclaw](https://github.com/comet-ml/opik-crawclaw)

```bash
crawclaw plugins install @opik/opik-crawclaw
```

### QQbot

Connect CrawClaw to QQ via the QQ Bot API. Supports private chats, group
mentions, channel messages, and rich media including voice, images, videos,
and files.

- **npm:** `@tencent-connect/crawclaw-qqbot`
- **repo:** [github.com/tencent-connect/crawclaw-qqbot](https://github.com/tencent-connect/crawclaw-qqbot)

```bash
crawclaw plugins install @tencent-connect/crawclaw-qqbot
```

### wecom

WeCom channel plugin for CrawClaw by the Tencent WeCom team. Powered by
WeCom Bot WebSocket persistent connections, it supports direct messages & group
chats, streaming replies, proactive messaging, image/file processing, Markdown
formatting, built-in access control, and document/meeting/messaging skills.

- **npm:** `@wecom/wecom-crawclaw-plugin`
- **repo:** [github.com/WecomTeam/wecom-crawclaw-plugin](https://github.com/WecomTeam/wecom-crawclaw-plugin)

```bash
crawclaw plugins install @wecom/wecom-crawclaw-plugin
```

## Submit your plugin

We welcome community plugins that are useful, documented, and safe to operate.

<Steps>
  <Step title="Publish to ClawHub or npm">
    Your plugin must be installable via `crawclaw plugins install \<package-name\>`.
    Publish to [ClawHub](/tools/clawhub) (preferred) or npm.
    See [Building Plugins](/plugins/building-plugins) for the full guide.

  </Step>

  <Step title="Host on GitHub">
    Source code must be in a public repository with setup docs and an issue
    tracker.

  </Step>

  <Step title="Open a PR">
    Add your plugin to this page with:

    - Plugin name
    - npm package name
    - GitHub repository URL
    - One-line description
    - Install command

  </Step>
</Steps>

## Quality bar

| Requirement                 | Why                                           |
| --------------------------- | --------------------------------------------- |
| Published on ClawHub or npm | Users need `crawclaw plugins install` to work |
| Public GitHub repo          | Source review, issue tracking, transparency   |
| Setup and usage docs        | Users need to know how to configure it        |
| Active maintenance          | Recent updates or responsive issue handling   |

Low-effort wrappers, unclear ownership, or unmaintained packages may be declined.

## Related

- [Install and Configure Plugins](/tools/plugin) — how to install any plugin
- [Building Plugins](/plugins/building-plugins) — create your own
- [Plugin Manifest](/plugins/manifest) — manifest schema
