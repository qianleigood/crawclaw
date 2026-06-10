---
title: "本地 ComfyUI Workflow Builder 设计"
summary: "本地 ComfyUI workflow builder plugin 的设计"
x-i18n:
  generated_at: "2026-06-10T12:46:53Z"
  model: codex
  provider: openai
  source_hash: 905b8d91e743f80af4f2790b0965c9c826f7f05e168410454d9b7cffa5620f4a
  source_path: superpowers/specs/2026-04-24-comfyui-local-workflow-design.md
  workflow: 15
---

# 本地 ComfyUI Workflow Builder 设计

## Summary

CrawClaw 应该以 plugin-backed media workflow builder 的方式集成本地 ComfyUI server。目标不是发布一小组固定 ComfyUI templates，而是让 CrawClaw 检查用户真实的本地 ComfyUI node surface，为图像或视频生成请求规划 graph，根据 live node catalog 验证该 graph，在 graph 无法变成 valid 时返回 structured diagnostics，将验证后的 graph 编译为 ComfyUI API-format JSON，在本地 ComfyUI queue 上运行，并下载生成的 outputs。

第一版实现面向本地 ComfyUI，通常是 `http://127.0.0.1:8188`。ComfyUI Cloud、n8n deployment，以及 generic cross-provider image-generation capability 都明确不放进第一版。

## Goals

- 添加 bundled `comfyui` plugin，而不是把新的 ComfyUI 行为加到 core agent tools。
- 让 CrawClaw 可以根据 local node catalog 自由创建 ComfyUI workflows，而不是只从 hardcoded templates 中选择。
- 从一开始支持 image 和 video workflows。
- 将 ComfyUI API-format workflow JSON 视为可 inspect、save 和 rerun 的 output artifact。
- 将 validated workflows 提交到本地 ComfyUI `/prompt` queue。
- 第一版通过 `/history/{prompt_id}` 跟踪 execution status，WebSocket progress 作为后续改进。
- 通过 `/view` 下载生成的 images、videos、audio 和 unknown files。
- 当 required nodes、model choices 或 inputs 缺失时返回 structured diagnostics。
- 保持实现边界足够小，以便用 mocked ComfyUI APIs 和真实 local ComfyUI smoke test 测试。

## Non-Goals

- 不安装或管理 ComfyUI custom nodes 或 models。
- 不把 ComfyUI lifecycle controls 放进 `comfyui_workflow`；Desktop Automation Environment 拥有 installation、start、stop、health 和 logs。
- 第一版不支持 ComfyUI Cloud。
- 不添加第二套 CrawClaw workflow engine。
- 第一版不接入 `workflowize` 或 n8n。
- 不重新引入 core image-generation agent tool。
- 暂不定义 generic image/video generation provider capability。
- 不保证任意 prompt 都能在每个本地 ComfyUI installation 上生成 valid graph。

## Current Project Fit

CrawClaw 已经具备适合这项工作的 native plugin 和 automation asset boundary：

- bundled automation assets 位于 `automation/`
- non-channel runtime plugins 使用 Rust native descriptors
- runtime tools 和 services 由 Rust 拥有
- core workflow execution 当前围绕 n8n，不应在第一版 ComfyUI 中扩展

ComfyUI lifecycle manifest 位于 `automation/comfyui`，workflow tool behavior 由 Rust native plugin crate 拥有。

现有 workflow subsystem 仍然是未来 consumer。一旦这个 plugin 可以可靠地创建和运行真实 ComfyUI graphs，CrawClaw 后续可以把一次成功的 ComfyUI generation run workflowize 到 n8n-backed workflow registry。

## ComfyUI API Assumptions

本地 ComfyUI server 暴露这个集成所需的 API surface：

- `GET /object_info` 获取 available node definitions
- `GET /system_stats` 获取 basic health 和 device information
- `GET /features` 在可用时做 feature discovery
- `POST /upload/image` 处理 image inputs
- `POST /prompt` 提交 queue
- `GET /history/{prompt_id}` 获取 completed execution data
- `GET /view` 获取 output file
- `GET /queue` 在需要时查看 queue state
- `POST /queue` 或 `POST /interrupt` 供后续 cancellation support 使用
- `GET /ws` 供后续 live progress support 使用

第一版实现不应依赖 browser UI。它应直接调用本地 HTTP API。

## User Experience

用户用自然语言请求一个 media generation task：

> Create a short cinematic video of a red crab walking through neon rain.

CrawClaw 应该：

