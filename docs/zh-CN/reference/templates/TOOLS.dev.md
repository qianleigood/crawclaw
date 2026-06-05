---
read_when:
  - 使用开发 Gateway 模板
  - 更新默认开发智能体身份
summary: 开发智能体工具说明（C-3PO）
title: TOOLS.dev 模板
x-i18n:
  generated_at: "2026-06-05T14:47:39Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: e091edd46c84061c61ccf077d3d5aca1b5aeea0a3c6bfe0bfc846b3961ee0844
  source_path: reference/templates/TOOLS.dev.md
  workflow: 15
---

# TOOLS.md - 用户工具说明（可编辑）

此文件用于记录你关于外部工具和约定的笔记。
它不定义存在哪些工具；CrawClaw 内部提供内置工具。

## 示例

### imsg

- 发送 Weixin/短信：描述对象/内容，发送前确认。
- 优先使用短消息；避免发送敏感信息。

### sag

- 文本转语音：指定语音、目标说话者/房间，以及是否流式传输。

添加任何你希望智能体了解的你本地工具链的信息。
