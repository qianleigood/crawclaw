---
title: "Automation Environment Design"
summary: "Desktop-managed n8n 和 ComfyUI 本地 automation runtimes 的设计"
x-i18n:
  generated_at: "2026-06-10T12:26:38Z"
  model: codex
  provider: openai
  source_hash: 71603bec39f3ec75a69336d333a67e154637dc474d15314db474498f07123b66
  source_path: superpowers/specs/2026-06-05-automation-environment-design.md
  workflow: 15
---

# Automation Environment Design

## Goal

向 CrawClaw Desktop 添加 Automation Environment，让 n8n 和 ComfyUI 这类较重的本地 automation services 可以被发现、安装、启动、停止、健康检查，并绑定到现有 Gateway workflow 和 plugin surfaces。

## Current State

在这个 slice 之前，Automation UI 可以提交 ComfyUI、n8n 和 cron 请求，但 n8n 与 ComfyUI 被假定已经存在。Runtime manifest 已经为 browser、SearXNG 等 managed local dependencies 提供了 `managedRuntimes` map。

当前 slice 将该模型扩展到 automation services。Desktop Settings 现在拥有 n8n 和 ComfyUI 的 Automation Environment section，负责安装、健康和本地进程生命周期；Automation workspace 则展示 ComfyUI、n8n 和 Cron 的执行数据。

## Non-Goals

- 不把完整 n8n 或 ComfyUI distribution 嵌入主 Desktop app。
- 不执行来自 `main` 这类 moving Git branch 的 scripts。
- 不在 runtime manifests 中存储 API keys、trigger tokens 或本地 service credentials。
- 不替换现有 n8n workflow broker 或 `comfyui_workflow` plugin。
- 不把 cron 变成 installable runtime。Cron 仍然是 internal trigger layer。

## Architecture

Automation Environment 是 Desktop-owned lifecycle layer。

```text
CrawClaw Desktop
  -> Automation Environment
       -> runtime manifest cache
       -> installer script verifier
       -> installer script runner
       -> local service supervisor
       -> health checker
       -> install, start, stop, and refresh actions
  -> Gateway
       -> workflow.n8n config
       -> plugin config injection
       -> workflow and tool APIs
  -> Runtime tools
       -> cron
       -> workflow / workflowize
       -> comfyui_workflow
```

Automation Environment 拥有安装和进程生命周期。Gateway 拥有 workflow control、registry state、callbacks 和 tool execution。Plugins 在 service ready 后拥有 service-specific tool calls。

## Runtime Manifest

Embedded runtime manifest 应该在 `managedRuntimes` 下声明可安装的 automation services。第一版 manifest slice 是描述性的，本身不执行 installers。

Required n8n fields：

- `runtime`: `node-service`
- `provider`: `n8n`
- `service`: `n8n`
- `baseUrl`: loopback default
- `defaultPort`: loopback default port
- `install`: installer channel metadata
- `license`: license identifier 或 product license name

Required ComfyUI fields：

- `runtime`: `python-service`
- `provider`: `comfyui`
- `service`: `comfyui`
- `baseUrl`: loopback default
- `defaultPort`: loopback default port
- `install`: installer channel metadata
- `computeProfiles`: hardware-specific install profiles
- `license`: license identifier

## Installer Channel

Installer scripts 可以放在 GitHub 上，但必须是当前 app release 的 versioned release assets。Desktop 不能执行 `raw.githubusercontent.com/.../main/...` scripts，也不能执行 moving `releases/latest/download/...` asset。

Installer flow：

1. 从 app version 的 GitHub release tag 下载 signed 或 checksum-pinned installer manifest。
2. 选择 service 和 platform profile。
3. 向用户展示 disk、network、GPU 和 license implications。
4. 下载引用的 installer script。
5. 校验 checksum；可用时也校验 signature。
6. 用 constrained environment 执行 script。
7. 将 stdout/stderr 捕获到 runtime install log。
8. 使用 installer exit status 和写入的 `runtime.json` 作为 installed runtime record。

Scripts 必须 idempotent，让重复安装可以安全地在 script layer 修复文件，即便 Desktop UI 不暴露单独的 repair action。

Scripts 不得接收、打印或持久化 secrets。n8n credential generation 和 workflow config binding 是明确的未来工作，不属于当前 Automation Environment slice。

Embedded runtime manifest 会 pin installer script SHA-256。Release manifest 必须声明同一个 checksum，这样 remote manifest 和 script 不能脱离将执行它们的 app version 独立移动。

## ComfyUI Compute Profiles

ComfyUI 安装必须基于 profile，因为 PyTorch wheels 会随硬件和操作系统不同而变化。

Supported profile ids：

- `apple-metal`: macOS Apple Silicon 与 MPS-capable PyTorch。
- `nvidia-cuda`: NVIDIA GPUs 与 CUDA PyTorch wheels。
- `amd-rocm`: AMD GPUs 与 ROCm PyTorch wheels。
- `intel-xpu`: Intel GPU support，初期为 experimental。
- `cpu`: CPU fallback，明确标记为 slow。
- `external`: user-managed ComfyUI；CrawClaw 只绑定到已有 `baseUrl`。

