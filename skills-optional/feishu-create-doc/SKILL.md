---
name: feishu-create-doc
description: |
  创建新的飞书云文档，并把结构化 Markdown 内容发布成可交付的飞书文档。Use when 用户要求新建飞书文档、知识库文档、会议纪要、方案、周报、项目文档、说明文档，或要求把现有内容发布到指定飞书文件夹、知识空间、知识库节点。尤其适合需要较强排版、callout、表格、分栏、Mermaid/PlantUML 图示的文档创建场景。Do not use for editing an existing doc（改用 feishu-update-doc）or reading an existing doc（改用 feishu-fetch-doc）。
metadata: { "crawclaw": { "workflow": { "portability": "crawclaw_agent", "allowedSkills": ["feishu-create-doc"], "notes": "Keep document authoring on the CrawClaw agent side unless a dedicated Feishu service node exists." } } }
---

# feishu_mcp_create_doc

通过 MCP 调用 `create-doc`，从 Lark-flavored Markdown 内容创建新的飞书云文档。

## 何时使用

优先用于“创建新的飞书文档”这类场景：
- 新建飞书云文档 / 知识库文档
- 会议纪要、方案、周报、项目文档、说明文档
- 把现有内容发布到指定文件夹、知识库节点或知识空间
- 需要较强排版、表格、callout、Mermaid/PlantUML 图示的飞书文档

不要用于：
- 修改已有文档 → `feishu-update-doc`
- 读取已有文档 → `feishu-fetch-doc`

## 返回值

工具成功执行后，返回一个 JSON 对象，包含：
- `doc_id`：文档 token
- `doc_url`：文档访问链接
- `message`：执行结果说明

## 最小参数集

### 必填
- `markdown`：文档正文，使用 Lark-flavored Markdown

### 常用可选
- `title`：文档标题
- `folder_token`：创建到指定文件夹
- `wiki_node`：创建到指定知识库节点
- `wiki_space`：创建到指定知识空间根目录

### 参数优先级

```text
wiki_node > wiki_space > folder_token
```

## 核心规则

- `title` 已经是文档标题时，`markdown` 开头不要再重复同名一级标题
- 飞书会自动生成目录，无需手写目录
- 长文档建议先创建，再配合 `feishu-update-doc` 的 append 模式分段追加
- 文档应优先追求结构清晰、样式节奏稳定、图文配合自然

## 创建前的快速判断

### 1. 先判断目标位置
- 普通云空间：用 `folder_token`
- 知识库节点下：用 `wiki_node`
- 知识空间根目录：用 `wiki_space`

### 2. 再判断内容复杂度
- 简单正文、标题、列表、表格：直接写 `markdown`
- 需要 callout、分栏、图片、Mermaid / PlantUML、提及或提醒：阅读 `references/lark-markdown-guide.md`

### 3. 长文档策略
- 一次创建骨架
- 后续使用 `feishu-update-doc` 逐段补充内容

## 简短示例

### 创建简单文档

```json
{
  "title": "项目计划",
  "markdown": "## 项目概述\n\n这是一个新项目。\n\n## 目标\n\n- 目标 1\n- 目标 2"
}
```

### 创建到指定知识库节点

```json
{
  "title": "技术文档",
  "wiki_node": "wikcnXXXXXXXXXXXXXXXXXXXXXX",
  "markdown": "## API 接口说明\n\n这是一个知识库文档。"
}
```

## 何时读取参考文档

当你需要 richer formatting 时，再读：
- `references/lark-markdown-guide.md`

它包含：
- Lark-flavored Markdown 核心规则
- 常见块类型
- callout / 表格 / 图片 / 图表 / 提及 / 提醒等格式提示
- 典型文档场景下的格式建议
