---
read_when:
  - 你想了解 CrawClaw 提供哪些工具
  - 你需要配置、允许或拒绝工具
  - 你在决定使用内置工具、Skills 还是插件
summary: CrawClaw 工具和插件概览：智能体可以做什么以及如何扩展
title: 工具和插件
x-i18n:
  generated_at: "2026-06-05T14:51:34Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 2da6422a803e8f6d3dfb02fd03cb653142790ecd3dbd5db352c504d2bc1de278
  source_path: tools/index.md
  workflow: 15
---

# 工具和插件

智能体在生成文本之外的所有操作都通过**工具**完成。工具是智能体读取文件、运行命令、浏览网页、发送消息以及与设备交互的方式。

## 工具、Skills 和插件

CrawClaw 有三层协同工作的机制：

<Steps>
  <Step title="工具是智能体调用的内容">
    工具是智能体可以调用的类型化函数（例如 `bash`、`browser`、`web_search`、`message`）。CrawClaw 提供一组内置工具和原生工具。

    智能体将工具视为发送到模型 API 的结构化函数定义。

  </Step>

  <Step title="Skills 教智能体何时以及如何做">
    Skill 是一个 markdown 文件（`SKILL.md`），注入到系统提示中。Skills 为智能体提供上下文、约束条件和分步指导，以便有效地使用工具。Skills 存在于你的工作区、共享文件夹中，或打包在插件里。

    [Skills 参考](/tools/skills) | [创建 Skills](/tools/creating-skills)

  </Step>

  <Step title="插件将所有内容打包在一起">
    插件是声明性元数据、配置、Skills 和原生能力的包。生产执行由 Rust 运行时拥有。

    [安装和配置插件](/tools/plugin) | [构建自己的插件](/plugins/building-plugins)

  </Step>
</Steps>

## 内置工具

这些工具随 CrawClaw 一起提供，无需安装任何插件即可使用：

| 工具                                | 功能                                     | 页面                            |
| ----------------------------------- | ---------------------------------------- | ------------------------------- |
| `bash` / `process`                  | 运行 shell 命令，管理后台进程            | [Exec](/tools/exec)             |
| `grep` / `find` / `ls`              | 通过 Rust 运行时搜索和检查工作区文件     | [Exec](/tools/exec)             |
| `browser`                           | 控制 Chromium 浏览器（导航、点击、截图） | [Browser](/tools/browser)       |
| `web_search` / `web_fetch`          | 搜索网页或获取页面内容                   | [Web](/tools/web)               |
| `image`                             | 使用视觉模型分析一张或多张图片           | [Image 工具](/tools/image)      |
| `pdf`                               | 使用原生和回退提取分析 PDF 文件          | [PDF 工具](/tools/pdf)          |
| `tts`                               | 将文本回复转换为音频                     | [文本转语音](/tools/tts)        |
| `read` / `write` / `edit`           | 工作区中的文件 I/O                       |                                 |
| `apply_patch`                       | 多 hunk 文件补丁                         | [应用补丁](/tools/apply-patch)  |
| `message`                           | 跨所有渠道发送消息                       | [智能体发送](/tools/agent-send) |
| `cron`                              | 管理定时任务                             |                                 |
| `sessions_spawn` / `sessions_yield` | 生成子智能体并接收结果                   | [子智能体](/tools/subagents)    |
| `session_status`                    | 检查当前会话状态                         |                                 |

`image` 和 `pdf` 是有条件注册的：只有当 CrawClaw 能够为当前智能体解析可用的媒体支持模型时才会暴露它们。

在授权聊天中使用 `/tools` 检查当前智能体的有效工具集。
`/tools verbose` 还列出不可用的内置工具和警告，包括有风险的 exec 姿态，例如主机执行而无需审批提示。

### 原生工具

- [Lobster](/tools/lobster) — 具有可恢复审批的类型化工作流运行时
- [LLM Task](/tools/llm-task) — 用于结构化输出的纯 JSON LLM 步骤
- [OpenProse](/prose) — 优先 markdown 的工作流编排

## 工具配置

### 允许和拒绝列表

通过配置中的 `tools.allow` / `tools.deny` 控制智能体可以调用哪些工具。拒绝优先于允许。

```json5
{
  tools: {
    allow: ["group:fs", "browser", "web_search"],
    deny: ["bash"],
  },
}
```

### 工具配置文件

`tools.profile` 在应用 `allow`/`deny` 之前设置基础允许列表。
每个智能体覆盖：`agents.list[].tools.profile`。

生命周期门控在策略允许/拒绝之前运行。`full` 移除配置文件限制，但本身不会暴露运行时条件工具或特殊智能体专用工具。

| 配置文件    | 包含内容                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `coding`    | 文件 I/O、bash/process、grep/find/ls、web、sessions_spawn/sessions_yield/session_status、browser、Skills 发现和经验写入 |
| `messaging` | 消息和 session_status                                                                                                   |
| `minimal`   | 仅 session_status                                                                                                       |

### 工具组

在 allow/deny 列表中使用 `group:*` 简写：

| 组                      | 工具                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `group:runtime`         | bash、process、grep、find、ls                                                                             |
| `group:fs`              | read、write、edit、apply_patch                                                                            |
| `group:web`             | web_search、web_fetch                                                                                     |
| `group:sessions`        | sessions_list、sessions_history、sessions_send、sessions_spawn、sessions_yield、subagents、session_status |
| `group:ui`              | browser、canvas                                                                                           |
| `group:automation`      | cron、gateway                                                                                             |
| `group:messaging`       | message                                                                                                   |
| `group:skills`          | discover_skills                                                                                           |
| `group:workflow`        | workflow、workflowize                                                                                     |
| `group:review`          | review_task                                                                                               |
| `group:memory`          | knowledge_recall、knowledge_reflect、knowledge_ingest、knowledge_model_list、knowledge_model_create       |
| `group:session_summary` | session_summary_file_read、session_summary_file_edit                                                      |
| `group:media`           | image、pdf、tts                                                                                           |
| `group:crawclaw`        | 所有内置 CrawClaw 工具（排除插件工具）                                                                    |

组扩展不会绕过生命周期门控。例如，`group:session_summary` 列出的工具仍然仅对其所属特殊智能体可用。

### 提供商特定限制

使用 `tools.byProvider` 限制特定提供商的工具，而不更改全局默认值：

```json5
{
  tools: {
    profile: "coding",
    byProvider: {
      "google-antigravity": { profile: "minimal" },
    },
  },
}
```
