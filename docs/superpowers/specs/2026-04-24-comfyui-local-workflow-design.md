# Local ComfyUI Workflow Builder Design

## Summary

CrawClaw should integrate with a local ComfyUI server as a plugin-backed media
workflow builder. The goal is not to ship a small fixed set of ComfyUI
templates. The goal is for CrawClaw to inspect the user's actual local ComfyUI
node surface, plan a graph for an image or video generation request, validate
that graph against the live node catalog, repair invalid plans when possible,
compile the validated graph to ComfyUI API-format JSON, run it on the local
ComfyUI queue, and download generated outputs.

The first implementation targets local ComfyUI, normally
`http://127.0.0.1:8188`. ComfyUI Cloud, n8n deployment, and a generic
cross-provider image-generation capability are intentionally left out of the
first pass.

## Goals

- Add a bundled `comfyui` plugin instead of adding new ComfyUI behavior to core
  agent tools.
- Let CrawClaw freely create ComfyUI workflows from the local node catalog,
  rather than selecting only from hardcoded templates.
- Support image and video workflows from the start.
- Treat ComfyUI API-format workflow JSON as an output artifact that can be
  inspected, saved, and rerun.
- Submit validated workflows to the local ComfyUI `/prompt` queue.
- Track execution status through `/history/{prompt_id}` in the first pass, with
  WebSocket progress as a later improvement.
- Download generated images, videos, audio, and unknown files through `/view`.
- Return structured diagnostics when required nodes, model choices, or inputs
  are missing.
- Keep the implementation bounded enough to test with mocked ComfyUI APIs and a
  real local ComfyUI smoke test.

## Non-Goals

- Do not install or manage ComfyUI itself.
- Do not install ComfyUI custom nodes or models.
- Do not support ComfyUI Cloud in the first pass.
- Do not add a second CrawClaw workflow engine.
- Do not wire this into `workflowize` or n8n in the first pass.
- Do not reintroduce a core `image_generate` tool.
- Do not define a generic image/video generation provider capability yet.
- Do not guarantee that every arbitrary prompt can produce a valid graph on
  every local ComfyUI installation.

## Current Project Fit

CrawClaw already has the right extension boundary for this work:

- bundled plugins live under `extensions/`
- non-channel plugins use `definePluginEntry`
- plugins can register agent tools and services
- plugin-owned dependencies stay in the plugin package
- core workflow execution is currently centered on n8n and should not be
  expanded for this first ComfyUI pass

The ComfyUI integration should therefore start as `extensions/comfyui`.

The existing workflow subsystem remains a future consumer. Once this plugin can
create and run real ComfyUI graphs reliably, CrawClaw can later workflowize a
successful ComfyUI generation run into the n8n-backed workflow registry.

## ComfyUI API Assumptions

The local ComfyUI server exposes the API surface needed for this integration:

- `GET /object_info` for available node definitions
- `GET /system_stats` for basic health and device information
- `GET /features` for feature discovery when available
- `POST /upload/image` for image inputs
- `POST /prompt` for queue submission
- `GET /history/{prompt_id}` for completed execution data
- `GET /view` for output file retrieval
- `GET /queue` for queue state when needed
- `POST /queue` or `POST /interrupt` for later cancellation support
- `GET /ws` for later live progress support

The first implementation should not depend on the browser UI. It should talk to
the local HTTP API directly.

## User Experience

The user asks for a media generation task in natural language:

> Create a short cinematic video of a red crab walking through neon rain.

CrawClaw should:

1. inspect the local ComfyUI node catalog if the cache is missing or stale
2. infer the requested workflow kind, such as `text-to-video`
3. plan a graph using nodes that exist in this local ComfyUI instance
4. explain missing required nodes or model choices if the plan cannot be built
5. compile and save a ComfyUI API-format workflow JSON artifact
6. ask for confirmation before running the local generation job
7. submit the workflow to `/prompt`
8. track completion
9. download and report output artifacts

For a reusable workflow request, CrawClaw should save the generated workflow JSON
and a small metadata sidecar so the user can ask to rerun or modify it later.

## Plugin Shape

### Package

Add a bundled plugin:

- `extensions/comfyui/package.json`
- `extensions/comfyui/crawclaw.plugin.json`
- `extensions/comfyui/index.ts`
- `extensions/comfyui/src/*`

The plugin id is `comfyui`. The package name should align with repo naming
rules, for example `@crawclaw/comfyui-plugin`.

### Config

Plugin config:

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

Default behavior:

