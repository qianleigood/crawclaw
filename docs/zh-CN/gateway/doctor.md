---
summary: "Doctor command: health checks, config migrations, and repair steps"
read_when:
  - Adding or modifying doctor migrations
  - Introducing breaking config changes
title: "Doctor"
---

# Doctor

CrawClaw Desktop 或 local Gateway API 是 CrawClaw 的修复 + 迁移工具。它会修复过时的配置/状态，检查健康状况，并提供可操作的修复步骤。

## 快速开始

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

### 无头/自动化

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

无需提示接受默认值（包括适用时的重启/服务修复步骤）。

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

无需提示应用推荐的修复（安全时进行修复 + 重启）。

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

也应用激进修复（覆盖自定义 runtime config）。

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

检测到时自动运行遗留状态迁移。

使用 CrawClaw Desktop 进行交互式设置，或通过本地 Gateway API 自动化。

如果旧安装留下启动项，请手动检查 legacy startup entries。

如果你想在写入前查看更改，请先打开配置文件：

```bash
cat ~/.crawclaw/crawclaw.json
```

## 功能概述

- git 安装的可选预检更新（仅交互模式）。
- 健康检查 + 重启提示。
- Skills 状态摘要（eligible/missing/blocked）和 plugin status。
- 遗留值的配置规范化。
- Browser migration checks for legacy browser configs。
- OpenCode provider override warnings（`models.providers.opencode` / `models.providers.opencode-go`）。
- 遗留磁盘状态迁移（会话/智能体目录/Weixin 认证）。
- Legacy cron store migration（`jobId`, `schedule.cron`, top-level delivery/payload fields, payload `provider`, simple `notify: true` webhook fallback jobs）。
- Session lock file inspection and stale lock cleanup。
- 状态完整性和权限检查（会话、记录、状态目录）。
- 本地运行时的配置文件权限检查（chmod `600`）。
- 模型认证健康：检查 OAuth 过期，可刷新即将过期的 token，并报告认证配置文件冷却/禁用状态。
- 额外工作区目录检测（`~/crawclaw`）。
- Legacy startup cleanup guidance。
- Removed TypeScript channel state migrations are no longer maintained。
- Gateway runtime reachability checks。
- 渠道状态警告（从运行中的 Gateway 网关探测）。
- Gateway 网关端口冲突诊断（默认 `18789`）。
- 开放私信策略的安全警告。
- 本地 token mode 下的 Gateway auth 检查（没有 token source 时提供 token generation；不会覆盖 token SecretRef config）。
- Workspace bootstrap 文件大小检查（context files 的 truncation/near-limit warnings）。
- Shell completion status check and auto-install/upgrade。
- Source install checks（pnpm workspace mismatch 和 npm lockfile drift）。
- 写入更新后的配置 + 向导元数据。

## 详细行为和原理

### 0）可选更新（git 安装）

如果这是 git 检出且 doctor 以交互模式运行，它会在运行 doctor 之前提供更新（fetch/rebase/build）。

### 1）配置规范化

如果配置包含遗留值形式（例如没有渠道特定覆盖的 `messages.ackReaction`），doctor 会将它们规范化为当前 schema。

### 2）遗留配置键迁移

当配置包含已弃用的键时，其他命令会拒绝运行并要求你使用 CrawClaw Desktop 或 local Gateway API。

Doctor 将：

- 解释找到了哪些遗留键。
- 显示它应用的迁移。
- 使用更新后的 schema 重写 `~/.crawclaw/crawclaw.json`。

Gateway 网关在检测到遗留配置格式时也会在启动时自动运行 doctor 迁移，因此过时的配置无需手动干预即可修复。
Cron job store migrations 由 CrawClaw Desktop 或 local Gateway API 处理。

当前迁移：

