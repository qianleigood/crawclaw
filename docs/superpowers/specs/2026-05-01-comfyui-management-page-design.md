---
title: "ComfyUI Management Page Design"
summary: "Design for a CrawClaw admin page that manages ComfyUI workflows, run history, outputs, and links back to the ComfyUI UI"
read_when:
  - You are implementing the ComfyUI management page
  - You need the UI/backend boundary for ComfyUI workflows and outputs
---

# ComfyUI Management Page Design

> Historical note: this design was written while the admin frontend target lived
> under `.tmp/openclaw-admin`. The tracked admin app now lives under
> `apps/crawclaw-admin`; treat `.tmp/openclaw-admin` and OpenClaw Admin wording
> below as implementation history, not the current source path.

## Summary

CrawClaw should add a ComfyUI management page that acts as an operations index
for local ComfyUI workflows. The page should show workflows CrawClaw knows
about, provide a clear link to open the native ComfyUI UI for graph editing,
show recent invocations, and surface generated outputs.

This page should not recreate the ComfyUI node editor inside CrawClaw. CrawClaw
owns workflow discovery, metadata, run actions, run history, and output browsing.
ComfyUI remains the place where users adjust the graph itself.

The current implementation target is the Vue admin app under
`.tmp/openclaw-admin`, using its existing Vue 3, Pinia, router, i18n, RPC client,
and Naive UI patterns. If this admin app is later moved into a tracked package,
the same page design should move with it.

## Goals

- Add a first-class OpenClaw Admin route for ComfyUI management.
- Show the current ComfyUI connection state and configured base URL.
- List saved workflows known to CrawClaw.
- Let users open the native ComfyUI page for graph adjustment.
- Show recent ComfyUI runs with status, prompt id, duration, error summary, and
  output count.
- Show recent output artifacts with type, filename, created time, and local or
  served URL when available.
- Keep dangerous side effects explicit: running a workflow remains a deliberate
  action and should use the existing approval/tool boundary when applicable.

## Non-Goals

- Do not embed or reimplement the ComfyUI graph editor.
- Do not install ComfyUI, custom nodes, or models.
- Do not expose raw filesystem browsing beyond ComfyUI workflow/output roots.
- Do not add queue cancellation, live WebSocket progress, or model management in
  the first page pass.
- Do not make a generic image/video provider dashboard.

## Existing Fit

The existing `extensions/comfyui` plugin already provides the workflow execution
core through the optional `comfyui_workflow` tool:

- `inspect` checks the local node catalog and system stats.
- `create` can save workflow artifacts.
- `validate` checks a workflow against the local catalog.
- `run` submits a workflow and can wait for completion and download outputs.
- `status` reads prompt history.
- `outputs` collects and optionally downloads output artifacts.

The gap is discoverability and history. The current store can save and load by
workflow id, but the UI needs list-style data:

- saved workflow summaries
- recent run summaries
- recent output summaries

The first backend addition should be a small ComfyUI control-plane surface
rather than a second execution path.

## Page Structure

The page should use the existing admin layout and appear under the OpenClaw
gateway navigation as `ComfyUI`.

Primary regions:

1. Header status bar
   - plugin state
   - configured base URL
   - connection/catalog refresh action
   - "Open ComfyUI" external link

2. Workflow list
   - workflow name/id
   - media kind
   - last run status
   - output count
   - last updated time

3. Workflow detail
   - selected workflow metadata
   - diagnostics from last validation
   - actions: validate, run, open in ComfyUI
   - raw prompt/IR file paths only when useful and safe to display

4. Recent runs
   - prompt id
   - workflow id
   - status: queued, running, success, failed, timed out, unknown
   - started/completed times
   - duration
   - error summary
   - output count

5. Recent outputs
   - artifact kind: image, video, audio, unknown
   - filename
   - originating prompt id
   - local path or media URL when available
   - open/download affordance when the existing backend can safely serve it

## Backend Surface

Add a narrow gateway or plugin-backed control-plane method set. The exact method
names can follow the gateway convention chosen during implementation, but the
capabilities should stay small:

- list ComfyUI workflows
- get one ComfyUI workflow detail
- list recent ComfyUI runs
- list recent ComfyUI outputs
- validate a workflow through the existing plugin logic
- run a workflow through the existing plugin/tool logic

The list methods should read from CrawClaw-owned workflow/output metadata under
the configured ComfyUI roots. They should not scan arbitrary directories.

Run history should be persisted as CrawClaw-owned sidecar metadata next to
workflow/output artifacts. The page should not depend on the user keeping the
browser open during generation.

## ComfyUI Link Behavior

The first implementation should expose one guaranteed link type:

- Open ComfyUI home: `${baseUrl}/`

The selected workflow detail can show the saved prompt/workflow artifact so the
user can import or adjust it in ComfyUI. The first pass should not invent a
workflow deep link unless the implementation verifies a stable local ComfyUI
route for it.

## Data Flow

1. The page loads config and calls the ComfyUI summary/list methods.
2. Selecting a workflow loads detail, recent runs, and outputs scoped to that
   workflow.
3. "Validate" calls the backend validation method and refreshes diagnostics.
4. "Run" asks for user confirmation in the UI, calls the backend run method, and
   refreshes recent runs/outputs after completion or failure.
5. "Open ComfyUI" opens the configured base URL in a new tab.

## Error Handling

- If ComfyUI is unreachable, show the configured base URL and the failed probe
  summary.
- If the plugin is disabled or missing, show a clear setup state and link to the
  tool/plugin configuration path already used by the admin app.
- If workflow metadata is missing or malformed, show the workflow id and skip
  that entry instead of breaking the whole page.
- If outputs exist on disk but cannot be served, show metadata and explain that
  preview is unavailable.
- If a run fails, preserve the prompt id and error summary in recent history.

## Testing

Backend:

- Unit test workflow list normalization from saved artifact files.
- Unit test run-history persistence and failed-run rendering data.
- Unit test path boundaries so list/output methods stay inside configured
  ComfyUI roots.

Frontend:

- Build/typecheck the admin app.
- Component or store-level tests if the admin app test harness is available.
- Manual smoke with a running gateway:
  - page loads with ComfyUI unreachable
  - page loads with local ComfyUI reachable
  - saved workflow appears in the list
  - validate updates diagnostics
  - run produces a recent run record
  - generated outputs appear after completion

## First-Pass Decisions

- Persist run history as CrawClaw-owned sidecar metadata under the configured
  ComfyUI workflow/output roots.
- Guarantee an "Open ComfyUI" link to the configured base URL.
- Treat selected-workflow deep linking as a later enhancement unless the
  implementation verifies a stable ComfyUI route.