- `baseUrl` defaults to `http://127.0.0.1:8188`
- only loopback hosts are allowed by default
- non-loopback `baseUrl` requires explicit config
- outputs are written under the active workspace unless the user configures a
  different allowed path

### Tool

Register one optional tool named `comfyui_workflow`.

Actions:

- `inspect`
- `plan`
- `create`
- `validate`
- `repair`
- `run`
- `status`
- `outputs`

The tool can expose a single discriminated parameter shape:

```ts
type ComfyUiWorkflowAction =
  | { action: "inspect"; refresh?: boolean }
  | { action: "plan"; goal: string; mediaKind?: "image" | "video" | "audio" | "auto" }
  | { action: "create"; goal: string; inputs?: Record<string, unknown>; save?: boolean }
  | { action: "validate"; workflow: unknown }
  | { action: "repair"; workflow: unknown; diagnostics: unknown[] }
  | { action: "run"; workflow: unknown; inputs?: Record<string, unknown>; approved?: boolean }
  | { action: "status"; promptId: string }
  | { action: "outputs"; promptId: string; download?: boolean };
```

`run` must require explicit approval metadata before submitting to ComfyUI when
the action is initiated by the model.

## Internal Architecture

### 1. ComfyUI Client

`src/client.ts`

Responsibilities:

- normalize and validate `baseUrl`
- call ComfyUI HTTP endpoints
- redact sensitive request details in errors
- enforce request timeouts
- parse JSON responses through schemas
- download output files safely

This module should not know about graph planning.

### 2. Node Catalog

`src/node-catalog.ts`

Responsibilities:

- fetch `/object_info`
- normalize node definitions into a stable internal catalog
- index by `class_type`
- expose node input metadata, required fields, optional fields, enum choices,
  and loose input/output type hints
- provide search helpers for node classes by capability-like signals

The catalog should be cacheable per `baseUrl`, but refresh must be easy because
users often install custom nodes while ComfyUI is running.

### 3. Graph IR

`src/graph-ir.ts`

CrawClaw should not let the model directly author final ComfyUI API JSON.
Instead, the model plans a smaller intermediate representation:

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

Each IR node includes:

- stable local id
- selected ComfyUI `class_type`
- purpose
- literal inputs
- input references to other IR nodes
- optional candidate alternatives

The IR is the safety boundary. Validation and repair operate on IR before
compilation.

### 4. Planner

`src/planner.ts`

Responsibilities:

- convert user goals into a high-level workflow plan
- choose `mediaKind`
- search the node catalog for candidate nodes
- produce graph IR
- prefer existing local nodes over hardcoded assumptions
- keep seed templates as hints, not as hard limits

The planner can use small built-in graph patterns to orient the agent:

- model loader
- prompt encoder
- latent/image/video initializer
- sampler or generator
- decoder or media combiner
- save/output node

These patterns do not define the full capability surface. The live catalog does.

### 5. Validator

`src/validator.ts`

Responsibilities:

- verify every `class_type` exists
- verify required inputs are present
- verify references point to existing nodes
- detect obviously incompatible links when input/output type hints are available
- detect missing model names or unresolved enum choices
- classify errors as repairable or blocking

Diagnostics should be structured:

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

### 6. Repair Loop

`src/repair.ts`

Responsibilities:

- take graph IR and diagnostics
- search for replacement nodes when a class is missing
- fill missing required inputs from defaults or user inputs when safe
- ask for user input when a required model/file choice cannot be inferred
- stop after `maxPlanRepairAttempts`

Repair should never silently swap to a semantically unrelated workflow. If the
user asks for video and no video path can be found, the result should say which
video nodes or models appear to be missing.

### 7. Compiler

`src/compiler.ts`

Responsibilities:

- compile validated IR to ComfyUI API-format JSON
- assign ComfyUI node ids
- translate IR edges into `[nodeId, outputIndex]` references
- preserve useful metadata in a sidecar rather than stuffing it into ComfyUI
  workflow JSON

The compiler should only accept validated IR.

### 8. Output Resolver

`src/outputs.ts`

Responsibilities:

- parse `/history/{prompt_id}`
- collect output files from known arrays such as `images`, `videos`, `audio`,
  and other file-like output entries
- infer kind from output key, filename, and MIME when needed
- download files through `/view`
- write outputs to the configured output directory
- return stable artifact records

Output shape:

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

"Free creation" means CrawClaw can combine any local ComfyUI nodes it can
understand from `/object_info`. It does not mean unvalidated JSON generation.

The creation loop is:

1. discover local nodes
2. plan graph IR
3. validate graph IR
4. repair graph IR
5. validate again
6. compile to API JSON
7. optionally run

