---
read_when:
  - 你想要可复现、可回滚的安装
  - 你已经在使用 Nix/NixOS/Home Manager
  - 你想要所有内容固定版本并声明式管理
summary: 使用 Nix 声明式安装 CrawClaw
title: Nix
x-i18n:
  generated_at: "2026-06-05T14:39:46Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: dbc46dba5324d54f6edd95c0e45b277f885665cdc5771ce3f63a31d954beeded
  source_path: install/nix.md
  workflow: 15
---

# Nix 安装

使用 **[nix-crawclaw](https://github.com/crawclaw/nix-crawclaw)** 声明式安装 CrawClaw —— 一个包含所有依赖的 Home Manager 模块。

<Info>
[nix-crawclaw](https://github.com/crawclaw/nix-crawclaw) 仓库是 Nix 安装的权威来源。本页面是一个快速概述。
</Info>

## 功能特性

- Gateway + node 工具（whisper、spotify、cameras）—— 全部固定版本
- launchd 服务，可跨重启保持运行
- 声明式配置的插件系统
- 即时回滚：`home-manager switch --rollback`

## 快速开始

<Steps>
  <Step title="安装 Determinate Nix">
    如果尚未安装 Nix，请按照 [Determinate Nix 安装程序](https://github.com/DeterminateSystems/nix-installer) 的说明进行操作。
  </Step>
  <Step title="创建本地 flake">
    使用 nix-crawclaw 仓库中的 agent-first 模板：
    ```bash
    mkdir -p ~/code/crawclaw-local
    # 从 nix-crawclaw 仓库复制 templates/agent-first/flake.nix
    ```
  </Step>
  <Step title="配置密钥">
    设置你的消息机器人令牌和模型提供商 API 密钥。放在 `~/.secrets/` 的纯文本文件即可。
  </Step>
  <Step title="填充模板占位符并切换">
    ```bash
    home-manager switch
    ```
  </Step>
  <Step title="验证">
    确认 launchd 服务正在运行，且你的机器人能响应消息。
  </Step>
</Steps>

有关完整的模块选项和示例，请参阅 [nix-crawclaw README](https://github.com/crawclaw/nix-crawclaw)。

## Nix 模式下的运行时行为

设置 `CRAWCLAW_NIX_MODE=1`（使用 nix-crawclaw 时自动设置）后，CrawClaw 进入确定性模式，禁用自动安装流程。

你也可以手动设置：

```bash
export CRAWCLAW_NIX_MODE=1
```

在 macOS 上，GUI 应用不会自动继承 shell 环境变量。改用 defaults 启用 Nix 模式：

```bash
defaults write ai.crawclaw.mac crawclaw.nixMode -bool true
```

### Nix 模式下发生的变化

- 自动安装和自修改流程被禁用
- 缺失的依赖项显示 Nix 特定的修复信息
- UI 显示只读的 Nix 模式横幅

### 配置和状态路径

CrawClaw 从 `CRAWCLAW_CONFIG_PATH` 读取 JSON5 配置，并将可变数据存储在 `CRAWCLAW_STATE_DIR`。在 Nix 下运行时，需显式设置这些路径为 Nix 管理的路径，以便运行时状态和配置脱离不可变存储。

| 变量                   | 默认值                                  |
| ---------------------- | --------------------------------------- |
| `CRAWCLAW_HOME`        | `HOME` / `USERPROFILE` / `os.homedir()` |
| `CRAWCLAW_STATE_DIR`   | `~/.crawclaw`                           |
| `CRAWCLAW_CONFIG_PATH` | `$CRAWCLAW_STATE_DIR/crawclaw.json`     |

## 相关

- [nix-crawclaw](https://github.com/crawclaw/nix-crawclaw) -- 完整设置指南
- [Wizard](/start/wizard) -- 非 Nix Desktop 设置