- `routing.allowFrom` → `channels.weixin.allowFrom`
- `routing.groupChat.requireMention` → `channels.weixin/feishu/weixin.groups."*".requireMention`
- `routing.groupChat.historyLimit` → `messages.groupChat.historyLimit`
- `routing.groupChat.mentionPatterns` → `messages.groupChat.mentionPatterns`
- `routing.queue` → `messages.queue`
- `routing.bindings` → 顶级 `bindings`
- `routing.agents`/`routing.defaultAgentId` → `agents.list` + `agents.list[].default`
- `routing.agentToAgent` → `tools.agentToAgent`
- `routing.transcribeAudio` → `tools.media.audio.models`
- `bindings[].match.accountID` → `bindings[].match.accountId`
- 对配置了 named `accounts` 但缺少 `accounts.default` 的 channel，在存在 account-scoped top-level single-account channel values 时，把它们移动到 `channels.<channel>.accounts.default`
- `identity` → `agents.list[].identity`
- `agent.model`/`allowedModels`/`modelAliases`/`modelFallbacks`/`imageModelFallbacks`
  → `agents.defaults.models` + `agents.defaults.model.primary/fallbacks` + `agents.defaults.imageModel.primary/fallbacks`
- `browser.ssrfPolicy.allowPrivateNetwork` → `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork`
- remove `browser.relayBindHost`（legacy extension relay setting）

Doctor warnings 还包括 multi-account channels 的 account-default guidance：

- 如果配置了两个或更多 `channels.<channel>.accounts` entries，但没有 `channels.<channel>.defaultAccount` 或 `accounts.default`，doctor 会警告 fallback routing 可能选到意外账号。
- 如果 `channels.<channel>.defaultAccount` 指向未知 account ID，doctor 会警告并列出已配置的 account IDs。

### 2b）OpenCode provider overrides

如果你手动添加了 `models.providers.opencode`、`opencode-zen` 或 `opencode-go`，
它会覆盖来自 Rust provider registry 的内置 OpenCode catalog。这可能会把模型强制路由到错误 API，
或把成本清零。Doctor 会发出警告，方便你移除覆盖并恢复 per-model API routing + costs。

### 2c）Browser migration cleanup

如果 browser config 仍指向已移除的 browser relay settings，doctor 会把它规范化到当前 Rust native
`agent-browser` model：

- `browser.relayBindHost` is removed

### 3）遗留状态迁移（磁盘布局）

Doctor 可以将旧的磁盘布局迁移到当前结构：

- 会话存储 + 记录：
  - 从 `~/.crawclaw/sessions/` 到 `~/.crawclaw/agents/<agentId>/sessions/`
- 智能体目录：
  - 从 `~/.crawclaw/agent/` 到 `~/.crawclaw/agents/<agentId>/agent/`
- Weixin 认证状态（Baileys）：
  - 从遗留的 `~/.crawclaw/credentials/*.json`（除 `oauth.json` 外）
  - 到 `~/.crawclaw/credentials/weixin/<accountId>/...`（默认账户 id：`default`）

这些迁移是尽力而为且幂等的；当 doctor 将任何遗留文件夹作为备份保留时会发出警告。Gateway/CLI 也会在启动时自动迁移 legacy sessions + agent dir，因此 history/auth/models 会落到 per-agent path，无需手动运行 doctor。Weixin 认证有意仅通过 CrawClaw Desktop 或 local Gateway API 迁移。

### 3a）Legacy cron store migrations

Doctor 还会检查 cron job store（默认 `~/.crawclaw/cron/jobs.json`，或被 override 时的 `cron.store`）里 scheduler 仍为兼容而接受的旧 job shapes。

当前 cron cleanups 包括：

- `jobId` → `id`
- `schedule.cron` → `schedule.expr`
- top-level payload fields（`message`, `model`, `thinking`, ...）→ `payload`
- top-level delivery fields（`deliver`, `channel`, `to`, `provider`, ...）→ `delivery`
- payload `provider` delivery aliases → explicit `delivery.channel`
- simple legacy `notify: true` webhook fallback jobs → explicit `delivery.mode="webhook"` with `delivery.to=cron.webhook`

Doctor 只有在不改变行为时才会自动迁移 `notify: true` jobs。如果一个 job 同时使用 legacy notify fallback 和现有 non-webhook delivery mode，doctor 会警告并留给人工 review。

