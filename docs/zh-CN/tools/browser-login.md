---
read_when:
  - 你需要登录网站以进行浏览器自动化
  - 你想向 X/Twitter 发布更新
summary: 浏览器自动化的手动登录和 X/Twitter 发布
title: 浏览器登录
x-i18n:
  generated_at: "2026-06-05T14:49:42Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 99d2a653683ae79e844464059eebd5a49b15b66c104757bb44f78791155a56fd
  source_path: tools/browser-login.md
  workflow: 15
---

# 浏览器登录 + X/Twitter 发布

## 手动登录（推荐）

当网站需要登录时，**在主机**浏览器配置文件中**手动登录**（CrawClaw Desktop 或本地 Gateway API）。

**不要**把你的凭证给模型。自动化登录经常触发反机器人防御，可能会锁定账户。

返回主要浏览器文档：[浏览器](/tools/browser)。

## 使用哪个 Chrome 配置？

CrawClaw 控制一个**专用 Chrome 配置文件**（名为 `crawclaw`，橙色 UI）。这与你的日常浏览器配置文件分开。

对于智能体浏览器工具调用：

- 默认选择：智能体应使用其隔离的 `crawclaw` 浏览器。
- 仅在已登录会话很重要且用户在电脑旁点击/批准任何附加提示时使用 `profile="user"`。
- 如果你有多个用户浏览器配置文件，请明确指定配置文件，而不是猜测。

两种简单的访问方式：

1. **让智能体打开浏览器**，然后你自己登录。
2. **直接调用浏览器工具**：

```json
{ "action": "open", "profile": "crawclaw", "url": "https://x.com" }
```

如果你有多个配置文件，请明确传递工具的 `profile` 参数（默认是 `crawclaw`）。

## X/Twitter：推荐流程

- **阅读/搜索/帖子：** 使用**主机**浏览器（手动登录）。
- **发布更新：** 使用**主机**浏览器（手动登录）。

```json5
{
  agents: {
    defaults: {
        mode: "non-main",
        browser: {
          allowHostControl: true,
        },
      },
    },
  },
}
```

然后以主机浏览器为目标：

```json
{
  "action": "open",
  "target": "host",
  "profile": "crawclaw",
  "url": "https://x.com"
}
```
