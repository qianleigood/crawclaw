---
title: "ComfyUI Tool"
summary: "创建、验证、运行并下载本地 ComfyUI 图像和视频工作流"
read_when:
  - 你想让 CrawClaw 构建本地 ComfyUI workflows
  - 你需要启用 comfyui_workflow tool
  - 你正在调试本地 ComfyUI graph validation 或 output downloads
x-i18n:
  generated_at: "2026-06-10T12:04:39Z"
  model: codex
  provider: openai
  source_hash: 2f127c7f4da74a11af475eef143f2662d5131adaf678fff1ef82813a25129c3c
  source_path: tools/comfyui.md
  workflow: 15
---

# ComfyUI tool

`comfyui_workflow` 让 CrawClaw inspect 本地 ComfyUI server，创建 validated graph，将其 compile 为 ComfyUI API-format prompt JSON，在 approval 后运行，并下载生成的 outputs。

这个 tool 由 plugin 拥有。它不会替代 `image` analysis tool，不会恢复旧的 image-generation agent tool，也不会改变 n8n workflow semantics。

## Availability

`comfyui_workflow` 会直接访问本地 ComfyUI HTTP API。它不会安装 custom nodes、下载 models，也不会绕过 ComfyUI 自身 runtime requirements。

CrawClaw Desktop 可以在 Desktop settings 的 Automation Environment 中安装、启动、停止和 health-check 一个 managed local ComfyUI runtime。你也可以把 tool 绑定到外部管理的 ComfyUI endpoint。Managed installs 基于 profile：
Apple Metal、NVIDIA CUDA、AMD ROCm、Intel XPU、CPU 或 external。CUDA、ROCm 和 XPU profiles 使用 profile-specific PyTorch wheel indexes；当你的 GPU 或 driver 需要不同 channel 时，可以用 `PYTORCH_INDEX_URL` 覆盖。

Bundled `comfyui` plugin 会将 `comfyui_workflow` 注册为 optional tool。可以用 tool name 或 plugin id 启用：

```json5
{
  tools: {
    allow: ["comfyui_workflow"],
  },
}
```

或：

```json5
{
  tools: {
    allow: ["comfyui"],
  },
}
```

## Config

默认 config：

```json5
{
  plugins: {
    entries: {
      comfyui: {
        config: {
          baseUrl: "http://127.0.0.1:8188",
          outputDir: ".crawclaw/comfyui/outputs",
          workflowsDir: ".crawclaw/comfyui/workflows",
          maxPlanRepairAttempts: 3,
          requestTimeoutMs: 30000,
          runTimeoutMs: 900000,
        },
      },
    },
  },
}
```

默认只允许 `127.0.0.1`、`localhost` 和 `::1` 等 loopback hosts。non-loopback endpoint 需要显式 config：

```json5
{
  plugins: {
    entries: {
      comfyui: {
        config: {
          baseUrl: "http://comfyui-host:8188",
          allowRemote: true,
        },
      },
    },
  },
}
```

## Actions

`comfyui_workflow` 使用一个 tool 承载多个 actions：

- `inspect`: fetch `/object_info`，汇总可用 nodes，并显示 video output candidates。
- `create`: 构建 graph IR、验证、compile API prompt JSON，并可选保存 artifacts。
- `validate`: 根据 live node catalog 验证已保存或提供的 graph IR。
- `run`: 在 plugin approval 后提交已保存或已验证 graph。
- `status`: 针对某次 run 读取 `/history/{prompt_id}`。
- `outputs`: 解析 history outputs，并可选通过 `/view` 下载文件。

`run` 不接受 raw ComfyUI prompt JSON。它必须使用 saved workflow id 或 validated CrawClaw graph IR，这样 validation 会在 `/prompt` 之前发生。

## Image and Video

Image 和 video 都是一等 media kinds。planner 使用本地 node catalog，而不是固定 template list。如果 video nodes 不存在，CrawClaw 会返回 blocking diagnostics，而不是悄悄把请求改成 image workflow。

Video support 取决于本地 ComfyUI installation。常见信号包括 video combine/save nodes、VHS-style nodes、temporal samplers、image-to-video conditioning 和 video model loaders。

## Artifacts

Saved workflows 使用 workspace-local paths：

```text
.crawclaw/comfyui/workflows/<slug>.ir.json
.crawclaw/comfyui/workflows/<slug>.prompt.json
.crawclaw/comfyui/workflows/<slug>.meta.json
.crawclaw/comfyui/outputs/<prompt_id>/*
```

IR file 是 CrawClaw graph representation，用于 validation 和 diagnostics。prompt file 是提交到 `/prompt` 的 ComfyUI API-format JSON。metadata sidecar 记录 original goal、ComfyUI base URL、catalog fingerprint、diagnostics、run id 和 output artifacts。

## Local API

该 tool 依赖 ComfyUI 文档中的本地 ComfyUI routes：

- `GET /system_stats`
- `GET /object_info`
- `POST /prompt`
- `GET /history/{prompt_id}`
- `GET /view`
- `POST /upload/image`

参见 ComfyUI server route reference：
[https://docs.comfy.org/development/comfyui-server/comms_routes](https://docs.comfy.org/development/comfyui-server/comms_routes)。

## 相关

- [Automation Overview](/automation) 了解 Automation Environment 和本地 runtime lifecycle
- [Image Tool](/tools/image) 用于 image analysis
- [Plugins](/tools/plugin) 了解 plugin enablement 和 installation behavior
- [Exec approvals](/tools/exec-approvals) 了解 approval flow concepts
