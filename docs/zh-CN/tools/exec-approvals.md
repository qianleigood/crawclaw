---
read_when:
  - 配置执行审批或白名单
  - 在 Web 控制界面中实现执行审批 UX
title: 执行审批
x-i18n:
  generated_at: "2026-06-05T15:09:27Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 9cb56713f22cc2bdf70516c54ce899acc3264a6b5b88801ca049a7aecafe782d
  source_path: tools/exec-approvals.md
  workflow: 15
---

# 执行审批

这是在 Gateway 主机上执行命令的安全互锁机制：只有当策略 + 白名单 +（可选）用户审批都同意时，命令才会被执行。执行审批是工具策略和特权控制的**附加层**（除非 elevated 设置为 `full`，后者会跳过审批）。有效策略取 `tools.exec.*` 和审批默认值中**更严格**的值；如果省略了某个审批字段，则使用 `tools.exec` 的值。主机执行还会使用该机器上的本地审批状态。主机本地的 `ask: "always"` 在 `~/.crawclaw/exec-approvals.json` 中会持续提示，即使会话或配置默认值请求 `ask: "on-miss"`。使用 CrawClaw Desktop 或本地 Gateway API 可以检查请求的策略、主机策略源和有效结果。

如果没有可用的审批 UI，任何需要提示的请求都会按 **ask fallback**（默认：拒绝）处理。

## 适用范围

执行审批在执行主机本地强制执行：

- **Gateway 主机** → Gateway 机器上的 `crawclaw` 进程

信任模型说明：

- 经过 Gateway 认证的调用者是该 Gateway 的受信任操作员。
- 执行审批降低了意外执行的风险，但不是用户级别的认证边界。
- 对于 shell 脚本和直接解释器/运行时文件调用，CrawClaw 也会尝试绑定一个具体的本地文件操作数。如果该绑定文件在审批后、执行前发生变化，则拒绝运行而不是执行漂移的内容。
- 此文件绑定是有意为之的最佳努力，不是一个完整的语义模型，无法覆盖每个解释器/运行时加载器路径。如果审批模式无法精确识别一个具体的本地文件进行绑定，它会拒绝生成审批支持的运行，而不是假装提供完整覆盖。

## 设置和存储

审批文件存储在执行主机上的本地 JSON 文件中：

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

## 无审批 "YOLO" 模式

如果你希望主机执行不弹出审批提示，必须打开**两个**策略层：

- CrawClaw 配置中的请求执行策略（`tools.exec.*`）
- `~/.crawclaw/exec-approvals.json` 中的主机本地审批策略

除非你明确收紧，否则这是默认的主机行为：

- `tools.exec.security`：在 `gateway`/`node` 上设为 `full`
- `tools.exec.ask`：设为 `off`
- 主机 `askFallback`：设为 `full`

重要区别：

- YOLO 选择主机执行如何被批准：`security=full` 加 `ask=off`。

如果你想要更保守的设置，可以将任一层重新收紧为 `allowlist` / `on-miss` 或 `deny`。

持久化 Gateway 主机 "从不提示" 设置：

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

会话级快捷方式：

- `/exec security=full ask=off` 只更改当前会话。
- `/elevated full` 是一个紧急快捷方式，也会跳过该会话的执行审批。

如果主机审批文件比配置更严格，更严格的主机策略仍会生效。

## 策略旋钮

### 安全（`exec.security`）

- **deny**：阻止所有主机执行请求。
- **allowlist**：仅允许白名单中的命令。
- **full**：允许所有内容（等同于 elevated）。

### 询问（`exec.ask`）

- **off**：从不提示。
- **on-miss**：仅在白名单不匹配时提示。
- **always**：每次命令都提示。
- `allow-always` 持久化信任不会在有效 ask 模式为 `always` 时抑制提示

### 询问回退（`askFallback`）

如果需要提示但无法访问 UI，回退决定：

- **deny**：阻止。
- **allowlist**：仅在白名单匹配时允许。
- **full**：允许。

### 内联解释器代码执行加固（`tools.exec.strictInlineEval`）

当 `tools.exec.strictInlineEval=true` 时，CrawClaw 将内联代码执行形式视为审批专用，即使解释器二进制文件本身在白名单中也是如此。

示例：

- `python -c`
- `node -e`、`node --eval`、`node -p`
- `ruby -e`
- `perl -e`、`perl -E`
- `php -r`
- `lua -e`
- `osascript -e`

