---
summary: "Full reference for desktop onboarding: every step and config field"
read_when:
  - Looking up a specific onboarding step or flag
  - Automating onboarding with non-interactive mode
  - Debugging onboarding behavior
title: "Onboarding Reference"
sidebarTitle: "Onboarding Reference"
---

# Onboarding Reference

This is the full reference for CrawClaw Desktop or the local Gateway API.
For a high-level overview, see [Desktop onboarding](/start/wizard).

## Flow details (local mode)

<Steps>
  <Step title="Existing config detection">
    - If `~/.crawclaw/crawclaw.json` exists, choose **Keep / Modify / Reset**.
    - Re-running onboarding does **not** wipe anything unless you explicitly choose **Reset**
      (or pass `--reset`).
    - CLI `--reset` defaults to `config+creds+sessions`; use `--reset-scope full`
      to also remove workspace.
    - If the config is invalid or contains legacy keys, the wizard stops and asks
      you to run CrawClaw Desktop or the local Gateway API before continuing.
    - Reset uses `trash` (never `rm`) and offers scopes:
      - Config only
      - Config + credentials + sessions
      - Full reset (also removes workspace)
  </Step>
  <Step title="Model/Auth">
    - **Anthropic API key**: uses `ANTHROPIC_API_KEY` if present or prompts for a key, then saves it for daemon use.
    - **Anthropic token (paste setup-token)**: run `claude setup-token` on any machine, then paste the token (you can name it; blank = default).
    - **OpenAI API key**: uses `OPENAI_API_KEY` if present or prompts for a key, then stores it in auth profiles.
    - **xAI (Grok) API key**: prompts for `XAI_API_KEY` and configures xAI as a model provider.
    - **OpenCode**: prompts for `OPENCODE_API_KEY` (or `OPENCODE_ZEN_API_KEY`, get it at https://opencode.ai/auth) and lets you pick the Zen or Go catalog.
    - **Ollama**: prompts for the Ollama base URL, offers **Cloud + Local** or **Local** mode, discovers available models, and auto-pulls the selected local model when needed.
    - More detail: [Ollama](/providers/ollama)
    - **API key**: stores the key for you.
    - **Vercel AI Gateway (multi-model proxy)**: prompts for `AI_GATEWAY_API_KEY`.
    - More detail: [Vercel AI Gateway](/providers/vercel-ai-gateway)
    - **Cloudflare AI Gateway**: prompts for Account ID, Gateway ID, and `CLOUDFLARE_AI_GATEWAY_API_KEY`.
    - More detail: [Cloudflare AI Gateway](/providers/cloudflare-ai-gateway)
    - **MiniMax**: config is auto-written; hosted default is `MiniMax-M2.7`.
    - More detail: [MiniMax](/providers/minimax)
    - **Synthetic (Anthropic-compatible)**: prompts for `SYNTHETIC_API_KEY`.
    - More detail: [Synthetic](/providers/synthetic)
    - **Moonshot (Kimi K2)**: config is auto-written.
    - **Kimi Coding**: config is auto-written.
    - More detail: [Moonshot AI (Kimi + Kimi Coding)](/providers/moonshot)
    - **Skip**: no auth configured yet.
    - Pick a default model from detected options (or enter provider/model manually). For best quality and lower prompt-injection risk, choose the strongest latest-generation model available in your provider stack.
    - Onboarding runs a model check and warns if the configured model is unknown or missing auth.
    - API key storage mode defaults to plaintext auth-profile values. Use `--secret-input-mode ref` to store env-backed refs instead (for example `keyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" }`).
    - OAuth credentials live in `~/.crawclaw/credentials/oauth.json`; auth profiles live in `~/.crawclaw/agents/<agentId>/agent/auth-profiles.json` (API keys + OAuth).
    - More detail: [/concepts/oauth](/concepts/oauth)
    <Note>
    Headless/server tip: complete OAuth on a machine with a browser, then copy
    `~/.crawclaw/credentials/oauth.json` (or `$CRAWCLAW_STATE_DIR/credentials/oauth.json`) to the
    gateway host.
    </Note>
  </Step>
  <Step title="Workspace">
    - Default `~/.crawclaw/workspace` (configurable).
    - Seeds the workspace files needed for the agent bootstrap ritual.
    - Full workspace layout + backup guide: [Agent workspace](/concepts/agent-workspace)
  </Step>
  <Step title="Gateway">
    - Port, bind, auth mode, tailscale exposure.
    - Auth recommendation: keep **Token** even for loopback so local WS clients must authenticate.
    - In token mode, interactive setup offers:
      - **Generate/store plaintext token** (default)
      - **Use SecretRef** (opt-in)
      - Quickstart reuses existing `gateway.auth.token` SecretRefs across `env`, `file`, and `exec` providers for onboarding probe/dashboard bootstrap.
      - If that SecretRef is configured but cannot be resolved, onboarding fails early with a clear fix message instead of silently degrading runtime auth.
    - In password mode, interactive setup also supports plaintext or SecretRef storage.
    - Non-interactive token SecretRef path: `--gateway-token-ref-env <ENV_VAR>`.
      - Requires a non-empty env var in the onboarding process environment.
      - Cannot be combined with `--gateway-token`.
    - Disable auth only if you fully trust every local process.
    - Non‑loopback binds still require auth.
  </Step>
  <Step title="Channels">
    - Bundled TypeScript channel plugins have been removed.
    - Rust-native channel plugins will be documented as they are reintroduced.
    - DM security: default is pairing. First DM sends a code; approve via CrawClaw Desktop or the local Gateway API or use allowlists.
  </Step>
  <Step title="Web search">
    - Enable the bundled managed SearXNG provider or skip.
    - No provider API key is required for the default desktop path.
    - Skip with `--skip-search`.
    - Configure later: CrawClaw Desktop or the local Gateway API.
  </Step>
  <Step title="Local runtime">
    - CrawClaw Desktop owns the default local Rust Gateway runtime.
    - The local Gateway API exposes setup/probe operations to desktop clients.
    - **Runtime selection:** bundled channel paths use the Rust native runtime. Bun is **not recommended** for production installs.
  </Step>
  <Step title="Health check">
    - Starts the Gateway (if needed) and runs CrawClaw Desktop or the local Gateway API.
    - Tip: CrawClaw Desktop or the local Gateway API adds gateway health probes to status output (requires a reachable gateway).
  </Step>
  <Step title="Skills (recommended)">
    - Reads the available skills and checks requirements.
    - Lets you choose a node manager: **npm / pnpm** (bun not recommended).
    - Installs optional dependencies (some use Homebrew on macOS).
  </Step>
  <Step title="Finish">
    - Summary + next steps, including Gateway and remote-control surfaces.
  </Step>
</Steps>

<Note>
If no GUI is detected, onboarding prints SSH port-forward instructions for remote gateway access instead of opening a browser.
</Note>

## Non-interactive mode

Use `--non-interactive` to automate or script onboarding:

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Add `--json` for a machine‑readable summary.

Gateway token SecretRef in non-interactive mode:

```bash
export CRAWCLAW_GATEWAY_TOKEN="your-token"
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

`--gateway-token` and `--gateway-token-ref-env` are mutually exclusive.

<Note>
`--json` does **not** imply non-interactive mode. Use `--non-interactive` (and `--workspace`) for scripts.
</Note>

Provider-specific command examples live in [CLI Automation](/start/wizard-cli-automation#provider-specific-examples).
Use this reference page for flag semantics and step ordering.

### Add agent (non-interactive)

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

## Gateway wizard RPC

The Gateway exposes the onboarding flow over RPC (`wizard.start`, `wizard.next`, `wizard.cancel`, `wizard.status`).
Gateway clients can render steps without re‑implementing onboarding logic.

## What the wizard writes

Typical fields in `~/.crawclaw/crawclaw.json`:

- `agents.defaults.workspace`
- `agents.defaults.model` / `models.providers` (if Minimax chosen)
- `tools.profile` (local onboarding defaults to `"coding"` when unset; existing explicit values are preserved)
- `gateway.*` (mode, bind, auth, tailscale)
- `session.dmScope` (behavior details: [CLI Setup Reference](/start/wizard-cli-reference#outputs-and-internals))
- `channels.ddingtalk.*`, `channels.esp32.*`, `channels.feishu.*`, `channels.qqbot.*`, `channels.weixin.*`
- Channel allowlists when you opt in during the prompts (names resolve to IDs when possible).
- `skills.install.nodeManager`
- `wizard.lastRunAt`
- `wizard.lastRunVersion`
- `wizard.lastRunCommit`
- `wizard.lastRunCommand`
- `wizard.lastRunMode`

CrawClaw Desktop or the local Gateway API writes `agents.list[]` and optional `bindings`.

Sessions are stored under `~/.crawclaw/agents/<agentId>/sessions/`.

Some channels are delivered as plugins. When you pick one during setup, onboarding
will prompt to install it (npm or a local path) before it can be configured.

## Related docs

- Onboarding overview: [Desktop onboarding](/start/wizard)
- Config reference: [Gateway configuration](/gateway/configuration)
- Channels: [Chat channels](/channels)
- Skills: [Skills](/tools/skills), [Skills config](/tools/skills-config)
