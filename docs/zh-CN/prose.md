---
read_when:
  - 你想要运行或编写 .prose 工作流
  - 你想要启用 OpenProse 插件
  - 你需要理解状态存储
summary: OpenProse：.prose 工作流、斜杠命令和 CrawClaw 中的状态管理
title: OpenProse
x-i18n:
  generated_at: "2026-06-05T14:42:30Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: be3236049d5d06ecd39ce8106e27df564607041fed94fdbfc9cfb4e499437d37
  source_path: prose.md
  workflow: 15
---

# OpenProse

OpenProse 是一种可移植的、优先使用 Markdown 的工作流格式，用于编排 AI 会话。在 CrawClaw 中，它作为插件提供，会安装一个 OpenProse skill 包以及一个 `/prose` 斜杠命令。程序存在于 `.prose` 文件中，可以生成多个具有显式控制流的子智能体。

官方网站：[https://www.prose.md](https://www.prose.md)

## 它能做什么

- 具有显式并行性的多智能体研究 + 综合。
- 可重复的、审批安全的workflow（代码审查、事件分类、内容管道）。
- 可在支持的智能体运行时之间运行的、可重用的 `.prose` 程序。

## 安装和启用

捆绑插件默认禁用。启用 OpenProse：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 实现自动化。

启用插件后重启 Gateway。

开发/本地检出：CrawClaw Desktop 或本地 Gateway API

相关文档：[插件](/tools/plugin)、[插件清单](/plugins/manifest)、[Skills](/tools/skills)。

## 斜杠命令

OpenProse 将 `/prose` 注册为用户可调用的 skill 命令。它路由到 OpenProse VM 指令，并在幕后使用 CrawClaw 工具。

常用命令：

```
/prose help
/prose run <file.prose>
/prose run <handle/slug>
/prose run <https://example.com/file.prose>
/prose compile <file.prose>
/prose examples
/prose update
```

## 示例：一个简单的 `.prose` 文件

```prose
# 研究 + 综合，两个智能体并行运行。

input topic: "我们应该研究什么？"

agent researcher:
  model: sonnet
  prompt: "你深入研究并引用来源。"

agent writer:
  model: opus
  prompt: "你写一份简洁的摘要。"

parallel:
  findings = session: researcher
    prompt: "研究 {topic}。"
  draft = session: writer
    prompt: "总结 {topic}。"

session "将发现和草稿合并为最终答案。"
context: { findings, draft }
```

## 文件位置

OpenProse 在你工作区的 `.prose/` 下维护状态：

```
.prose/
├── .env
├── runs/
│   └── {YYYYMMDD}-{HHMMSS}-{random}/
│       ├── program.prose
│       ├── state.md
│       ├── bindings/
│       └── agents/
└── agents/
```

用户级持久化智能体位于：

```
~/.prose/agents/
```

## 状态模式

OpenProse 支持多种状态后端：

- **filesystem**（默认）：`.prose/runs/...`
- **in-context**：临时的，适用于小程序
- **sqlite**（实验性）：需要 `sqlite3` 二进制文件
- **postgres**（实验性）：需要 `psql` 和连接字符串

注意事项：

- sqlite/postgres 是可选的且处于实验阶段。
- postgres 凭证会流入子智能体日志；使用专用的、最低权限的数据库。

## 远程程序

`/prose run <handle/slug>` 解析为 `https://p.prose.md/<handle>/<slug>`。
直接 URL 按原样获取。这使用 `web_fetch` 工具（或 `exec` 用于 POST）。

## CrawClaw 运行时映射

OpenProse 程序映射到 CrawClaw 原语：

| OpenProse 概念      | CrawClaw 工具    |
| ------------------- | ---------------- |
| 生成会话 / 任务工具 | `sessions_spawn` |
| 文件读取/写入       | `read` / `write` |
| Web 获取            | `web_fetch`      |

如果你的工具白名单阻止了这些工具，OpenProse 程序将失败。参见 [Skills 配置](/tools/skills-config)。

## 安全和审批

像对待代码一样对待 `.prose` 文件。运行前审查。使用 CrawClaw 工具白名单和审批门控来控制副作用。

对于确定性的、审批门控的workflow，请与 [Lobster](/tools/lobster) 比较。
