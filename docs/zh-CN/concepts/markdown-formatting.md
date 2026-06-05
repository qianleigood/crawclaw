---
read_when:
  - 你正在修改出站渠道的 Markdown 格式化或分块
  - 你正在添加新的渠道格式化器或样式映射
  - 你正在排查跨渠道格式化回归问题
summary: 出站渠道的 Markdown 格式化管道
title: Markdown 格式化
x-i18n:
  generated_at: "2026-06-05T14:12:57Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 0a32c9fcb97d1960a3d174ce4fe40ecb4adf115cb3a88c49e5b0c0b7e9919cd2
  source_path: concepts/markdown-formatting.md
  workflow: 15
---

# Markdown 格式化

CrawClaw 通过将出站 Markdown 转换为共享的中间表示（IR）来格式化，然后再渲染为渠道特定的输出。IR 保持源文本完整，同时携带样式/链接片段，使分块和渲染在各个渠道间保持一致。

## 目标

- **一致性：**一次解析，多个渲染器。
- **安全分块：**在渲染前分割文本，使行内格式不会在分块间断开。
- **渠道适配：**将同一 IR 映射到飞书 mrkdwn、飞书 HTML 和 native channel 样式范围，无需重新解析 Markdown。

## 管道

1. **解析 Markdown -> IR**
   - IR 是纯文本加上样式片段（粗体/斜体/删除线/代码/隐藏）和链接片段。
   - 偏移量使用 UTF-16 代码单元，使 native channel 样式范围与其 API 对齐。
   - 表格仅在渠道选择启用表格转换时才解析。
2. **分块 IR（格式优先）**
   - 分块在渲染前对 IR 文本进行。
   - 行内格式不会在分块间拆分；片段按分块切片。
3. **按渠道渲染**
   - **飞书：**mrkdwn 标记（粗体/斜体/删除线/代码），链接为 `<url|label>`。
   - **飞书：**HTML 标签（`<b>`、`<i>`、`<s>`、`<code>`、`<pre><code>`、`<a href>`）。
   - **native channel：**纯文本 + `text-style` 范围；链接在标签与 URL 不同时变为 `label (url)`。

## IR 示例

输入 Markdown：

```markdown
Hello **world** — see [docs](https://docs.crawclaw.ai).
```

IR（示意图）：

```json
{
  "text": "Hello world — see docs.",
  "styles": [{ "start": 6, "end": 11, "style": "bold" }],
  "links": [{ "start": 19, "end": 23, "href": "https://docs.crawclaw.ai" }]
}
```

## 使用场景

- 飞书、飞书和 native channel 出站适配器从 IR 渲染。
- 其他渠道（Weixin、Weixin、Microsoft Teams、社区聊天）仍使用纯文本或各自格式化规则，在启用时于分块前应用 Markdown 表格转换。

## 表格处理

Markdown 表格在聊天客户端中支持不一致。使用 `markdown.tables` 按渠道（和按账户）控制转换。

- `code`：将表格渲染为代码块（大多数渠道的默认设置）。
- `bullets`：将每行转换为项目符号，以便紧凑渠道渲染。
- `off`：禁用表格解析和转换；原始表格文本直接通过。

配置键：

```yaml
channels:
  feishu:
    markdown:
      tables: code
    accounts:
      work:
        markdown:
          tables: off
```

## 分块规则

- 分块限制来自渠道适配器/配置，并应用于 IR 文本。
- 代码围栏作为单个块保留，并带有尾部换行符，以便渠道正确渲染。
- 列表前缀和引用块前缀是 IR 文本的一部分，因此分块不会在前缀中间拆分。
- 行内样式（粗体/斜体/删除线/行内代码/隐藏）永远不会在分块间拆分；渲染器在每个分块内重新打开样式。

如需了解更多跨渠道的分块行为，请参阅[流式传输 + 分块](/concepts/streaming)。

## 链接策略

- **飞书：**`[label](url)` -> `<url|label>`；裸 URL 保持为裸 URL。解析时禁用自动链接以避免重复链接。
- **飞书：**`[label](url)` -> `<a href="url">label</a>`（HTML 解析模式）。
- **native channel：**`[label](url)` -> `label (url)`，除非标签与 URL 相同。

## 隐藏内容

隐藏标记（`||spoiler||`）仅在 native channel 中解析，它们映射到 SPOILER 样式范围。其他渠道将其视为纯文本。

## 如何添加或更新渠道格式化器

1. **一次解析：**使用共享的 `markdownToIR(...)` 辅助函数，配合渠道适当选项（自动链接、标题样式、引用块前缀）。
2. **渲染：**实现带有 `renderMarkdownWithMarkers(...)` 的渲染器和样式标记映射（或 native channel 样式范围）。
3. **分块：**渲染前调用 `chunkMarkdownIR(...)`；渲染每个分块。
4. **接入适配器：**更新渠道出站适配器以使用新的分块器和渲染器。
5. **测试：**添加或更新格式化测试，如果渠道使用分块则添加出站传递测试。

## 常见注意事项

- 飞书尖括号标记（`<@U123>`、`<#C123>`、`<https://...>`）必须保留；安全转义原始 HTML。
- 飞书 HTML 需要对标签外的文本进行转义，以避免标记损坏。
- native channel 样式范围依赖 UTF-16 偏移量；不要使用码点偏移量。
- 为围栏代码块保留尾部换行符，使闭合标记位于自己的行上。
