---
read_when:
  - 你之前已经在本机使用过 CrawClaw
  - 你还保留着 `~/.crawclaw` 状态目录
summary: 将旧版 CrawClaw 本地状态迁移到 CrawClaw。
title: CrawClaw 到 CrawClaw 迁移
---

# CrawClaw 到 CrawClaw 迁移

如果你本机之前已经使用过 CrawClaw，并且本地状态还在 `~/.crawclaw`，
请按这份指南迁移到 CrawClaw 的默认运行时路径。

## 现在的默认位置

CrawClaw 现在优先使用：

- 状态目录：`~/.crawclaw`
- 配置文件：`~/.crawclaw/crawclaw.json`
- 主 CLI 命令：`crawclaw`

兼容层仍然存在，但建议的稳定状态是：

- 日常运行都使用 `crawclaw`
- 状态写入 `~/.crawclaw`
- 配置文件统一为 `crawclaw.json`

## 推荐做法

先直接运行内置迁移命令：

```bash
crawclaw migrate-crawclaw
```

如果你想先预览变更：

```bash
crawclaw migrate-crawclaw --dry-run
```

## 迁移命令会做什么

它会尽量把旧版默认运行时状态迁移到新的默认位置。

覆盖内容包括：

- 旧状态目录：`~/.crawclaw`
- 旧配置文件名：
  - `crawclaw.json`
  - `clawdbot.json`

迁移成功后，CrawClaw 会使用：

- `~/.crawclaw`
- `~/.crawclaw/crawclaw.json`

## 运行前先确认

1. 先停掉正在运行的 Gateway 进程或托管服务。
2. 不要在当前 shell 里强制指定自定义运行时路径。
3. 直接在正常 shell 中执行一次迁移命令。

如果下面这些环境变量里任意一个已设置，迁移命令会拒绝执行：

- `CRAWCLAW_STATE_DIR`
- `CRAWCLAW_STATE_DIR`
- `CRAWCLAW_CONFIG_PATH`
- `CRAWCLAW_CONFIG_PATH`
- `CRAWCLAW_OAUTH_DIR`
- `CRAWCLAW_OAUTH_DIR`

这是有意的限制。迁移只针对默认运行时路径安全执行。

## 迁移之后

先做基本验证：

```bash
crawclaw doctor
crawclaw gateway status
```

如果你以前是全局安装，再确认新的 CLI 入口：

```bash
crawclaw --version
```

## 不会自动改掉的内容

迁移命令不会重写你所有历史脚本和外部自动化。尤其不会自动修改：

- 仍然调用 `crawclaw` 的 shell alias
- 你自己写的服务包装脚本
- 仍然导出 `CRAWCLAW_*` 的外部自动化
- 自定义 git checkout 路径

这些需要在迁移成功后手工清理。

## 关于兼容层

当前仍有一部分底层兼容环境变量和更新内部逻辑接受旧版
`CRAWCLAW_*` 名称。这属于重命名过渡期的正常状态。

日常使用请优先采用：

- `crawclaw`
- `~/.crawclaw`
- 已支持时优先使用 `CRAWCLAW_*`

## 如果迁移失败

先跑这两个命令：

```bash
crawclaw migrate-crawclaw --dry-run
crawclaw doctor
```

然后检查当前 shell 或托管服务环境里是否还设置了自定义路径覆盖。
