---
read_when:
  - 编辑系统提示文本、工具列表或时间/心跳部分
  - 更改工作区引导或 Skills 注入行为
summary: CrawClaw 系统提示包含的内容及其组装方式
title: 系统提示
x-i18n:
  generated_at: "2026-06-11T14:43:12Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 672f239d284f8b029fbda98caa09db3e7dc6ca558f3961b80c84b5b6533d13a5
  source_path: concepts/system-prompt.md
  workflow: 15
---

# 系统提示

CrawClaw 为每个智能体运行构建自定义系统提示。该提示**归 CrawClaw 所有**，由 Rust 运行时路径组装。

## 结构

提示有意设计得紧凑，使用固定部分：

- **工具**：当前工具列表 + 简短描述。
- **安全**：简短的安全护栏提醒，避免寻求权力或绕过监督的行为。
- **Skills**（当可用时）：告诉模型如何按需加载 Skill 指令。
- **CrawClaw 自我更新**：如何运行 `config.apply` 和 `update.run`。
- **工作区**：工作目录（`agents.defaults.workspace`）。
- **文档**：CrawClaw 文档的本地路径（仓库或 npm 包）以及何时阅读。
- **工作区文件（注入）**：表示引导文件包含在下方。
- **当前日期和时间**：用户本地时间、时区和时间格式。
- **回复标签**：支持提供商的可选回复标签语法。
- **心跳**：当唤醒运行提供心跳提示时，事件驱动的主会话唤醒提示和确认行为。
- **运行时**：主机、操作系统、节点、模型、仓库根目录（当检测到时）、思考级别（一行）。
- **推理**：当前可见性级别 + /reasoning 切换提示。

## 提示模式

CrawClaw 可以为子智能体渲染更小的系统提示。运行时为每次运行设置 `promptMode`（非用户面向配置）：

- `full`（默认）：包含上述所有部分。
- `minimal`：用于子智能体；省略 **Skills**、**记忆召回**、**CrawClaw 自我更新**、**模型别名**、**用户身份**、**回复标签**、**消息传递**、**静默回复**和遗留的**心跳**。工具、**安全**、上下文保持可用。
- `none`：仅返回基础身份行。

当 `promptMode=minimal` 时，额外注入的提示标记为 **子智能体上下文** 而非 **群聊上下文**。

## 工作区引导注入

引导文件被修剪并附加到 **项目上下文** 下，以便模型看到单一规范的工作区指令文件，无需显式读取：

- `AGENTS.md`

CrawClaw 不再在普通聊天轮次中默认注入这些文件：

- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `MEMORY.md` / `memory.md`

这将默认引导集保持为单个文件，避免在每个轮次中浪费提示预算在 persona、启动、工具说明、身份、事件唤醒或记忆文件上。

> **注意：** `memory/*.md` 每日文件**不会**自动注入。持久记忆召回在提示组装期间选择有界限的相关笔记，而非在每个轮次中烧掉整个记忆目录的上下文。

大文件会被截断并添加标记。最大文件大小由 `agents.defaults.bootstrapMaxChars` 控制（默认值：20000）。所有引导文件注入的引导内容总量受 `agents.defaults.bootstrapTotalMaxChars` 限制（默认值：150000）。缺失文件注入一个简短的缺失文件标记。当发生截断时，CrawClaw 可以在项目上下文中注入警告块；通过 `agents.defaults.bootstrapPromptTruncationWarning` 控制此行为（`off`、`once`、`always`；默认值：`once`）。

子智能体和定时会话也保持在相同的单文件引导上：`AGENTS.md`。

当前公共钩子表面不会改变引导文件列表。SDK `Setup`、`SessionStart` 和 `UserPromptSubmit` 钩子可以在运行周围添加上下文，但引导文件选择仍由运行时拥有。

要检查每个注入文件的贡献量（原始 vs 注入、截断，加上工具 schema 开销），请使用 `/context list` 或 `/context detail`。参见[上下文](/concepts/context)。

## 提示排序和动态上下文

CrawClaw 在动态系统上下文之前渲染稳定的系统提示部分。这保持了长期存在的提示前缀更易于缓存，同时仍在同一请求中将记忆召回、钩子上下文和其他每轮 `system_context` 部分作为系统可见指令发送。

动态记忆上下文附加在基础系统提示之后。该上下文可能每个轮次都不同，因为持久记忆、经验召回、钩子和路由诊断都是查询相关的。将其保持在稳定前缀之后，避免仅仅因为召回结果改变而使整个提示前缀失效。

## 时间处理

当用户时区已知时，系统提示包含专用的**当前日期和时间**部分。为保持提示缓存稳定，它现在仅包含**时区**（无动态时钟或时间格式）。

当智能体需要当前时间时使用 `session_status`；状态卡包含时间戳行。

通过以下配置：

- `agents.defaults.userTimezone`
- `agents.defaults.timeFormat`（`auto` | `12` | `24`）

参见[日期和时间](/date-time)了解完整行为详情。

## Skills

当存在符合条件的 Skills 时，CrawClaw 在 Rust 运行时上下文披露中呈现最多五个相关 Skill 摘要。每个摘要包含 Skill 名称和描述。完整的 `SKILL.md` 内容仅在模型通过运行时 Skill 工具明确加载 Skill 后才添加，加载的 Skill 内容在进入上下文之前被限制。

这保持了基础提示较小，同时仍支持有针对性的 Skill 使用。

## 文档

当可用时，系统提示包含一个**文档**部分，指向本地 CrawClaw 文档目录（仓库工作区中的 `docs/` 或捆绑的 npm 包文档），还注明了公共镜像、源仓库、社区 community chat 和 ClawHub（[https://clawhub.ai](https://clawhub.ai)）用于 Skills 发现。提示指示模型首先咨询本地文档以了解 CrawClaw 行为、命令、配置或架构，并在可能时运行 CrawClaw Desktop 或本地 Gateway API 本身（仅在缺乏访问权限时才询问用户）。