### 3c）Session lock cleanup

Doctor 会扫描每个 agent session directory，查找异常退出后残留的 stale write-lock files。对每个 lock file，它会报告 path、PID、PID 是否仍存活、lock age，以及是否 stale（dead PID 或超过 30 minutes）。在 `--fix` / `--repair` mode 下会自动移除 stale lock files；否则打印提示并要求你用 `--fix` 重新运行。

### 4）状态完整性检查（会话持久化、路由和安全）

状态目录是操作的核心。如果它消失，你会丢失会话、凭证、日志和配置（除非你在别处有备份）。

Doctor 检查：

- **状态目录缺失**：警告灾难性状态丢失，提示重新创建目录，并提醒你它无法恢复丢失的数据。
- **状态目录权限**：验证可写性；提供修复权限（并在检测到所有者/组不匹配时发出 `chown` 提示）。
- **macOS cloud-synced state dir**：当 state 位于 iCloud Drive（`~/Library/Mobile Documents/com~apple~CloudDocs/...`）或 `~/Library/CloudStorage/...` 下时警告，因为 sync-backed paths 可能导致更慢 I/O 和 lock/sync races。
- **Linux SD or eMMC state dir**：当 state 解析到 `mmcblk*` mount source 时警告，因为 SD/eMMC backed random I/O 在 session 和 credential writes 下可能更慢且磨损更快。
- **会话目录缺失**：`sessions/` 和会话存储目录是持久化历史和避免 `ENOENT` 崩溃所必需的。
- **记录不匹配**：当最近的会话条目缺少记录文件时发出警告。
- **主会话"1 行 JSONL"**：当主记录只有一行时标记（历史未累积）。
- **多个状态目录**：当多个 `~/.crawclaw` 文件夹存在于不同 home 目录或当 `CRAWCLAW_STATE_DIR` 指向别处时发出警告（历史可能在安装之间分裂）。
- **远程模式提醒**：如果 `gateway.mode=remote`，doctor 会提醒你在远程主机上运行它（状态在那里）。
- **配置文件权限**：当 `~/.crawclaw/crawclaw.json` 对组/其他用户可读时发出警告，并提供收紧到 `600` 的选项。

### 5）模型认证健康（OAuth 过期）

Doctor 检查 auth store 中的 OAuth 和 token profiles，并在 token 即将过期、已过期或缺失时警告。如果 Anthropic Claude Code profile stale，它会建议运行 `claude setup-token` 或粘贴 setup-token。CrawClaw Desktop 不再运行 bundled JavaScript OAuth refresh helpers。

Doctor 还会报告由于以下原因暂时不可用的认证配置文件：

- 短冷却（速率限制/超时/认证失败）
- 长禁用（账单/信用失败）

### 6）Hooks 模型验证

如果设置了 `hooks.gmail.model`，doctor 会根据目录和允许列表验证模型引用，并在无法解析或不允许时发出警告。该检查只报告可检测的问题，不会修改 runtime。

### 8）Legacy startup cleanup hints

Doctor 关注 desktop-owned local Gateway runtime。如果旧 OS supervisor entries 仍存在，应手动移除，确保 desktop app 和 local Gateway API 是唯一默认 startup path。

### 9）Startup channel checks

当 Feishu channel account 存在 pending/actionable legacy state migration 时，doctor（在 `--fix` / `--repair` mode 下）会创建 pre-migration snapshot，然后运行 best-effort migration steps：legacy Feishu state migration 和 legacy encrypted-state preparation。这两个步骤都是 non-fatal；错误会被记录，startup 继续。在 read-only mode（CrawClaw Desktop 或 local Gateway API without `--fix`）下会完全跳过此检查。

### 9）安全警告

当提供商对私信开放而没有允许列表，或当策略以危险方式配置时，Doctor 会发出警告。

### 10）Local runtime availability

Doctor 报告 local Gateway API 是否可达，以及 active configuration 指向 local 还是 remote Gateway。

### 11）Workspace status（skills、plugins 和 legacy dirs）

