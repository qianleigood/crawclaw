---
read_when:
  - 你想从机器上移除 CrawClaw
  - 卸载后旧的 Gateway 启动项仍在运行
summary: 完全卸载 CrawClaw（桌面应用、本地运行时状态、工作区）
title: 卸载
x-i18n:
  generated_at: "2026-06-05T14:40:07Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 1a251c5651565183dfc4893659f48bfc2a3f93cd6622e573d3ebbe40c259435f
  source_path: install/uninstall.md
  workflow: 15
---

# 卸载

两条路径：

- **简单路径**：通过 CrawClaw Desktop。
- **手动旧版启动清理**：如果桌面应用已删除但旧启动项仍在运行。

## 简单路径

推荐：使用内置卸载程序：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

非交互式自动化应调用本地 Gateway API。如果该 API 无法访问，请使用以下手动步骤。

手动步骤（结果相同）：

1. 停止 CrawClaw Desktop 和任何手动 Gateway 进程：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

2. 移除任何旧版操作系统启动项：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

3. 删除状态 + 配置：

```bash
rm -rf "${CRAWCLAW_STATE_DIR:-$HOME/.crawclaw}"
```

如果你将 `CRAWCLAW_CONFIG_PATH` 设置为状态目录之外的自定义位置，也请删除该文件。

4. 删除你的工作区（可选，移除智能体文件）：

```bash
rm -rf ~/.crawclaw/workspace
```

5. 仅当你安装了桌面优先打包模式之前的旧全局 `crawclaw` 包时，才移除它。

注意事项：

- 如果你使用了 profiles（`--profile` / `CRAWCLAW_PROFILE`），请为每个状态目录重复步骤 3（默认是 `~/.crawclaw-<profile>`）。
- 在远程模式下，状态目录位于 **gateway 主机**上，因此也要在那里运行步骤 1-4。

## 手动旧版启动清理

如果旧启动项持续运行但 `crawclaw` 已不存在，请使用此方法。

### macOS（launchd）

默认标签为 `ai.crawclaw.gateway`（或 `ai.crawclaw.<profile>`；旧版 `com.crawclaw.*` 可能仍存在）：

```bash
launchctl bootout gui/$UID/ai.crawclaw.gateway
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

如果你安装了较旧的全局 `crawclaw` 包，请使用 `npm rm -g crawclaw`（或如果你用那种方式安装的，则用 `pnpm remove -g` / `bun remove -g`）移除它。

### 源码检出（git clone）

如果你从仓库检出运行（`git clone` + CrawClaw Desktop 或 Gateway API / Gateway API 调用）：

1. **在**删除仓库**之前**停止本地 Gateway 运行时（使用上面的简单路径或手动清理）。
2. 删除仓库目录。
3. 按上面所示移除状态 + 工作区。
