---
read_when: Browser automation fails on Linux, especially with snap Chromium
summary: 修复 Linux 上 CrawClaw 浏览器自动化 agent-browser 启动问题
title: 浏览器故障排除
x-i18n:
  generated_at: "2026-06-10T19:31:34Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: a740a93ff37e8e708604a427c9fc6ac46322bd36e6f33831e1adb9f43f645afd
  source_path: tools/browser-linux-troubleshooting.md
  workflow: 15
---

# 浏览器故障排除 (Linux)

Rust 原生 `browser` 工具启动托管的 `agent-browser` CLI。在 Linux 上，大多数故障源于缺少托管运行时或 Chromium 二进制文件无法在当前主机环境中启动。

## 缺少 agent-browser 运行时

如果工具报告说 `agent-browser` 缺失，请重新安装托管运行时：

在网关主机上打开 CrawClaw Desktop，让它暂存捆绑的托管运行时，或通过本地 Gateway 运行时安装路径在相同主机上运行。暂存的浏览器二进制文件位于 `runtimes/browser/bin/agent-browser`。

然后检查运行时清单：

确认网关运行时根目录包含 `runtimes/manifest.json` 且清单声明了 `browser-agent-browser-runtime` 服务。

## 浏览器可执行文件启动失败

在 Ubuntu 和许多 Linux 发行版上，默认的 Chromium 包可能是 snap 包装器。如果它在自动化下失败，请安装 Google Chrome 或其他基于 Chromium 的非 snap 浏览器，并将 CrawClaw 指向该二进制文件：

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
| `browser.executablePath` | 基于 Chromium 的浏览器二进制文件路径                | 自动检测        |
| `browser.noSandbox`      | 为需要它的主机添加 `--no-sandbox`                   | `false`         |
| `browser.extraArgs`      | 通过原生 `agent-browser` 客户端传递的额外浏览器标志 | `[]`            |
