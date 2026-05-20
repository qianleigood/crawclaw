---
summary: "CrawClaw 的高级设置和开发工作流"
read_when:
  - 设置新机器
  - 你想要“latest + greatest”而不破坏个人设置
title: "设置"
---

# 设置

<Note>
如果是第一次设置，请先从 [Getting Started](/start/getting-started) 开始。
新手引导细节见 [Getting Started](/start/getting-started)。
</Note>

## TL;DR

- **个性化内容放在仓库之外：** `~/.crawclaw/workspace`（工作区）+ `~/.crawclaw/crawclaw.json`（配置）。
- **稳定工作流：** 安装 CrawClaw Desktop，并使用桌面设置界面。
- **前沿工作流：** 从源码运行桌面应用。

## 从源码运行的先决条件

- Node 24.x（稳定）或 Node 25.x（实验）
- `pnpm`

## 个性化策略

如果你想要“100% 为我定制”同时又方便更新，把自定义内容保存在：

- **配置：** `~/.crawclaw/crawclaw.json`（JSON/JSON5-ish）
- **工作区：** `~/.crawclaw/workspace`（skills、prompts、memories；可以做成私有 git repo）

从 CrawClaw Desktop 完成引导。应用会写入缺失的本地默认值，并把状态保存在
`~/.crawclaw`。

## 从仓库运行 Gateway

运行 `pnpm desktop:tauri:stage-runtime` 后，桌面应用会使用打包好的内部 Gateway
二进制：

```bash
./dist/native/crawclaw-gateway --port 18789
```

## 稳定工作流

1. 安装 CrawClaw Desktop。
2. 通过桌面设置界面完成 onboarding 和配置。
3. 使用桌面状态和诊断面板检查本地健康状态。

## 前沿工作流

目标：开发 Rust Gateway 和桌面 host loop。

### 1）启动开发 Gateway

```bash
pnpm install
pnpm desktop:tauri:stage-runtime
pnpm desktop:tauri:dev
```

桌面开发 shell 会通过 Tauri host 启动本地 Rust Gateway。

### 2）验证

- 使用桌面状态面板或 Gateway API health route。

### 常见陷阱

- **端口错误：** Gateway WS 默认是 `ws://127.0.0.1:18789`；所有客户端保持同一端口。
- **状态存放位置：**
- Credentials: `~/.crawclaw/credentials/`
- Sessions: `~/.crawclaw/agents/<agentId>/sessions/`
- Logs: `/tmp/crawclaw/`

## 凭证存储映射

调试认证或决定备份内容时使用这张映射：

- **Weixin**: `~/.crawclaw/credentials/weixin/<accountId>/creds.json`
- **Feishu bot token**: config/env 或 `channels.feishu.tokenFile`（只允许普通文件；拒绝 symlink）
- **QQBot bot token**: config/env 或 SecretRef（env/file/exec providers）
- **DingTalk tokens**: config/env (`channels.ddingtalk.*`)
- **Pairing allowlists**:
  - `~/.crawclaw/credentials/<channel>-allowFrom.json`（默认账号）
  - `~/.crawclaw/credentials/<channel>-<accountId>-allowFrom.json`（非默认账号）
- **Model auth profiles**: `~/.crawclaw/agents/<agentId>/agent/auth-profiles.json`
- **File-backed secrets payload（可选）**: `~/.crawclaw/secrets.json`
- **Legacy OAuth import**: `~/.crawclaw/credentials/oauth.json`
  更多细节见 [Security](/gateway/security#credential-storage-map)。

## 更新

- 把 `~/.crawclaw/workspace` 和 `~/.crawclaw/` 当作“你的内容”；不要把个人 prompt/config 放进 `crawclaw` 仓库。
- 更新源码：`git pull` + `pnpm install`（lockfile 变化时）+ 使用 `pnpm desktop:tauri:dev`。

## Linux

Linux 安装使用 systemd **user** service。默认情况下，systemd 会在 logout/idle
时停止 user service，这会终止 Gateway。Onboarding 会尝试帮你启用 lingering（可能提示
sudo）。如果仍未启用，运行：

```bash
sudo loginctl enable-linger $USER
```

对于 always-on 或多用户服务器，可以考虑使用 **system** service 而不是 user service
（不需要 lingering）。systemd 说明见 [Gateway runbook](/gateway)。

## 相关文档

- [Gateway runbook](/gateway)（supervision、ports）
- [Gateway configuration](/gateway/configuration)（config schema + examples）
- [QQBot](/channels/index) 和 [Feishu](/channels/index)（reply tags + replyToMode settings）
- [CrawClaw assistant setup](/start/crawclaw)
