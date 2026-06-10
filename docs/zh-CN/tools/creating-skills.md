---
read_when:
  - 你正在你的工作区中创建一个新的自定义 Skill
  - 你需要基于 SKILL.md 的 Skills 快速入门工作流
summary: 使用 SKILL.md 构建并测试自定义工作区 Skills
title: 创建 Skills
x-i18n:
  generated_at: "2026-06-10T19:33:13Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 37d532ddc004e51086b4ceec6e61753ae4a26fd90eae375d7287d75efaf9ff52
  source_path: tools/creating-skills.md
  workflow: 15
---

# 创建 Skills

Skills 教智能体何时以及如何使用工具。每个 Skill 是一个目录，目录中包含带有 YAML frontmatter 和 Markdown 指令的 `SKILL.md` 文件。

关于 Skills 的加载和优先级，请参阅 [Skills](/tools/skills)。

## 创建你的第一个 Skill

<Steps>
  <Step title="创建 Skill 目录">
    Skills 位于你的工作区中。创建一个新文件夹：

    ```bash
    mkdir -p ~/.crawclaw/workspace/skills/hello-world
    ```

  </Step>

  <Step title="编写 SKILL.md">
    在该目录内创建 `SKILL.md`。frontmatter 定义元数据，而 markdown 正文包含智能体的指令。

    ```markdown
    ---
    name: hello_world
    description: A simple skill that says hello.
    ---

    # Hello World Skill

    When the user asks for a greeting, use the `echo` tool to say
    "Hello from your custom skill!".
    ```

  </Step>

  <Step title="添加工具（可选）">
    你可以在 frontmatter 中定义自定义工具 schemas，或指示智能体使用现有的系统工具（如 `exec` 或 `browser`）。Skills 也可以随插件一起打包，与其文档化的工具一同分发。

  </Step>

  <Step title="加载 Skill">
    启动一个新会话，让 CrawClaw 识别该 Skill：

    ```bash
    # 在聊天中
    /new
    ```

    或重启 CrawClaw Desktop 或 Gateway 进程以加载新 Skill。

    验证 Skill 已加载：

    打开 Skills 设置页，或让新的智能体回合针对问候任务使用
    `discover_skills`，确认结果中出现 `hello_world`。

  </Step>

  <Step title="测试它">
    发送一条应该触发该 Skill 的消息：

    ```text
    使用 hello_world skill 打个招呼。
    ```

    也可以直接与智能体聊天并请求问候。

  </Step>
</Steps>

## Skill 元数据参考

YAML frontmatter 支持以下字段：

| 字段                                | 必填 | 描述                                           |
| ----------------------------------- | ---- | ---------------------------------------------- |
| `name`                              | 是   | 唯一标识符（snake_case）                       |
| `description`                       | 是   | 显示给智能体的单行描述                         |
| `metadata.crawclaw.os`              | 否   | 操作系统过滤器（`["darwin"]`、`["linux"]` 等） |
| `metadata.crawclaw.requires.bins`   | 否   | PATH 上必需的二进制文件                        |
| `metadata.crawclaw.requires.config` | 否   | 必需的配置键                                   |

## 最佳实践

- **保持简洁** — 指示模型 _要做什么_，而不是如何成为一个 AI
- **安全第一** — 如果你的 Skill 使用 `exec`，确保提示不允许来自不可信输入的任意命令注入
- **本地测试** — 分享前使用 CrawClaw Desktop 或本地 Gateway API 测试
- **使用 ClawHub** — 在 [ClawHub](https://clawhub.com) 浏览和贡献 Skills

## Skills 存放位置

| 位置                         | 优先级 | 范围               |
| ---------------------------- | ------ | ------------------ |
| `\<workspace\>/skills/`      | 最高   | 按智能体           |
| `~/.crawclaw/skills/`        | 中等   | 共享（所有智能体） |
| 捆绑（随 CrawClaw 一起发布） | 最低   | 全局               |
| `skills.load.extraDirs`      | 最低   | 自定义共享文件夹   |

## 相关

- [Skills 参考](/tools/skills) — 加载、优先级和门控规则
- [Skills 配置](/tools/skills-config) — `skills.*` 配置 schema
- [ClawHub](/tools/clawhub) — 公共 Skill 注册表
- [构建插件](/plugins/building-plugins) — 插件可以附带 Skills
