---
read_when:
  - 你需要解释智能体工作空间或其文件布局
  - 你想要备份或迁移智能体工作空间
summary: 智能体工作空间：位置、布局和备份策略
title: 智能体工作空间
x-i18n:
  generated_at: "2026-06-05T14:11:50Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: e9109d25627e5d48fcb48f1f2e60117555a08294d264cebc99bf8a0b4b864db4
  source_path: concepts/agent-workspace.md
  workflow: 15
---

# 智能体工作空间

工作空间是智能体的家。它是文件工具和工作空间上下文使用的唯一工作目录。保持其私密性，并将其视为记忆。

这与 `~/.crawclaw/` 不同，后者存储配置、凭证和会话。

解析相对路径时以工作空间为基准，但绝对路径仍可访问主机上的其他位置。如果需要硬隔离，请在隔离的主机或虚拟机上运行 CrawClaw，并将敏感路径排除在该环境之外。

## 默认位置

- 默认值：`~/.crawclaw/workspace`
- 如果设置了 `CRAWCLAW_PROFILE` 且不为 `"default"`，则默认值变为
  `~/.crawclaw/workspace-<profile>`。
- 在 `~/.crawclaw/crawclaw.json` 中覆盖：

```json5
{
  agent: {
    workspace: "~/.crawclaw/workspace",
  },
}
```

CrawClaw Desktop 和本地 Gateway API 会创建工作空间，并在缺少引导文件时填充初始内容。
解析到源工作空间之外的别名会被忽略。

如果你已自行管理工作空间文件，可以禁用引导文件创建：

```json5
{ agent: { skipBootstrap: true } }
```

## 额外的工作空间文件夹

旧版本安装可能已创建 `~/crawclaw`。保留多个工作空间目录会导致混淆的认证或状态漂移，因为一次只有一个工作空间处于活动状态。

**建议：** 保持单一活动工作空间。如果你不再使用额外的文件夹，请归档或将其移至垃圾箱（例如 `trash ~/crawclaw`）。如果你有意保留多个工作空间，请确保 `agents.defaults.workspace` 指向活动的工作空间。

CrawClaw Desktop 或本地 Gateway API 在检测到额外的工作空间目录时会发出警告。

## 工作空间文件映射（每个文件的含义）

以下是 CrawClaw 在工作空间内期望的标准文件：

- `AGENTS.md`
  - 智能体的操作说明以及它应如何使用记忆。
  - 在每个会话开始时加载。
  - 是放置规则、优先级和“如何行事”等细节的好地方。

- `SOUL.md`
  - 人设、语气和边界。
  - 作为工作空间文件保留，但默认不会注入。

- `USER.md`
  - 用户是谁以及如何称呼他们。
  - 作为工作空间文件保留，但默认不会注入。

- `IDENTITY.md`
  - 智能体的名称、风格和表情符号。
  - 在引导仪式期间创建/更新。

- `TOOLS.md`
  - 关于本地工具和约定的笔记。
  - 不控制工具的可用性；仅提供指导。
  - 默认不会注入。

- `HEARTBEAT.md`
  - 事件驱动的 main-session 唤醒运行的可选检查清单。
  - 不是新计划自动化推荐的位置。
  - 使用 cron 任务或钩子进行新的主动工作。

- `BOOTSTRAP.md`
  - 一次性首次运行仪式。
  - 仅在全新工作空间时创建。
  - 仪式完成后删除它。

- `memory/YYYY-MM-DD.md`
  - 每日记忆日志（每天一个文件）。
  - 建议在会话开始时读取今天和昨天的内容。

- `MEMORY.md`（可选）
  - 用于显式记忆工具和工作流的精选长期记忆。
  - 不属于默认工作空间引导注入路径。

了解 [记忆](/concepts/memory) 中的工作流和自动记忆刷新。

- `skills/`（可选）
  - 工作空间特定的 skills。
  - 当名称冲突时覆盖托管/捆绑的 skills。

