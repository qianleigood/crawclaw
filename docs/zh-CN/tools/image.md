---
title: 图像工具
summary: 使用已配置的视觉模型分析一张或多张图片
read_when:
  - 你想在 agent 中分析图片
  - 你需要 image 工具的准确参数和限制
  - 你在排查图像模型解析或本地路径访问
---

# 图像工具

`image` 用来分析一张或多张图片，并返回文本结果。

快速说明：

- 支持单图输入（`image`）和多图输入（`images`）。
- 支持本地文件路径、`file://` URL、`data:` URL，以及 `http(s)` URL。
- 优先使用已配置的图像模型；必要时会尽力从当前 provider 推断可用视觉模型。
- 结果文本在 `content[0].text`，结构化元数据放在 `details`。

## 可用条件

只有在 CrawClaw 能为当前 agent 解析出可用的图像模型时，这个工具才会注册：

1. `agents.defaults.imageModel`
2. 根据默认聊天模型做同 provider 的视觉模型配对
3. 如果存在可用认证，则回退到 OpenAI / Anthropic 的默认视觉模型

如果没有解析出可用模型，`image` 工具不会暴露给模型。

<Note>
  如果当前聊天模型本身支持视觉，而且用户已经在消息里直接附上图片，
  那些图片通常已经自动可见。此时只有在你需要额外加载新的图片路径或 URL
  时，才需要显式调用 `image`。
</Note>

## 输入参数

- `image`（`string`）：单张图片路径或 URL
- `images`（`string[]`）：多张图片路径或 URL，最多 `maxImages`
- `prompt`（`string`）：分析提示词，默认 `Describe the image.`
- `model`（`string`）：可选模型覆盖（`provider/model`）
- `maxBytesMb`（`number`）：每张图片的大小上限（MB）
- `maxImages`（`number`）：本次调用允许的最大图片数，默认 `20`

补充说明：

- `image` 和 `images` 会先合并、去重，再加载。
- 如果没有提供任何图片输入，工具会报错。
- 如果图片数量超过 `maxImages`，工具会返回 `too_many_images` 结构化错误。

## 支持的图片引用

- 本地文件路径（支持 `~` 展开）
- 相对 workspace 的本地路径
- `file://` URL
- `data:` URL
- `http://` 和 `https://` URL

限制说明：

- 不支持的 URI scheme 会返回 `unsupported_image_reference`。
- 沙盒模式下不允许远程 `http(s)` 图片 URL。
- 如果启用了 workspace-only 文件策略，超出允许根目录的本地路径会被拒绝。

## 模型路由

CrawClaw 会先解析出一个支持图像输入的模型，再交给对应的媒体理解 provider 执行。

Provider 说明：

- 多图输入会优先使用 provider 原生的多图能力。
- 如果 provider 不支持多图，CrawClaw 会退化成逐张描述再合并。
- 如果选中的是 MiniMax 视觉模型，会自动走 MiniMax VLM 专用路径。

## 配置

```json5
{
  agents: {
    defaults: {
      imageModel: {
        primary: "openai/gpt-5-mini",
        fallbacks: ["anthropic/claude-opus-4-5"],
      },
      mediaMaxMb: 10,
    },
  },
}
```

完整字段见 [配置参考](/gateway/configuration-reference)。

## 返回结构

工具会把结果文本放到 `content[0].text`，并在 `details` 里附带结构化信息。

常见 `details` 字段：

- `model`：最终使用的模型引用（`provider/model`）
- `attempts`：回退过程中失败的尝试记录

路径相关字段：

- 单图输入：`details.image`
- 多图输入：`details.images[]`
- 如果路径在沙盒/桥接里被重写：`rewrittenFrom`

## 错误行为

- 缺少图片输入：抛出 `image required`
- 图片太多：返回 `details.error = "too_many_images"`
- 不支持的引用 scheme：返回 `details.error = "unsupported_image_reference"`
- 沙盒下使用远程 URL：抛出 `Sandboxed image tool does not allow remote URLs.`

## 示例

单图：

```json
{
  "image": "/tmp/photo.jpg",
  "prompt": "描述画面内容并提取可见文字"
}
```

多图：

```json
{
  "images": ["/tmp/frame-1.png", "/tmp/frame-2.png"],
  "prompt": "比较这两张截图的 UI 差异"
}
```

远程图片：

```json
{
  "image": "https://example.com/chart.png",
  "prompt": "用三条要点总结这张图表"
}
```

## 相关文档

- [工具总览](/tools)
- [PDF 工具](/tools/pdf)