Doctor 会打印默认 agent 的 workspace state summary：

- **Skills status**：统计 eligible、missing-requirements 和 allowlist-blocked skills。
- **Legacy workspace dirs**：当 `~/crawclaw` 或其他 legacy workspace directories 与当前 workspace 并存时警告。
- **Plugin status**：统计 loaded/disabled/errored plugins；列出有错误的 plugin IDs；报告 bundle plugin capabilities。
- **Plugin compatibility warnings**：标记与当前 runtime 有 compatibility issues 的 plugins。
- **Plugin diagnostics**：展示 plugin registry 发出的 load-time warnings 或 errors。

### 11b）Bootstrap file size

Doctor 检查 workspace bootstrap files（例如 `AGENTS.md`、`CLAUDE.md` 或其他 injected context files）是否接近或超过配置的 character budget。它会报告每个文件的 raw vs. injected character counts、truncation percentage、truncation cause（`max/file` 或 `max/total`），以及 total injected characters 占 total budget 的比例。当文件被截断或接近上限时，doctor 会给出调优 `agents.defaults.bootstrapMaxChars` 和 `agents.defaults.bootstrapTotalMaxChars` 的提示。

### 11c）Shell completion

Doctor 检查当前 shell（zsh、bash、fish 或 PowerShell）是否已安装 tab completion：

- 如果 shell profile 使用慢速 dynamic completion pattern（`source <(... completion command ...)`），doctor 会升级到更快的 cached file variant。
- 如果 completion 已在 profile 中配置但 cache file 缺失，doctor 会自动 regenerate cache。
- 如果完全没有配置 completion，doctor 会提示安装（仅 interactive mode；`--non-interactive` 下跳过）。

手动 regenerate cache 时，使用 CrawClaw Desktop 或 local Gateway API 的 repair surface。

### 12）Gateway auth checks（local token）

Doctor 检查 local gateway token auth readiness。

- 如果 token mode 需要 token 但没有 token source，doctor 会提供生成 token。
- 如果 `gateway.auth.token` 由 SecretRef 管理但当前不可用，doctor 会警告，且不会用 plaintext 覆盖它。
- CrawClaw Desktop 或 local Gateway API 只在没有配置 token SecretRef 时强制生成。

### 12b）Read-only SecretRef-aware repairs

部分 repair flows 需要检查已配置 credentials，同时不能削弱 runtime fail-fast 行为。

- CrawClaw Desktop 或 local Gateway API 现在使用与 status-family commands 相同的 read-only SecretRef summary model 来做 targeted config repairs。
- 示例：Feishu `allowFrom` / `groupAllowFrom` `@username` repair 会在可用时尝试使用已配置 bot credentials。
- 如果 Feishu bot token 通过 SecretRef 配置但在当前 command path 中不可用，doctor 会报告 credential configured-but-unavailable，并跳过 auto-resolution，而不是 crash 或误报 token missing。

### 13）Gateway 网关健康检查 + 重启

Doctor 运行健康检查，并在 Gateway 网关看起来不健康时提供重启选项。

### 14）渠道状态警告

如果 Gateway 网关健康，doctor 运行渠道状态探测并报告警告及建议的修复。

### 15）Gateway runtime + port diagnostics

Doctor 检查 local Gateway API 是否可达。它还检查 gateway port（默认 `18789`）上的端口冲突，并报告可能原因，例如另一个 local runtime 或 SSH tunnel。

### 16）Gateway runtime best practices

默认由 CrawClaw Desktop 拥有本地 runtime。除非你明确在调试 isolated profile，否则避免在同一端口并行运行长期 shell。

### 18）配置写入 + 向导元数据

Doctor 持久化任何配置更改，并标记向导元数据以记录 doctor 运行。

### 19）工作区提示（备份 + 记忆系统）

当缺失时，Doctor 建议使用工作区记忆系统，并在工作区尚未在 git 下时打印备份提示。

参见 [/concepts/agent-workspace](/concepts/agent-workspace) 了解工作区结构和 git 备份的完整指南（推荐私有 GitHub 或 GitLab）。
