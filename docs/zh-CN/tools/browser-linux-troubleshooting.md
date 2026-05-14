---
summary: 修复 Linux 上 CrawClaw agent-browser 启动问题
read_when: 浏览器自动化在 Linux 上失败，特别是 snap Chromium 环境
title: 浏览器故障排除
x-i18n:
  generated_at: "2026-05-14T00:00:00Z"
  source_path: tools/browser-linux-troubleshooting.md
---

# 浏览器故障排除（Linux）

Rust native `browser` 工具会启动托管的 `agent-browser` CLI。Linux 上最常见
的问题是托管运行时缺失，或 Chromium 类浏览器在当前主机环境中无法启动。

## 缺少 agent-browser 运行时

如果工具提示 `agent-browser` 缺失，请重新安装托管运行时：

```bash
crawclaw runtimes install
```

然后检查运行时状态：

```bash
crawclaw runtimes doctor
```

## 浏览器可执行文件无法启动

Ubuntu 等发行版中的 Chromium 可能是 snap wrapper。若自动化启动失败，建议
安装 Google Chrome 或其它非 snap 的 Chromium 浏览器，并在配置中指定路径：

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

通过智能体会话或 Gateway Tools Invoke API 调用：

```json
{ "action": "status", "profile": "crawclaw" }
```

```json
{ "action": "open", "profile": "crawclaw", "url": "https://example.com" }
```
