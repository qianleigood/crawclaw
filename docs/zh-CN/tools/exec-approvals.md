---
read_when:
  - 配置 exec 审批或允许列表
  - 在 Web 控制界面中实现 exec 审批用户体验
summary: Gateway 主机 exec 的审批、允许列表和主机策略控制
title: Exec 审批
x-i18n:
  generated_at: "2026-06-10T18:59:33Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 6f4e182e13716f82d64abc29d3502c0efea66402fa36060c159dc95d9017d205
  source_path: tools/exec-approvals.md
  workflow: 15
---

# Exec 审批

Exec 审批是 Gateway 主机上命令的安全互锁机制：只有当策略 + 允许列表 +（可选）用户审批全部同意时，命令才会被执行。
Exec 审批是**附加于**工具策略和提权关卡的（除非提权设置为 `full`，会跳过审批）。
有效策略是 `tools.exec.*` 和审批默认值的**更严格**者；如果省略了某个审批字段，则使用 `tools.exec` 的值。
主机 exec 也会使用该机器上的本地审批状态。如果主机本地的 `ask: "always"` 位于 `~/.crawclaw/exec-approvals.json` 中，即使会话或配置默认值请求 `ask: "on-miss"`，仍会持续提示。
使用 CrawClaw Desktop 或本地 Gateway API 检查请求的策略、主机策略来源和有效结果。

如果没有可用的审批 UI，任何需要提示的请求都会由 **ask 回退** 解决（默认：拒绝）。

## 适用范围

Exec 审批在执行主机上本地执行：

- **Gateway 主机** → 网关机器上的 `crawclaw` 进程

信任模型说明：

- Gateway 认证的调用者是该 Gateway 的受信任操作员。
- Exec 审批降低意外执行风险，但不是每个用户的身份验证边界。
- 对于 shell 脚本和直接解释器/运行时文件调用，CrawClaw 也会尝试绑定一个具体的本地文件操作数。如果在审批后、执行前该绑定文件发生变化，则拒绝运行而不是执行漂移的内容。
- 此文件绑定是有意为之的尽力行为，并非每个解释器/运行时加载器路径的完整语义模型。如果审批模式无法准确识别一个具体的本地文件进行绑定，它会拒绝生成审批支持的运行，而不是假装具有完全覆盖。

## 设置和存储

审批位于执行主机上的本地 JSON 文件中：

`~/.crawclaw/exec-approvals.json`

示例 schema：

```json
{
  "version": 1,
  "socket": {
    "path": "~/.crawclaw/exec-approvals.sock",
    "token": "base64url-token"
  },
  "defaults": {
    "security": "deny",
    "ask": "on-miss",
    "askFallback": "deny",
    "autoAllowSkills": false
  },
  "agents": {
    "main": {
      "security": "allowlist",
      "ask": "on-miss",
      "askFallback": "deny",
      "autoAllowSkills": true,
      "allowlist": [
        {
          "id": "B0C8C0B3-2C2D-4F8A-9A3C-5A4B3C2D1E0F",
          "pattern": "~/Projects/**/bin/rg",
          "lastUsedAt": 1737150000000,
          "lastUsedCommand": "rg -n TODO",
          "lastResolvedPath": "/Users/user/Projects/.../bin/rg"
        }
      ]
    }
  }
}
```

## 无审批"YOLO"模式

如果你希望主机 exec 在无审批提示的情况下运行，必须同时打开**两个**策略层：

- CrawClaw 配置中请求的 exec 策略（`tools.exec.*`）
- `~/.crawclaw/exec-approvals.json` 中的主机本地审批策略

这是现在默认的主机行为，除非你明确收紧它：

- `tools.exec.security`：`gateway`/`node` 上的 `full`
- `tools.exec.ask`：`off`
- 主机 `askFallback`：`full`

重要区别：

- YOLO 选择主机 exec 的审批方式：`security=full` 加 `ask=off`。

如果你想要更保守的设置，将任一层恢复到 `allowlist` / `on-miss` 或 `deny`。

持久化 Gateway 主机"从不提示"设置：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

然后设置主机审批文件以匹配：

