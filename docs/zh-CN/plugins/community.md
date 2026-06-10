---
summary: "Community-maintained CrawClaw plugins：浏览、安装并提交你自己的 plugin"
read_when:
  - 你想寻找 third-party CrawClaw plugins
  - 你想发布或列出自己的 plugin
title: "Community Plugins"
x-i18n:
  generated_at: "2026-06-10T11:28:57Z"
  model: codex
  provider: openai
  source_hash: 95a309f28846ed55b1448274ce3a9dbded71f97206b04c15296f439f296f0618
  source_path: plugins/community.md
  workflow: 15
---

# Community Plugins

Community plugins 是 third-party packages，用于通过新的 channels、tools、providers 或其他 capabilities 扩展 CrawClaw。它们由 community 构建和维护，发布在 [ClawHub](/tools/clawhub) 或 npm 上，并可以用单个命令安装。

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

CrawClaw 会优先检查 ClawHub，然后自动 fallback 到 npm。

## Listed plugins

### Codex App Server Bridge

用于 Codex App Server conversations 的独立 CrawClaw bridge。把 chat 绑定到 Codex thread，用 plain text 对话，并通过 chat-native commands 控制 resume、planning、review、model selection、compaction 等。

- **npm:** `crawclaw-codex-app-server`
- **repo:** [github.com/pwrdrvr/crawclaw-codex-app-server](https://github.com/pwrdrvr/crawclaw-codex-app-server)

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

### Lossless Claw (LCM)

CrawClaw 的 Lossless Context Management plugin。基于 DAG 的 conversation summarization，带 incremental compaction；在降低 token usage 的同时保留完整 context fidelity。

- **npm:** `@martian-engineering/lossless-claw`
- **repo:** [github.com/Martian-Engineering/lossless-claw](https://github.com/Martian-Engineering/lossless-claw)

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

### Opik

官方 plugin，用于把 agent traces 导出到 Opik。监控 agent behavior、cost、tokens、errors 等。

- **npm:** `@opik/opik-crawclaw`
- **repo:** [github.com/comet-ml/opik-crawclaw](https://github.com/comet-ml/opik-crawclaw)

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

### QQbot

通过 QQ Bot API 将 CrawClaw 连接到 QQ。支持 private chats、group mentions、channel messages，以及包含 voice、images、videos 和 files 的 rich media。

- **npm:** `@tencent-connect/crawclaw-qqbot`
- **repo:** [github.com/tencent-connect/crawclaw-qqbot](https://github.com/tencent-connect/crawclaw-qqbot)

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

### wecom

腾讯 WeCom team 提供的 CrawClaw WeCom channel plugin。它基于 WeCom Bot WebSocket persistent connections，支持 direct messages 和 group chats、streaming replies、proactive messaging、image/file processing、Markdown formatting、built-in access control，以及 document/meeting/messaging skills。

- **npm:** `@wecom/wecom-crawclaw-plugin`
- **repo:** [github.com/WecomTeam/wecom-crawclaw-plugin](https://github.com/WecomTeam/wecom-crawclaw-plugin)

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

## Submit your plugin

我们欢迎有用、有文档且安全可运行的 community plugins。

<Steps>
  <Step title="Publish to ClawHub or npm">
    Your plugin must be installable via CrawClaw Desktop or the local Gateway API.
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

| Requirement                 | Why                                                          |
| --------------------------- | ------------------------------------------------------------ |
| Published on ClawHub or npm | Users need CrawClaw Desktop or the local Gateway API to work |
| Public GitHub repo          | Source review, issue tracking, transparency                  |
| Setup and usage docs        | Users need to know how to configure it                       |
| Active maintenance          | Recent updates or responsive issue handling                  |

Low-effort wrappers、ownership 不清晰或无人维护的 packages 可能会被拒绝。

## Related

- [Install and Configure Plugins](/tools/plugin) — 如何安装任意 plugin
- [Building Plugins](/plugins/building-plugins) — 创建自己的 plugin
- [Plugin Manifest](/plugins/manifest) — manifest schema