这是针对无法干净地映射到一个稳定文件操作数的解释器加载器的纵深防御。在严格模式下：

- 这些命令仍需要显式审批；
- `allow-always` 不会自动为它们持久化新的白名单条目。

## 白名单（按智能体）

白名单是**按智能体**的。如果存在多个智能体，请在活动审批 UI 中切换要编辑的智能体。模式是**不区分大小写的 glob 匹配**。模式应解析为**二进制路径**（仅 basename 的条目会被忽略）。旧的 `agents.default` 条目在加载时会迁移到 `agents.main`。Shell 链（如 `echo ok && pwd`）仍需要每个顶层段都满足白名单规则。

示例：

- `~/Projects/**/bin/peekaboo`
- `~/.local/bin/*`
- `/opt/homebrew/bin/rg`

每个白名单条目追踪：

- **id** 稳定 UUID，用于 UI 标识（可选）
- **上次使用** 时间戳
- **上次使用的命令**
- **上次解析的路径**

## 自动允许 Skill CLI

启用 **Auto-allow skill CLIs** 后，已知 Skills 引用的可执行文件会在 Gateway 主机上被视为白名单。这是通过 Gateway RPC 上的 `skills.bins` 获取 skill bin 列表。如果你需要严格的手动白名单，请禁用此功能。

重要信任说明：

- 这是一个**隐式便捷白名单**，与手动路径白名单条目分开。
- 它适用于受信任的操作员环境。
- 如果你需要严格的显式信任，请保持 `autoAllowSkills: false` 并仅使用手动路径白名单条目。

## 安全 bins（仅 stdin）

`tools.exec.safeBins` 定义了一小部分**仅 stdin** 二进制文件（如 `cut`），这些文件可以在白名单模式下运行**而无需**显式白名单条目。安全 bins 拒绝位置文件参数和类路径标记，因此它们只能对输入流进行操作。这是一条针对流过滤器的窄路径快速通道，不是常规信任列表。**不要**将解释器或运行时二进制文件（如 `python3`、`node`、`ruby`、`bash`、`sh`、`zsh`）添加到 `safeBins`。如果一个命令可以执行代码、运行子命令或读取文件，请优先使用显式白名单条目并保持审批提示启用。自定义安全 bins 必须在 `tools.exec.safeBinProfiles.<bin>` 中定义显式配置文件。验证从 argv 形状确定性进行（无主机文件系统存在性检查），这可以防止从允许/拒绝差异中产生文件存在预言。文件导向选项被拒绝用于默认安全 bins（如 `sort -o`、`sort --output`、`sort --files0-from`、`sort --compress-program`、`sort --random-source`、`sort --temporary-directory`/`-T`、`wc --files0-from`、`jq -f/--from-file`、`grep -f/--file`）。安全 bins 还对破坏仅 stdin 行为的选项强制执行显式逐二进制标志策略（如 `sort -o/--output/--compress-program` 和 grep 递归标志）。长选项在安全 bin 模式下会失败关闭地进行验证：未知标志和模糊缩写都会被拒绝。
按安全 bin 配置文件的拒绝标志：

