---
read_when:
  - 更新 CrawClaw
  - 更新后出现问题
summary: 安全更新 CrawClaw Desktop 的方法以及回滚策略
title: 更新
x-i18n:
  generated_at: "2026-05-22T03:00:39Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 2bc0dd973a82289aa938a6ae3f4711d1cc5d8044660fc1179cf1f352db61f08d
  source_path: install/updating.md
  workflow: 15
---

# 更新

保持 CrawClaw 为最新版本。

## 推荐：CrawClaw Desktop 或本地 Gateway API

最快的更新方式是通过 CrawClaw Desktop。它会获取最新的应用包并在需要时重启嵌入式 Gateway。

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

要切换渠道或指定特定版本：

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

请参阅[自动更新程序](#auto-updater)了解渠道语义。

## 备选：重新运行安装程序

从 [GitHub Releases](https://github.com/qianleigood/crawclaw/releases) 安装当前 CrawClaw Desktop release asset。

CrawClaw Desktop 负责支持的更新和入门引导流程。已弃用的公共 CLI 入门引导流程的源代码安装程序标志不再提供文档。

## 备选：手动 npm 或 pnpm

旧的全局 npm/pnpm 安装应迁移到 desktop package。安装桌面应用后再移除旧的全局包。

## 自动更新程序

自动更新程序默认关闭。在 `~/.crawclaw/crawclaw.json` 中启用：

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

| 渠道     | 行为                                                                                      |
| -------- | ----------------------------------------------------------------------------------------- |
| `stable` | 等待 `stableDelayHours` 后，通过 `stableJitterHours` 范围内的确定性抖动应用（分批推送）。 |
| `beta`   | 每隔 `betaCheckIntervalHours`（默认：每小时）检查一次并立即应用。                         |
| `dev`    | 不自动应用。手动使用 CrawClaw Desktop 或本地 Gateway API。                                |

Gateway 还会在启动时记录更新提示（使用 `update.checkOnStart: false` 禁用）。

## 更新后

<Steps>

### 运行 Doctor

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

迁移配置、审计私信策略并检查 Gateway 健康状态。详情：[Doctor](/gateway/doctor)

### 重启 Gateway

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

### 验证

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

</Steps>

## 回滚

### 固定版本（npm）

安装你要运行版本对应的 CrawClaw Desktop release asset。

提示：`npm view crawclaw version` 显示当前发布的版本。

### 固定提交（源代码）

```bash
git fetch origin
git checkout "$(git rev-list -n 1 --before=\"2026-01-01\" origin/main)"
pnpm install && pnpm build
```

从该 checkout 启动 CrawClaw Desktop，或从同一源码树运行本地 Gateway API target。

返回最新版本：`git checkout main && git pull`。

## 如果你卡住了

- 再次运行 CrawClaw Desktop 或本地 Gateway API 并仔细阅读输出。
- 检查：[故障排除](/gateway/troubleshooting)
- 提交 GitHub issue：[https://github.com/qianleigood/crawclaw/issues](https://github.com/qianleigood/crawclaw/issues)

## 相关内容

- [安装概述](/install) — 所有安装方法
- [Doctor](/gateway/doctor) — 更新后的健康检查
- [迁移](/install/migrating) — 主要版本迁移指南
