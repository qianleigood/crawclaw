---
title: "ComfyUI Tool"
summary: "Create, validate, run, and download local ComfyUI image and video workflows"
read_when:
  - You want CrawClaw to build local ComfyUI workflows
  - You need to enable the comfyui_workflow tool
  - You are debugging local ComfyUI graph validation or output downloads
---

# ComfyUI tool

`comfyui_workflow` lets CrawClaw inspect a local ComfyUI server, create a
validated graph, compile it to ComfyUI API-format prompt JSON, run it after
approval, and download generated outputs.

This tool is plugin-owned. It does not replace the `image` analysis tool, does
not restore `image_generate`, and does not change n8n workflow semantics.

## Availability

ComfyUI must already be installed and running. CrawClaw talks to the local
ComfyUI HTTP API directly and does not install ComfyUI, custom nodes, or models.

The bundled `comfyui` plugin registers `comfyui_workflow` as an optional tool.
Enable it with either the tool name or plugin id:

```json5
{
  tools: {
    allow: ["comfyui_workflow"],
  },
}
```

or:

```json5
{
  tools: {
    allow: ["comfyui"],
  },
}
```

## Config

Default config:

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

Only loopback hosts such as `127.0.0.1`, `localhost`, and `::1` are allowed by
default. A non-loopback endpoint requires explicit config:

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

`comfyui_workflow` uses one tool with multiple actions:

- `inspect`: fetch `/object_info`, summarize available nodes, and show video
  output candidates.
- `create`: build graph IR, validate it, compile API prompt JSON, and optionally
  save artifacts.
- `validate`: validate saved or provided graph IR against the live node catalog.
- `repair`: fill safe defaults for repairable graph IR diagnostics.
- `run`: submit a saved or validated graph after plugin approval.
- `status`: read `/history/{prompt_id}` for a run.
- `outputs`: parse history outputs and optionally download files through
  `/view`.

`run` does not accept raw ComfyUI prompt JSON. It must use a saved workflow id or
validated CrawClaw graph IR so validation happens before `/prompt`.

## Image and Video

Image and video are both first-class media kinds. The planner uses the local
node catalog instead of a fixed template list. If video nodes are not present,
CrawClaw returns blocking diagnostics instead of silently changing the request
to an image workflow.

Video support depends on the local ComfyUI installation. Common signals include
video combine/save nodes, VHS-style nodes, temporal samplers, image-to-video
conditioning, and video model loaders.

## Artifacts

Saved workflows use workspace-local paths:

```text
.crawclaw/comfyui/workflows/<slug>.ir.json
.crawclaw/comfyui/workflows/<slug>.prompt.json
.crawclaw/comfyui/workflows/<slug>.meta.json
.crawclaw/comfyui/outputs/<prompt_id>/*
```

The IR file is the CrawClaw graph representation used for validation and
repair. The prompt file is the ComfyUI API-format JSON submitted to `/prompt`.
The metadata sidecar records the original goal, ComfyUI base URL, catalog
fingerprint, diagnostics, run id, and output artifacts.

## Local API

The tool relies on local ComfyUI routes documented by ComfyUI:

- `GET /system_stats`
- `GET /object_info`
- `POST /prompt`
- `GET /history/{prompt_id}`
- `GET /view`
- `POST /upload/image`

See the ComfyUI server route reference at
[https://docs.comfy.org/development/comfyui-server/comms_routes](https://docs.comfy.org/development/comfyui-server/comms_routes).

## Related

- [Image Tool](/tools/image) for image analysis
- [Plugins](/tools/plugin) for plugin enablement and installation behavior
- [Exec approvals](/tools/exec-approvals) for approval flow concepts