1. 如果 cache 缺失或 stale，则 inspect 本地 ComfyUI node catalog
2. 推断请求的 workflow kind，例如 `text-to-video`
3. 使用本地 ComfyUI instance 中存在的 nodes 规划 graph
4. 如果无法构建 plan，则解释缺失的 required nodes 或 model choices
5. 编译并保存 ComfyUI API-format workflow JSON artifact
6. 运行本地 generation job 前请求确认
7. 将 workflow 提交到 `/prompt`
8. 跟踪 completion
9. 下载并报告 output artifacts

对于 reusable workflow request，CrawClaw 应保存生成的 workflow JSON 和一个小的 metadata sidecar，让用户后续可以请求 rerun 或 modify。

## Plugin Shape

### Package

实现使用现有 native plugin 和 automation manifest surfaces：

- `automation/comfyui/manifest.json`
- `crates/crawclaw-native-plugins/src/comfyui.rs`
- `crates/crawclaw-native-plugins/src/registry.rs`

Plugin id 是 `comfyui`；optional tool 是 `comfyui_workflow`。

### Config

Plugin config：

```json5
{
  plugins: {
    entries: {
      comfyui: {
        config: {
          baseUrl: "http://127.0.0.1:8188",
          outputDir: ".crawclaw/comfyui/outputs",
          maxPlanRepairAttempts: 3,
          requestTimeoutMs: 30000,
          runTimeoutMs: 900000,
        },
      },
    },
  },
}
```

Default behavior：

- `baseUrl` 默认是 `http://127.0.0.1:8188`
- 默认只允许 loopback hosts
- non-loopback `baseUrl` 需要 explicit config
- outputs 写入 active workspace 下，除非用户配置了其他 allowed path

### Tool

注册一个名为 `comfyui_workflow` 的 optional tool。

Actions：

- `inspect`
- `create`
- `validate`
- `run`
- `status`
- `outputs`

Gateway-facing read operations 也通过 native operations 暴露 saved workflow、run 和 output lists：

- `workflows-list`
- `workflow-get`
- `runs-list`
- `outputs-list`

不要暴露 public `repair` action。Validation diagnostics 可以包含 `repairHint` strings，但当前 runtime 没有 standalone `repair` operation。

Tool 可以暴露单一 discriminated parameter shape：

```ts
type ComfyUiWorkflowAction =
  | { action: "inspect"; refresh?: boolean }
  | { action: "create"; goal: string; inputs?: Record<string, unknown>; save?: boolean }
  | { action: "validate"; workflowId?: string; ir?: unknown }
  | {
      action: "run";
      workflowId?: string;
      ir?: unknown;
      waitForCompletion?: boolean;
      downloadOutputs?: boolean;
    }
  | { action: "status"; promptId: string }
  | { action: "outputs"; promptId: string; download?: boolean };
```

当 action 由 model 发起时，`run` 在提交到 ComfyUI 前必须要求 explicit approval metadata。

## Internal Architecture

### 1. ComfyUI Client

`crates/crawclaw-native-plugins/src/comfyui.rs` client functions

Responsibilities：

- normalize 并 validate `baseUrl`
- 调用 ComfyUI HTTP endpoints
- 在 errors 中 redact sensitive request details
- 强制 request timeouts
- 通过 schemas 解析 JSON responses
- 安全下载 output files

这个 module 不应知道 graph planning。

### 2. Node Catalog

`crates/crawclaw-native-plugins/src/comfyui.rs` catalog types

Responsibilities：

- fetch `/object_info`
- 将 node definitions normalize 为 stable internal catalog
- 按 `class_type` 建 index
- 暴露 node input metadata、required fields、optional fields、enum choices，以及 loose input/output type hints
- 根据 capability-like signals 提供 node classes search helpers

Catalog 应该可以按 `baseUrl` cache，但 refresh 必须容易，因为用户经常在 ComfyUI 运行时安装 custom nodes。

### 3. Graph IR

`crates/crawclaw-native-plugins/src/comfyui.rs` graph IR types

CrawClaw 不应让 model 直接 author final ComfyUI API JSON。相反，model 应规划一个更小的 intermediate representation：

```ts
type ComfyGraphIr = {
  id: string;
  goal: string;
  mediaKind: "image" | "video" | "audio" | "mixed";
  nodes: ComfyGraphIrNode[];
  edges: ComfyGraphIrEdge[];
  outputs: ComfyGraphIrOutput[];
  notes?: string;
};
```

每个 IR node 包含：

- stable local id
- selected ComfyUI `class_type`
- purpose
- literal inputs
- input references to other IR nodes
- optional candidate alternatives

