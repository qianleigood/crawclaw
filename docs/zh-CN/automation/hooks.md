---
read_when:
  - 你需要 /new、/stop 和智能体生命周期事件的事件驱动自动化
  - 你需要构建、安装或调试钩子
summary: 钩子：命令和生命周期事件的事件驱动自动化
title: 钩子
x-i18n:
  generated_at: "2026-05-19T00:56:49Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 1345e872da400c2261455d70e3d10e6a5ebb952b47eb53d1e9b673f452f503ab
  source_path: automation/hooks.md
  workflow: 15
---

# 钩子

钩子是小型脚本，当 Gateway 网关内部发生某些事情时自动运行。它们从目录中自动发现，可以通过 CrawClaw Desktop 或本地 Gateway API 进行检查。

CrawClaw 中有两种钩子：

- **内置钩子**（此页）：当智能体事件触发时在 Gateway 内运行，例如 `/new`, `/stop` 或生命周期事件。
- **网页钩子**：外部 HTTP 端点，允许其他系统触发 CrawClaw 中的工作。请参阅 [网页钩子](/automation/cron-jobs#webhooks)。

钩子也可以打包在插件中。CrawClaw Desktop 或本地 Gateway API 会显示独立钩子和插件管理的钩子。

## 快速开始

```bash
# List available hooks
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Enable a hook
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Check hook status
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Get detailed information
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

## 事件类型

| Event                    | When it fires                                    |
| ------------------------ | ------------------------------------------------ |
| `command:new`            | `/new` command issued                            |
| `command:stop`           | `/stop` command issued                           |
| `command`                | Any command event (general listener)             |
| `session:compact:before` | Before compaction summarizes history             |
| `session:compact:after`  | After compaction completes                       |
| `session:patch`          | When session properties are modified             |
| `agent:bootstrap`        | Before workspace bootstrap files are injected    |
| `gateway:startup`        | After channels start and hooks are loaded        |
| `message:received`       | Inbound message from any channel                 |
| `message:transcribed`    | After audio transcription completes              |
| `message:preprocessed`   | After all media and link understanding completes |
| `message:sent`           | Outbound message delivered                       |

## 编写钩子

### 钩子结构

每个钩子是一个包含两个文件的目录：

```
my-hook/
├── HOOK.md          # Metadata + documentation
└── handler.ts       # Handler implementation
```

### HOOK.md 格式

```markdown
---
name: my-hook
description: "Short description of what this hook does"
metadata:
  { "crawclaw": { "emoji": "🔗", "events": ["command:new"], "requires": { "bins": ["node"] } } }
---

# My Hook

Detailed documentation goes here.
```

**元数据字段** （`metadata.crawclaw`）：

| Field      | Description                                          |
| ---------- | ---------------------------------------------------- |
| `emoji`    | Display emoji for CLI                                |
| `events`   | Array of events to listen for                        |
| `export`   | Named export to use (defaults to `"default"`)        |
| `os`       | Required platforms (e.g., `["darwin", "linux"]`)     |
| `requires` | Required `bins`, `anyBins`, `env`, or `config` paths |
| `always`   | Bypass eligibility checks (boolean)                  |
| `install`  | Installation methods                                 |

### 处理器实现

```typescript
const handler = async (event) => {
  if (event.type !== "command" || event.action !== "new") {
    return;
  }

  console.log(`[my-hook] New command triggered`);
  // Your logic here

  // Optionally send message to user
  event.messages.push("Hook executed!");
};

export default handler;
```

每个事件包含： `type`, `action`, `sessionKey`, `timestamp`, `messages` （推送给用户），和 `context` （事件特定数据）。

### 事件上下文要点

**命令事件** （`command:new`）：`context.sessionEntry`, `context.previousSessionEntry`, `context.commandSource`, `context.workspaceDir`, `context.cfg`。

**消息事件** （`message:received`）：`context.from`, `context.content`, `context.channelId`, `context.metadata` 消息事件（提供商特定数据，包括 `senderId`, `senderName`, `guildId`）

**消息事件** （`message:sent`）：`context.to`, `context.content`, `context.success`, `context.channelId`。

**消息事件** （`message:transcribed`）：`context.transcript`, `context.from`, `context.channelId`, `context.mediaPath`。

**消息事件** （`message:preprocessed`）：`context.bodyForAgent` （富化后的最终正文）， `context.from`, `context.channelId`。

**启动事件** （`agent:bootstrap`）：`context.bootstrapFiles` （可变数组）， `context.agentId`。

**会话补丁事件** （`session:patch`）：`context.sessionEntry`, `context.patch` （仅包含变更的字段）， `context.cfg`只有特权客户端才能触发补丁事件。

**压缩事件**： `session:compact:before` 包括 `messageCount`, `tokenCount`。`session:compact:after` 添加 `compactedCount`, `summaryLength`, `tokensBefore`, `tokensAfter`。

## 钩子发现

钩子从以下目录中发现，按覆盖优先级递增排序：

1. **托管钩子**： `~/.crawclaw/hooks/` （用户安装的工作区共享钩子）。额外目录来自 `hooks.internal.load.extraDirs` 共享此优先级。
2. **工作区钩子**： `<workspace>/hooks/` （每个智能体，默认禁用，需要显式启用）

工作区钩子可以添加新的钩子名称，但不能覆盖同名托管钩子。

### 钩子模块

独立 hook-pack 安装/更新命令已从默认产品路径中移除。将可信的钩子模块放入托管钩子或工作区钩子目录中，或发布原生插件能力以实现可分发的扩展行为。

## 已移除的捆绑钩子

CrawClaw 不再附带 TypeScript 捆绑钩子处理器。旧的
`bootstrap-extra-files`, `command-logger`和 `boot-md` 处理器已从产品运行时边界中移除；当你需要本地自动化时，请使用托管钩子模块或工作区钩子。

## 插件钩子

类型化插件 SDK 生命周期钩子已移除。插件不再注册
`before_tool_call`, `before_agent_reply`, `before_install`、模型解析或通过已移除的类型化插件 API 注册消息流钩子；请使用本页中的内部钩子和网页钩子系统进行运营自动化。

## 配置

```json
{
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "my-hook": { "enabled": true }
      }
    }
  }
}
```

每个钩子的环境变量：

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "my-hook": {
          "enabled": true,
          "env": { "MY_CUSTOM_VAR": "value" }
        }
      }
    }
  }
}
```

