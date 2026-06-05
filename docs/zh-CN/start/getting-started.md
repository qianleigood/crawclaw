---
read_when:
  - 从零开始首次设置
  - 你想要最快的桌面聊天工作路径
summary: 安装 CrawClaw Desktop 并启动本地 Gateway。
title: 入门指南
x-i18n:
  generated_at: "2026-06-05T14:48:42Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 869cc3ce9e1ad3af40dfaa5ff90946e214831126d8311d13eeaadeabf1c33e9d
  source_path: start/getting-started.md
  workflow: 15
---

# 入门指南

安装 CrawClaw Desktop 并在桌面 UI 中完成设置。完成后你将拥有本地 Rust Gateway、已配置的模型认证和一个可用的桌面聊天会话。

## 你需要什么

- **macOS** 用于支持的 Apple 平台桌面应用
- **模型提供商账户或 API 密钥**（来自 Anthropic、OpenAI、Google 或其他支持的提供商）

## 快速设置

<Steps>
  <Step title="安装 CrawClaw Desktop">
    从 [GitHub Releases](https://github.com/qianleigood/crawclaw/releases) 下载最新的桌面安装包。
  </Step>
  <Step title="打开桌面应用">
    CrawClaw Desktop 会准备 `~/.crawclaw`、暂存嵌入式 Rust 运行时、启动本地 Gateway 并打开设置界面。
  </Step>
  <Step title="配置模型和插件">
    使用桌面设置来配置模型提供商、插件启用、本地运行时状态、日志和诊断。
  </Step>
  <Step title="发送你的第一条消息">
    使用 CrawClaw Desktop 中的智能体页面。自动化客户端可以通过本地 Gateway API 连接。
  </Step>
</Steps>

## 下一步做什么

<Columns>
  <Card title="Desktop 安装" href="/install/desktop" icon="monitor">
    应用包含、启动和本地存储的内容。
  </Card>
  <Card title="连接渠道" href="/channels" icon="message-square">
    Weixin、Feishu、QQ Bot、DingTalk 和 ESP32。
  </Card>
  <Card title="配对与安全" href="/channels/pairing" icon="shield">
    控制谁可以向你的智能体发送消息。
  </Card>
  <Card title="Gateway API" href="/gateway/protocol" icon="waypoints">
    用于自动化和集成的本地控制平面协议。
  </Card>
</Columns>

<Accordion title="高级：环境变量">
  如果你将 CrawClaw 作为服务账户运行或需要自定义路径：

- `CRAWCLAW_HOME` — 用于内部路径解析的主目录
- `CRAWCLAW_STATE_DIR` — 覆盖状态目录
- `CRAWCLAW_CONFIG_PATH` — 覆盖配置文件路径

完整参考：[环境变量](/help/environment)。
</Accordion>
