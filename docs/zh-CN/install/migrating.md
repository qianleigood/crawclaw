---
read_when:
  - 你正在将 CrawClaw 迁移到新的笔记本/服务器
  - 你希望保留会话、认证和渠道登录（Weixin 等）
summary: 将 CrawClaw 安装迁移到另一台机器
title: 迁移指南
x-i18n:
  generated_at: "2026-06-05T14:39:35Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 3b296f455ed417ed46808d011941dc53961cdcffb0981c1fc866bdb244c7d287
  source_path: install/migrating.md
  workflow: 15
---

# 将 CrawClaw 迁移到新机器

本指南将 CrawClaw gateway 迁移到新机器，而无需重新进行新手引导。

## 迁移内容

当你复制**状态目录**（默认 `~/.crawclaw/`）和你的**工作区**时，将保留：

- **配置** -- `crawclaw.json` 和所有 gateway 设置
- **认证** -- API 密钥、OAuth token、凭证配置
- **会话** -- 对话历史和智能体状态
- **渠道状态** -- Weixin 登录、Feishu 会话等
- **工作区文件** -- `MEMORY.md`、`USER.md`、Skills 和提示词

<Tip>
在旧机器上运行 CrawClaw Desktop 或本地 Gateway API 以确认你的状态目录路径。
自定义配置使用 `~/.crawclaw-<profile>/` 或通过 `CRAWCLAW_STATE_DIR` 设置的路径。
</Tip>

## 迁移步骤

<Steps>
  <Step title="停止 gateway 并备份">
    在**旧**机器上，停止 gateway 以确保文件在复制过程中不会变更，然后打包：

    ```bash
    # 首先停止 CrawClaw Desktop 或 Gateway 服务。
    cd ~
    tar -czf crawclaw-state.tgz .crawclaw
    ```

    如果你使用多个配置（例如 `~/.crawclaw-work`），请分别打包每个。

  </Step>

  <Step title="在新机器上安装 CrawClaw">
    在新机器上[安装](/install) CLI（以及 Node 如果需要）。
    如果新手引导创建了新的 `~/.crawclaw/` 也没有问题 -- 你将在下一步覆盖它。

  </Step>

  <Step title="复制状态目录和工作区">
    通过 `scp`、`rsync -a` 或外部驱动器传输压缩包，然后解压：

    ```bash
    cd ~
    tar -xzf crawclaw-state.tgz
    ```

    确保隐藏目录已包含，且文件所有权与将运行 gateway 的用户一致。

  </Step>

  <Step title="运行 Doctor 并验证">
    在新机器上，运行 [Doctor](/gateway/doctor) 以应用配置迁移并修复服务：

    使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 实现自动化。

  </Step>
</Steps>

## 常见陷阱

<AccordionGroup>
  <Accordion title="配置或状态目录不匹配">
    如果旧 gateway 使用了 `--profile` 或 `CRAWCLAW_STATE_DIR`，而新 gateway 没有使用，
    渠道将显示为已登出，会话将为空。
    使用你迁移时**相同的** profile 或状态目录启动 gateway，然后重新运行 CrawClaw Desktop 或本地 Gateway API。
  </Accordion>

  <Accordion title="仅复制 crawclaw.json">
    仅凭配置文件是不够的。凭证存储在 `credentials/` 下，智能体状态存储在 `agents/` 下。
    请始终迁移**整个**状态目录。
  </Accordion>

  <Accordion title="权限和所有权">
    如果你以 root 身份复制或切换了用户，gateway 可能无法读取凭证。
    确保状态目录和工作区由运行 gateway 的用户拥有。
  </Accordion>

  <Accordion title="远程模式">
    如果你的 UI 指向**远程** gateway，则远程主机拥有会话和工作区。
    请迁移 gateway 主机本身，而非你的本地笔记本。参见[常见问题](/help/faq#where-things-live-on-disk)。
  </Accordion>

  <Accordion title="备份中的密钥">
    状态目录包含 API 密钥、OAuth token 和渠道凭证。
    请加密存储备份，避免使用不安全的传输渠道，并在怀疑泄露时轮换密钥。
  </Accordion>
</AccordionGroup>

## 验证清单

在新机器上确认：

- [ ] CrawClaw Desktop 或本地 Gateway API 显示 gateway 正在运行
- [ ] 渠道仍保持连接（无需重新配对）
- [ ] 仪表盘正常打开并显示现有会话
- [ ] 工作区文件（记忆、配置）存在
