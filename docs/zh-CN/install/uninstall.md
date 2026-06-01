---
read_when:
  - 你想从机器上移除 CrawClaw
  - 旧 Gateway startup entry 在卸载后仍在运行
summary: 完全卸载 CrawClaw（desktop app、本地 runtime state、workspace）
title: 卸载
x-i18n:
  generated_at: "2026-02-03T07:50:10Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 6673a755c5e1f90a807dd8ac92a774cff6d1bc97d125c75e8bf72a40e952a777
  source_path: install/uninstall.md
  workflow: 15
---

# 卸载

两种路径：

- **简单路径**：从 CrawClaw Desktop 执行。
- **手动 legacy startup cleanup**：desktop app 已删除但旧 startup entry 仍在运行时使用。

## 简单路径

推荐使用内置卸载入口：

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

非交互式自动化应调用本地 Gateway API。如果 API 不可达，请使用下面的手动步骤。

手动步骤（效果相同）：

1. 停止 CrawClaw Desktop 和任何手动 Gateway process：

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

2. 移除任何 legacy OS startup entry：

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

3. 删除 state + config：

```bash
rm -rf "${CRAWCLAW_STATE_DIR:-$HOME/.crawclaw}"
```

如果你将 `CRAWCLAW_CONFIG_PATH` 设置到 state dir 外的自定义位置，也请删除该文件。

4. 删除 workspace（可选，会移除 agent files）：

```bash
rm -rf ~/.crawclaw/workspace
```

5. 仅当你曾在 desktop-first packaging model 之前安装过旧的全局 `crawclaw` package 时，才移除旧包。

注意事项：

- 如果你使用 profiles（`--profile` / `CRAWCLAW_PROFILE`），对每个 state dir 重复步骤 3（默认为 `~/.crawclaw-<profile>`）。
- 在 remote mode 下，state dir 位于 **gateway host**，因此也要在那里执行步骤 1-4。

## 手动 legacy startup cleanup

如果旧 startup entry 仍在运行但 `crawclaw` 已缺失，请使用此方法。

### macOS（launchd）

默认 label 是 `ai.crawclaw.gateway`（或 `ai.crawclaw.<profile>`；legacy `com.crawclaw.*` 可能仍存在）：

```bash
launchctl bootout gui/$UID/ai.crawclaw.gateway
rm -f ~/Library/LaunchAgents/ai.crawclaw.gateway.plist
```

如果你使用 profile，请替换 label 和 plist 名称为 `ai.crawclaw.<profile>`。如果存在 legacy `com.crawclaw.*` plist，也请移除。

### Linux（systemd user unit）

默认 unit name 是 `crawclaw-gateway.service`（或 `crawclaw-gateway-<profile>.service`）：

```bash
systemctl --user disable --now crawclaw-gateway.service
rm -f ~/.config/systemd/user/crawclaw-gateway.service
systemctl --user daemon-reload
```

### Windows legacy task

默认 task name 是 `CrawClaw Gateway`（或 `CrawClaw Gateway (<profile>)`）。Task script 位于你的 state dir 下。

```powershell
schtasks /Delete /F /TN "CrawClaw Gateway"
Remove-Item -Force "$env:USERPROFILE\.crawclaw\gateway.cmd"
```

如果你使用 profile，请删除匹配的 task name 和 `~\.crawclaw-<profile>\gateway.cmd`。

## Normal install vs source checkout

### Normal install（CrawClaw Desktop / npm / pnpm / bun）

如果你安装过旧的全局 `crawclaw` package，请使用 `npm rm -g crawclaw` 移除（或使用你当时的 `pnpm remove -g` / `bun remove -g`）。

### Source checkout（git clone）

如果你从 repo checkout 运行（`git clone` + CrawClaw Desktop 或 Gateway API calls）：

1. 删除 repo 前先停止本地 Gateway runtime（使用上面的简单路径或手动 cleanup）。
2. 删除 repo directory。
3. 按上面步骤删除 state + workspace。
