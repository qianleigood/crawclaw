---
read_when:
  - 添加或修改 skills
  - 更改 skill 门控或加载规则
summary: Skills：托管与工作区、门控规则以及配置/环境变量连接
title: Skills
x-i18n:
  generated_at: "2026-06-11T14:43:12Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 3173acc1fdc879eb226ab29515b4d2405494249be8bf4883d36b33c7f5b7c6c5
  source_path: tools/skills.md
  workflow: 15
---

# Skills（CrawClaw）

CrawClaw 使用 **[AgentSkills](https://agentskills.io) 兼容**的 skill 文件夹来教智能体如何使用工具。每个 skill 都是一个包含 `SKILL.md` 的目录，其中包含 YAML frontmatter 和说明文档。CrawClaw 加载**捆绑 skills** 以及可选的本地覆盖，并根据平台、CPU 架构、环境、配置和二进制文件存在性在加载时进行筛选。

## 位置和优先级

CrawClaw 从以下来源加载 skills：

1. **额外 skill 文件夹**：通过 `skills.load.extraDirs` 配置
2. **捆绑 skills**：随安装包分发（npm 包或 CrawClaw.app）
3. **托管/本地 skills**：`~/.crawclaw/skills`
4. **个人智能体 skills**：`~/.agents/skills`
5. **项目智能体 skills**：`<workspace>/.agents/skills`
6. **工作区 skills**：`<workspace>/skills`

如果 skill 名称发生冲突，优先级为：

`<workspace>/skills`（最高）→ `<workspace>/.agents/skills` → `~/.agents/skills` → `~/.crawclaw/skills` → 捆绑 skills → `skills.load.extraDirs`（最低）

## 智能体专属与共享 skills

在**多智能体**设置中，每个智能体都有自己的工作区。这意味着：

- **智能体专属 skills** 仅存在于该智能体的 `<workspace>/skills` 中。
- **项目智能体 skills** 位于 `<workspace>/.agents/skills`，在普通工作区 `skills/` 文件夹之前应用于该工作区。
- **个人智能体 skills** 位于 `~/.agents/skills`，适用于该机器上的所有工作区。
- **共享 skills** 位于 `~/.crawclaw/skills`（托管/本地），对同一机器上的**所有智能体**可见。
- 如果你希望多个智能体使用通用的 skills 包，也可以通过 `skills.load.extraDirs` 添加**共享文件夹**（优先级最低）。

如果同一 skill 名称存在于多个位置，则应用通常的优先级规则：工作区优先，然后是项目智能体 skills、个人智能体 skills、托管/本地、捆绑 skills，最后是额外 dirs。

## 插件 + skills

插件可以通过在 `crawclaw.plugin.json` 中列出 `skills` 目录来提供自己的 skills（路径相对于插件根目录）。插件启用时加载插件 skills。目前这些目录合并到与 `skills.load.extraDirs` 相同的低优先级路径中，因此同名的捆绑、托管、智能体或工作区 skill 会覆盖它们。
你可以通过插件配置条目上的 `metadata.crawclaw.requires.config` 对其进行门控。参见[插件](/tools/plugin)了解发现/配置，以及[工具](/tools)了解这些 skills 提供的工具界面。

## ClawHub（安装 + 同步）

ClawHub 是 CrawClaw 的公共 skills 注册中心。访问 [https://clawhub.ai](https://clawhub.ai)。使用原生 CrawClaw Desktop 或本地 Gateway API 命令来发现/安装/更新 skills，或在需要发布/同步工作流时使用独立的 `clawhub` CLI。
完整指南：[ClawHub](/tools/clawhub)。

常见流程：

- 在工作区中安装 skill：
  - CrawClaw Desktop 或本地 Gateway API
- 更新所有已安装的 skills：
  - CrawClaw Desktop 或本地 Gateway API
- 同步（扫描 + 发布更新）：
  - `clawhub sync --all`

原生 CrawClaw Desktop 或本地 Gateway API 安装到活动工作区的 `skills/` 目录。独立的 `clawhub` CLI 也安装到当前工作目录下的 `./skills`（或回退到配置的 CrawClaw 工作区）。CrawClaw 在下次会话时将其识别为 `<workspace>/skills`。

## 安全注意事项

- 将第三方 skills 视为**不受信任的代码**。在启用之前先阅读它们。
- 工作区和 extra-dir skill 发现仅接受 skill 根目录和 `SKILL.md` 文件，其解析后的真实路径保持在配置的根目录内。
- Gateway 支持的 skill 依赖安装（`skills.install`、新手引导和 Skills 设置 UI）在执行安装程序元数据之前运行内置的危险代码扫描器。`critical` 级别的发现默认阻止，除非调用方明确设置危险覆盖；可疑发现仍仅警告。
- CrawClaw Desktop 或本地 Gateway API 不同：它将 ClawHub skill 文件夹下载到工作区，不使用上述安装程序元数据路径。
- `skills.entries.*.env` 和 `skills.entries.*.apiKey` 将密钥注入**主机**进程
- 有关更广泛的威胁模型和检查清单，请参见[安全](/gateway/security)。

## 格式（AgentSkills 兼容）

`SKILL.md` 必须至少包含：

```markdown
---
name: image-lab
description: 通过提供商支持的工作流生成或编辑图像
---
```

注意事项：

- 我们遵循 AgentSkills 规范的布局和意图。
- Rust 智能体运行时仅支持**单行** frontmatter 键。
- `metadata` 应该是**单行 JSON 对象**。
- 在说明文档中使用 `{baseDir}` 引用 skill 文件夹路径。
- 可选的 frontmatter 键：
  - `homepage` — 在 macOS Skills UI 中显示为“Website”的 URL（也支持通过 `metadata.crawclaw.homepage`）。
  - `user-invocable` — `true|false`（默认：`true`）。当为 `true` 时，该 skill 作为用户斜杠命令公开。
  - `disable-model-invocation` — `true|false`（默认：`false`）。当为 `true` 时，该 skill 不包含在模型提示词中（仍可通过用户调用使用）。
  - `command-dispatch` — `tool`（可选）。当设置为 `tool` 时，斜杠命令绕过模型直接分派到工具。
  - `command-tool` — 设置 `command-dispatch: tool` 时要调用的工具名称。
  - `command-arg-mode` — `raw`（默认）。对于工具分派，将原始参数字符串转发给工具（无核心解析）。

    工具使用以下参数调用：
    `{ command: "<raw args>", commandName: "<斜杠命令>", skillName: "<skill 名称>" }`。

## 门控（加载时过滤器）

CrawClaw 使用 `metadata`（单行 JSON）在**加载时筛选 skills**：

```markdown
---
name: image-lab
description: 通过提供商支持的工作流生成或编辑图像
metadata:
  {
    "crawclaw":
      {
        "requires": { "bins": ["uv"], "env": ["GEMINI_API_KEY"], "config": ["browser.enabled"] },
        "primaryEnv": "GEMINI_API_KEY",
      },
  }
---
```

`metadata.crawclaw` 下的字段：

- `always: true` — 始终包含该 skill（跳过其他门控）。
- `emoji` — macOS Skills UI 使用的可选表情符号。
- `homepage` — 在 macOS Skills UI 中显示为“Website”的可选 URL。
- `os` — 可选的平台列表（`darwin`、`linux`、`win32`）。如果设置，该 skill 仅在那些操作系统上可用。
- `arch` — 可选的 Node CPU 架构列表（`arm64`、`x64` 等）。如果设置，该 skill 仅在那些架构上可用。
- `requires.bins` — 列表；每个都必须存在于 `PATH` 上。
- `requires.anyBins` — 列表；至少一个必须存在于 `PATH` 上。
- `requires.env` — 列表；环境变量必须存在**或**在配置中提供。
- `requires.config` — 必须为真的 `crawclaw.json` 路径列表。
- `primaryEnv` — 与 `skills.entries.<name>.apiKey` 关联的环境变量名。
- `install` — macOS Skills UI 使用的可选安装程序规格数组（brew/node/go/uv/download）。

- `requires.bins` 在 skill 加载时在**主机**上检查。
  在该运行时通过正常的配置流程安装后再启用该 skill。
  示例：`summarize` skill（`skills/summarize/SKILL.md`）需要 `summarize` CLI

安装程序示例：

```markdown
---
name: gemini
description: 使用 Gemini CLI 进行编码辅助和 Google 搜索查询。
metadata:
  {
    "crawclaw":
      {
        "emoji": "♊️",
        "requires": { "bins": ["gemini"] },
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "gemini-cli",
              "bins": ["gemini"],
              "label": "安装 Gemini CLI（brew）",
            },
          ],
      },
  }
---
```

注意事项：

- 如果列出了多个安装程序，Gateway 选择**单个**首选选项（可用时为 brew，否则为 node）。
- 如果所有安装程序都是 `download`，CrawClaw 列出每个条目，以便你查看可用的制品。
- 安装程序规格可以包含 `os: ["darwin"|"linux"|"win32"]` 来按平台过滤选项。
- Node 安装遵循 `crawclaw.json` 中的 `skills.install.nodeManager`（默认：npm；选项：npm/pnpm/yarn/bun）。
  这仅影响 **skill 安装**；Gateway 运行时仍应为 Node
  （Bun 不推荐用于 Weixin/Feishu）。
- Go 安装：如果 `go` 缺失且 `brew` 可用，Gateway 会先通过 Homebrew 安装 Go，并在可能时将 `GOBIN` 设置为 Homebrew 的 `bin`。
- 下载安装：`url`（必需）、`archive`（`tar.gz` | `tar.bz2` | `zip`）、`extract`（默认：检测到 archive 时自动提取）、`stripComponents`、`targetDir`（默认：`~/.crawclaw/tools/<skillKey>`）。

如果没有 `metadata.crawclaw`，该 skill 始终符合条件（除非在配置中禁用或被捆绑 skills 的 `skills.allowBundled` 阻止）。

## 配置覆盖（`~/.crawclaw/crawclaw.json`）

捆绑/托管 skills 可以切换并提供环境变量值：

```json5
{
  skills: {
    entries: {
      "image-lab": {
        enabled: true,
        apiKey: { source: "env", provider: "default", id: "GEMINI_API_KEY" }, // 或明文字符串
        env: {
          GEMINI_API_KEY: "GEMINI_KEY_HERE",
        },
        config: {
          endpoint: "https://example.invalid",
          model: "nano-pro",
        },
      },
      peekaboo: { enabled: true },
      sag: { enabled: false },
    },
  },
}
```

注意：如果 skill 名称包含连字符，请对键加引号（JSON5 允许带引号的键）。

此处的 skill 示例适用于自定义或第三方工作流。

对于原生图像分析，请使用带有 `agents.defaults.imageModel` 的 `image` 工具。

配置键默认匹配 **skill 名称**。如果 skill 定义了 `metadata.crawclaw.skillKey`，请在 `skills.entries` 下使用该键。

规则：

- `enabled: false` 禁用该 skill，即使它已捆绑/安装。
- `env`：仅在变量尚未在进程中设置时注入。
- `apiKey`：对于声明 `metadata.crawclaw.primaryEnv` 的 skills 的便捷方式。
  支持明文字符串或 SecretRef 对象（`{ source, provider, id }`）。
- `config`：自定义 per-skill 字段的可选包；自定义键必须位于此处。
- `allowBundled`：仅适用于**捆绑** skills 的可选允许列表。如果设置，则仅列表中的捆绑 skills 符合条件（托管/工作区 skills 不受影响）。

## 环境变量注入（每次智能体运行）

当智能体运行启动时，CrawClaw：

1. 读取 skill 元数据。
2. 将任何 `skills.entries.<key>.env` 或 `skills.entries.<key>.apiKey` 应用到
   `process.env`。
3. 使用**符合条件的** skills 构建系统提示词。
4. 运行结束后恢复原始环境。

这是**限定在智能体运行范围内**，而不是全局 shell 环境。

## 捆绑 skill 依赖项

捆绑的核心 skill 辅助依赖项由原生运行时和提交的需求锁定文件拥有。

捆绑核心 skills 的规则：

- 将共享 Python 包版本固定放在 `skills/.runtime/requirements.lock.txt` 中。
- 不要为 skill 依赖项添加 TypeScript 安装或修复钩子。
- 如果缺少运行时，报告必须提供它的原生运行时或显式用户配置。

平台特定的捆绑 skill 运行时应同时声明平台元数据和安装时策略。例如，`openai-whisper` 声明 `os: ["darwin"]` 和 `arch: ["arm64"]`，其 MLX Whisper 运行时仅在 macOS Apple Silicon 上安装。

## 会话快照（性能）

CrawClaw 在会话**启动时快照符合条件的 skills**，并在同一会话的后续轮次中重用该列表。对 skills 或配置的更改在下一次新会话时生效。

当启用 skills 监视器或出现新的符合条件的远程节点时，Skills 也可以在会话中刷新（见下文）。可以将其视为**热重载**：刷新的列表在下一个智能体轮次时被获取。

## 语义 skill 发现

CrawClaw 在查找任务的 skills 时可以在词法回退之前使用嵌入和重新排序。交互式 CrawClaw Desktop 或本地 Gateway API 可以在 **Skills** 步骤中配置本地 Ollama 嵌入。这**不会**改变主聊天模型。

每个 skill 的向量文本有意与触发面保持一致：skill 名称、触发说明以及 skill 文件或目录基名。完整的 `SKILL.md` 正文不会被嵌入，因此 `description` 字段应保持简洁且聚焦于触发器。

Skills 步骤可以选择：

- `nomic-embed-text`：默认，较小的下载量，适用于大多数笔记本电脑和简短的 skill 描述。
- `qwen3-embedding:0.6b`：更强的多语言和代码检索能力，下载量适中。
- `mxbai-embed-large`：当额外的磁盘和内存可接受时，用于更大规模的英语检索模型。

如果选定的嵌入模型在本地缺失，CrawClaw 会通过 Ollama 自动拉取，然后再嵌入 skills。

手动配置：

```json5
{
  skills: {
    discovery: {
      semantic: {
        enabled: true,
        provider: "ollama",
        model: "nomic-embed-text",
      },
    },
  },
}
```

## Skills 监视器（自动刷新）

默认情况下，CrawClaw 监视 skill 文件夹，并在 `SKILL.md` 文件更改时更新 skills 快照。在 `skills.load` 下配置：

```json5
{
  skills: {
    load: {
      watch: true,
      watchDebounceMs: 250,
    },
  },
}
```

## Token 影响（skills 列表）

当 skills 符合条件时，CrawClaw 在 Rust 运行时上下文披露中显示最多五个相关的 skill 摘要。提示词成本是显示的 skill 名称和描述的文本成本，加上小型披露包装器。

默认情况下不会注入完整的 `SKILL.md` 内容。它仅在模型通过运行时 skill 工具加载 skill 后进入上下文，每个加载的 skill 在投影前都有上限。

## 托管 skills 生命周期

CrawClaw 作为安装的一部分（npm 包或 CrawClaw.app）提供一组基线 skills 作为**捆绑 skills**。`~/.crawclaw/skills` 用于本地覆盖（例如，在不更改捆绑副本的情况下固定/修补 skill）。工作区 skills 由用户拥有，并在名称冲突时覆盖两者。

## 配置参考

有关完整的配置模式，请参见 [Skills 配置](/tools/skills-config)。

## 寻找更多 skills？

浏览 [https://clawhub.ai](https://clawhub.ai)。

---

## 相关

- [创建 Skills](/tools/creating-skills) — 构建自定义 skills
- [Skills 配置](/tools/skills-config) — skill 配置参考
- [斜杠命令](/tools/slash-commands) — 所有可用的斜杠命令
- [插件](/tools/plugin) — 插件系统概览