This gives the model room to design custom image and video graphs while keeping
the runtime path deterministic and testable.

## Image And Video Support

The first implementation must treat media kind as a first-class workflow axis.

Supported intents:

- `text-to-image`
- `image-to-image`
- `text-to-video`
- `image-to-video`
- `mixed` for workflows that produce more than one output kind

The system should not hardcode one video ecosystem. It should detect candidates
from the local node catalog, including common concepts such as:

- video model loader
- image-to-video conditioning
- text-to-video conditioning
- temporal sampler
- frame interpolation
- video combine/save node
- VHS-style video output nodes

If multiple valid video paths are available, CrawClaw should prefer the one with
the strongest local evidence from node names, required inputs, and available
model enum choices.

## Persistence

When `create` succeeds with `save: true`, write:

- compiled workflow JSON
- graph IR JSON
- metadata sidecar

Suggested workspace layout:

```text
.crawclaw/comfyui/workflows/<slug>.workflow.json
.crawclaw/comfyui/workflows/<slug>.ir.json
.crawclaw/comfyui/workflows/<slug>.meta.json
.crawclaw/comfyui/outputs/<prompt_id>/*
```

The metadata sidecar should include:

- original user goal
- ComfyUI base URL
- node catalog fingerprint
- created timestamp
- media kind
- validation diagnostics
- prompt id for runs, when available
- output artifact records

## Safety And Approval

Running ComfyUI can consume GPU, disk, and time. The first design therefore uses
these guardrails:

- only loopback endpoints are allowed by default
- non-loopback endpoints require explicit config
- `run` requires explicit approval when initiated by the model
- uploads only read files from allowed local roots
- downloads write only under the configured output directory
- cancellation can be added later through `/queue` and `/interrupt`
- errors must redact local paths where they are not needed for user action

The user can ask CrawClaw to create and validate workflow JSON without running
it. Submission to ComfyUI is the side-effect boundary.

## Error Handling

Common failure modes should produce actionable responses:

- ComfyUI is not reachable: report the configured `baseUrl` and the failed
  endpoint.
- `/object_info` is unavailable: report that CrawClaw cannot plan safely without
  the node catalog.
- Required node class is missing: list the missing class and candidate
  alternatives if any were found.
- Required model or enum choice is missing: ask the user to choose from the
  available values.
- Workflow validation fails after repairs: return diagnostics and the last IR
  draft, but do not submit.
- `/prompt` rejects the workflow: return ComfyUI's validation error and node
  errors.
- Execution completes with no outputs: return history status and save no empty
  artifact records.
- Output download fails: keep the remote output metadata and report which file
  failed.

## Testing Plan

Unit tests:

- `baseUrl` normalization and loopback enforcement
- `/object_info` normalization
- graph IR schema validation
- validator diagnostics for missing classes and inputs
- repair loop stopping behavior
- compiler output for a small valid graph
- output resolver for image, video, audio, and unknown file entries
- tool action dispatch

Integration tests with mocked ComfyUI:

- `inspect -> create -> validate`
- `create -> run -> status -> outputs`
- `/prompt` validation error with `node_errors`
- missing video nodes produces blocking diagnostics
- output download writes files only under the configured output directory

Manual or live smoke test:

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
- generic `media-generation` provider capability if another backend needs the
  same contract
- optional curated node-pack guidance, without automatic custom-node install
- richer model/file pickers backed by local ComfyUI model lists

## Design Decisions

- Saved workflow artifacts live in workspace `.crawclaw/comfyui` by default.
  This keeps generated graphs and outputs close to the project context that
  requested them.
- `comfyui_workflow` is optional by default because `run` can consume GPU, disk,
  and time. Users can enable the tool by allowlisting the tool name or plugin id.
- The first implementation uses polling through `/history/{prompt_id}` for run
  status. WebSocket progress through `/ws` is future work.
- Normal chat responses show a concise graph summary, validation diagnostics,
  and saved artifact paths. Full graph IR is saved to disk and shown only when
  requested.

## Success Criteria

The first implementation is complete when:

- CrawClaw can inspect a local ComfyUI node catalog.
- CrawClaw can create a validated ComfyUI graph for image generation.
- CrawClaw can create a validated ComfyUI graph for video generation when the
  required local nodes exist.
- Invalid or unsupported graphs are blocked before `/prompt`.
- CrawClaw can submit an approved graph to local ComfyUI.
- CrawClaw can parse history and download generated outputs.
- The implementation is plugin-owned and does not alter core n8n workflow
  semantics.
