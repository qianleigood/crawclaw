---
summary: "CLI reference for `crawclaw runtimes` (install, inspect, and repair managed runtimes)"
read_when:
  - You want to verify install-time managed runtimes
  - You need to repair bundled sidecar/runtime or core skill dependencies after install
title: "runtimes"
---

# `crawclaw runtimes`

Inspect and repair the shared managed runtimes that CrawClaw prepares during install/postinstall.

Related:

- Plugins: [Plugins](/cli/plugins)
- Doctor: [Doctor](/cli/doctor)
- Plugin system: [Plugins](/tools/plugin)

## Commands

```bash
crawclaw runtimes list
crawclaw runtimes doctor
crawclaw runtimes install
crawclaw runtimes repair
```

## What this manages

CrawClaw installs shared managed runtimes under `~/.crawclaw/runtimes/node-<major>`.

Current bundled shared runtimes include:

- `browser` — installs the managed `pinchtab` binary under `~/.crawclaw/runtimes/node-<major>/browser`
- `core-skills` — installs Python packages needed by bundled core skill helper scripts under `~/.crawclaw/runtimes/node-<major>/core-skills/venv`
- `n8n` — installs the managed `n8n` binary under `~/.crawclaw/runtimes/node-<major>/n8n` for workflow deployment and execution setup
- `notebooklm-mcp-cli` — installed under `~/.crawclaw/runtimes/node-<major>/notebooklm-mcp-cli/venv`
- `open-websearch` — installed under `~/.crawclaw/runtimes/node-<major>/open-websearch`
- `qwen3-tts` — installed under `~/.crawclaw/runtimes/node-<major>/qwen3-tts/venv`; uses MLX packages on macOS Apple Silicon and the `qwen-tts` Python package on Linux, Windows, and non-Apple-Silicon macOS
- `scrapling-fetch` — installed under `~/.crawclaw/runtimes/node-<major>/scrapling-fetch/venv`
- `skill-openai-whisper` — installed under `~/.crawclaw/runtimes/node-<major>/skill-openai-whisper/venv` on macOS Apple Silicon only

The install process also writes a shared manifest at:

```bash
~/.crawclaw/runtimes/manifest.json
```

- That manifest records the Node major, ABI, and active runtime root for the last install.
- If you switch between Node 24 and Node 25, run `crawclaw runtimes install` again so the current major gets its own isolated runtime tree.

Startup and bundled skill helpers prefer these install-time runtimes and no longer rely on first-run bootstrap of managed dependencies.

For browser automation, install/postinstall now provisions the `pinchtab` runtime in that shared managed path instead of expecting a separate manual install later. When `browser.provider=pinchtab` and you do not set `browser.pinchtab.baseUrl`, CrawClaw now auto-aligns to the managed local PinchTab server at `http://127.0.0.1:9867` and starts it through the browser plugin service.

## Examples

```bash
crawclaw runtimes list
crawclaw runtimes doctor
crawclaw runtimes install
crawclaw runtimes repair --json
```

## Notes

- `runtimes list` reads the shared runtime manifest and prints the current recorded state.
- `runtimes doctor` gives a human-readable health summary of the install-time runtimes.
- `runtimes doctor` also checks whether the recorded runtime manifest matches the current Node major and ABI.
- `runtimes install` re-runs the bundled runtime provisioner and refreshes the manifest.
- `runtimes repair` currently reuses the same installation + verification path as `install`.
- Browser runtime provisioning installs `pinchtab` into the managed runtime root. If `browser.pinchtab.baseUrl` is unset, CrawClaw treats the managed local PinchTab server as the default. If you set `browser.pinchtab.baseUrl`, CrawClaw treats that endpoint as externally managed and does not try to realign it.
- Core skill runtime provisioning installs pinned Python packages from `skills/.runtime/requirements.lock.txt`. Core skill scripts should use that runtime or fail with a repair hint; they should not install Python packages on first use.
- `qwen3-tts` runtime provisioning installs the pinned MLX audio sidecar dependencies on `darwin/arm64` and the pinned `qwen-tts` Python package runtime on Linux, Windows, and non-Apple-Silicon macOS. The Qwen3-TTS `autoStart` path uses that managed venv by default and reports a repair hint if the runtime is missing or fails import verification.
- `skill-openai-whisper` is only provisioned on `darwin/arm64`. Intel macOS, Linux, and Windows keep the runtime listed as non-install-time because MLX Whisper requires Apple Silicon.
- n8n runtime provisioning installs the `n8n` CLI into the managed runtime root. CrawClaw still requires workflow n8n configuration such as `workflow.n8n.baseUrl`, `workflow.n8n.apiKey`, and `workflow.n8n.triggerBearerToken` before deploy/run actions can talk to a live n8n instance.
- If a managed runtime is missing, CrawClaw startup or the owning helper reports a clear error and points you to `crawclaw runtimes install` instead of trying to bootstrap those dependencies inside the plugin or skill start path.
