---
read_when:
  - 开始新的 CrawClaw 智能体会话
  - 启用或审计默认 Skills
summary: CrawClaw 个人助手设置的默认智能体说明和 Skills 清单
title: 默认 AGENTS.md
x-i18n:
  generated_at: "2026-06-05T14:46:18Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 1bb35b70aa7b21351dfcb9c4b576f869421d57a237795aaf4e46191a2bbffe34
  source_path: reference/AGENTS.default.md
  workflow: 15
---

# AGENTS.md - CrawClaw 个人助手（默认）

## 首次运行（推荐）

CrawClaw 使用专用工作区目录用于智能体。默认：`~/.crawclaw/workspace`（可通过 `agents.defaults.workspace` 配置）。

1. 创建工作区（如果尚不存在）：

```bash
mkdir -p ~/.crawclaw/workspace
```

2. 将默认工作区模板复制到工作区：

```bash
cp docs/reference/templates/AGENTS.md ~/.crawclaw/workspace/AGENTS.md
cp docs/reference/templates/SOUL.md ~/.crawclaw/workspace/SOUL.md
cp docs/reference/templates/TOOLS.md ~/.crawclaw/workspace/TOOLS.md
```

3. 可选：如果你想要个人助手 Skills 清单，请将此文件替换 AGENTS.md：

```bash
cp docs/reference/AGENTS.default.md ~/.crawclaw/workspace/AGENTS.md
```

4. 可选：通过设置 `agents.defaults.workspace` 选择不同的工作区（支持 `~`）：

```json5
{
  agents: { defaults: { workspace: "~/.crawclaw/workspace" } },
}
```

## 安全默认值

- 不要在聊天中转储目录或密钥。
- 除非明确要求，否则不要运行破坏性命令。
- 不要向外部消息平台发送部分/流式回复（仅发送最终回复）。

## 会话开始（必需）

- 阅读 `SOUL.md`、`USER.md` 和 `memory/` 中的今天和昨天内容。
- 存在时阅读 `MEMORY.md`；仅当 `MEMORY.md` 不存在时才回退到小写的 `memory.md`。
- 在回复前执行此操作。

## Soul（必需）

- `SOUL.md` 定义身份、语气和边界。保持最新。
- 如果你更改了 `SOUL.md`，请告知用户。
- 你在每个会话中都是一个全新实例；连续性存在于这些文件中。

## 共享空间（推荐）

- 你不是用户的声音；在群聊或公共频道中要谨慎。
- 不要分享私人数据、联系方式或内部笔记。

## 记忆系统（推荐）

- 每日日志：`memory/YYYY-MM-DD.md`（如需要请创建 `memory/`）。
- 长期记忆：`MEMORY.md` 用于持久化事实、偏好和决策。
- 小写 `memory.md` 仅作为遗留回退；不要故意同时保留两个根文件。
- 会话开始时，阅读今天 + 昨天 + `MEMORY.md`（如果存在），否则阅读 `memory.md`。
- 记录：决策、偏好、约束、未完成事项。
- 除非明确要求，否则避免记录密钥。

## 工具和 Skills

- 工具存在于 Skills 中；当你需要时，遵循每个 Skill 的 `SKILL.md`。
- 在 `TOOLS.md` 中保留特定于环境的笔记（Skills 注意事项）。

## 备份提示（推荐）

如果你将此工作区视为 Clawd 的"记忆"，请将其设为 git 仓库（最好为私有），以便 `AGENTS.md` 和你的记忆文件得到备份。

```bash
cd ~/.crawclaw/workspace
git init
git add AGENTS.md
git commit -m "Add Clawd workspace"
# 可选：添加私有远程并推送
```

## CrawClaw 的功能

- 运行 Weixin gateway 和 CrawClaw 的 Rust 智能体运行时，使助手能够通过主机 Mac 读取/写入聊天、获取上下文和运行 Skills。
- 本地 node/运行时主机管理权限（屏幕录制、通知、麦克风）并暴露 Gateway API 控制。
- 直接聊天默认折叠到智能体的 `main` 会话；群组保持隔离为 `agent:<agentId>:<channel>:group:<id>`（房间/频道：`agent:<agentId>:<channel>:channel:<id>`）；后台任务可以在完成时将 main-session 唤醒事件加入队列。

## 核心 Skills（在设置 → Skills 中启用）

- **mcporter** — 用于管理外部 Skill 后端的工具服务器运行时/CLI。
- **Peekaboo** — 快速 macOS 截图，带可选 AI 视觉分析。
- **camsnap** — 从 RTSP/ONVIF 安防摄像头捕获帧、片段或移动警报。
- **oracle** — 带有会话重放和浏览器控制的 OpenAI 就绪智能体 CLI。
- **eightctl** — 从终端控制你的睡眠。
- **gog** — Google Suite CLI：Gmail、日历、云端硬盘、联系人。
- **spotify-player** — 终端 Spotify 客户端，用于搜索/队列/控制播放。
- **sag** — 带有 mac 风格 say UX 的语音播放；默认流式传输到扬声器。
- **Sonos CLI** — 从脚本控制 Sonos 扬声器（发现/状态/播放/音量/分组）。
- **blucli** — 从脚本播放、分组和自动化 BluOS 播放器。
- **OpenHue CLI** — 用于场景和自动化的飞利浦 Hue 照明控制。
- **OpenAI Whisper** — 本地语音转文本，用于快速听写和语音邮件转录。
- **Gemini CLI** — 从终端使用 Google Gemini 模型进行快速问答。
- **agent-tools** — 用于自动化和辅助脚本的实用工具包。

## 使用注意事项

- 脚本编写首选本地 Gateway API；mac 应用处理权限。
- 从 Skills 选项卡运行安装；如果二进制文件已存在，它会隐藏按钮。
- 使用 cron 作业和钩子进行提醒、收件箱监控和摄像头捕获自动化。
- Canvas UI 全屏运行，带原生覆盖。避免在左上角/右上角/底部边缘放置关键控件；在布局中添加明确的页边距，不要依赖安全区域嵌入。
- 对于浏览器驱动的验证，请使用 CrawClaw 管理的 Chrome 配置文件的智能体 `browser` 工具。
- 对于 DOM 检查，请使用 `browser` 工具操作，如 `snapshot`、`screenshot`、`console` 和 `network`。
- 对于交互，请使用 `browser` 工具操作，如 `open`、`navigate`、`upload` 和 `act`，配合 `click`、`type`、`hover`、`drag`、`select`、`press`、`wait` 或 `evaluate`（click/type 需要 snapshot 引用；使用 `evaluate` 执行页面上下文的 JavaScript）。
