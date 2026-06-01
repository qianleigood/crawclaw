---
read_when:
  - 从零开始首次设置
  - 你想用最快路径获得可用的 desktop chat
summary: 安装 CrawClaw Desktop 并启动本地 Gateway。
title: 入门指南
x-i18n:
  generated_at: "2026-03-16T06:27:55Z"
  model: gpt-5.4
  provider: openai
  source_hash: 47583047c1a603c1254d2540846452ad321d12bc7fc3f24e5def9282ee96f415
  source_path: start/getting-started.md
  workflow: 15
---

# 入门指南

安装 CrawClaw Desktop，并在桌面 UI 中完成设置。完成后，你会拥有本地 Rust Gateway、已配置的模型认证，以及一个可用的 desktop chat session。

## 你需要准备

- **macOS**，用于当前支持的 Apple-platform desktop app
- **模型 provider 账号或 API key**，例如 Anthropic、OpenAI、Google 或其他支持的 provider

## 快速设置

<Steps>
  <Step title="安装 CrawClaw Desktop">
    从 [GitHub Releases](https://github.com/qianleigood/crawclaw/releases) 下载最新 desktop asset。
  </Step>
  <Step title="打开 desktop app">
    CrawClaw Desktop 会准备 `~/.crawclaw`、stage embedded Rust runtime、启动本地 Gateway，并打开设置 UI。
  </Step>
  <Step title="配置模型和 plugins">
    在 desktop Settings 中配置模型 providers、plugin 启用状态、本地 runtime 状态、日志和诊断。
  </Step>
  <Step title="发送第一条消息">
    在 CrawClaw Desktop 的 Agent 页面发送消息。自动化客户端可以通过本地 Gateway API 连接。
  </Step>
</Steps>

## 下一步

<Columns>
  <Card title="Desktop install" href="/install/desktop" icon="monitor">
    了解 app 打包、启动和本地存储的内容。
  </Card>
  <Card title="连接 channel" href="/channels" icon="message-square">
    Weixin、Feishu、QQ Bot、DingTalk 和 ESP32。
  </Card>
  <Card title="Pairing 和安全" href="/channels/pairing" icon="shield">
    控制谁可以给你的 agent 发消息。
  </Card>
  <Card title="Gateway API" href="/gateway/protocol" icon="waypoints">
    面向自动化和集成的本地 control-plane protocol。
  </Card>
</Columns>

<Accordion title="高级：环境变量">
  如果你以 service account 运行 CrawClaw，或想使用自定义路径：

- `CRAWCLAW_HOME` — 内部路径解析使用的 home directory
- `CRAWCLAW_STATE_DIR` — 覆盖 state directory
- `CRAWCLAW_CONFIG_PATH` — 覆盖 config file path

完整参考：[Environment variables](/help/environment)。
</Accordion>