IR 是 safety boundary。Validation 在 compilation 前作用于 IR。Diagnostics 可以携带 repair hints，但没有 standalone public repair operation。

### 4. Planner

`crates/crawclaw-native-plugins/src/comfyui.rs` planner functions

Responsibilities：

- 将 user goals 转为 high-level workflow plan
- 选择 `mediaKind`
- 搜索 node catalog 中的 candidate nodes
- 生成 graph IR
- 优先使用 existing local nodes，而不是 hardcoded assumptions
- 将 seed templates 作为 hints，而不是 hard limits

Planner 可以使用小型 built-in graph patterns 来辅助 agent 定位：

- model loader
- prompt encoder
- latent/image/video initializer
- sampler or generator
- decoder or media combiner
- save/output node

这些 patterns 不定义完整 capability surface。Live catalog 才定义它。

### 5. Validator

`crates/crawclaw-native-plugins/src/comfyui.rs` validator functions

Responsibilities：

- 验证每个 `class_type` 存在
- 验证 required inputs 存在
- 验证 references 指向 existing nodes
- 在 input/output type hints 可用时检测明显 incompatible links
- 检测 missing model names 或 unresolved enum choices
- 将 errors 分类为 blocking，并在用户可行动时包含 repair hints

Diagnostics 应该是 structured：

```ts
type ComfyGraphDiagnostic = {
  code: string;
  severity: "error" | "warning";
  nodeId?: string;
  classType?: string;
  field?: string;
  message: string;
  repairHint?: string;
};
```

### 6. Diagnostics

`crates/crawclaw-native-plugins/src/comfyui.rs` diagnostics

Responsibilities：

- 为 invalid graph IR 返回 structured diagnostics
- 当 required model 或 enum 无法推断时包含 candidate choices
- 只将 `repairHint` 作为给 user 或 planner 的 guidance
- 通过 `maxPlanRepairAttempts` 保持 bounded planner attempts

Planner 绝不能 silently swap 到语义无关的 workflow。如果用户请求 video 但找不到 video path，结果应该说明哪些 video nodes 或 models 看起来缺失。

### 7. Compiler

`crates/crawclaw-native-plugins/src/comfyui.rs` compiler functions

Responsibilities：

- 将 validated IR 编译为 ComfyUI API-format JSON
- 分配 ComfyUI node ids
- 将 IR edges 转换为 `[nodeId, outputIndex]` references
- 将有用 metadata 保存在 sidecar，而不是塞入 ComfyUI workflow JSON

Compiler 只应接受 validated IR。

### 8. Output Resolver

`crates/crawclaw-native-plugins/src/comfyui.rs` output resolver

Responsibilities：

- 解析 `/history/{prompt_id}`
- 从 `images`、`videos`、`audio` 等 known arrays 和其他 file-like output entries 收集 output files
- 需要时根据 output key、filename 和 MIME 推断 kind
- 通过 `/view` 下载 files
- 将 outputs 写入 configured output directory
- 返回 stable artifact records

Output shape：

```ts
type ComfyOutputArtifact = {
  kind: "image" | "video" | "audio" | "unknown";
  nodeId: string;
  filename: string;
  subfolder?: string;
  type?: string;
  mime?: string;
  localPath?: string;
};
```

## Free Workflow Creation Model

"Free creation" 表示 CrawClaw 可以组合它从 `/object_info` 理解到的任何本地 ComfyUI nodes。它不表示 unvalidated JSON generation。

Creation loop：

1. discover local nodes
2. plan graph IR
3. validate graph IR
4. 如果 validation blocks compilation，则返回 diagnostics
5. compile to API JSON
6. optionally run

这让 model 有空间设计 custom image 和 video graphs，同时保持 runtime path deterministic 且 testable。

## Image And Video Support

第一版实现必须将 media kind 作为 first-class workflow axis。

Supported intents：

- `text-to-image`
- `image-to-image`
- `text-to-video`
- `image-to-video`
- `mixed`，用于产生多种 output kind 的 workflows

系统不应 hardcode 某一个 video ecosystem。它应从 local node catalog 检测 candidates，包括这些常见概念：

- video model loader
- image-to-video conditioning
- text-to-video conditioning
- temporal sampler
- frame interpolation
- video combine/save node
- VHS-style video output nodes

如果存在多条 valid video paths，CrawClaw 应优先选择来自 node names、required inputs 和 available model enum choices 的 local evidence 最强的路径。

## Persistence

当 `create` 以 `save: true` 成功时，写入：