```json5
{
  version: 1,
  defaults: {
    security: "full",
    ask: "off",
    askFallback: "full",
  },
}
```

仅会话快捷方式：

- `/exec security=full ask=off` 仅更改当前会话。
- `/elevated full` 是一个紧急快捷方式，也会跳过该会话的 exec 审批。

如果主机审批文件比配置更严格，更严格的主机策略仍然优先。

## 策略旋钮

### 安全（`exec.security`）

- **deny**：阻止所有主机 exec 请求。
- **allowlist**：仅允许允许列表中的命令。
- **full**：允许一切（等同于提权）。

### 提示（`exec.ask`）

- **off**：从不提示。
- **on-miss**：仅在允许列表不匹配时提示。
- **always**：每次命令都提示。
- `allow-always` 持久信任在有效提示模式为 `always` 时不会抑制提示

### 提示回退（`askFallback`）

如果需要提示但无法访问 UI，回退决定：

- **deny**：阻止。
- **allowlist**：仅在允许列表匹配时允许。
- **full**：允许。

### 内联解释器 eval 强化（`tools.exec.strictInlineEval`）

当 `tools.exec.strictInlineEval=true` 时，CrawClaw 将内联代码 eval 形式视为仅审批模式，即使解释器二进制文件本身在允许列表中。

示例：

- `python -c`
- `node -e`、`node --eval`、`node -p`
- `ruby -e`
- `perl -e`、`perl -E`
- `php -r`
- `lua -e`
- `osascript -e`

这是针对无法干净地映射到一个稳定文件操作数的解释器加载器的纵深防御。在严格模式下：

- 这些命令仍然需要显式审批；
- `allow-always` 不会自动为它们持久化新的允许列表条目。

## 允许列表（每个智能体）

允许列表是**每个智能体**的。如果存在多个智能体，请在活动审批 UI 中切换要编辑的智能体。
模式是**不区分大小写的 glob 匹配**。
模式应解析为**二进制路径**（仅 basename 的条目会被忽略）。
旧版 `agents.default` 条目在加载时迁移到 `agents.main`。
Shell 链（如 `echo ok && pwd`）仍需要每个顶级段满足允许列表规则。

示例：

- `~/Projects/**/bin/peekaboo`
- `~/.local/bin/*`
- `/opt/homebrew/bin/rg`

每个允许列表条目跟踪：

- **id** 用于 UI 标识的稳定 UUID（可选）
- **上次使用** 时间戳
- **上次使用的命令**
- **上次解析的路径**

## 自动允许 Skill CLI

启用**自动允许 Skill CLI**后，已知 Skills 引用的可执行文件会在 Gateway 主机上被视为允许列表。
这使用 `skills.bins` 通过 Gateway RPC 获取 Skill bin 列表。如果需要严格的手动允许列表，请禁用此功能。

重要信任说明：

- 这是**隐式便利允许列表**，与手动路径允许列表条目分开。
- 它适用于受信任的操作员环境。
- 如果需要严格的显式信任，请保持 `autoAllowSkills: false`，仅使用手动路径允许列表条目。

## 安全 bin（仅 stdin）

`tools.exec.safeBins` 定义了一个小的**仅 stdin** 二进制文件列表（例如 `cut`），这些文件可以在**无**显式允许列表条目的情况下以允许列表模式运行。安全 bin 拒绝位置文件参数和类路径标记，因此它们只能对输入流进行操作。
将其视为流过滤器的窄快速路径，而不是一般信任列表。
**不要**将解释器或运行时二进制文件（例如 `python3`、`node`、`ruby`、`bash`、`sh`、`zsh`）添加到 `safeBins`。
如果某个命令可以评估代码、执行子命令或按设计读取文件，请使用显式允许列表条目并保持审批提示启用。
自定义安全 bin 必须在 `tools.exec.safeBinProfiles.<bin>` 中定义显式配置文件。
验证从 argv 形状确定性进行（无主机文件系统存在检查），这可以防止从允许/拒绝差异中产生文件存在预言。
默认安全 bin 的文件导向选项被拒绝（例如 `sort -o`、`sort --output`、`sort --files0-from`、`sort --compress-program`、`sort --random-source`、`sort --temporary-directory`/`-T`、`wc --files0-from`、`jq -f/--from-file`、`grep -f/--file`）。
安全 bin 还会对破坏 stdin-only 行为的选项强制执行显式逐二进制标志策略（例如 `sort -o/--output/--compress-program` 和 grep 递归标志）。
在安全 bin 模式下，长选项会被失败关闭式验证：未知标志和模糊缩写都会被拒绝。
安全 bin 配置文件按配置文件拒绝的标志：