额外钩子目录：

```json
{
  "hooks": {
    "internal": {
      "load": {
        "extraDirs": ["/path/to/more/hooks"]
      }
    }
  }
}
```

<Note>
旧版 `hooks.internal.handlers` 数组配置格式仍保持向后兼容，但新钩子应使用基于发现机制的系统。
</Note>

## Gateway API 参考

```bash
# List all hooks (add --eligible, --verbose, or --json)
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Show detailed info about a hook
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Show eligibility summary
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Enable/disable
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

## 最佳实践

- **保持处理器快速。** 钩子在命令处理期间运行。对于繁重的工作，使用后台执行配合 `void processInBackground(event)`。
- **优雅地处理错误。** 将风险操作包装在 try/catch 中；不要抛出异常，以便其他处理器能够运行。
- **尽早过滤事件。** 如果事件类型/动作不相关，请立即返回。
- **使用特定的事件键。** 优先使用 `"events": ["command:new"]` 而不是 `"events": ["command"]` 以减少开销。

## 故障排除

### 钩子未被检测到

```bash
# Verify directory structure
ls -la ~/.crawclaw/hooks/my-hook/
# Should show: HOOK.md, handler.ts

# List all discovered hooks
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

### 钩子不符合条件

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

检查是否缺少二进制文件（PATH）、环境变量、配置值或操作系统兼容性。

### 钩子未执行

1. 验证钩子已启用：CrawClaw Desktop 或本地 Gateway API
2. 重启 Gateway 进程以便重新加载钩子。
3. 检查 Gateway 日志： `./scripts/clawlog.sh | grep hook`

## 相关内容

- [Gateway API 参考：钩子](/automation/hooks)
- [网页钩子](/automation/cron-jobs#webhooks)
- [配置](/gateway/configuration-reference#hooks)