- compiled workflow JSON
- graph IR JSON
- metadata sidecar

建议的 workspace layout：

```text
.crawclaw/comfyui/workflows/<slug>.workflow.json
.crawclaw/comfyui/workflows/<slug>.ir.json
.crawclaw/comfyui/workflows/<slug>.meta.json
.crawclaw/comfyui/outputs/<prompt_id>/*
```

Metadata sidecar 应包含：

- original user goal
- ComfyUI base URL
- node catalog fingerprint
- created timestamp
- media kind
- validation diagnostics
- runs 可用时的 prompt id
- output artifact records

## Safety And Approval

运行 ComfyUI 可能消耗 GPU、disk 和 time。因此第一版设计使用这些 guardrails：

- 默认只允许 loopback endpoints
- non-loopback endpoints 需要 explicit config
- 当由 model 发起时，`run` 需要 explicit approval
- uploads 只读取 allowed local roots 下的 files
- downloads 只写入 configured output directory
- cancellation 后续可以通过 `/queue` 和 `/interrupt` 添加
- errors 必须在 local paths 对 user action 无必要时 redact 它们

用户可以要求 CrawClaw 创建并验证 workflow JSON，而不运行它。提交到 ComfyUI 是 side-effect boundary。

## Error Handling

常见 failure modes 应产生 actionable responses：

- ComfyUI 不可达：报告 configured `baseUrl` 和 failed endpoint。
- `/object_info` 不可用：报告 CrawClaw 没有 node catalog 就无法安全 plan。
- Required node class 缺失：列出 missing class，并在找到时列出 candidate alternatives。
- Required model 或 enum choice 缺失：请用户从 available values 中选择。
- Workflow validation 失败：返回 diagnostics 和 last IR draft，但不 submit。
- `/prompt` 拒绝 workflow：返回 ComfyUI 的 validation error 和 node errors。
- Execution completes with no outputs：返回 history status，且不保存 empty artifact records。
- Output download 失败：保留 remote output metadata，并报告哪个 file 失败。

## Testing Plan

Unit tests：

- `baseUrl` normalization and loopback enforcement
- `/object_info` normalization
- graph IR schema validation
- validator diagnostics for missing classes and inputs
- diagnostics and bounded planner stopping behavior
- compiler output for a small valid graph
- output resolver for image, video, audio, and unknown file entries
- tool action dispatch

Integration tests with mocked ComfyUI：

- `inspect -> create -> validate`
- `create -> run -> status -> outputs`
- `/prompt` validation error with `node_errors`
- missing video nodes produces blocking diagnostics
- output download writes files only under the configured output directory

Manual or live smoke test：

1. start local ComfyUI on `127.0.0.1:8188`
2. run `inspect`
3. create a simple image workflow
4. validate it
5. submit after approval
6. download output
7. repeat with a video-capable local node set when available

## Future Work

- WebSocket progress through `/ws`
- cancellation through `/queue` and `/interrupt`
- UI page for saved ComfyUI workflows and outputs
- workflowize integration after the plugin path is stable
- n8n service-step integration for generated ComfyUI workflows
- generic `media-generation` provider capability if another backend needs the same contract
- optional curated node-pack guidance, without automatic custom-node install
- richer model/file pickers backed by local ComfyUI model lists

## Design Decisions

- Saved workflow artifacts 默认放在 workspace `.crawclaw/comfyui`。这让 generated graphs 和 outputs 靠近请求它们的 project context。
- `comfyui_workflow` 默认是 optional，因为 `run` 可能消耗 GPU、disk 和 time。用户可以通过 allowlisting tool name 或 plugin id 启用该 tool。
- 第一版实现使用 `/history/{prompt_id}` polling 获取 run status。通过 `/ws` 的 WebSocket progress 是 future work。
- 普通 chat responses 展示 concise graph summary、validation diagnostics 和 saved artifact paths。Full graph IR 保存到 disk，仅在请求时展示。

## Success Criteria

第一版实现完成的条件：

- CrawClaw 可以 inspect 本地 ComfyUI node catalog。
- CrawClaw 可以为 image generation 创建 validated ComfyUI graph。
- 当 required local nodes 存在时，CrawClaw 可以为 video generation 创建 validated ComfyUI graph。
- Invalid 或 unsupported graphs 会在 `/prompt` 前被 blocked。
- CrawClaw 可以将 approved graph 提交到 local ComfyUI。
- CrawClaw 可以 parse history 并下载 generated outputs。
- 实现由 plugin 拥有，且不改变 core n8n workflow semantics。
