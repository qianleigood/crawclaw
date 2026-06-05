---
read_when:
  - 向新用户介绍 ClawHub
  - 安装、搜索或发布 Skills 或插件
  - 解释单独的 ClawHub CLI 参数和同步行为
summary: ClawHub 指南：公共注册表、CrawClaw Desktop 安装流程和 ClawHub CLI 工作流
title: ClawHub
x-i18n:
  generated_at: "2026-06-05T14:50:26Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 1068391059117144a662f454dacdba657679af7b30428833b0b60ba95bc10588
  source_path: tools/clawhub.md
  workflow: 15
---

# ClawHub

ClawHub 是 **CrawClaw Skills 和插件**的公共注册表。

- 使用 CrawClaw Desktop 或本地 Gateway API 从 ClawHub 搜索、安装和更新 Skills 与插件。
- 当你需要注册表认证、发布、删除、恢复删除或同步工作流时，使用单独的 `clawhub` CLI。

网站：[clawhub.ai](https://clawhub.ai)

## CrawClaw Desktop 流程

Desktop 可以搜索、安装和更新 Skills 与插件。自动化应调用本地 Gateway API。

在 npm 之前也会尝试将安全的裸 npm 插件规范用于 ClawHub。

CrawClaw Desktop 安装到你的活动工作区并持久化源元数据，以便后续更新可以保留在 ClawHub 上。

## ClawHub 是什么

- CrawClaw Skills 和插件的公共注册表。
- Skill 包和元数据的版本化存储。
- 用于搜索、标签和原生渠道使用的发现界面。

## 工作原理

1. 用户发布一个 Skill 包（文件 + 元数据）。
2. ClawHub 存储包、解析元数据并分配版本。
3. 注册表为搜索和发现建立 Skill 索引。
4. 用户在 CrawClaw 中浏览、下载和安装 Skills。

## 你可以做什么

- 发布新 Skills 和现有 Skills 的新版本。
- 通过名称、标签或搜索发现 Skills。
- 下载 Skill 包并检查其文件。
- 报告滥用或不安全的 Skills。
- 如果你是版主，可以隐藏、取消隐藏、删除或封禁。

## 谁适合使用（面向初学者）

如果你想为 CrawClaw 智能体添加新能力，ClawHub 是查找和安装 Skills 最简单的方式。你不需要了解后端如何工作。你可以：

- 用自然语言搜索 Skills。
- 将 Skill 安装到你的工作区。
- 稍后从 Desktop 或 Gateway API 更新 Skills。
- 通过发布来备份你自己的 Skills。

## 快速开始（非技术）

1. 搜索你需要的内容：
   - CrawClaw Desktop 或本地 Gateway API
2. 安装一个 Skill：
   - CrawClaw Desktop 或本地 Gateway API
3. 启动新的 CrawClaw 会话以加载新的 Skill。
4. 如果你想发布或管理注册表认证，也安装单独的 `clawhub` CLI。

## 安装 ClawHub CLI

仅当你需要注册表认证工作流（如发布/同步）时才需要：

```bash
npm i -g clawhub
```

```bash
pnpm add -g clawhub
```

## 它如何融入 CrawClaw

原生 CrawClaw Desktop 或本地 Gateway API 安装到活动工作区的 `skills/` 目录。CrawClaw Desktop 或本地 Gateway API 记录正常的托管插件安装以及 ClawHub 源元数据以供更新。

单独的 `clawhub` CLI 也将 Skills 安装到当前工作目录下的 `./skills`。如果配置了 CrawClaw 工作区，`clawhub` 会回退到该工作区，除非你覆盖 `--workdir`（或 `CLAWHUB_WORKDIR`）。CrawClaw 从 `<workspace>/skills` 加载工作区 Skills，并会在**下一个**会话中加载它们。如果你已经使用 `~/.crawclaw/skills` 或捆绑的 Skills，工作区 Skills 优先。

有关 Skills 如何加载、共享和门控的更多详情，请参阅 [Skills](/tools/skills)。

## Skill 系统概览

Skill 是一个版本化的文件包，教 CrawClaw 如何执行特定任务。每次发布都会创建一个新版本，注册表保留版本历史，以便用户可以审核更改。

一个典型的 Skill 包括：

- 一个包含主要描述和用法的 `SKILL.md` 文件。
- Skill 使用的可选配置、脚本或支持文件。
- 元数据，如标签、摘要和安装要求。

ClawHub 使用元数据来驱动发现并安全地公开 Skill 能力。注册表还跟踪原生渠道的使用情况（如星标和下载）以提高排名和可见性。

## 服务提供的功能

- **公开浏览** Skills 及其 `SKILL.md` 内容。
- **搜索**，由嵌入（向量搜索）驱动，而不仅仅是关键词。
- **版本控制**，带有 semver、更新日志和标签（包括 `latest`）。
- **下载**，每个版本一个 zip。
- **星标和评论**，用于社区反馈。
- **审核**，用于审批和审计。
- **CLI 友好的 API**，用于自动化和脚本编写。

## 安全和审核

ClawHub 默认开放。任何人都可以上传 Skills，但 GitHub 账户必须至少有一周才能发布。这有助于减缓滥用，同时不阻止合法贡献者。

报告和审核：

- 任何登录用户都可以报告 Skill。
- 必须提供报告原因并记录。
- 每个用户最多可有 20 个活动报告。
- 有超过 3 个独立报告的 Skills 默认自动隐藏。
- 版主可以查看隐藏的 Skills、取消隐藏、删除或封禁用户。
- 滥用报告功能可导致账户封禁。

有兴趣成为版主？在 CrawClaw community chat 中询问并联系版主或维护者。

## Desktop 和 Gateway API 操作与参数

全局选项（适用于所有命令）：

- `--workdir <dir>`：工作目录（默认：当前目录；回退到 CrawClaw 工作区）。
- `--dir <dir>`：Skills 目录，相对于 workdir（默认：`skills`）。
- `--site <url>`：网站基础 URL（浏览器登录）。
- `--registry <url>`：注册表 API 基础 URL。
- `--no-input`：禁用提示（非交互式）。
- `-V, --cli-version`：打印 CLI 版本。

认证：

- `clawhub login`（浏览器流程）或 `clawhub login --token <token>`
- `clawhub logout`
- `clawhub whoami`

选项：

- `--token <token>`：粘贴 API token。
- `--label <label>`：为浏览器登录 token 存储的标签（默认：`CLI token`）。
- `--no-browser`：不打开浏览器（需要 `--token`）。

搜索：

- `clawhub search "query"`
- `--limit <n>`：最大结果数。

安装：

- `clawhub install <slug>`
- `--version <version>`：安装特定版本。
- `--force`：如果文件夹已存在则覆盖。

更新：

- `clawhub update <slug>`
- `clawhub update --all`
- `--version <version>`：更新到特定版本（仅单个 slug）。
- `--force`：当本地文件与任何已发布版本不匹配时覆盖。

列表：

- `clawhub list`（读取 `.clawhub/lock.json`）

发布 Skills：

- `clawhub skill publish <path>`
- `--slug <slug>`：Skill slug。
- `--name <name>`：显示名称。
- `--version <version>`：Semver 版本。
- `--changelog <text>`：更新日志文本（可以为空）。
- `--tags <tags>`：逗号分隔的标签（默认：`latest`）。

发布插件：

- `clawhub package publish <source>`
- `<source>` 可以是本地文件夹、`owner/repo`、`owner/repo@ref` 或 GitHub URL。
- `--dry-run`：在不上传任何内容的情况下构建精确的发布计划。
- `--json`：为 CI 输出机器可读的输出。
- `--source-repo`、`--source-commit`、`--source-ref`：当自动检测不够时的可选覆盖。

删除/恢复删除（仅所有者/管理员）：

- `clawhub delete <slug> --yes`
- `clawhub undelete <slug> --yes`

同步（扫描本地 Skills + 发布新的/更新的）：

- `clawhub sync`
- `--root <dir...>`：额外的扫描根目录。
- `--all`：无提示上传所有内容。
- `--dry-run`：显示将要上传的内容。
- `--bump <type>`：更新的 `patch|minor|major`（默认：`patch`）。
- `--changelog <text>`：非交互式更新的更新日志。
- `--tags <tags>`：逗号分隔的标签（默认：`latest`）。
- `--concurrency <n>`：注册表检查（默认：4）。

## 智能体的常见工作流

### 搜索 Skills

```bash
clawhub search "postgres backups"
```

### 下载新的 Skills

```bash
clawhub install my-skill-pack
```

### 更新已安装的 Skills

```bash
clawhub update --all
```

### 备份你的 Skills（发布或同步）

对于单个 Skill 文件夹：

```bash
clawhub skill publish ./my-skill --slug my-skill --name "My Skill" --version 1.0.0 --tags latest
```

一次性扫描和备份多个 Skills：

```bash
clawhub sync --all
```

### 从 GitHub 发布插件

```bash
clawhub package publish your-org/your-plugin --dry-run
clawhub package publish your-org/your-plugin
clawhub package publish your-org/your-plugin@v1.0.0
clawhub package publish https://github.com/your-org/your-plugin
```

代码插件必须在 `package.json` 中包含必需的 CrawClaw 元数据：

```json
{
  "name": "@myorg/crawclaw-my-plugin",
  "version": "1.0.0",
  "type": "module",
  "crawclaw": {
    "compat": {
      "pluginApi": ">=2026.3.24-beta.2",
      "minGatewayVersion": "2026.3.24-beta.2"
    },
    "build": {
      "crawclawVersion": "2026.3.24-beta.2",
      "pluginSdkVersion": "2026.3.24-beta.2"
    }
  }
}
```

## 高级细节（技术）

### 版本控制和标签

- 每次发布都会创建一个新的 **semver** `SkillVersion`。
- 标签（如 `latest`）指向一个版本；移动标签可以让你回滚。
- 更新日志附加在每个版本上，同步或发布更新时可以为空。

### 本地更改与注册表版本

更新使用内容哈希将本地 Skill 内容与注册表版本进行比较。如果本地文件与任何已发布版本不匹配，CLI 会在覆盖前询问（非交互式运行需要 `--force`）。

### 同步扫描和回退根

`clawhub sync` 首先扫描当前 workdir。如果没有找到 Skills，它会回退到已知的旧位置（例如 `~/crawclaw/skills` 和 `~/.crawclaw/skills`）。这是为了在不需要额外参数的情况下找到旧的 Skill 安装。

### 存储和锁文件

- 已安装的 Skills 记录在你 workdir 下的 `.clawhub/lock.json` 中。
- 认证 token 存储在 ClawHub CLI 配置文件中（可通过 `CLAWHUB_CONFIG_PATH` 覆盖）。

### 遥测（安装计数）

当你在登录状态下运行 `clawhub sync` 时，CLI 会发送最小快照以计算安装计数。你可以完全禁用此功能：

```bash
export CLAWHUB_DISABLE_TELEMETRY=1
```

## 环境变量

- `CLAWHUB_SITE`：覆盖网站 URL。
- `CLAWHUB_REGISTRY`：覆盖注册表 API URL。
- `CLAWHUB_CONFIG_PATH`：覆盖 CLI 存储 token/配置的位置。
- `CLAWHUB_WORKDIR`：覆盖默认 workdir。
- `CLAWHUB_DISABLE_TELEMETRY=1`：在 `sync` 上禁用遥测。