Profile selection：

1. 通过 platform-specific probes 检测硬件。
2. 推荐一个 profile。
3. 安装前允许手动 override。
4. 安装匹配的 Python、virtual environment、PyTorch wheel 和 ComfyUI package/source。
5. 验证 `import torch` 和预期 backend availability。
6. 在 loopback 上启动 ComfyUI。
7. Probe `/system_stats` 和 `/object_info`。

PyTorch index URL 和精确 install command 是 manifest data，而不是 UI constants。Profiles 应在 CrawClaw 可以明确命名时提供 safe default wheel channel；当用户的 GPU、driver 或 platform 需要不同 PyTorch channel 时，可以通过 `PYTORCH_INDEX_URL` override。

## n8n Runtime

n8n installation 是 managed Node service：

1. 安装或复用兼容的 local Node/npm runtime。
2. 将 pinned n8n package 安装到 managed runtime directory。
3. 通过 generated start script 创建 local n8n data directory。
4. 写入包含 loopback base URL 和 start script path 的 `runtime.json`。
5. 在 loopback 上启动 n8n。
6. Probe local health endpoint。

Future slices 可以生成 local credentials，并写入 non-secret workflow config，让 workflow methods 可以自动 publish 和 run n8n workflows。当前 slice 有意停在 install、start、stop、refresh、health 和 log reporting。

## UI

Automation Environment 属于 Desktop Settings，而 Automation workspace 仍然是 execution surface。

Settings 应暴露 Automation Environment section：

- 只包含 n8n 和 ComfyUI runtime cards。Cron 内置在 Gateway scheduler 中，不作为 installable environment 展示。
- Runtime status、endpoint、health、process id、logs、install policy，以及 install/start/stop/refresh actions。
- 安装前提供 ComfyUI profile selection 和 PyTorch index URL override。
- 每个 runtime 都有 empty、unavailable、health-failed 和 install-failed states。

Automation workspace 应暴露 execution tabs：

- `ComfyUI`、`n8n` 和 `Cron` 作为 top-level tabs。
- 每个 tab 展示 current runs、workflows 或 cron jobs、execution history 和 artifacts。
- Runtime install/configuration controls 不放在 execution workspace。

UI 不能显示 raw secret values。

## State

Desktop runtime root 下的当前 local state layout：

```text
automation-assets/n8n/manifest.json
automation-assets/n8n/install.sh
automation-assets/comfyui/manifest.json
automation-assets/comfyui/install.sh
automation/n8n/runtime.json
automation/n8n/install.log
automation/n8n/service.log
automation/n8n/service.pid
automation/comfyui/runtime.json
automation/comfyui/install.log
automation/comfyui/service.log
automation/comfyui/service.pid
```

`runtime.json` 是当前 non-secret runtime record：

```json
{
  "runtimeId": "comfyui",
  "computeProfile": "nvidia-cuda",
  "baseUrl": "http://127.0.0.1:8188",
  "startScript": "<desktop-runtime-root>/automation/comfyui/start.sh",
  "installedAt": "2026-06-05T00:00:00Z"
}
```

## Current Implementation Slice

当前 slice 比最初的 manifest-only cut 更大，但 contract 仍然有边界：

1. 在 staged runtime manifest 中声明 n8n 和 ComfyUI。
2. 包含 installer channel metadata、loopback defaults、license metadata 和 ComfyUI compute profile ids。
3. 将 release-manifest 和 installer-script assets stage 到 packaged Desktop runtime tree。
4. 暴露 Desktop API routes，用于 refresh、install、start 和 stop managed automation runtimes。
5. 在 Settings Automation Environment section 中展示 runtime status、health、logs、process id 和 ComfyUI profile selection。
6. 保持 installer defaults pinned：n8n 默认 `2.23.3`，ComfyUI 默认 source ref `5aa71b9bc28809a16596bb9fa3d0a6300d8e3f0e`。
7. 将 release assets stage 到 `dist/automation/`，并暴露 checked `automation-release-assets` command，打印某个 release tag 的精确 `gh release upload` command。默认要求 requested tag 指向当前 `HEAD`；有意 backfill 时必须传 `--allow-tag-mismatch`。
8. 保持 Automation workspace 聚焦 ComfyUI、n8n 和 Cron 的 execution data。

这个 slice 仍不执行 GitHub release uploads，不生成 service credentials，不自动绑定 n8n config，也不添加显式 repair、uninstall 或 upgrade flows。

## Verification

这个 slice 的最低验证：

```bash
cargo test -p crawclaw-runtime desktop_runtime_manifest_advertises_automation_environment_services -- --nocapture
cargo test -p crawclaw-runtime automation_runtime_release_manifests_match_install_scripts -- --nocapture
cargo test --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml gateway_automation_runtime_lifecycle_installs_starts_and_stops_managed_runtime -- --nocapture
```

落地前的更宽 follow-up gates：

```bash
pnpm desktop:contract:check
pnpm docs:check-links
pnpm build
```