[//]: # "SAFE_BIN_DENIED_FLAGS:START"

- `grep`：`--dereference-recursive`、`--directories`、`--exclude-from`、`--file`、`--recursive`、`-R`、`-d`、`-f`、`-r`
- `jq`：`--argfile`、`--from-file`、`--library-path`、`--rawfile`、`--slurpfile`、`-L`、`-f`
- `sort`：`--compress-program`、`--files0-from`、`--output`、`--random-source`、`--temporary-directory`、`-T`、`-o`
- `wc`：`--files0-from`

[//]: # "SAFE_BIN_DENIED_FLAGS:END"

安全 bins 还强制将 argv 标记在执行时视为**字面文本**（无 globbing，无 `$VARS` 展开），仅适用于仅 stdin 段，因此像 `*` 或 `$HOME/...` 这样的模式不能被用来走私文件读取。安全 bins 还必须从受信任的二进制目录解析（系统默认值加上可选的 `tools.exec.safeBinTrustedDirs`）。`PATH` 条目永远不会被自动信任。默认受信任的安全 bin 目录是有意精简的：`/bin`、`/usr/bin`。如果你的安全 bin 可执行文件位于包管理器/用户路径（如 `/opt/homebrew/bin`、`/usr/local/bin`、`/opt/local/bin`、`/snap/bin`），请将它们显式添加到 `tools.exec.safeBinTrustedDirs`。Shell 链接和重定向在白名单模式下不会自动允许。

Shell 链接（`&&`、`||`、`;`）在每个顶层段都满足白名单时允许（包括安全 bins 或 skill 自动允许）。重定向在白名单模式下仍不支持。命令替换（`$()` / 反引号）在白名单解析期间被拒绝，包括双引号内部；如果你需要字面的 `$()` 文本，请使用单引号。在 macOS 配套应用审批中，包含 shell 控制或展开语法的原始 shell 文本（`&&`、`||`、`;`、`|`、`` ` ``、`$`、`<`、`>`、`(`、`)`）被视为白名单未命中，除非 shell 二进制文件本身在白名单中。对于 shell 包装器（`bash|sh|zsh ... -c/-lc`），请求范围的 env 覆盖被缩减为一个小显式白名单（`TERM`、`LANG`、`LC_*`、`COLORTERM`、`NO_COLOR`、`FORCE_COLOR`）。对于白名单模式下的 allow-always 决策，已知的调度包装器（`env`、`nice`、`nohup`、`stdbuf`、`timeout`）会持久化内部可执行文件路径而不是包装器路径。Shell 多路复用器（`busybox`、`toybox`）也会被解包以处理 shell 小程序（`sh`、`ash` 等），因此内部可执行文件会被持久化而不是多路复用器二进制文件。如果一个包装器或多路复用器无法被安全解包，不会自动持久化白名单条目。如果你将解释器（如 `python3` 或 `node`）加入白名单，优先使用 `tools.exec.strictInlineEval=true`，这样内联执行仍需要显式审批。在严格模式下，`allow-always` 仍可以持久化良性的解释器/脚本调用，但内联执行载体不会被自动持久化。

默认安全 bins：

[//]: # "SAFE_BIN_DEFAULTS:START"

`cut`、`uniq`、`head`、`tail`、`tr`、`wc`

[//]: # "SAFE_BIN_DEFAULTS:END"

`grep` 和 `sort` 不在默认列表中。如果你选择加入，请为它们的非 stdin 工作流保留显式白名单条目。对于安全 bin 模式下的 `grep`，使用 `-e`/`--regexp` 提供模式；位置模式形式会被拒绝，以防止文件操作数作为模糊位置参数被走私。

### 安全 bins 与白名单对比

| 主题     | `tools.exec.safeBins`             | 白名单（`exec-approvals.json`）               |
| -------- | --------------------------------- | --------------------------------------------- |
| 目标     | 自动允许狭窄的 stdin 过滤器       | 显式信任特定的可执行文件                      |
| 匹配类型 | 可执行文件名 + 安全 bin argv 策略 | 解析的可执行文件路径 glob 模式                |
| 参数范围 | 受安全 bin 配置和字面标记规则限制 | 仅路径匹配；参数由你负责                      |
| 典型示例 | `head`、`tail`、`tr`、`wc`        | `jq`、`python3`、`node`、`ffmpeg`、自定义 CLI |
| 最佳用途 | 管道中的低风险文本转换            | 具有更广泛行为或副作用的任何工具              |

配置位置：

- `safeBins` 来自配置（`tools.exec.safeBins` 或按智能体 `agents.list[].tools.exec.safeBins`）。
- `safeBinTrustedDirs` 来自配置（`tools.exec.safeBinTrustedDirs` 或按智能体 `agents.list[].tools.exec.safeBinTrustedDirs`）。
- `safeBinProfiles` 来自配置（`tools.exec.safeBinProfiles` 或按智能体 `agents.list[].tools.exec.safeBinProfiles`）。按智能体配置键覆盖全局键。
- 白名单条目位于主机本地 `~/.crawclaw/exec-approvals.json` 下的 `agents.<id>.allowlist`（或通过支持审批的客户端 / CrawClaw Desktop 或本地 Gateway API）。
- 当解释器/运行时 bin 出现在 `safeBins` 中但没有显式配置文件时，CrawClaw Desktop 或本地 Gateway API 会用 `tools.exec.safe_bins_interpreter_unprofiled` 发出警告。
- CrawClaw Desktop 或本地 Gateway API 可以为缺失的自定义 `safeBinProfiles.<bin>` 条目提供脚手架（`{}`，之后审查并收紧）。解释器/运行时 bin 不会被自动提供脚手架。

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

如果你明确将 `jq` 加入 `safeBins`，CrawClaw 在安全 bin 模式下仍会拒绝 `env` 内置命令，因此 `jq -n env` 无法在没有显式白名单路径或审批提示的情况下转储主机进程环境。

## 客户端编辑

支持审批的客户端可以编辑默认值、按智能体覆盖和白名单。选择一个范围（默认值或某个智能体），调整策略，然后添加/删除白名单模式。

CLI：CrawClaw Desktop 或本地 Gateway API 支持本地和 Gateway 编辑（参见[审批](/tools/exec-approvals)）。

## 审批流程

当需要提示时，Gateway 会向操作员客户端广播 `exec.approval.requested`。支持审批的客户端通过 `exec.approval.resolve` 进行处理，然后 Gateway 执行或拒绝已批准的请求。

## 解释器/运行时命令

审批支持的解释器/运行时运行是有意保守的：

- 精确的 argv/cwd/env 上下文始终被绑定。
- 直接 shell 脚本和直接运行时文件形式会尽力绑定到一个具体的本地文件快照。
- 常见的包管理器包装形式，如果仍能解析为一个直接的本地文件（如 `pnpm exec`、`pnpm node`、`npm exec`、`npx`），会在绑定前解包。
- 如果 CrawClaw 无法为解释器/运行时命令精确识别一个具体的本地文件（如包脚本、eval 形式、特定运行时加载器链或模糊的多文件形式），则会拒绝审批支持的执行，而不是声称拥有它不具备的语义覆盖。
  allowlist/full 工作流，其中操作员接受更广泛的运行时语义。

当需要审批时，exec 工具会立即返回一个审批 id。使用该 id 来关联后续的系统事件（`Exec finished` / `Exec denied`）。如果在超时前未收到决策，请求会被视为审批超时，并作为拒绝原因显示。

### 后续投递行为

已批准的异步 exec 完成后，CrawClaw 会向同一会话发送后续的 `agent` 轮次。

- 如果存在有效的外部投递目标（可投递渠道加上目标 `to`），后续投递使用该渠道。
- 在没有外部目标的内部会话流程中，后续投递保持在会话范围内（`deliver: false`）。
- 如果调用方明确请求严格外部投递但无法解析外部渠道，请求会因 `INVALID_REQUEST` 而失败。
- 如果启用了 `bestEffortDeliver` 且无法解析外部渠道，投递会降级为会话范围内而不是失败。

确认对话框包含：

- 命令 + 参数
- cwd
- 智能体 id
- 解析的可执行文件路径
- 主机 + 策略元数据

操作：

- **Allow once** → 立即运行
- **Always allow** → 添加到白名单 + 运行
- **Deny** → 阻止

## 审批转发到聊天渠道

你可以将执行审批提示转发到任何聊天渠道（包括插件渠道），并用 `/approve` 进行批准。这使用正常的出站投递管道。

配置：

```json5
{
  approvals: {
    exec: {
      enabled: true,
      mode: "session", // "session" | "targets" | "both"
      agentFilter: ["main"],
      sessionFilter: ["qqbot"], // 子字符串或正则表达式
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

`/approve` 命令同时处理执行审批和插件审批。如果 ID 不匹配待处理的执行审批，它会自动检查插件审批。

### 插件审批转发

插件审批转发使用与执行审批相同的投递管道，但在 `approvals.plugin` 下有自己独立的配置。启用或禁用一个不会影响另一个。

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

支持共享交互式回复的渠道会为执行和插件审批呈现相同的审批按钮。不支持共享交互式 UI 的渠道会回退到纯文本，并附带 `/approve` 说明。

### 任何渠道的同聊审批

当执行或插件审批请求来自可投递的聊天界面时，该聊天现在默认可以用 `/approve` 批准。这适用于 DingTalk、Matrix 和 QQBot 等渠道，以及现有的终端 UI 流程。

这条共享文本命令路径使用该对话的正常渠道认证模型。如果发起聊天的渠道已经可以发送命令和接收回复，审批请求不再需要单独的原生投递适配器来保持待处理状态。

QQBot 和飞书也支持同聊 `/approve`，但这些渠道在原生审批投递被禁用时仍会使用其已解析的审批者列表进行授权。

### 原生审批投递

某些渠道也可以充当原生审批客户端。原生客户端在共享同聊 `/approve` 流程之上，添加审批者私信、发起聊天分发和渠道特定的交互式审批 UX。

通用模型：

- 主机执行策略仍决定是否需要执行审批
- `approvals.exec` 控制将审批提示转发到其他聊天目标
- `channels.<channel>.execApprovals` 控制该渠道是否充当原生审批客户端

当以下条件都满足时，原生审批客户端会自动启用私信优先投递：

- 该渠道支持原生审批投递
- 可以从显式的 `execApprovals.approvers` 或现有所有者配置解析审批者
- `channels.<channel>.execApprovals.enabled` 未设置或为 `"auto"`

设置 `enabled: false` 可以显式禁用原生审批客户端。设置 `enabled: true` 可以强制启用（当审批者可以解析时）。公开发起聊天投递通过 `channels.<channel>.execApprovals.target` 保持显式。

常见问题：[为什么聊天审批有两个执行审批配置？](/help/faq#why-are-there-two-exec-approval-configs-for-chat-approvals)

- QQBot：`channels.qqbot.execApprovals.*`
- DingTalk：`channels.ddingtalk.execApprovals.*`
- 飞书：`channels.feishu.execApprovals.*`

这些原生审批客户端在共享同聊 `/approve` 流程和共享审批按钮之上添加了私信路由和可选的渠道分发。

共享行为：

- DingTalk、Matrix、QQBot 和类似可投递聊天使用正常渠道认证模型进行同聊 `/approve`
- 当原生审批客户端自动启用时，默认原生投递目标是审批者私信
- 对于 QQBot 和飞书，只有已解析的审批者可以批准或拒绝
- QQBot 和飞书的审批者可以是显式的（`execApprovals.approvers`）或从现有所有者配置推断（`allowFrom`，加上支持直接消息的 `defaultTo`）
- DingTalk 的审批者可以是显式的（`execApprovals.approvers`）或从 `commands.ownerAllowFrom` 推断
- 请求者不需要是审批者
- 发起聊天可以直接用 `/approve` 批准（当该聊天已经支持命令和回复时）
- 当原生 `target` 启用发起聊天投递时，审批提示包含命令文本
- 待处理的执行审批默认在 30 分钟后过期
- 如果没有操作员 UI 或配置的审批客户端可以接受请求，提示会回退到 `askFallback`

飞书默认为审批者私信（`target: "dm"`）。当你希望审批提示也出现在发起飞书聊天/主题时，可以切换到 `channel` 或 `both`。对于飞书论坛主题，CrawClaw 会保留主题以用于审批提示和审批后的后续跟进。

参见：

- [QQBot](/channels/index)
- [飞书](/channels/index)

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

Exec 生命周期作为系统消息显示：

- `Exec running`（仅在命令超过运行通知阈值时）
- `Exec finished`
- `Exec denied`

这些事件在节点报告事件后发布到智能体的会话。当命令完成时，Gateway 主机执行审批会发出相同的生命周期事件（以及在超过阈值时可选的运行中事件）。审批控制的 exec 重用审批 id 作为这些消息中的 `runId`，便于关联。

## 拒绝审批行为

当异步执行审批被拒绝时，CrawClaw 阻止智能体重用同一命令早期运行的任何输出。拒绝原因会与明确的指导一起传递，说明没有可用的命令输出，这会阻止智能体声称有新输出或用先前成功运行的过期结果重复执行被拒绝的命令。

## 影响

- **full** 权限很强；尽可能使用白名单。
- **ask** 让你保持参与循环，同时仍允许快速审批。
- 按智能体的白名单防止一个智能体的审批泄漏到其他智能体。
- 审批仅适用于**授权发送者**的主机执行请求。未经授权的发送者不能发送 `/exec`。
- `/exec security=full` 是授权操作员的会话级便捷方式，设计上会跳过审批。
  要硬性阻止主机执行，请将审批安全性设为 `deny` 或通过工具策略拒绝 `exec` 工具。

相关：

- [Exec 工具](/tools/exec)
- [Elevated 模式](/tools/elevated)
- [Skills](/tools/skills)

## 相关

- [Exec](/tools/exec) — shell 命令执行工具
- [安全](/gateway/security) — 安全模型和加固
- [安全](/gateway/security) — 各使用场景
