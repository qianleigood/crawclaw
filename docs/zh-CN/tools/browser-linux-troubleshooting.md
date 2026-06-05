---
read_when: Browser automation fails on Linux, especially with snap Chromium
summary: 修复 Linux 上 CrawClaw 浏览器自动化的智能体-浏览器启动问题
title: 浏览器故障排除
x-i18n:
  generated_at: "2026-06-05T14:49:40Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 9fe21a4463b63246cef8d5f5353eaa971c9a7f1a983f9e7ec5f89d42bf14d324
  source_path: tools/browser-linux-troubleshooting.md
  workflow: 15
---

# 浏览器故障排除（Linux）

Rust 原生 `browser` 工具启动托管的 `agent-browser` CLI。在 Linux 上，大多数失败要么来自缺失的托管运行时，要么来自无法在当前主机环境中启动的 Chromium 二进制文件。

## 缺失 agent-browser 运行时

如果工具报告 `agent-browser` 缺失，请重新安装托管运行时：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

然后检查运行时清单：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

## 浏览器可执行文件启动失败

在 Ubuntu 和许多 Linux 发行版上，默认的 Chromium 包可能是 snap 包装器。如果它在自动化下失败，请安装 Google Chrome 或其他基于非 snap Chromium 的浏览器，并将 CrawClaw 指向该二进制文件：

```bash
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
sudo apt --fix-broken install -y
```

```json
{
  "browser": {
    "enabled": true,
    "provider": "agent-browser",
    "executablePath": "/usr/bin/google-chrome-stable",
    "noSandbox": true,
    "extraArgs": ["--disable-gpu"]
  }
}
```

## 通过工具验证

通过智能体会话或 Gateway Tools Invoke API 调用浏览器工具：

```json
{ "action": "status", "profile": "crawclaw" }
```

```json
{ "action": "open", "profile": "crawclaw", "url": "https://example.com" }
```

## 配置参考

| 选项                     | 描述                                                | 默认值          |
| ------------------------ | --------------------------------------------------- | --------------- |
| `browser.enabled`        | 启用浏览器自动化                                    | `true`          |
| `browser.provider`       | 浏览器运行时提供商                                  | `agent-browser` |
| `browser.executablePath` | 指向基于 Chromium 的浏览器二进制文件的路径          | 自动检测        |
| `browser.noSandbox`      | 为需要它的主机添加 `--no-sandbox`                   | `false`         |
| `browser.extraArgs`      | 通过原生 `agent-browser` 客户端传递的额外浏览器标志 | `[]`            |
