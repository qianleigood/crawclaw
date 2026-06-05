---
read_when:
  - 调整提权模式默认值、允许列表或斜杠命令行为
title: 提权模式
x-i18n:
  generated_at: "2026-06-05T14:51:11Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 6b3240b3693687f1f52ddba3e33fc3861592d8ac231cb3d0e7dbed1c8f2d28c6
  source_path: tools/elevated.md
  workflow: 15
---

# 提权模式

在 Gateway 网关主机上运行命令，而不是在本地机器上运行，并具有可配置的审批门控。

<Info>
</Info>

## 指令

使用斜杠命令控制每个会话的提权模式：

| 指令             | 作用                                      |
| ---------------- | ----------------------------------------- |
| `/elevated on`   | 在 Gateway 主机上运行，保留 exec 审批     |
| `/elevated ask`  | 与 `on` 相同（别名）                      |
| `/elevated full` | 在 Gateway 主机上运行**并**跳过 exec 审批 |

也可用作 `/elev on|off|ask|full`。

发送 `/elevated` 不带参数以查看当前级别。

## 工作原理

<Steps>
  <Step title="检查可用性">
    提权必须在配置中启用，发送者必须在允许列表中：

    ```json5
    {
      tools: {
        elevated: {
          enabled: true,
          allowFrom: {
            qqbot: ["user-id-123"],
            weixin: ["+15555550123"],
          },
        },
      },
    }
    ```

  </Step>

  <Step title="设置级别">
    发送仅包含指令的消息以设置会话默认值：

    ```
    /elevated full
    ```

    或在消息中内联使用（仅适用于该消息）：

    ```
    /elevated on run the deployment script
    ```

  </Step>

  <Step title="命令在主机上运行">
    当提权激活时，`exec` 调用会路由到 Gateway 主机，配置中的命令执行审批规则仍然适用。
  </Step>
</Steps>

## 解析顺序

1. 消息上的**内联指令**（仅适用于该消息）
2. **会话覆盖**（通过发送仅包含指令的消息设置）
3. **全局默认**（配置中的 `agents.defaults.elevatedDefault`）

## 可用性和允许列表

- **全局门控**：`tools.elevated.enabled`（必须为 `true`）
- **发送者允许列表**：`tools.elevated.allowFrom`，包含每个渠道的列表
- **每个智能体门控**：`agents.list[].tools.elevated.enabled`（只能进一步限制）
- **每个智能体允许列表**：`agents.list[].tools.elevated.allowFrom`（发送者必须同时匹配全局和每个智能体）
- **QQBot 回退**：如果 `tools.elevated.allowFrom.qqbot` 被省略，则使用 `channels.qqbot.allowFrom` 作为回退
- **所有门控必须通过**；否则提权被视为不可用

允许列表条目格式：

| 前缀                    | 匹配                          |
| ----------------------- | ----------------------------- |
| （无）                  | 发送者 ID、E.164 或 From 字段 |
| `name:`                 | 发送者显示名称                |
| `username:`             | 发送者用户名                  |
| `tag:`                  | 发送者标签                    |
| `id:`、`from:`、`e164:` | 显式身份定位                  |

## 提权不控制的内容

- **工具策略**：如果 `exec` 被工具策略拒绝，提权无法覆盖它
- **与 `/exec` 分开**：`/exec` 指令为授权发送者调整每个会话的 exec 默认值，不需要提权模式

## 相关

- [Exec 工具](/tools/exec) — shell 命令执行
- [Exec 审批](/tools/exec-approvals) — 审批和允许列表系统
- [安全](/gateway/security)
