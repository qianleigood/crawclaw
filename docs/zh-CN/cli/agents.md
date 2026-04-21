---
read_when:
  - 你需要多个隔离的智能体（工作区 + 路由 + 认证）
summary: "`crawclaw agents` 的 CLI 参考（列出/状态/添加/删除/绑定/设置身份/harness）"
title: agents
x-i18n:
  generated_at: "2026-02-01T19:58:38Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 30556d81636a9ad8972573cc6b498e620fd266e1dfb16eef3f61096ea62f9896
  source_path: cli/agents.md
  workflow: 14
---

# `crawclaw agents`

管理隔离的智能体（工作区 + 认证 + 路由）。

相关内容：

- 多智能体路由：[多智能体路由](/concepts/multi-agent)
- 智能体工作区：[智能体工作区](/concepts/agent-workspace)

## 示例

```bash
crawclaw agents list
crawclaw agents status
crawclaw agents add work --workspace ~/.crawclaw/workspace-work
crawclaw agents bindings
crawclaw agents bind --agent work --bind telegram:ops
crawclaw agents unbind --agent work --bind telegram:ops
crawclaw agents set-identity --workspace ~/.crawclaw/workspace --from-identity
crawclaw agents set-identity --agent main --avatar avatars/crawclaw.png
crawclaw agents harness report --json
crawclaw agents harness promote-check --baseline baseline.json --candidate candidate.json
crawclaw agents delete work
```

## `agents status`

`crawclaw agents status` 会生成面向运维/排障的智能体汇总视图。

它会合并：

- 本地 session/store 活跃情况
- runtime / task 计数
- stale runtime 计数
- 最近的 guard blocker
- completion blocker
- loop warning bucket / progress warning

示例：

```bash
crawclaw agents status
crawclaw agents status --json
```

## `agents harness`

离线 harness 命令用于在真正推广前评估 loop / completion policy 的变化。

生成内置 scenario 的 report：

```bash
crawclaw agents harness report
crawclaw agents harness report --scenario fix-complete --json
```

把 candidate report 和 baseline 做对比：

```bash
crawclaw agents harness promote-check --baseline baseline.json --candidate candidate.json
crawclaw agents harness promote-check --baseline baseline.json --candidate candidate.json --json
```

`promote-check` 不会直接修改 live policy；它只会输出离线 verdict：
`promote`、`shadow` 或 `reject`。

## 路由绑定

使用 routing bindings 可以把入站通道流量固定到某个 agent。

列出 bindings：

```bash
crawclaw agents bindings
crawclaw agents bindings --agent work
crawclaw agents bindings --json
```

添加 bindings：

```bash
crawclaw agents bind --agent work --bind telegram:ops --bind discord:guild-a
```

如果你省略 `accountId`（`--bind <channel>`），CrawClaw 会在可用时从通道默认配置和插件 setup hooks 中解析。

### 绑定作用域行为

- 不带 `accountId` 的 binding 只匹配该通道的默认 account。
- `accountId: "*"` 是通道级 fallback（所有 account），优先级低于显式 account binding。
- 如果同一个 agent 已经有一个不带 `accountId` 的 channel binding，后续再绑定显式或可解析的 `accountId` 时，CrawClaw 会原地升级这条 binding，而不是新增重复项。

示例：

```bash
# 初始的仅 channel binding
crawclaw agents bind --agent work --bind telegram

# 后续升级为 account-scoped binding
crawclaw agents bind --agent work --bind telegram:ops
```

升级后，这条 binding 只会路由 `telegram:ops`。如果还想保留默认 account 路由，需要显式再加一条（例如 `--bind telegram:default`）。

移除 bindings：

```bash
crawclaw agents unbind --agent work --bind telegram:ops
crawclaw agents unbind --agent work --all
```

## 身份文件

每个智能体工作区可以在工作区根目录包含一个 `IDENTITY.md`：

- 示例路径：`~/.crawclaw/workspace/IDENTITY.md`
- `set-identity --from-identity` 从工作区根目录读取（或从显式指定的 `--identity-file` 读取）

头像路径相对于工作区根目录解析。

## 设置身份

`set-identity` 将字段写入 `agents.list[].identity`：

- `name`
- `theme`
- `emoji`
- `avatar`（工作区相对路径、http(s) URL 或 data URI）

从 `IDENTITY.md` 加载：

```bash
crawclaw agents set-identity --workspace ~/.crawclaw/workspace --from-identity
crawclaw agents set-identity --identity-file ~/.crawclaw/workspace/IDENTITY.md --agent main
```

显式覆盖字段：

```bash
crawclaw agents set-identity --agent main --name "CrawClaw" --emoji "🦀" --avatar avatars/crawclaw.png
```

配置示例：

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "CrawClaw",
          theme: "space lobster",
          emoji: "🦀",
          avatar: "avatars/crawclaw.png",
        },
      },
    ],
  },
}
```
