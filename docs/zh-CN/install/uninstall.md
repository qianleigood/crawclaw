---
read_when:
  - 你想从机器上移除 CrawClaw
  - 卸载后旧的 Gateway 启动项仍在运行
summary: 完全卸载 CrawClaw（桌面应用、本地运行时状态、工作区）
title: 卸载
x-i18n:
  generated_at: "2026-06-10T21:08:36Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 4ac985a8775ed339b018b7d037cb61c7783f7b4bcfa4e663d60b5d5630c84a26
  source_path: install/uninstall.md
  workflow: 15
---

# 卸载

两条路径：

- **当前桌面安装**：退出 CrawClaw Desktop，移除应用/包，然后决定是否删除本地状态。
- **手动旧版启动清理**：如果桌面应用已删除但旧启动项仍在运行。

## 当前桌面安装

当前桌面版本不会通过 Gateway API 提供一键整机卸载。应用本体请使用操作系统的包/应用移除流程。

移除应用前，如果你希望在内置 Gateway 仍运行时导出或删除本地桌面数据，请在 CrawClaw Desktop
中使用 **设置 > 数据与隐私**。

手动步骤：

1. 停止 CrawClaw Desktop 和任何手动 Gateway 进程：

退出 CrawClaw Desktop。如果你手动启动过 Gateway 或 dev server，请先停止对应进程再删除文件。

2. 移除应用或包：

- macOS app：把 CrawClaw Desktop 从 `/Applications` 移到废纸篓。
- 旧版包安装：用 `npm rm -g crawclaw` 移除旧的全局包（如果你用 `pnpm` 或 `bun`
  安装，则使用 `pnpm remove -g crawclaw` / `bun remove -g crawclaw`）。

3. 如果你想做完整本地清理，删除状态 + 配置：

```bash
rm -rf "${CRAWCLAW_STATE_DIR:-$HOME/.crawclaw}"
```

如果你将 `CRAWCLAW_CONFIG_PATH` 设置为状态目录之外的自定义位置，也请删除该文件。

4. 仅当 workspace 位于状态目录之外时，删除你的 workspace：

```bash
rm -rf /path/to/your/crawclaw-workspace
```

注意事项：

- 如果你使用了 profiles（`--profile` / `CRAWCLAW_PROFILE`），请为每个 profile 重复状态目录清理（默认是 `~/.crawclaw-<profile>`）。
- 在远程模式下，状态位于 **gateway 主机**上，因此也要在那里清理。

## 手动旧版启动清理

如果旧启动项持续运行但 `crawclaw` 已不存在，请使用此方法。

### macOS（launchd）

当前桌面安装不会创建单独的 Gateway helper LaunchAgent。仅在旧版 Gateway launchd 条目存在时移除它们：

```bash
launchctl print gui/$UID | grep crawclaw
launchctl bootout gui/$UID/ai.crawclaw.gateway 2>/dev/null || true
rm -f ~/Library/LaunchAgents/ai.crawclaw.gateway.plist
```

如果你使用了 profile，请将标签和 plist 名称替换为 `ai.crawclaw.<profile>`。如果存在，请移除任何旧版 `com.crawclaw.*` plist。

### Linux（systemd user unit）

默认单元名称为 `crawclaw-gateway.service`（或 `crawclaw-gateway-<profile>.service`）：

```bash
systemctl --user disable --now crawclaw-gateway.service
rm -f ~/.config/systemd/user/crawclaw-gateway.service
systemctl --user daemon-reload
```

### Windows 旧版任务

默认任务名称为 `CrawClaw Gateway`（或 `CrawClaw Gateway (<profile>)`）。
任务脚本位于状态目录下。

```powershell
schtasks /Delete /F /TN "CrawClaw Gateway"
Remove-Item -Force "$env:USERPROFILE\.crawclaw\gateway.cmd"
```

如果你使用了 profile，请删除匹配的任务名称和 `~\.crawclaw-<profile>\gateway.cmd`。

## 正常安装与源码检出

### 正常安装（CrawClaw Desktop / npm / pnpm / bun）

通过操作系统的包/应用流程移除桌面应用。如果你安装了较旧的全局 `crawclaw` 包，请使用
`npm rm -g crawclaw`（或如果你用那种方式安装的，则用 `pnpm remove -g crawclaw` /
`bun remove -g crawclaw`）移除它。

### 源码检出（git clone）

如果你从仓库检出运行（`git clone` + CrawClaw Desktop 或 Gateway API / Gateway API 调用）：

1. **在**删除仓库**之前**停止本地 Gateway 运行时（退出 CrawClaw Desktop 或停止手动 dev process）。
2. 删除仓库目录。
3. 按上面所示移除状态 + 工作区。
