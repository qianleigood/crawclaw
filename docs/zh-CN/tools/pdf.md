---
title: PDF 工具
summary: 使用原生 provider 或提取回退路径分析一个或多个 PDF 文档
read_when:
  - 你想在 agent 中分析 PDF
  - 你需要 pdf 工具的准确参数和限制
  - 你在排查原生 PDF 模式与提取回退模式
---

# PDF 工具

`pdf` 用来分析一个或多个 PDF 文档，并返回文本结果。

快速说明：

- Anthropic 和 Google provider 优先走原生 PDF 分析模式。
- 其他 provider 走提取回退模式：先抽文本，不够时再渲染页面图片。
- 支持单个输入（`pdf`）或多个输入（`pdfs`），单次最多 10 个 PDF。

## 可用条件

只有在 CrawClaw 能为当前 agent 解析出可用的 PDF 模型时，这个工具才会注册：

1. `agents.defaults.pdfModel`
2. 回退到 `agents.defaults.imageModel`
3. 再根据当前 provider 与认证状态尽力自动推断

如果没有解析出可用模型，`pdf` 工具不会暴露给模型。

## 输入参数

- `pdf`（`string`）：单个 PDF 路径或 URL
- `pdfs`（`string[]`）：多个 PDF 路径或 URL，最多 10 个
- `prompt`（`string`）：分析提示词，默认 `Analyze this PDF document.`
- `pages`（`string`）：页码过滤，如 `1-5` 或 `1,3,7-9`
- `model`（`string`）：可选模型覆盖（`provider/model`）
- `maxBytesMb`（`number`）：每个 PDF 的大小上限（MB）

补充说明：

- `pdf` 和 `pdfs` 会先合并、去重，再加载。
- 如果没有 PDF 输入，工具会报错。
- `pages` 按 1-based 页码解析，会去重、排序，并裁剪到配置允许的最大页数。
- `maxBytesMb` 默认取 `agents.defaults.pdfMaxBytesMb`，否则默认 `10`。

## 支持的 PDF 引用

- 本地文件路径（支持 `~` 展开）
- `file://` URL
- `http://` 和 `https://` URL

限制说明：

- 其他 URI scheme（例如 `ftp://`）会返回 `unsupported_pdf_reference`
- 沙盒模式下不允许远程 `http(s)` URL
- 如果启用了 workspace-only 文件策略，超出允许根目录的本地路径会被拒绝

## 执行模式

### 原生 provider 模式

原生模式适用于 `anthropic` 和 `google`。
工具会把原始 PDF 字节直接发给 provider API。

原生模式限制：

- 不支持 `pages`；如果设置了 `pages`，工具会直接返回错误

### 提取回退模式

回退模式用于不支持原生 PDF 的 provider。

流程：

1. 先提取选定页的文本（最多 `agents.defaults.pdfMaxPages`，默认 `20`）
2. 如果提取文本少于 `200` 个字符，就把选定页渲染成 PNG 图片
3. 把提取内容和 prompt 一起交给目标模型

回退细节：

- 页面图片提取使用 `4,000,000` 像素预算
- 如果目标模型不支持图像输入，而且 PDF 也提取不到足够文本，会直接报错
- 该模式依赖 `pdfjs-dist`，如果要渲染页面图片还需要 `@napi-rs/canvas`

## 配置

```json5
{
  agents: {
    defaults: {
      pdfModel: {
        primary: "anthropic/claude-opus-4-6",
        fallbacks: ["openai/gpt-5-mini"],
      },
      pdfMaxBytesMb: 10,
      pdfMaxPages: 20,
    },
  },
}
```

完整字段见 [配置参考](/gateway/configuration-reference)。

## 返回结构

工具把结果文本放在 `content[0].text`，结构化元数据放在 `details`。

常见 `details` 字段：

- `model`：最终使用的模型引用（`provider/model`）
- `native`：如果走原生 provider 模式则为 `true`
- `attempts`：成功前失败的回退尝试

路径相关字段：

- 单 PDF 输入：`details.pdf`
- 多 PDF 输入：`details.pdfs[]`
- 如果路径在沙盒/桥接里被重写：`rewrittenFrom`

## 错误行为

- 缺少 PDF 输入：抛出 `pdf required: provide a path or URL to a PDF document`
- PDF 太多：返回 `details.error = "too_many_pdfs"`
- 不支持的引用 scheme：返回 `details.error = "unsupported_pdf_reference"`
- 原生模式使用 `pages`：抛出 `pages is not supported with native PDF providers`

## 示例

单个 PDF：

```json
{
  "pdf": "/tmp/report.pdf",
  "prompt": "用 5 条要点总结这份报告"
}
```

多个 PDF：

```json
{
  "pdfs": ["/tmp/q1.pdf", "/tmp/q2.pdf"],
  "prompt": "比较两份文档里的风险和时间线变化"
}
```

按页过滤：

```json
{
  "pdf": "https://example.com/report.pdf",
  "pages": "1-3,7",
  "model": "openai/gpt-5-mini",
  "prompt": "只提取和客户影响有关的事件"
}
```

## 相关文档

- [工具总览](/tools)
- [配置参考](/gateway/configuration-reference#agent-defaults)