- `canvas/`（可选）
  - 用于节点显示的 Canvas UI 文件（例如 `canvas/index.html`）。

如果运行的活跃引导文件缺失，CrawClaw 会注入一个“缺失文件”标记并继续。大型引导文件在注入时会被截断；使用 `agents.defaults.bootstrapMaxChars`（默认值：20000）和 `agents.defaults.bootstrapTotalMaxChars`（默认值：150000）调整限制。
CrawClaw Desktop 或本地 Gateway API 可以在不覆盖现有文件的情况下重新创建缺失的默认值。

## 工作空间中不包含的内容

这些位于 `~/.crawclaw/` 下，不应提交到工作空间仓库：

- `~/.crawclaw/crawclaw.json`（配置）
- `~/.crawclaw/credentials/`（OAuth 令牌、API 密钥）
- `~/.crawclaw/agents/<agentId>/sessions/`（会话记录 + 元数据）
- `~/.crawclaw/skills/`（托管 skills）

如果你需要迁移会话或配置，请单独复制它们，并将其排除在版本控制之外。

## Git 备份（推荐，私有）

将工作空间视为私有记忆。将其放入**私有** git 仓库，以便备份和恢复。

在 Gateway 运行的机器上执行以下步骤（即工作空间所在的机器）。

### 1) 初始化仓库

如果已安装 git，全新工作空间会自动初始化。如果此工作空间还不是仓库，请运行：

```bash
cd ~/.crawclaw/workspace
git init
git add AGENTS.md SOUL.md TOOLS.md IDENTITY.md USER.md HEARTBEAT.md memory/
git commit -m "Add agent workspace"
```

### 2) 添加私有远程仓库（适合初学者的选项）

选项 A：GitHub 网页界面

1. 在 GitHub 上创建一个新的**私有**仓库。
2. 不要使用 README 初始化（避免合并冲突）。
3. 复制 HTTPS 远程 URL。
4. 添加远程并推送：

```bash
git branch -M main
git remote add origin <https-url>
git push -u origin main
```

选项 B：GitHub CLI（`gh`）

```bash
gh auth login
gh repo create crawclaw-workspace --private --source . --remote origin --push
```

选项 C：GitLab 网页界面

1. 在 GitLab 上创建一个新的**私有**仓库。
2. 不要使用 README 初始化（避免合并冲突）。
3. 复制 HTTPS 远程 URL。
4. 添加远程并推送：

```bash
git branch -M main
git remote add origin <https-url>
git push -u origin main
```

### 3) 持续更新

```bash
git status
git add .
git commit -m "Update memory"
git push
```

## 不要提交密钥

即使在私有仓库中，也要避免在工作空间中存储密钥：

- API 密钥、OAuth 令牌、密码或私人凭证。
- `~/.crawclaw/` 下的任何内容。
- 聊天记录或敏感附件的原始转储。

如果必须存储敏感引用，请使用占位符并将真实密钥保留在其他地方（密码管理器、环境变量或 `~/.crawclaw/`）。

建议的 `.gitignore` 起始内容：

```gitignore
.DS_Store
.env
**/*.key
**/*.pem
**/secrets*
```

## 将工作空间移动到新机器

1. 将仓库克隆到所需路径（默认 `~/.crawclaw/workspace`）。
2. 在 `~/.crawclaw/crawclaw.json` 中将 `agents.defaults.workspace` 设置为该路径。
3. 运行 CrawClaw Desktop 或本地 Gateway API 以填充任何缺失的文件。
4. 如果需要会话，请单独从旧机器复制 `~/.crawclaw/agents/<agentId>/sessions/`。

## 高级说明

- 多智能体路由可以为每个智能体使用不同的工作空间。了解
  [渠道路由](/channels/channel-routing) 中的路由配置。

## 相关

- [持久指令](/automation/standing-orders) — 工作空间文件中的持久指令
- [Heartbeat](/gateway/heartbeat) — 事件驱动的唤醒迁移说明
- [会话](/concepts/session) — 会话存储路径
