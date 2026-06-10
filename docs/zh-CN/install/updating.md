---
read_when:
  - 更新 CrawClaw
  - 更新后出现问题
summary: 安全更新 CrawClaw Desktop 以及回滚策略
title: 更新
x-i18n:
  generated_at: "2026-06-10T20:56:05Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: ae4fb84b2544de6f96b36e3519140b601cbff3838a82c49282f4e39744ef8f69
  source_path: install/updating.md
  workflow: 15
---

# 更新

保持 CrawClaw 为最新版本。

## 推荐：CrawClaw Desktop

最快的更新方式是使用 CrawClaw Desktop。它会获取最新应用包，并在需要时重启内置
Gateway。

对于源码检出和自动化场景，使用 Gateway `update.run` 控制平面方法。它会检查当前
git checkout，在工作区有未提交更改时拒绝继续，拉取 upstream refs 和 tags，并报告
当前 checkout 是否已经是最新，或是否有更新可用。它不会替换已打包的桌面应用 bundle。

切换渠道或指定版本：

- 将 `update.channel` 设置为 `stable`、`beta` 或 `dev`。
- 自动化场景通过 Gateway API（`config.patch`）修改配置，然后运行 `update.run` 检查
  当前 checkout。
- 已打包的桌面安装请从 [GitHub Releases](https://github.com/qianleigood/crawclaw/releases)
  下载目标版本。

查看[自动更新器](#auto-updater)了解渠道语义。

## 替代方式：重新运行安装程序

从 [GitHub Releases](https://github.com/qianleigood/crawclaw/releases) 安装当前
CrawClaw Desktop release asset。

CrawClaw Desktop 拥有受支持的更新和 onboarding 路径。已退役的公开 CLI onboarding
流程中的源码安装器 flags 不再记录。

## 替代方式：手动 npm 或 pnpm

旧版全局 npm/pnpm 安装应迁移到桌面包。安装桌面应用后，移除旧的全局包。

## 自动更新器

自动更新器默认关闭。可在 `~/.crawclaw/crawclaw.json` 中启用：

```json5
{
  update: {
    channel: "stable",
    auto: {
      enabled: true,
      stableDelayHours: 6,
      stableJitterHours: 12,
      betaCheckIntervalHours: 1,
    },
  },
}
```

| 渠道     | 行为                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------- |
| `stable` | 等待 `stableDelayHours` 后，在 `stableJitterHours` 的确定性 jitter 窗口内应用（分散 rollout）。 |
| `beta`   | 每隔 `betaCheckIntervalHours` 检查一次（默认每小时），并立即应用。                              |
| `dev`    | 不自动应用。通过 CrawClaw Desktop 或本地 Gateway API 手动执行。                                 |

Gateway 启动时也会记录更新提示（可用 `update.checkOnStart: false` 禁用）。

## 更新后

<Steps>

### 运行 Doctor

从 CrawClaw Desktop 或 Gateway repair surface 运行 Doctor。

它会迁移配置、审计 DM 策略并检查 Gateway health。详情见：[Doctor](/gateway/doctor)

### 重启 Gateway

从 CrawClaw Desktop 重启，让内置 Gateway 重新加载启动时绑定的设置。源码检出场景下，停止正在运行的
dev process，必要时重新构建，然后从更新后的 checkout 启动 Gateway。

### 验证

检查 Desktop health view 或 Gateway `health` / `system.health` RPC。确认 Gateway 可达、预期
channels 为 connected 或 ready，并且日志中没有阻塞性的配置或服务错误。

</Steps>

## 回滚

### 固定到某个版本（npm）

下载你想运行的 CrawClaw Desktop release asset。

提示：`npm view crawclaw version` 会显示当前发布版本。

### 固定到某个 commit（源码）

```bash
git fetch origin
git checkout "$(git rev-list -n 1 --before='2026-01-01' origin/main)"
pnpm install && pnpm build
```

从该 checkout 启动 CrawClaw Desktop，或从同一源码树运行本地 Gateway API target。

回到最新版本：`git checkout main && git pull`。

## 如果卡住

- 再次运行 CrawClaw Desktop 或本地 Gateway API，并仔细阅读输出。
- 查看：[Troubleshooting](/gateway/troubleshooting)
- 提交 GitHub issue：[https://github.com/qianleigood/crawclaw/issues](https://github.com/qianleigood/crawclaw/issues)

## 相关

- [Install Overview](/install) — 所有安装方式
- [Doctor](/gateway/doctor) — 更新后的健康检查
- [Migrating](/install/migrating) — 大版本迁移指南