[//]: # "SAFE_BIN_DENIED_FLAGS:START"

- `grep`：`--dereference-recursive`、`--directories`、`--exclude-from`、`--file`、`--recursive`、`-R`、`-d`、`-f`、`-r`
- `jq`：`--argfile`、`--from-file`、`--library-path`、`--rawfile`、`--slurpfile`、`-L`、`-f`
- `sort`：`--compress-program`、`--files0-from`、`--output`、`--random-source`、`--temporary-directory`、`-T`、`-o`
- `wc`：`--files0-from`

[//]: # "SAFE_BIN_DENIED_FLAGS:END"

安全 bin 还会强制 argv 标记在执行时被视为**字面文本**（无 glob 展开也无 `$VARS` 展开），用于仅 stdin 段，因此 `*` 或 `$HOME/...` 等模式不能被用来偷偷读取文件。
安全 bin 还必须从受信任的二进制目录解析（系统默认值加上可选的 `tools.exec.safeBinTrustedDirs`）。`PATH` 条目永远不会被自动信任。
默认受信任安全 bin 目录是有意精简的：`/bin`、`/usr/bin`。
如果你的安全 bin 可执行文件位于包管理器/用户路径中（例如 `/opt/homebrew/bin`、`/usr/local/bin`、`/opt/local/bin`、`/snap/bin`），请将它们显式添加到 `tools.exec.safeBinTrustedDirs`。
Shell 链接和重定向在允许列表模式下不会自动允许。

Shell 链接（`&&`、`||`、`;`）在每个顶级段满足允许列表（包括安全 bin 或 skill 自动允许）时允许。重定向在允许列表模式下仍然不支持。
命令替换（`$()` / 反引号）在允许列表解析期间被拒绝，包括双引号内部；如果你需要字面 `$()` 文本，请使用单引号。
在 macOS 配套应用审批中，包含 shell 控制或展开语法的原始 shell 文本（`&&`、`||`、`;`、`|`、`` ` ``、`$`、`<`、`>`、`(`、`)`）被视为允许列表未命中，除非 shell 二进制文件本身在允许列表中。
对于 shell 包装器（`bash|sh|zsh ... -c/-lc`），请求范围的 env 覆盖被缩减为一个小显式允许列表（`TERM`、`LANG`、`LC_*`、`COLORTERM`、`NO_COLOR`、`FORCE_COLOR`）。
对于允许列表模式下的 allow-always 决策，已知调度包装器（`env`、`nice`、`nohup`、`stdbuf`、`timeout`）会持久化内部可执行文件路径而不是包装器路径。Shell 多路复用器（`busybox`、`toybox`）也会为 shell 小程序（`sh`、`ash` 等）解包，因此内部可执行文件会被持久化而不是多路复用器二进制文件。如果无法安全地解包包装器或多路复用器，则不会自动持久化允许列表条目。
如果你允许列表解释器如 `python3` 或 `node`，请首选 `tools.exec.strictInlineEval=true`，这样内联 eval 仍需要显式审批。在严格模式下，`allow-always` 仍可以持久化良性的解释器/脚本调用，但内联 eval 载体不会被自动持久化。

默认安全 bin：

[//]: # "SAFE_BIN_DEFAULTS:START"

`cut`、`uniq`、`head`、`tail`、`tr`、`wc`

[//]: # "SAFE_BIN_DEFAULTS:END"

`grep` 和 `sort` 不在默认列表中。如果你选择加入，请为它们的非 stdin 工作流保留显式允许列表条目。
对于安全 bin 模式下的 `grep`，使用 `-e`/`--regexp` 提供模式；位置模式形式被拒绝，因此文件操作数不能作为模糊位置被偷偷传入。

### 安全 bin 与允许列表

| 主题     | `tools.exec.safeBins`             | 允许列表（`exec-approvals.json`）             |
| -------- | --------------------------------- | --------------------------------------------- |
| 目标     | 自动允许窄 stdin 过滤器           | 显式信任特定可执行文件                        |
| 匹配类型 | 可执行文件名 + 安全 bin argv 策略 | 已解析可执行文件路径 glob 模式                |
| 参数范围 | 受安全 bin 配置和字面标记规则限制 | 仅路径匹配；参数由你负责                      |
| 典型示例 | `head`、`tail`、`tr`、`wc`        | `jq`、`python3`、`node`、`ffmpeg`、自定义 CLI |
| 最佳用途 | 管道中低风险文本转换              | 具有更广泛行为或副作用的任何工具              |

配置位置：

- `safeBins` 来自配置（`tools.exec.safeBins` 或每个智能体 `agents.list[].tools.exec.safeBins`）。
- `safeBinTrustedDirs` 来自配置（`tools.exec.safeBinTrustedDirs` 或每个智能体 `agents.list[].tools.exec.safeBinTrustedDirs`）。
- `safeBinProfiles` 来自配置（`tools.exec.safeBinProfiles` 或每个智能体 `agents.list[].tools.exec.safeBinProfiles`）。每个智能体的配置键覆盖全局键。
- 允许列表条目位于主机本地 `~/.crawclaw/exec-approvals.json` 中的 `agents.<id>.allowlist`（或通过支持审批的客户端 / CrawClaw Desktop 或本地 Gateway API）。
- CrawClaw Desktop 或本地 Gateway API 会在解释器/运行时 bin 出现在 `safeBins` 中但没有显式配置文件时发出 `tools.exec.safe_bins_interpreter_unprofiled` 警告。
- CrawClaw Desktop 或本地 Gateway API 可以为缺失的自定义 `safeBinProfiles.<bin>` 条目搭建脚手架为 `{}`（之后检查并收紧）。解释器/运行时 bin 不会自动搭建。

自定义配置文件示例：

```json5
{
  tools: {
    exec: {
      safeBins: ["jq", "myfilter"],
      safeBinProfiles: {
        myfilter: {
          minPositional: 0,
          maxPositional: 0,
          allowedValueFlags: ["-n", "--limit"],
          deniedFlags: ["-f", "--file", "-c", "--command"],
        },
      },
    },
  },
}
```

如果你明确选择将 `jq` 加入 `safeBins`，CrawClaw 在安全 bin 模式下仍会拒绝 `env` 内置命令，因此 `jq -n env` 无法在没有显式允许列表路径或审批提示的情况下转储主机进程环境。

## 客户端编辑

支持审批的客户端可以编辑默认值、每个智能体覆盖和允许列表。
选择一个范围（默认或某个智能体），调整策略，并添加/删除允许列表模式。

CLI：CrawClaw Desktop 或本地 Gateway API 支持本地和 Gateway 编辑（参见[审批](/tools/exec-approvals)）。

## 审批流程

当需要提示时，Gateway 会向操作员客户端广播 `exec.approval.requested`。
支持审批的客户端通过 `exec.approval.resolve` 来解决，然后 Gateway 运行或拒绝已批准的请求。

## 解释器/运行时命令

审批支持的解释器/运行时运行是有意保守的：

- 始终绑定精确的 argv/cwd/env 上下文。
- 直接 shell 脚本和直接运行时文件形式尽力绑定到一个具体的本地文件快照。
- 常见包管理器包装形式仍解析为一个直接本地文件（例如 `pnpm exec`、`pnpm node`、`npm exec`、`npx`）会在绑定前解包。
- 如果 CrawClaw 无法为解释器/运行时命令准确识别一个具体的本地文件（例如包脚本、eval 形式、运行时特定加载器链或模糊的多文件形式），则会拒绝审批支持的执行，而不是声称具有它没有的语义覆盖。
  allowlist/full 工作流，操作员接受更广泛的运行时语义。

当需要审批时，exec 工具会立即返回一个审批 id。使用该 id 来关联后续系统事件（`Exec finished` / `Exec denied`）。如果在超时前没有收到决定，请求将被视为审批超时，并作为拒绝原因显示。

### 后续交付行为

在批准的异步 exec 完成后，CrawClaw 会向同一会话发送后续 `agent` 轮次。

- 如果存在有效的外部交付目标（可交付渠道加上目标 `to`），后续交付使用该渠道。
- 在没有外部目标的内部会话流程中，后续交付保持仅会话模式（`deliver: false`）。
- 如果调用方明确请求严格外部交付但无法解析外部渠道，请求将失败并显示 `INVALID_REQUEST`。
- 如果启用了 `bestEffortDeliver` 且无法解析外部渠道，交付会降级为仅会话模式而不是失败。

确认对话框包括：

- 命令 + 参数
- cwd
- 智能体 id
- 已解析的可执行文件路径
- 主机 + 策略元数据

操作：

- **仅允许一次** → 现在运行
- **始终允许** → 添加到允许列表 + 运行
- **拒绝** → 阻止

## 审批转发到聊天渠道

你可以将 exec 审批提示转发到任何聊天渠道（包括插件渠道），并用 `/approve` 批准它们。这使用正常的出站交付管道。

配置：

```json5
{
  approvals: {
    exec: {
      enabled: true,
      mode: "session", // "session" | "targets" | "both"
      agentFilter: ["main"],
      sessionFilter: ["qqbot"], // 子字符串或正则
      targets: [
        { channel: "ddingtalk", to: "U12345678" },
        { channel: "feishu", to: "123456789" },
      ],
    },
  },
}
```

在聊天中回复：

```
/approve <id> allow-once
/approve <id> allow-always
/approve <id> deny
```

`/approve` 命令同时处理 exec 审批和插件审批。如果 ID 与待处理的 exec 审批不匹配，它会自动检查插件审批。

### 插件审批转发

插件审批转发使用与 exec 审批相同的交付管道，但有自己独立的配置在 `approvals.plugin` 下。启用或禁用其中一个不会影响另一个。

```json5
{
  approvals: {
    plugin: {
      enabled: true,
      mode: "targets",
      agentFilter: ["main"],
      targets: [
        { channel: "ddingtalk", to: "U12345678" },
        { channel: "feishu", to: "123456789" },
      ],
    },
  },
}
```

配置结构与 `approvals.exec` 相同：`enabled`、`mode`、`agentFilter`、`sessionFilter` 和 `targets` 的工作方式相同。

支持共享交互式回复的渠道会为 exec 和插件审批呈现相同的审批按钮。不支持共享交互式 UI 的渠道会回退到带有 `/approve` 说明的纯文本。

### 任何渠道的同聊审批

当 exec 或插件审批请求来自可交付的聊天界面时，同一聊天现在默认可以用 `/approve` 批准它。这适用于 DingTalk、Matrix、QQBot 等渠道，以及现有的终端 UI 流程。

这条共享文本命令路径使用该会话的正常渠道认证模型。如果发起聊天的渠道已经可以发送命令和接收回复，审批请求不再需要单独的原生交付适配器来保持待处理状态。

QQBot 和 Feishu 也支持同聊 `/approve`，但这些渠道在原生审批交付被禁用时仍使用其解析的审批人列表进行授权。

### 原生审批交付

某些渠道也可以充当原生审批客户端。原生客户端在共享同聊 `/approve` 流程之上添加审批人私信、原始聊天广播和渠道特定的交互式审批用户体验。

通用模型：

- 主机 exec 策略仍决定是否需要 exec 审批
- `approvals.exec` 控制将审批提示转发到其他聊天目的地
- `channels.<channel>.execApprovals` 控制该渠道是否充当原生审批客户端

当所有这些条件都满足时，原生审批客户端会自动启用私信优先交付：

- 该渠道支持原生审批交付
- 可以从显式 `execApprovals.approvers` 或现有所有者配置解析审批人
- `channels.<channel>.execApprovals.enabled` 未设置或为 `"auto"`

设置 `enabled: false` 可显式禁用原生审批客户端。设置 `enabled: true` 可在审批人解析时强制启用。
公共原始聊天交付通过 `channels.<channel>.execApprovals.target` 保持显式。

常见问题：[为什么聊天审批有两个 exec 审批配置？](/help/faq#why-are-there-two-exec-approval-configs-for-chat-approvals)

- QQBot：`channels.qqbot.execApprovals.*`
- DingTalk：`channels.ddingtalk.execApprovals.*`
- Feishu：`channels.feishu.execApprovals.*`

这些原生审批客户端在共享同聊 `/approve` 流程和共享审批按钮之上添加私信路由和可选的渠道广播。

共享行为：

- DingTalk、Matrix、QQBot 和类似的可交付聊天使用正常渠道认证模型进行同聊 `/approve`
- 当原生审批客户端自动启用时，默认原生交付目标是审批人私信
- 对于 QQBot 和 Feishu，只有解析的审批人可以批准或拒绝
- QQBot 和 Feishu 审批人可以是显式的（`execApprovals.approvers`）或从现有所有者配置推断（`allowFrom`，以及支持直接消息的 `defaultTo`）
- DingTalk 审批人可以是显式的（`execApprovals.approvers`）或从 `commands.ownerAllowFrom` 推断
- 请求者不需要是审批人
- 发起聊天的渠道可以在该聊天已支持命令和回复时直接用 `/approve` 批准
- 当原生 `target` 启用原始聊天交付时，审批提示包括命令文本
- 待处理的 exec 审批默认在 30 分钟后过期
- 如果没有操作员 UI 或配置的审批客户端可以接受请求，提示会回退到 `askFallback`

Feishu 默认使用审批人私信（`target: "dm"`）。当你还希望审批提示出现在发起 Feishu 聊天/话题中时，可以切换到 `channel` 或 `both`。对于 Feishu 论坛话题，CrawClaw 会为审批提示和审批后跟进保留话题。

参见：

- [QQBot](/channels/index)
- [Feishu](/channels/index)

### macOS IPC 流程

```
Gateway -> Node Service (WS)
                 |  IPC (UDS + token + HMAC + TTL)
                 v
             Mac App (UI + approvals + system.run)
```

安全说明：

- Unix socket 模式 `0600`，token 存储在 `exec-approvals.json` 中。
- 相同 UID 对等检查。
- 挑战/响应（nonce + HMAC token + 请求哈希）+ 短 TTL。

## 系统事件

Exec 生命周期作为系统消息呈现：

- `Exec running`（仅在命令超过运行通知阈值时）
- `Exec finished`
- `Exec denied`

这些在节点报告事件后发布到智能体的会话。
当命令完成时（以及在超过阈值时可选地运行时），Gateway 主机 exec 审批会发出相同的生命周期事件。
审批门控的 exec 会在这些消息中重用审批 id 作为 `runId`，以便轻松关联。

## 拒绝审批行为

当异步 exec 审批被拒绝时，CrawClaw 会阻止智能体重用该命令早期运行的任何输出。拒绝原因会随明确说明没有命令输出可用而传递，这会阻止智能体声称有新输出或用先前成功运行的陈旧结果重复被拒绝的命令。

## 影响

- **full** 很强大；尽可能使用允许列表。
- **ask** 让你保持知情，同时仍允许快速审批。
- 每个智能体允许列表防止一个智能体的审批泄露到其他智能体。
- 审批仅适用于**授权发送者**的主机 exec 请求。未授权发送者不能发出 `/exec`。
- `/exec security=full` 是授权操作员的会话级便利功能，设计上会跳过审批。
  要硬性阻止主机 exec，请将审批安全设置为 `deny` 或通过工具策略拒绝 `exec` 工具。

相关：

- [Exec 工具](/tools/exec)
- [提权模式](/tools/elevated)
- [Skills](/tools/skills)

## 相关

- [Exec](/tools/exec) — shell 命令执行工具
- [安全](/gateway/security) — 安全模型和强化
- [安全](/gateway/security) — 何时使用各种功能
