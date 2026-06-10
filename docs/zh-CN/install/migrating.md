---
read_when:
  - 你正在将 CrawClaw 迁移到新的笔记本/服务器
  - 你希望保留会话、认证和渠道登录（Weixin 等）
summary: 将 CrawClaw 安装迁移到另一台机器
title: 迁移指南
x-i18n:
  generated_at: "2026-06-10T21:36:28Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: a2a9dd3180fb454b79923b952e7e9d0511bb903542fee9ed71964c13923a1835
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
在归档任何内容之前，在 CrawClaw Desktop 中打开**设置** → **数据与隐私**，查看**当前桌面数据目录**。
默认桌面 runtime 使用 `~/.crawclaw`；自定义 profile 使用 `~/.crawclaw-<profile>/` 或通过 `CRAWCLAW_STATE_DIR` 设置的路径。
</Tip>

## 迁移步骤

<Steps>
  <Step title="停止 gateway 并备份">
    在**旧**机器上，退出 CrawClaw Desktop 或停止拥有 Gateway 的服务，以确保文件在复制过程中不会变更，然后打包状态目录：

    ```bash
    cd ~
    tar -czf crawclaw-state.tgz .crawclaw
    ```

    如果**当前桌面数据目录**指向其他位置，请改为打包那个确切目录。如果你使用多个 profile，请分别打包每个状态目录。

  </Step>

  <Step title="在新机器上安装 CrawClaw">
    在新机器上[安装 CrawClaw Desktop](/install)，或者针对 headless Gateway 主机遵循你的 server runtime 指南。
    如果新手引导创建了新的 `~/.crawclaw/` 也没有问题 -- 你将在下一步覆盖它。

  </Step>

  <Step title="复制状态目录和工作区">
    在新机器上退出 CrawClaw Desktop，通过 `scp`、`rsync -a` 或外部驱动器传输压缩包，然后解压：

    ```bash
    cd ~
    tar -xzf crawclaw-state.tgz
    ```

    确保隐藏目录已包含，且文件所有权与将运行 gateway 的用户一致。

  </Step>

  <Step title="刷新 Runtime 并验证">
    在新机器上启动 CrawClaw Desktop。打开**设置** → **高级**，点击**刷新 Runtime**；如果 runtime 未就绪，再生成**诊断信息**。确认**设置** → **数据与隐私**显示的是已迁移的数据目录。自动化或外部监控使用 [Gateway health API](/gateway/health)。

  </Step>
</Steps>

## 常见陷阱

<AccordionGroup>
  <Accordion title="配置或状态目录不匹配">
    如果旧 gateway 使用了 `--profile` 或 `CRAWCLAW_STATE_DIR`，而新 gateway 没有使用，
    渠道将显示为已登出，会话将为空。
    使用你迁移时**相同的** profile 或状态目录启动 gateway，然后确认 CrawClaw Desktop 在**设置** → **数据与隐私**下显示该目录。
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

- [ ] **设置** → **高级**显示 runtime 已就绪，或 Gateway health API 报告健康
- [ ] **设置** → **数据与隐私**显示已迁移的状态目录
- [ ] 渠道仍保持连接（无需重新配对）
- [ ] 仪表盘正常打开并显示现有会话
- [ ] 工作区文件（记忆、配置）存在
