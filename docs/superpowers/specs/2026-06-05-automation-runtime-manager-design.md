---
title: "Automation Runtime Manager Design"
summary: "Design for Desktop-managed n8n and ComfyUI local automation runtimes"
read_when:
  - You are implementing Desktop-managed n8n or ComfyUI installation
  - You are changing automation runtime manifests, health checks, or service lifecycle
  - You need the boundary between runtime installation, Gateway workflow control, and plugin tools
---

# Automation Runtime Manager Design

## Goal

Add an Automation Runtime Manager to CrawClaw Desktop so heavy local automation
services such as n8n and ComfyUI can be discovered, installed, started, repaired,
upgraded, and bound to the existing Gateway workflow and plugin surfaces.

## Current State

The current automation UI can submit ComfyUI, n8n, and cron requests, but n8n
and ComfyUI are assumed to already exist. The current ComfyUI tool documentation
also states that ComfyUI must already be installed and running. The runtime
manifest already has a `managedRuntimes` map for managed local dependencies such
as browser and SearXNG. This design extends that model to automation services.

## Non-Goals

- Do not embed a full n8n or ComfyUI distribution in the main Desktop app.
- Do not execute scripts from a moving Git branch such as `main`.
- Do not store API keys, trigger tokens, or local service credentials in runtime
  manifests.
- Do not replace the existing n8n workflow broker or `comfyui_workflow` plugin.
- Do not turn cron into an installable runtime. Cron remains an internal trigger
  layer.

## Architecture

Automation Runtime Manager is a Desktop-owned lifecycle layer.

```text
CrawClaw Desktop
  -> Automation Runtime Manager
       -> runtime manifest cache
       -> installer script verifier
       -> installer script runner
       -> local service supervisor
       -> health checker
       -> repair and uninstall actions
  -> Gateway
       -> workflow.n8n config
       -> plugin config injection
       -> workflow and tool APIs
  -> Runtime tools
       -> cron
       -> workflow / workflowize
       -> comfyui_workflow
```

The manager owns installation and process lifecycle. Gateway owns workflow
control, registry state, callbacks, and tool execution. Plugins own service
specific tool calls once a service is ready.

## Runtime Manifest

The embedded runtime manifest should advertise installable automation services
under `managedRuntimes`. The first manifest slice is descriptive and does not
execute installers by itself.

Required n8n fields:

- `runtime`: `node-service`
- `provider`: `n8n`
- `service`: `n8n`
- `baseUrl`: loopback default
- `defaultPort`: loopback default port
- `install`: installer channel metadata
- `license`: license identifier or product license name

Required ComfyUI fields:

- `runtime`: `python-service`
- `provider`: `comfyui`
- `service`: `comfyui`
- `baseUrl`: loopback default
- `defaultPort`: loopback default port
- `install`: installer channel metadata
- `computeProfiles`: hardware-specific install profiles
- `license`: license identifier

## Installer Channel

Installer scripts may live on GitHub, but they must be versioned release assets
for the current app release. Desktop must not execute
`raw.githubusercontent.com/.../main/...` scripts or a moving
`releases/latest/download/...` asset.

Installer flow:

1. Download a signed or checksum-pinned installer manifest from the app version's
   GitHub release tag.
2. Select the service and platform profile.
3. Show disk, network, GPU, and license implications to the user.
4. Download the referenced installer script.
5. Verify checksum, and signature when available.
6. Execute the script with a constrained environment.
7. Parse JSON progress and final status.
8. Record the installed runtime state locally.

Scripts must be idempotent. A repeated install is a repair.

Scripts must not receive, print, or persist secrets. Desktop generates and stores
n8n credentials and tokens through the local secret surface after installation.

The embedded runtime manifest pins the installer script SHA-256. The release
manifest must declare the same checksum, so a remote manifest and script cannot
move independently of the app version that will execute them.

## ComfyUI Compute Profiles

ComfyUI installation must be profile based because PyTorch wheels differ by
hardware and operating system.

Supported profile ids:

- `apple-metal`: macOS Apple Silicon and MPS-capable PyTorch.
- `nvidia-cuda`: NVIDIA GPUs and CUDA PyTorch wheels.
- `amd-rocm`: AMD GPUs and ROCm PyTorch wheels.
- `intel-xpu`: Intel GPU support, initially experimental.
- `cpu`: CPU fallback, explicitly marked as slow.
- `external`: user-managed ComfyUI; CrawClaw binds only to an existing `baseUrl`.

Profile selection:

1. Detect hardware through platform-specific probes.
2. Recommend one profile.
3. Allow manual override before installation.
4. Install the matching Python, virtual environment, PyTorch wheel, and ComfyUI
   package/source.
5. Verify `import torch` and the expected backend availability.
6. Start ComfyUI on loopback.
7. Probe `/system_stats` and `/object_info`.

The PyTorch index URL and exact install command are manifest data, not UI
constants. Profiles should provide a safe default wheel channel when CrawClaw can
name one, and users can override it through `PYTORCH_INDEX_URL` when their GPU,
driver, or platform needs a different PyTorch channel.

## n8n Runtime

n8n installation is a managed Node service:

1. Install or reuse the CrawClaw-managed Node runtime.
2. Install the pinned n8n package into the managed runtime directory.
3. Create a local n8n data directory.
4. Generate local credentials and trigger tokens through Desktop/Gateway secret
   storage.
5. Start n8n on loopback.
6. Probe the local API.
7. Write non-secret workflow config so existing workflow methods can publish and
   run n8n workflows.

## UI

The Automation workspace should become a status and binding surface:

- Runtime overview: Gateway, Cron, n8n, ComfyUI.
- Runtime cards: install, start, stop, repair, logs, uninstall.
- ComfyUI install path: external bind or managed install with compute profile.
- n8n install path: external bind or managed install.
- Binding wizard: bind ready services to an agent, workflow, or cron trigger.
- Diagnostics: port conflicts, missing files, failed health checks, and script
  output.

The UI must not show raw secret values.

## State

Suggested local state layout:

```text
~/.crawclaw/runtimes/automation/manifest.cache.json
~/.crawclaw/runtimes/n8n/
~/.crawclaw/runtimes/comfyui/<profile>/
~/.crawclaw/logs/automation-runtime-manager/
```

Suggested non-secret config:

```json
{
  "automation": {
    "runtimes": {
      "n8n": {
        "mode": "managed",
        "baseUrl": "http://127.0.0.1:5679"
      },
      "comfyui": {
        "mode": "managed",
        "profile": "nvidia-cuda",
        "baseUrl": "http://127.0.0.1:8188"
      }
    }
  }
}
```

## Current Implementation Slice

The current slice is larger than the original manifest-only cut, but still has a
bounded contract:

1. Advertise n8n and ComfyUI in the staged runtime manifest.
2. Include installer channel metadata, loopback defaults, license metadata, and
   ComfyUI compute profile ids.
3. Stage release-manifest and installer-script assets into the packaged Desktop
   runtime tree.
4. Expose Desktop API routes to refresh, install, start, and stop managed
   automation runtimes.
5. Surface runtime status, health, logs, process id, and ComfyUI profile
   selection in the Automation workspace.
6. Keep installer defaults pinned: n8n defaults to `2.23.3`, and ComfyUI defaults
   to source ref `5aa71b9bc28809a16596bb9fa3d0a6300d8e3f0e`.
7. Stage release assets into `dist/automation/` and expose a checked
   `automation-release-assets` command that prints the exact `gh release upload`
   command for a release tag. The command requires the requested tag to point at
   the current `HEAD` by default; intentional backfills must pass
   `--allow-tag-mismatch`.

This slice still does not execute GitHub release uploads, generate service
credentials, bind n8n config automatically, or add uninstall/upgrade flows.

## Verification

Minimum verification for this slice:

```bash
cargo test -p crawclaw-runtime desktop_runtime_manifest_advertises_automation_runtime_manager_services -- --nocapture
cargo test -p crawclaw-runtime automation_runtime_release_manifests_match_install_scripts -- --nocapture
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml gateway_automation_runtime_lifecycle_installs_starts_and_stops_managed_runtime -- --nocapture
```

Broader follow-up gates before landing:

```bash
pnpm desktop:contract:check
pnpm docs:check-links
pnpm build
```
