---
read_when:
  - 调整提权模式默认值、允许列表或斜杠命令行为
summary: 在 Gateway 网关上运行经过审批的 exec 命令，带有可配置的审批关卡
title: 提权模式
x-i18n:
  generated_at: "2026-06-10T18:58:14Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 3dedcc151d4d97eef3fcc6e731c9e9f0e44d921542a710f6d471d91666ecd945
  source_path: tools/elevated.md
  workflow: 15
---

# 提权模式

提权模式允许经过审批的发件人在 Gateway 网关上运行 `exec` 命令，并带有可配置的审批关卡。

<Info>
</Info>

## 指令

使用斜杠命令控制每个会话的提权模式：

| 指令             | 功能                                     |
| ---------------- | ---------------------------------------- |
| `/elevated on`   | 在网关主机上运行，保留 exec 审批         |
| `/elevated ask`  | 与 `on` 相同（别名）                     |
| `/elevated full` | 在网关主机上运行 **并且** 跳过 exec 审批 |

也可以使用 `/elev on|off|ask|full`。

发送不带参数的 `/elevated` 可查看当前级别。

## 工作原理

<Steps>
  <Step title="检查可用性">
    提权必须在配置中启用，且发件人必须在允许列表中：

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
    发送仅包含指令的消息来设置会话默认值：

    ```
    /elevated full
    ```

    或内联使用（仅对该消息生效）：

    ```
    /elevated on run the deployment script
    ```

  </Step>
  <Step title="命令在主机上运行">
    启用提权后，`exec` 调用会路由到网关主机，但已配置的审批规则仍然适用。
  </Step>
</Steps>

## 解析顺序

1. **消息上的内联指令**（仅对该消息生效）
2. **会话覆盖**（通过发送仅包含指令的消息设置）
3. **全局默认值**（配置中的 `agents.defaults.elevatedDefault`）

## 可用性与允许列表

- **全局关卡**：`tools.elevated.enabled`（必须为 `true`）
- **发件人允许列表**：`tools.elevated.allowFrom`，包含每个渠道的列表
- **每个智能体关卡**：`agents.list[].tools.elevated.enabled`（只能进一步限制）
- **每个智能体允许列表**：`agents.list[].tools.elevated.allowFrom`（发件人必须同时匹配全局 + 每个智能体的规则）
- **QQBot 回退**：如果省略 `tools.elevated.allowFrom.qqbot`，则使用 `channels.qqbot.allowFrom` 作为回退
- **所有关卡都必须通过**；否则提权将被视为不可用

允许列表条目格式：

| 前缀                    | 匹配项                        |
| ----------------------- | ----------------------------- |
| （无）                  | 发件人 ID、E.164 或 From 字段 |
| `name:`                 | 发件人显示名称                |
| `username:`             | 发件人用户名                  |
| `tag:`                  | 发件人标签                    |
| `id:`、`from:`、`e164:` | 显式身份定位                  |

## 提权模式不控制的内容

- **工具策略**：如果 `exec` 被工具策略拒绝，提权模式无法覆盖
- **与 `/exec` 分离**：`/exec` 指令为已授权发件人调整每个会话的 exec 默认值，无需提权模式

## 相关

- [Exec 工具](/tools/exec) — shell 命令执行
- [Exec 审批](/tools/exec-approvals) — 审批和允许列表系统
- [安全](/gateway/security)
