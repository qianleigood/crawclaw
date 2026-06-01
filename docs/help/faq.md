---
summary: "Frequently asked questions about CrawClaw setup, configuration, and usage"
read_when:
  - Answering common setup, install, onboarding, or runtime support questions
  - Triaging user-reported issues before deeper debugging
title: "FAQ"
---

# FAQ

Quick answers plus deeper troubleshooting for real-world setups (local dev, VPS, multi-agent, OAuth/API keys, model failover). For runtime diagnostics, see [Troubleshooting](/gateway/troubleshooting). For the full config reference, see [Configuration](/gateway/configuration).

## First 60 seconds if something is broken

1. **Quick status (first check)**

   ```bash
   # Use CrawClaw Desktop or the local Gateway API for this operation.
   ```

   Fast local summary: OS + update, Gateway runtime reachability, agents/sessions, provider config + runtime issues (when gateway is reachable).

2. **Pasteable report (safe to share)**

   ```bash
   # Use CrawClaw Desktop or the local Gateway API for this operation.
   ```

   Read-only diagnosis with log tail (tokens redacted).

3. **Gateway runtime + port state**

   ```bash
   # Use CrawClaw Desktop or the local Gateway API for this operation.
   ```

   Shows local runtime vs RPC reachability, the probe target URL, and which config is active.

4. **Deep probes**

   ```bash
   # Use CrawClaw Desktop or the local Gateway API for this operation.
   ```

   Runs gateway health checks + provider probes (requires a reachable gateway). See [Health](/gateway/health).

5. **Tail the latest log**

   ```bash
   # Use CrawClaw Desktop or the local Gateway API for this operation.
   ```

   If RPC is down, fall back to:

   ```bash
   tail -f "$(ls -t /tmp/crawclaw/crawclaw-*.log | head -1)"
   ```

   File logs are separate from service logs; see [Logging](/logging) and [Troubleshooting](/gateway/troubleshooting).

6. **Run the doctor (repairs)**

   ```bash
   # Use CrawClaw Desktop or the local Gateway API for this operation.
   ```

   Repairs/migrates config/state + runs health checks. See [Doctor](/gateway/doctor).

7. **Gateway snapshot**

   ```bash
   # Use CrawClaw Desktop or the local Gateway API for this operation.
   # Use CrawClaw Desktop or the local Gateway API for this operation.
   ```

   Asks the running gateway for a full snapshot (WS-only). See [Health](/gateway/health).

## Quick start and first-run setup

<AccordionGroup>
  <Accordion title="I am stuck, fastest way to get unstuck">
    Use a local AI agent that can **see your machine**. That is far more effective than asking
    in QQBot, because most "I'm stuck" cases are **local config or environment issues** that
    remote helpers cannot inspect.

    - **Claude Code**: [https://www.anthropic.com/claude-code/](https://www.anthropic.com/claude-code/)
    - **OpenAI Codex**: [https://openai.com/codex/](https://openai.com/codex/)

    These tools can read the repo, run commands, inspect logs, and help fix your machine-level
    setup (PATH, services, permissions, auth files). Give them the **full source checkout** via
    the hackable (git) install:

    ```bash
    # Install CrawClaw Desktop from GitHub Releases.
    ```

    This installs CrawClaw **from a git checkout**, so the agent can read the code + docs and
    reason about the exact version you are running. You can always switch back to stable later
    by re-running the installer without `--install-method git`.

    Tip: ask the agent to **plan and supervise** the fix (step-by-step), then execute only the
    necessary commands. That keeps changes small and easier to audit.

    If you discover a real bug or fix, please file a GitHub issue or send a PR:
    [https://github.com/qianleigood/crawclaw/issues](https://github.com/qianleigood/crawclaw/issues)
    [https://github.com/qianleigood/crawclaw/pulls](https://github.com/qianleigood/crawclaw/pulls)

    Start with these commands (share outputs when asking for help):

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    What they do:

    - CrawClaw Desktop or the local Gateway API: quick snapshot of gateway/agent health + basic config.
    - CrawClaw Desktop or the local Gateway API: checks provider auth + model availability.
    - CrawClaw Desktop or the local Gateway API: validates and repairs common config/state issues.

    Other useful checks are available from CrawClaw Desktop diagnostics or the local Gateway API.

    Quick debug loop: [First 60 seconds if something is broken](#first-60-seconds-if-something-is-broken).
    Install docs: [Install](/install), [Desktop](/install/desktop), [Updating](/install/updating).

  </Accordion>

  <Accordion title="Recommended way to install and set up CrawClaw">
    Install CrawClaw Desktop from GitHub Releases, then complete setup in the desktop app.

    The wizard can also build UI assets automatically. After onboarding, you typically run the Gateway on port **18789**.

    From source (contributors/dev):

    ```bash
    git clone https://github.com/qianleigood/crawclaw.git
    cd crawclaw
    pnpm install
    pnpm build
    ```

    Desktop users do not need a global `crawclaw` command.

  </Accordion>

  <Accordion title="How do I start chatting after onboarding?">
    Use a connected channel or open the desktop client.
  </Accordion>

  <Accordion title="How do I authenticate a gateway client (token) on localhost vs remote?">
    **Localhost (same machine):**

    - Open a supported gateway client against `http://127.0.0.1:18789/`.
    - If it asks for auth, use the token from `gateway.auth.token` (or `CRAWCLAW_GATEWAY_TOKEN`).
    - Retrieve it from the gateway host: CrawClaw Desktop or the local Gateway API (or generate one: CrawClaw Desktop or the local Gateway API).

    **Not on localhost:**

    - **Tailscale Serve** (recommended): keep bind loopback, run CrawClaw Desktop or the local Gateway API, open `https://<magicdns>/`. If `gateway.auth.allowTailscale` is `true`, identity headers satisfy browser client/WebSocket auth (no token, assumes trusted gateway host); HTTP APIs still require token/password.
    - **Tailnet bind**: run CrawClaw Desktop or the local Gateway API, then connect a client to `http://<tailscale-ip>:18789/`.
    - **SSH tunnel**: `ssh -N -L 18789:127.0.0.1:18789 user@host` then connect a client to `http://127.0.0.1:18789/`.

    See [Remote access](/gateway/remote) for bind modes and auth details.

  </Accordion>

  <Accordion title="Why are there two exec approval configs for chat approvals?">
    They control different layers:

    - `approvals.exec`: forwards approval prompts to chat destinations
    - `channels.<channel>.execApprovals`: makes that channel act as a native approval client

    The host exec policy is still the real approval gate. Chat config only controls where approval
    prompts appear and how people can answer them.

    In most setups you do **not** need both:

    - If the chat already supports commands and replies, same-chat `/approve` works through the shared path.
    - If a supported native channel can infer approvers safely, CrawClaw now auto-enables DM-first native approvals when `channels.<channel>.execApprovals.enabled` is unset or `"auto"`.
    - Use `approvals.exec` only when prompts must also be forwarded to other chats or explicit ops rooms.
    - Use `channels.<channel>.execApprovals.target: "channel"` or `"both"` only when you explicitly want approval prompts posted back into the originating room/topic.

    Short version: forwarding is for routing, native client config is for richer channel-specific UX.
    See [Exec Approvals](/tools/exec-approvals).

  </Accordion>

  <Accordion title="What runtime do I need?">
    Node **>= 22** is required. `pnpm` is recommended. Bun is **not recommended** for the Gateway.
  </Accordion>

  <Accordion title="Does it run on Raspberry Pi?">
    Yes. The Gateway is lightweight - docs list **512MB-1GB RAM**, **1 core**, and about **500MB**
    disk as enough for personal use, and note that a **Raspberry Pi 4 can run it**.

    If you want extra headroom (logs, media, other services), **2GB is recommended**, but it's
    not a hard minimum.

  </Accordion>

  <Accordion title="Any tips for Raspberry Pi installs?">
    Short version: it works, but expect rough edges.

    - Use a **64-bit** OS and keep Node >= 22.
    - Prefer the **hackable (git) install** so you can see logs and update fast.
    - Start without channels/skills, then add them one by one.
    - If you hit weird binary issues, it is usually an **ARM compatibility** problem.

    Docs: [Linux](/platforms/linux), [Install](/install).

  </Accordion>

  <Accordion title="It is stuck on wake up my friend / onboarding will not hatch. What now?">
    That screen depends on the Gateway being reachable and authenticated. Desktop clients also send
    "Wake up, my friend!" automatically on first hatch. If you see that line with **no reply**
    and tokens stay at 0, the agent never ran.

    1. Restart the Gateway:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    2. Check status + auth:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    3. If it still hangs, run:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    If the Gateway is remote, ensure the tunnel/Tailscale connection is up and that the UI
    is pointed at the right Gateway. See [Remote access](/gateway/remote).

  </Accordion>

  <Accordion title="Can I migrate my setup to a new machine (Mac mini) without redoing onboarding?">
    Yes. Copy the **state directory** and **workspace**, then run Doctor once. This
    keeps your bot "exactly the same" (memory, session history, auth, and channel
    state) as long as you copy **both** locations:

    1. Install CrawClaw on the new machine.
    2. Copy `$CRAWCLAW_STATE_DIR` (default: `~/.crawclaw`) from the old machine.
    3. Copy your workspace (default: `~/.crawclaw/workspace`).
    4. Start CrawClaw Desktop and verify the local Gateway API is reachable.

    That preserves config, auth profiles, Weixin creds, sessions, and memory. If you're in
    remote mode, remember the gateway host owns the session store and workspace.

    **Important:** if you only commit/push your workspace to GitHub, you're backing
    up **memory + bootstrap files**, but **not** session history or auth. Those live
    under `~/.crawclaw/` (for example `~/.crawclaw/agents/<agentId>/sessions/`).

    Related: [Migrating](/install/migrating), [Where things live on disk](#where-things-live-on-disk),
    [Agent workspace](/concepts/agent-workspace), [Doctor](/gateway/doctor),
    [Remote mode](/gateway/remote).

  </Accordion>

  <Accordion title="Where do I see what is new in the latest version?">
    Check the GitHub changelog:
    [https://github.com/qianleigood/crawclaw/blob/main/CHANGELOG.md](https://github.com/qianleigood/crawclaw/blob/main/CHANGELOG.md)

    Newest entries are at the top. If the top section is marked **Unreleased**, the next dated
    section is the latest shipped version. Entries are grouped by **Highlights**, **Changes**, and
    **Fixes** (plus docs/other sections when needed).

  </Accordion>

  <Accordion title="Cannot access docs.crawclaw.ai (SSL error)">
    Some Comcast/Xfinity connections incorrectly block `docs.crawclaw.ai` via Xfinity
    Advanced Security. Disable it or allowlist `docs.crawclaw.ai`, then retry.
    Please help us unblock it by reporting here: [https://spa.xfinity.com/check_url_status](https://spa.xfinity.com/check_url_status).

    If you still can't reach the site, the docs are mirrored on GitHub:
    [https://github.com/qianleigood/crawclaw/tree/main/docs](https://github.com/qianleigood/crawclaw/tree/main/docs)

  </Accordion>

  <Accordion title="Difference between stable and beta">
    **Stable** and **beta** are **npm dist-tags**, not separate code lines:

    - `latest` = stable
    - `beta` = early build for testing

    Usually, a stable release lands on **beta** first, then an explicit
    promotion step moves that same version to `latest`. Maintainers can also
    publish straight to `latest` when needed. That's why beta and stable can
    point at the **same version** after promotion.

    See what changed:
    [https://github.com/qianleigood/crawclaw/blob/main/CHANGELOG.md](https://github.com/qianleigood/crawclaw/blob/main/CHANGELOG.md)

    For install one-liners and the difference between beta and dev, see the accordion below.

  </Accordion>

  <Accordion title="How do I install the beta version and what is the difference between beta and dev?">
    **Beta** is the npm dist-tag `beta` (may match `latest` after promotion).
    **Dev** is the moving head of `main` (git); when published, it uses the npm dist-tag `dev`.

    One-liners (macOS/Linux):

    ```bash
    # Install CrawClaw Desktop from GitHub Releases.
    ```

    ```bash
    # Install CrawClaw Desktop from GitHub Releases.
    ```

    Windows installer (PowerShell):
    [GitHub Releases](https://github.com/qianleigood/crawclaw/releases)

    More detail: [Desktop](/install/desktop) and [Updating](/install/updating).

  </Accordion>

  <Accordion title="How do I try the latest bits?">
    Two options:

    1. **Dev channel (git checkout):**

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    This switches to the `main` branch and updates from source.

    2. **Hackable install (from the installer site):**

    ```bash
    # Install CrawClaw Desktop from GitHub Releases.
    ```

    That gives you a local repo you can edit, then update via git.

    If you prefer a clean clone manually, use:

    ```bash
    git clone https://github.com/qianleigood/crawclaw.git
    cd crawclaw
    pnpm install
    pnpm build
    ```

    Docs: [Update](/install/updating), [auto-updater channels](/install/updating#auto-updater),
    [Install](/install).

  </Accordion>

  <Accordion title="How long does install and onboarding usually take?">
    Rough guide:

    - **Install:** 2-5 minutes
    - **Onboarding:** 5-15 minutes depending on how many channels/models you configure

    If it hangs, use [Installer stuck](#quick-start-and-first-run-setup)
    and the fast debug loop in [I am stuck](#quick-start-and-first-run-setup).

  </Accordion>

  <Accordion title="Installer stuck? How do I get more feedback?">
    Re-run the installer with **verbose output**:

    ```bash
    # Install CrawClaw Desktop from GitHub Releases.
    ```

    Beta install with verbose:

    ```bash
    # Install CrawClaw Desktop from GitHub Releases.
    ```

    For a hackable (git) install:

    ```bash
    # Install CrawClaw Desktop from GitHub Releases.
    ```

    Windows (PowerShell) equivalent:

    ```powershell
    # CrawClaw Desktop installer has no dedicated -Verbose flag yet.
    Set-PSDebug -Trace 1
    # Install CrawClaw Desktop from GitHub Releases.
    Set-PSDebug -Trace 0
    ```

    More options: [Install](/install) and [Desktop](/install/desktop).

  </Accordion>

  <Accordion title="Windows install says git not found or crawclaw not recognized">
    Two common Windows issues:

    **1) npm error spawn git / git not found**

    - Install **Git for Windows** and make sure `git` is on your PATH.
    - Close and reopen PowerShell, then re-run the installer.

    **2) crawclaw is not recognized after install**

    - Your npm global bin folder is not on PATH.
    - Check the path:

      ```powershell
      npm config get prefix
      ```

    - Add that directory to your user PATH (no `\bin` suffix needed on Windows; on most systems it is `%AppData%\npm`).
    - Close and reopen PowerShell after updating PATH.

    Docs: [Windows](/platforms/windows).

  </Accordion>

  <Accordion title="Windows exec output shows garbled Chinese text - what should I do?">
    This is usually a console code page mismatch on native Windows shells.

    Symptoms:

    - `system.run`/`exec` output renders Chinese as mojibake
    - The same command looks fine in another terminal profile

    Quick workaround in PowerShell:

    ```powershell
    chcp 65001
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    ```

    Then restart the Gateway and retry your command:

    ```powershell
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    If you still reproduce this on latest CrawClaw, track/report it in:

    - [Issue #30640](https://github.com/qianleigood/crawclaw/issues/30640)

  </Accordion>

  <Accordion title="The docs did not answer my question - how do I get a better answer?">
    Use the **hackable (git) install** so you have the full source and docs locally, then ask
    your bot (or Claude/Codex) _from that folder_ so it can read the repo and answer precisely.

    ```bash
    # Install CrawClaw Desktop from GitHub Releases.
    ```

    More detail: [Install](/install) and [Desktop](/install/desktop).

  </Accordion>

  <Accordion title="How do I install CrawClaw on Linux?">
    Short answer: follow the Linux guide, then run onboarding.

    - Linux quick path + service install: [Linux](/platforms/linux).
    - Full walkthrough: [Getting Started](/start/getting-started).
    - Installer + updates: [Install & updates](/install/updating).

  </Accordion>

  <Accordion title="How do I install CrawClaw on a VPS?">
    Any Linux VPS works. Install on the server, then use SSH/Tailscale to reach the Gateway.

    Guides: [exe.dev](/install/exe-dev), [DigitalOcean](/install/digitalocean), and [Azure](/install/azure).
    Remote access: [Gateway remote](/gateway/remote).

  </Accordion>

  <Accordion title="Where are the cloud/VPS install guides?">
    We keep a **hosting hub** with the common providers. Pick one and follow the guide:

    - [VPS hosting](/vps) (all providers in one place)
    - [exe.dev](/install/exe-dev)

    How it works in the cloud: the **Gateway runs on the server**, and you access it
    from your laptop/phone via a gateway client (or Tailscale/SSH). Your state + workspace
    live on the server, so treat the host as the source of truth and back it up.

    Hub: [Platforms](/platforms). Remote access: [Gateway remote](/gateway/remote).

  </Accordion>

  <Accordion title="Can I ask CrawClaw to update itself?">
    Short answer: **possible, not recommended**. The update flow can restart the
    Gateway (which drops the active session), may need a clean git checkout, and
    can prompt for confirmation. Safer: run updates from a shell as the operator.

    Use CrawClaw Desktop update controls, or automate against the local Gateway API when a scripted update flow is explicitly required.

    If you must automate from an agent:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Docs: [Update](/install/updating), [Updating](/install/updating).

  </Accordion>

  <Accordion title="What does onboarding actually do?">
    CrawClaw Desktop or the local Gateway API is the recommended setup path. In **local mode** it walks you through:

    - **Model/auth setup** (provider OAuth/setup-token flows and API keys supported, plus local model options such as LM Studio)
    - **Workspace** location + bootstrap files
    - **Gateway settings** (bind/port/auth/tailscale)
    - **Providers** (Weixin, Feishu, QQBot, Feishu (plugin), Signal, Weixin)
    - **Local runtime** setup through CrawClaw Desktop and the Rust Gateway
    - **Health checks** and **skills** selection

    It also warns if your configured model is unknown or missing auth.

  </Accordion>

  <Accordion title="Do I need a Claude or OpenAI subscription to run this?">
    No. You can run CrawClaw with **API keys** (Anthropic/OpenAI/others) or with
    **local-only models** so your data stays on your device. Subscriptions (Claude
    Pro/Max) are optional ways to authenticate those providers.

    If you choose Anthropic subscription auth, decide for yourself whether to use it:
    Anthropic has blocked some subscription usage outside Claude Code in the past.

    Docs: [Anthropic](/providers/anthropic), [OpenAI](/providers/openai),
    [Local models](/gateway/local-models), [Models](/concepts/models).

  </Accordion>

  <Accordion title="Can I use Claude Max subscription without an API key?">
    Yes. You can either use a **setup-token** or reuse a local **Claude CLI**
    login on the gateway host.

    Claude Pro/Max subscriptions **do not include an API key**, so this is the
    technical path for subscription accounts. But this is your decision: Anthropic
    has blocked some subscription usage outside Claude Code in the past.
    If you want the clearest and safest supported path for production, use an Anthropic API key.

  </Accordion>

  <Accordion title="How does Anthropic setup-token auth work?">
    `claude setup-token` generates a **token string** via the Claude Code CLI (it is not available in the web console). You can run it on **any machine**. Choose **Anthropic token (paste setup-token)** in onboarding or paste it with CrawClaw Desktop or the local Gateway API. The token is stored as an auth profile for the **anthropic** provider and used like an API key (no auto-refresh). More detail: [OAuth](/concepts/oauth).
  </Accordion>

  <Accordion title="Where do I find an Anthropic setup-token?">
    It is **not** in the Anthropic Console. The setup-token is generated by the **Claude Code CLI** on **any machine**:

    ```bash
    claude setup-token
    ```

    Copy the token it prints, then choose **Anthropic token (paste setup-token)** in onboarding. If you want to run it on the gateway host, use CrawClaw Desktop or the local Gateway API. If you ran `claude setup-token` elsewhere, paste it on the gateway host with CrawClaw Desktop or the local Gateway API. See [Anthropic](/providers/anthropic).

  </Accordion>

  <Accordion title="Do you support Claude subscription auth (Claude Pro or Max)?">
    Yes. You can either:

    - use a **setup-token**
    - reuse a local **Claude CLI** login on the gateway host with CrawClaw Desktop or the local Gateway API

    Setup-token is still supported. Claude CLI migration is simpler when the gateway host already runs Claude Code. See [Anthropic](/providers/anthropic) and [OAuth](/concepts/oauth).

    Important: this is technical compatibility, not a policy guarantee. Anthropic
    has blocked some subscription usage outside Claude Code in the past.
    You need to decide whether to use it and verify Anthropic's current terms.
    For production or multi-user workloads, Anthropic API key auth is the safer, recommended choice.

  </Accordion>

<a id="why-am-i-seeing-http-429-ratelimiterror-from-anthropic"></a>
<Accordion title="Why am I seeing HTTP 429 rate_limit_error from Anthropic?">
That means your **Anthropic quota/rate limit** is exhausted for the current window. If you
use a **Claude subscription** (setup-token), wait for the window to
reset or upgrade your plan. If you use an **Anthropic API key**, check the Anthropic Console
for usage/billing and raise limits as needed.

    If the message is specifically:
    `Extra usage is required for long context requests`, the request is trying to use
    Anthropic's 1M context beta (`context1m: true`). That only works when your
    credential is eligible for long-context billing (API key billing or subscription
    with Extra Usage enabled).

    Tip: set a **fallback model** so CrawClaw can keep replying while a provider is rate-limited.
    See [Models](/concepts/models), [OAuth](/concepts/oauth), and
    [/gateway/troubleshooting#anthropic-429-extra-usage-required-for-long-context](/gateway/troubleshooting#anthropic-429-extra-usage-required-for-long-context).

  </Accordion>

  <Accordion title="Is AWS Bedrock supported?">
    Yes - via CrawClaw's Rust NativeProvider **Amazon Bedrock (Converse)** transport with **manual config**. You must supply AWS credentials/region on the gateway host and add a Bedrock provider entry in your models config. See [Amazon Bedrock](/providers/bedrock) and [Model providers](/providers/models). If you prefer a managed key flow, an OpenAI-compatible proxy in front of Bedrock is still a valid option.
  </Accordion>

  <Accordion title="How does Codex auth work?">
    CrawClaw keeps `openai-codex/*` models in the catalog for compatible existing auth profiles and external tooling, but the bundled JavaScript Codex OAuth onboarding flow has been removed. Use OpenAI API keys for the default OpenAI setup path. See [Model providers](/concepts/model-providers) and [Desktop onboarding](/start/wizard).
  </Accordion>

  <Accordion title="Do you support OpenAI subscription auth (Codex OAuth)?">
    CrawClaw no longer starts a bundled JavaScript Codex OAuth login flow. Existing compatible auth profiles can still be present, but onboarding now favors OpenAI API keys and native provider surfaces.

    See [OAuth](/concepts/oauth), [Model providers](/concepts/model-providers), and [Desktop onboarding](/start/wizard).

  </Accordion>

  <Accordion title="Is a local model OK for casual chats?">
    Usually no. CrawClaw needs large context + strong safety; small cards truncate and leak. If you must, run the **largest** model build you can locally (LM Studio) and see [/gateway/local-models](/gateway/local-models). Smaller/quantized models increase prompt-injection risk - see [Security](/gateway/security).
  </Accordion>

  <Accordion title="How do I keep hosted model traffic in a specific region?">
    Pick region-pinned endpoints. OpenRouter exposes US-hosted options for MiniMax, Kimi, and GLM; choose the US-hosted variant to keep data in-region. You can still list Anthropic/OpenAI alongside these by using `models.mode: "merge"` so fallbacks stay available while respecting the regioned provider you select.
  </Accordion>

  <Accordion title="Do I have to buy a Mac Mini to install this?">
    No. CrawClaw runs on macOS, Linux, or native Windows. A Mac mini is optional - some people
    buy one as an always-on host, but a small VPS, home server, or Raspberry Pi-class box works too.

    You only need a Mac **for macOS-only tools**. For Weixin, use [Weixin](/channels/index) (recommended) - the Weixin server runs on any Mac, and the Gateway can run on Linux or elsewhere. If you want other macOS-only tools, run the Gateway on a Mac.

    Docs: [Weixin](/channels/index), [Remote gateway](/gateway/remote).

  </Accordion>

  <Accordion title="Do I need a Mac mini for Weixin support?">
    You need **some macOS device** signed into Messages. It does **not** have to be a Mac mini -
    any Mac works. **Use [Weixin](/channels/index)** (recommended) for Weixin - the Weixin server runs on macOS, while the Gateway can run on Linux or elsewhere.

    Common setups:

    - Run the Gateway on Linux/VPS, and run the Weixin server on any Mac signed into Messages.
    - Run everything on the Mac if you want the simplest single-machine setup.

    Docs: [Weixin](/channels/index), [Remote gateway](/gateway/remote).

  </Accordion>

  <Accordion title="Can I use Bun?">
    Bun is **not recommended**. We see runtime bugs, especially with Weixin and Feishu.
    Use **Node** for stable gateways.

    If you still want to experiment with Bun, do it on a non-production gateway
    without Weixin/Feishu.

  </Accordion>

  <Accordion title="Feishu: what goes in allowFrom?">
    `channels.feishu.allowFrom` is **the human sender's Feishu user ID** (numeric). It is not the bot username.

    Onboarding accepts `@username` input and resolves it to a numeric ID, but CrawClaw authorization uses numeric IDs only.

    Safer (no third-party bot):

    - DM your bot, then run CrawClaw Desktop or the local Gateway API and read `from.id`.

    Official Bot API:

    - DM your bot, then call `https://api.feishu.org/bot<bot_token>/getUpdates` and read `message.from.id`.

    Third-party (less private):

    - DM `@userinfobot` or `@getidsbot`.

    See [/channels/index](/channels/index#access-control-and-activation).

  </Accordion>

  <Accordion title="Can multiple people use one Weixin number with different CrawClaw instances?">
    Yes, via **multi-agent routing**. Bind each sender's Weixin **DM** (peer `kind: "direct"`, sender E.164 like `+15551234567`) to a different `agentId`, so each person gets their own workspace and session store. Replies still come from the **same Weixin account**, and DM access control (`channels.weixin.dmPolicy` / `channels.weixin.allowFrom`) is global per Weixin account. See [Multi-Agent Routing](/concepts/multi-agent) and [Weixin](/channels/index).
  </Accordion>

  <Accordion title='Can I run a "fast chat" agent and an "Opus for coding" agent?'>
    Yes. Use multi-agent routing: give each agent its own default model, then bind inbound routes (provider account or specific peers) to each agent. Example config lives in [Multi-Agent Routing](/concepts/multi-agent). See also [Models](/concepts/models) and [Configuration](/gateway/configuration).
  </Accordion>

  <Accordion title="Does Homebrew work on Linux?">
    Yes. Homebrew supports Linux (Linuxbrew). Quick setup:

    ```bash
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> ~/.profile
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
    brew install <formula>
    ```

    If you run CrawClaw via systemd, ensure the service PATH includes `/home/linuxbrew/.linuxbrew/bin` (or your brew prefix) so `brew`-installed tools resolve in non-login shells.
    Recent builds also prepend common user bin dirs on Linux systemd services (for example `~/.local/bin`, `~/.npm-global/bin`, `~/.local/share/pnpm`, `~/.bun/bin`) and honor `PNPM_HOME`, `NPM_CONFIG_PREFIX`, `BUN_INSTALL`, `VOLTA_HOME`, `ASDF_DATA_DIR`, `NVM_DIR`, and `FNM_DIR` when set.

  </Accordion>

  <Accordion title="Difference between the hackable git install and npm install">
    - **Hackable (git) install:** full source checkout, editable, best for contributors.
      You run builds locally and can patch code/docs.
    - **npm install:** global command install, no repo, best for "just run it."
      Updates come from npm dist-tags.

    Docs: [Getting started](/start/getting-started), [Updating](/install/updating).

  </Accordion>

  <Accordion title="Can I switch between npm and git installs later?">
    Yes. Install the other flavor, then start CrawClaw Desktop so the local runtime uses the new entrypoint.
    This **does not delete your data** - it only changes the CrawClaw code install. Your state
    (`~/.crawclaw`) and workspace (`~/.crawclaw/workspace`) stay untouched.

    From npm to git:

    ```bash
    git clone https://github.com/qianleigood/crawclaw.git
    cd crawclaw
    pnpm install
    pnpm build
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    From git to npm:

    ```bash

    # Install CrawClaw Desktop from GitHub Releases.

    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Doctor still checks config and state after the move; remove any old startup entries manually if they predate the desktop runtime.

    Backup tips: see [Backup strategy](#where-things-live-on-disk).

  </Accordion>

  <Accordion title="Should I run the Gateway on my laptop or a VPS?">
    Short answer: **if you want 24/7 reliability, use a VPS**. If you want the
    lowest friction and you're okay with sleep/restarts, run it locally.

    **Laptop (local Gateway)**

    - **Pros:** no server cost, direct access to local files, live browser window.
    - **Cons:** sleep/network drops = disconnects, OS updates/reboots interrupt, must stay awake.

    **VPS / cloud**

    - **Pros:** always-on, stable network, no laptop sleep issues, easier to keep running.
    - **Cons:** often run headless (use screenshots), remote file access only, you must SSH for updates.

    **CrawClaw-specific note:** Weixin/Feishu/DingTalk/Feishu (plugin)/QQBot all work fine from a VPS. The only real trade-off is **headless browser** vs a visible window. See [Browser](/tools/browser).

    **Recommended default:** VPS if you had gateway disconnects before. Local is great when you're actively using the Mac and want local file access or UI automation with a visible browser.

  </Accordion>

  <Accordion title="How important is it to run CrawClaw on a dedicated machine?">
    Not required, but **recommended for reliability and isolation**.

    - **Dedicated host (VPS/Mac mini/Pi):** always-on, fewer sleep/reboot interruptions, cleaner permissions, easier to keep running.
    - **Shared laptop/desktop:** totally fine for testing and active use, but expect pauses when the machine sleeps or updates.

    For security guidance, read [Security](/gateway/security).

  </Accordion>

  <Accordion title="What are the minimum VPS requirements and recommended OS?">
    CrawClaw is lightweight. For a basic Gateway + one chat channel:

    - **Absolute minimum:** 1 vCPU, 1GB RAM, ~500MB disk.
    - **Recommended:** 1-2 vCPU, 2GB RAM or more for headroom (logs, media, multiple channels). Node tools and browser automation can be resource hungry.

    OS: use **Ubuntu LTS** (or any modern Debian/Ubuntu). The Linux install path is best tested there.

    Docs: [Linux](/platforms/linux), [VPS hosting](/vps).

  </Accordion>

  <Accordion title="Can I run CrawClaw in a VM and what are the requirements?">
    Yes. Treat a VM the same as a VPS: it needs to be always on, reachable, and have enough
    RAM for the Gateway and any channels you enable.

    Baseline guidance:

    - **Absolute minimum:** 1 vCPU, 1GB RAM.
    - **Recommended:** 2GB RAM or more if you run multiple channels, browser automation, or media tools.
    - **OS:** Ubuntu LTS or another modern Debian/Ubuntu.

    If you are on Windows, use the native Windows install path. See [Windows](/platforms/windows), [VPS hosting](/vps).
    If you are running macOS in a VM, see [macOS VM](/install/macos-vm).

  </Accordion>
</AccordionGroup>

## What is CrawClaw?

<AccordionGroup>
  <Accordion title="What is CrawClaw, in one paragraph?">
    CrawClaw is a personal AI assistant you run on your own devices. It replies on the messaging surfaces you already use (Weixin, Feishu, DingTalk, Feishu (plugin), QQBot, Feishu, Signal, Weixin). The **Gateway** is the always-on control plane; the assistant is the product.
  </Accordion>

  <Accordion title="Value proposition">
    CrawClaw is not "just a Claude wrapper." It's a **local-first control plane** that lets you run a
    capable assistant on **your own hardware**, reachable from the chat apps you already use, with
    stateful sessions, memory, and tools - without handing control of your workflows to a hosted
    SaaS.

    Highlights:

    - **Your devices, your data:** run the Gateway wherever you want (Mac, Linux, VPS) and keep the
      workspace + session history local.
    - **Model-agnostic:** use Anthropic, OpenAI, MiniMax, OpenRouter, etc., with per-agent routing
      and failover.
    - **Local-only option:** run local models so **all data can stay on your device** if you want.
    - **Multi-agent routing:** separate agents per channel, account, or task, each with its own
      workspace and defaults.
    - **Open source and hackable:** inspect, extend, and self-host without vendor lock-in.

    Docs: [Gateway](/gateway), [Channels](/channels), [Multi-agent](/concepts/multi-agent),
    [Memory](/concepts/memory).

  </Accordion>

  <Accordion title="I just set it up - what should I do first?">
    Good first projects:

    - Build a website (WordPress, Shopify, or a simple static site).
    - Prototype a mobile app (outline, screens, API plan).
    - Organize files and folders (cleanup, naming, tagging).
    - Connect Gmail and automate summaries or follow ups.

    It can handle large tasks, but it works best when you split them into phases and
    use sub agents for parallel work.

  </Accordion>

  <Accordion title="What are the top five everyday use cases for CrawClaw?">
    Everyday wins usually look like:

    - **Personal briefings:** summaries of inbox, calendar, and news you care about.
    - **Research and drafting:** quick research, summaries, and first drafts for emails or docs.
    - **Reminders and follow ups:** cron, hooks, and main-session wake driven nudges and checklists.
    - **Browser automation:** filling forms, collecting data, and repeating web tasks.
    - **Cross device coordination:** send a task from your phone, let the Gateway run it on a server, and get the result back in chat.

  </Accordion>

  <Accordion title="Can CrawClaw help with lead gen, outreach, ads, and blogs for a SaaS?">
    Yes for **research, qualification, and drafting**. It can scan sites, build shortlists,
    summarize prospects, and write outreach or ad copy drafts.

    For **outreach or ad runs**, keep a human in the loop. Avoid spam, follow local laws and
    platform policies, and review anything before it is sent. The safest pattern is to let
    CrawClaw draft and you approve.

    Docs: [Security](/gateway/security).

  </Accordion>

  <Accordion title="What are the advantages vs Claude Code for web development?">
    CrawClaw is a **personal assistant** and coordination layer, not an IDE replacement. Use
    Claude Code or Codex for the fastest direct coding loop inside a repo. Use CrawClaw when you
    want durable memory, cross-device access, and tool orchestration.

    Advantages:

    - **Persistent memory + workspace** across sessions
    - **Multi-platform access** (Weixin, Feishu, DingTalk, QQBot, desktop clients)
    - **Tool orchestration** (browser, files, scheduling, hooks)
    - **Always-on Gateway** (run on a VPS, interact from anywhere)

    Showcase: [https://crawclaw.ai/showcase](https://crawclaw.ai/showcase)

  </Accordion>
</AccordionGroup>

## Skills and automation

<AccordionGroup>
  <Accordion title="How do I customize skills without keeping the repo dirty?">
    Use managed overrides instead of editing the repo copy. Put your changes in `~/.crawclaw/skills/<name>/SKILL.md` (or add a folder via `skills.load.extraDirs` in `~/.crawclaw/crawclaw.json`). Precedence is `<workspace>/skills` > `~/.crawclaw/skills` > bundled, so managed overrides win without touching git. Only upstream-worthy edits should live in the repo and go out as PRs.
  </Accordion>

  <Accordion title="Can I load skills from a custom folder?">
    Yes. Add extra directories via `skills.load.extraDirs` in `~/.crawclaw/crawclaw.json` (lowest precedence). Default precedence remains: `<workspace>/skills` → `~/.crawclaw/skills` → bundled → `skills.load.extraDirs`. `clawhub` installs into `./skills` by default, which CrawClaw treats as `<workspace>/skills` on the next session.
  </Accordion>

  <Accordion title="How can I use different models for different tasks?">
    Today the supported patterns are:

    - **Cron jobs**: isolated jobs can set a `model` override per job.
    - **Sub-agents**: route tasks to separate agents with different default models.
    - **On-demand switch**: use `/model` to switch the current session model at any time.

    See [Cron jobs](/automation/cron-jobs), [Multi-Agent Routing](/concepts/multi-agent), and [Slash commands](/tools/slash-commands).

  </Accordion>

  <Accordion title="The bot freezes while doing heavy work. How do I offload that?">
    Use **sub-agents** for long or parallel tasks. Sub-agents run in their own session,
    return a summary, and keep your main chat responsive.

    Ask your bot to "spawn a sub-agent for this task" or use `/subagents`.
    Use `/status` in chat to see what the Gateway is doing right now (and whether it is busy).

    Token tip: long tasks and sub-agents both consume tokens. If cost is a concern, set a
    cheaper model for sub-agents via `agents.defaults.subagents.model`.

    Docs: [Sub-agents](/tools/subagents), [Background Tasks](/automation/tasks).

  </Accordion>

  <Accordion title="How do thread-bound subagent sessions work on QQBot?">
    Use thread bindings. You can bind a QQBot thread to a subagent or session target so follow-up messages in that thread stay on that bound session.

    Basic flow:

    - Spawn with `sessions_spawn` using `thread: true` (and optionally `mode: "session"` for persistent follow-up).
    - Or manually bind with `/focus <target>`.
    - Use `/agents` to inspect binding state.
    - Use `/session idle <duration|off>` and `/session max-age <duration|off>` to control auto-unfocus.
    - Use `/unfocus` to detach the thread.

    Required config:

    - Global defaults: `session.threadBindings.enabled`, `session.threadBindings.idleHours`, `session.threadBindings.maxAgeHours`.
    - QQBot overrides: `channels.qqbot.threadBindings.enabled`, `channels.qqbot.threadBindings.idleHours`, `channels.qqbot.threadBindings.maxAgeHours`.
    - Auto-bind on spawn: set `channels.qqbot.threadBindings.spawnSubagentSessions: true`.

    Docs: [Sub-agents](/tools/subagents), [QQBot](/channels/index), [Configuration Reference](/gateway/configuration-reference), [Slash commands](/tools/slash-commands).

  </Accordion>

  <Accordion title="Cron or reminders do not fire. What should I check?">
    Cron runs inside the Gateway process. If the Gateway is not running continuously,
    scheduled jobs will not run.

    Checklist:

    - Confirm cron is enabled (`cron.enabled`) and `CRAWCLAW_SKIP_CRON` is not set.
    - Check the Gateway is running 24/7 (no sleep/restarts).
    - Verify timezone settings for the job (`--tz` vs host timezone).

    Debug:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Docs: [Cron jobs](/automation/cron-jobs), [Automation & Tasks](/automation).

  </Accordion>

  <Accordion title="How do I install skills on Linux?">
    Use native CrawClaw Desktop or the local Gateway API commands or drop skills into your workspace. The macOS Skills UI isn't available on Linux.
    Browse skills at [https://clawhub.com](https://clawhub.com).

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Install the separate `clawhub` CLI only if you want to publish or sync your own skills.

  </Accordion>

  <Accordion title="Can CrawClaw run tasks on a schedule or continuously in the background?">
    Yes. Use the Gateway scheduler:

    - **Cron jobs** for scheduled or recurring tasks (persist across restarts).
    - **Main-session cron jobs** when scheduled work needs the active conversation context.
    - **Isolated jobs** for autonomous agents that post summaries or deliver to chats.

    Docs: [Cron jobs](/automation/cron-jobs), [Automation & Tasks](/automation),
    [Heartbeat compatibility](/gateway/heartbeat).

  </Accordion>

  <Accordion title="Can I run Apple macOS-only skills from Linux?">
    Not directly. macOS skills are gated by `metadata.crawclaw.os` plus required binaries, and skills only appear in the system prompt when they are eligible on the **Gateway host**. On Linux, `darwin`-only skills (like `apple-notes`, `apple-reminders`, `things-mac`) will not load unless you override the gating.

    You have two supported patterns:

    **Option A - run the Gateway on a Mac (simplest).**
    Run the Gateway where the macOS binaries exist, then connect from Linux in [remote mode](#gateway-ports-already-running-and-remote-mode) or over Tailscale. The skills load normally because the Gateway host is macOS.

    **Option B - proxy macOS binaries over SSH (advanced).**
    Keep the Gateway on Linux, but make the required CLI binaries resolve to SSH wrappers that run on a Mac. Then override the skill to allow Linux so it stays eligible.

    1. Create an SSH wrapper for the binary (example: `memo` for Apple Notes):

       ```bash
       #!/usr/bin/env bash
       set -euo pipefail
       exec ssh -T user@mac-host /opt/homebrew/bin/memo "$@"
       ```

    2. Put the wrapper on `PATH` on the Linux host (for example `~/bin/memo`).
    3. Override the skill metadata (workspace or `~/.crawclaw/skills`) to allow Linux:

       ```markdown
       ---
       name: apple-notes
       description: Manage Apple Notes via the memo CLI on macOS.
       metadata: { "crawclaw": { "os": ["darwin", "linux"], "requires": { "bins": ["memo"] } } }
       ---
       ```

    4. Start a new session so the skills snapshot refreshes.

  </Accordion>

  <Accordion title="Do you have a Notion or HeyGen integration?">
    Not built-in today.

    Options:

    - **Custom skill / plugin:** best for reliable API access (Notion/HeyGen both have APIs).
    - **Browser automation:** works without code but is slower and more fragile.

    If you want to keep context per client (agency workflows), a simple pattern is:

    - One Notion page per client (context + preferences + active work).
    - Ask the agent to fetch that page at the start of a session.

    If you want a native integration, open a feature request or build a skill
    targeting those APIs.

    Install skills:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Native installs land in the active workspace `skills/` directory. For shared skills across agents, place them in `~/.crawclaw/skills/<name>/SKILL.md`. Some skills expect binaries installed via Homebrew; on Linux that means Linuxbrew (see the Homebrew Linux FAQ entry above). See [Skills](/tools/skills) and [ClawHub](/tools/clawhub).

  </Accordion>

  <Accordion title="How do I use my existing signed-in Chrome with CrawClaw?">
    Use a managed browser profile or a remote CDP profile. The legacy host-local
    attach mode is no longer part of the supported browser path.

    From an agent session, use the `browser` tool with `profile: "crawclaw"`.
    For direct Gateway `/tools/invoke` calls, pass
    `{ "action": "status", "profile": "crawclaw" }` or
    `{ "action": "tabs", "profile": "crawclaw" }` as `args`.

    If Chrome runs on another host, point a named profile at that remote CDP
    endpoint instead:

    ```json5
    {
      browser: {
        profiles: {
          remote: { cdpUrl: "http://BROWSER_HOST:9222", color: "#00AA00" }
        }
      }
    }
    ```

    If the Gateway runs elsewhere, use remote CDP.

  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Do you have dedicated sandbox docs?">
    Yes. See [Security](/gateway/security).
  </Accordion>

  <Accordion title="Can I keep DMs private but use one agent for public groups in a sandbox?">
    Yes - if your private traffic is **DMs** and your public traffic is **groups**.

    Use `agents.defaults.sandbox.mode: "non-main"` so group/channel sessions run in Docker while the main DM session stays on the host. Then use `tools.sandbox.tools` to limit which tools are available inside sandboxed sessions.

    Setup walkthrough + example config: [Groups: personal DMs + public groups](/channels/groups#pattern-personal-dms-public-groups-single-agent)

    Key config reference: [Gateway configuration](/gateway/configuration#enable-sandbox-isolation)

  </Accordion>

  <Accordion title="How do I bind-mount a host folder into the sandbox?">
    Set `agents.defaults.sandbox.docker.binds` to `["host:path:mode"]` (for example `"/home/user/src:/src:ro"`). Global and per-agent binds are merged; per-agent binds are ignored when `scope: "shared"`. Use `:ro` for sensitive content and remember that binds bypass filesystem isolation. See [Security](/gateway/security) for security notes.
  </Accordion>

  <Accordion title="How does memory work?">
    CrawClaw memory is just Markdown files in the agent workspace:

    - Daily notes in `memory/YYYY-MM-DD.md`
    - Curated long-term notes in `MEMORY.md` (main/private sessions only)

    CrawClaw also runs a **silent pre-compaction memory flush** to remind the model
    to write durable notes before auto-compaction. This only runs when the workspace

  </Accordion>

  <Accordion title="Memory keeps forgetting things. How do I make it stick?">
    Ask the bot to **write the fact to memory**. Long-term notes belong in `MEMORY.md`,
    short-term context goes into `memory/YYYY-MM-DD.md`.

    This is still an area we are improving. It helps to remind the model to store memories;
    it will know what to do. If it keeps forgetting, verify the Gateway is using the same
    workspace on every run.

    Docs: [Memory](/concepts/memory), [Agent workspace](/concepts/agent-workspace).

  </Accordion>

  <Accordion title="Does memory persist forever? What are the limits?">
    Memory files live on disk and persist until you delete them. The limit is your
    storage, not the model. The **session context** is still limited by the model
    context window, so long conversations can compact or truncate. Durable memory,
    experience recall, and session summaries pull bounded relevant context back
    into later turns.

    Docs: [Memory](/concepts/memory), [Context](/concepts/context).

  </Accordion>

  <Accordion title="Does memory require an OpenAI API key?">
    Not by itself. The built-in memory runtime uses your configured model roles
    for extraction, summaries, and consolidation. Provider-specific commands still
    need the credentials that provider requires.

    Hindsight-backed experience recall is optional and uses the endpoint and
    banks you configure under `memory.hindsight`.

  </Accordion>
</AccordionGroup>

## Where things live on disk

<AccordionGroup>
  <Accordion title="Is all data used with CrawClaw saved locally?">
    No - **CrawClaw's state is local**, but **external services still see what you send them**.

    - **Local by default:** sessions, memory files, config, and workspace live on the Gateway host
      (`~/.crawclaw` + your workspace directory).
    - **Remote by necessity:** messages you send to model providers (Anthropic/OpenAI/etc.) go to
      their APIs, and chat platforms (Weixin/Feishu/DingTalk/etc.) store message data on their
      servers.
    - **You control the footprint:** using local models keeps prompts on your machine, but channel
      traffic still goes through the channel's servers.

    Related: [Agent workspace](/concepts/agent-workspace), [Memory](/concepts/memory).

  </Accordion>

  <Accordion title="Where does CrawClaw store its data?">
    Everything lives under `$CRAWCLAW_STATE_DIR` (default: `~/.crawclaw`):

    | Path                                                            | Purpose                                                            |
    | --------------------------------------------------------------- | ------------------------------------------------------------------ |
    | `$CRAWCLAW_STATE_DIR/crawclaw.json`                             | Main config (JSON5)                                                |
    | `$CRAWCLAW_STATE_DIR/credentials/oauth.json`                    | Legacy OAuth import (copied into auth profiles on first use)       |
    | `$CRAWCLAW_STATE_DIR/agents/<agentId>/agent/auth-profiles.json` | Auth profiles (OAuth, API keys, and optional `keyRef`/`tokenRef`)  |
    | `$CRAWCLAW_STATE_DIR/secrets.json`                              | Optional file-backed secret payload for `file` SecretRef providers |
    | `$CRAWCLAW_STATE_DIR/agents/<agentId>/agent/auth.json`          | Legacy compatibility file (static `api_key` entries scrubbed)      |
    | `$CRAWCLAW_STATE_DIR/credentials/`                              | Provider state (e.g. `weixin/<accountId>/creds.json`)            |
    | `$CRAWCLAW_STATE_DIR/agents/`                                   | Per-agent state (agentDir + sessions)                              |
    | `$CRAWCLAW_STATE_DIR/agents/<agentId>/sessions/`                | Conversation history & state (per agent)                           |
    | `$CRAWCLAW_STATE_DIR/agents/<agentId>/sessions/sessions.json`   | Session metadata (per agent)                                       |

    Legacy single-agent path: `~/.crawclaw/agent/*` (migrated by CrawClaw Desktop or the local Gateway API).

    Your **workspace** (AGENTS.md, memory files, skills, etc.) is separate and configured via `agents.defaults.workspace` (default: `~/.crawclaw/workspace`).

  </Accordion>

  <Accordion title="Where should AGENTS.md / SOUL.md / USER.md / MEMORY.md live?">
    These files live in the **agent workspace**, not `~/.crawclaw`.

    - **Workspace (per agent)**: `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`,
      `MEMORY.md` (or legacy fallback `memory.md` when `MEMORY.md` is absent),
      `memory/YYYY-MM-DD.md`, optional `HEARTBEAT.md`.
    - **State dir (`~/.crawclaw`)**: config, credentials, auth profiles, sessions, logs,
      and shared skills (`~/.crawclaw/skills`).

    Default workspace is `~/.crawclaw/workspace`, configurable via:

    ```json5
    {
      agents: { defaults: { workspace: "~/.crawclaw/workspace" } },
    }
    ```

    If the bot "forgets" after a restart, confirm the Gateway is using the same
    workspace on every launch (and remember: remote mode uses the **gateway host's**
    workspace, not your local laptop).

    Tip: if you want a durable behavior or preference, ask the bot to **write it into
    AGENTS.md or MEMORY.md** rather than relying on chat history.

    See [Agent workspace](/concepts/agent-workspace) and [Memory](/concepts/memory).

  </Accordion>

  <Accordion title="Recommended backup strategy">
    Put your **agent workspace** in a **private** git repo and back it up somewhere
    private (for example GitHub private). This captures memory + AGENTS/SOUL/USER
    files, and lets you restore the assistant's "mind" later.

    Do **not** commit anything under `~/.crawclaw` (credentials, sessions, tokens, or encrypted secrets payloads).
    If you need a full restore, back up both the workspace and the state directory
    separately (see the migration question above).

    Docs: [Agent workspace](/concepts/agent-workspace).

  </Accordion>

  <Accordion title="How do I completely uninstall CrawClaw?">
    See the dedicated guide: [Uninstall](/install/uninstall).
  </Accordion>

  <Accordion title="Can agents work outside the workspace?">
    Relative paths resolve inside the workspace, but absolute paths can access other
    host locations. If you need hard isolation, run CrawClaw on an isolated host or VM. If you
    want a repo to be the default working directory, point that agent's
    `workspace` to the repo root. The CrawClaw repo is just source code; keep the
    workspace separate unless you intentionally want the agent to work inside it.

    Example (repo as default cwd):

    ```json5
    {
      agents: {
        defaults: {
          workspace: "~/Projects/my-repo",
        },
      },
    }
    ```

  </Accordion>

  <Accordion title="Remote mode: where is the session store?">
    Session state is owned by the **gateway host**. If you're in remote mode, the session store you care about is on the remote machine, not your local laptop. See [Session management](/concepts/session).
  </Accordion>
</AccordionGroup>

## Config basics

<AccordionGroup>
  <Accordion title="What format is the config? Where is it?">
    CrawClaw reads an optional **JSON5** config from `$CRAWCLAW_CONFIG_PATH` (default: `~/.crawclaw/crawclaw.json`):

    ```
    $CRAWCLAW_CONFIG_PATH
    ```

    If the file is missing, it uses safe-ish defaults (including a default workspace of `~/.crawclaw/workspace`).

  </Accordion>

  <Accordion title='I set gateway.bind: "lan" (or "tailnet") and now nothing listens / the UI says unauthorized'>
    Non-loopback binds **require auth**. Configure `gateway.auth.mode` + `gateway.auth.token` (or use `CRAWCLAW_GATEWAY_TOKEN`).

    ```json5
    {
      gateway: {
        bind: "lan",
        auth: {
          mode: "token",
          token: "replace-me",
        },
      },
    }
    ```

    Notes:

    - `gateway.remote.token` / `.password` do **not** enable local gateway auth by themselves.
    - Local call paths can use `gateway.remote.*` as fallback only when `gateway.auth.*` is unset.
    - If `gateway.auth.token` / `gateway.auth.password` is explicitly configured via SecretRef and unresolved, resolution fails closed (no remote fallback masking).
    - Browser-facing clients authenticate via `connect.params.auth.token`. Avoid putting tokens in URLs.

  </Accordion>

  <Accordion title="Why do I need a token on localhost now?">
    CrawClaw enforces token auth by default, including loopback. If no token is configured, gateway startup auto-generates one and saves it to `gateway.auth.token`, so **local WS clients must authenticate**. This blocks other local processes from calling the Gateway.

    If you **really** want open loopback, set `gateway.auth.mode: "none"` explicitly in your config. Doctor can generate a token for you any time: CrawClaw Desktop or the local Gateway API.

  </Accordion>

  <Accordion title="Do I have to restart after changing config?">
    CrawClaw Desktop and the local Gateway API own supported config writes:

    - Some settings are read dynamically for future operations.
    - Startup-bound settings such as listener port, bind mode, or TLS take effect after restarting the desktop Gateway from the app.

  </Accordion>

  <Accordion title="How do I disable funny CLI taglines?">
    Set `cli.banner.taglineMode` in config:

    ```json5
    {
      cli: {
        banner: {
          taglineMode: "off", // random | default | off
        },
      },
    }
    ```

    - `off`: hides tagline text but keeps the banner title/version line.
    - `default`: uses `All your chats, one CrawClaw.` every time.
    - `random`: rotating funny/seasonal taglines (default behavior).
    - If you want no banner at all, set env `CRAWCLAW_HIDE_BANNER=1`.

  </Accordion>

  <Accordion title="How do I enable web search (and web fetch)?">
    `web_fetch` works without an API key. `web_search` uses the bundled managed
    SearXNG path and also works without a provider API key. **Recommended:** run
    CrawClaw Desktop or the local Gateway API and enable the bundled provider.

    ```json5
    {
      plugins: {
        entries: {
          searxng: {
            enabled: true,
            config: {
              webSearch: {
                autoStart: true,
                host: "127.0.0.1",
                port: 3210,
              },
            },
          },
        },
      },
      tools: {
        web: {
          search: {
            enabled: true,
            provider: "searxng",
            maxResults: 5,
          },
          fetch: {
            enabled: true,
          },
        },
      },
    }
    ```

    SearXNG-specific web-search config lives under
    `plugins.entries.searxng.config.webSearch.*`.

    Notes:

    - If you use allowlists, add `web_search`/`web_fetch` or `group:web`.
    - `web_fetch` is enabled by default (unless explicitly disabled).
    - Daemons read env vars from `~/.crawclaw/.env` (or the service environment).

    Docs: [Web tools](/tools/web).

  </Accordion>

  <Accordion title="config.apply wiped my config. How do I recover and avoid this?">
    `config.apply` replaces the **entire config**. If you send a partial object, everything
    else is removed.

    Recover:

    - Restore from backup (git or a copied `~/.crawclaw/crawclaw.json`).
    - If you have no backup, re-run CrawClaw Desktop or the local Gateway API and reconfigure channels/models.
    - If this was unexpected, file a bug and include your last known config or any backup.
    - A local coding agent can often reconstruct a working config from logs or history.

    Avoid it:

    - Use CrawClaw Desktop or the local Gateway API for small changes.
    - Use CrawClaw Desktop or the local Gateway API for interactive edits.

    Docs: [Config](/gateway/configuration), [Configure](/gateway/configuration), [Doctor](/gateway/doctor).

  </Accordion>

  <Accordion title="How do I run a central Gateway with specialized workers across devices?">
    The common pattern is **one Gateway** (e.g. Raspberry Pi) plus **agents**:

    - **Gateway (central):** owns channels (Signal/Weixin), routing, and sessions.
    - **Agents (workers):** separate brains/workspaces for special roles (e.g. "Hetzner ops", "Personal data").
    - **Sub-agents:** spawn background work from a main agent when you want parallelism.
    - **Desktop client:** connect to the Gateway and switch agents/sessions.

    Docs: [Remote access](/gateway/remote), [Multi-Agent Routing](/concepts/multi-agent), [Sub-agents](/tools/subagents).

  </Accordion>

  <Accordion title="Can the CrawClaw browser run headless?">
    Yes. It's a config option:

    ```json5
    {
      browser: { headless: true },
      agents: {
        defaults: {
        },
      },
    }
    ```

    Default is `false` (headful). Headless is more likely to trigger anti-bot checks on some sites. See [Browser](/tools/browser).

    Headless uses the **same Chromium engine** and works for most automation (forms, clicks, scraping, logins). The main differences:

    - No visible browser window (use screenshots if you need visuals).
    - Some sites are stricter about automation in headless mode (CAPTCHAs, anti-bot).
      For example, X/Twitter often blocks headless sessions.

  </Accordion>

  <Accordion title="How do I use Brave for browser control?">
    Set `browser.executablePath` to your Brave binary (or any Chromium-based browser) and restart the Gateway.
    See the browser selection notes in [Browser](/tools/browser#browser-selection).
  </Accordion>
</AccordionGroup>

## Remote gateways

<AccordionGroup>
  <Accordion title="Tailscale is connected but I get no replies. What now?">
    Check the basics:

    - Gateway is running: CrawClaw Desktop or the local Gateway API
    - Gateway health: CrawClaw Desktop or the local Gateway API
    - Channel health: CrawClaw Desktop or the local Gateway API

    Then verify auth and routing:

    - If you use Tailscale Serve, make sure `gateway.auth.allowTailscale` is set correctly.
    - If you connect via SSH tunnel, confirm the local tunnel is up and points at the right port.
    - Confirm your allowlists (DM or group) include your account.

    Docs: [Tailscale](/gateway/tailscale), [Remote access](/gateway/remote), [Channels](/channels).

  </Accordion>

  <Accordion title="Can two CrawClaw instances talk to each other (local + VPS)?">
    Yes. There is no built-in "bot-to-bot" bridge, but you can wire it up in a few
    reliable ways:

    **Simplest:** use a normal chat channel both bots can access (Feishu/DingTalk/Weixin).
    Have Bot A send a message to Bot B, then let Bot B reply as usual.

    **CLI bridge (generic):** run a script that calls the other Gateway with
    CrawClaw Desktop or the local Gateway API, targeting a chat where the other bot
    listens. If one bot is on a remote VPS, point your CLI at that remote Gateway
    via SSH/Tailscale (see [Remote access](/gateway/remote)).

    Example pattern (run from a machine that can reach the target Gateway):

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Tip: add a guardrail so the two bots do not loop endlessly (mention-only, channel
    allowlists, or a "do not reply to bot messages" rule).

    Docs: [Remote access](/gateway/remote), [Agent CLI](/tools/agent-send), [Agent send](/tools/agent-send).

  </Accordion>

  <Accordion title="Do I need separate VPSes for multiple agents?">
    No. One Gateway can host multiple agents, each with its own workspace, model defaults,
    and routing. That is the normal setup and it is much cheaper and simpler than running
    one VPS per agent.

    Use separate VPSes only when you need hard isolation (security boundaries) or very
    different configs that you do not want to share. Otherwise, keep one Gateway and
    use multiple agents or sub-agents.

  </Accordion>

  <Accordion title="Do remote clients run a local Gateway runtime?">
    No. Only **one gateway** should run per host unless you intentionally run isolated profiles (see [Multiple gateways](/gateway/multiple-gateways)).
    `gateway` and `discovery` changes reconfigure online. Listener-level gateway changes can briefly reconnect clients.

  </Accordion>

  <Accordion title="Is there an API / RPC way to apply config?">
    Yes. `config.apply` validates + writes the full config, then the running Gateway applies the changed settings through the live reconfigure pipeline.
  </Accordion>

  <Accordion title="Minimal sane config for a first install">
    ```json5
    {
      agents: { defaults: { workspace: "~/.crawclaw/workspace" } },
      channels: { weixin: { allowFrom: ["+15555550123"] } },
    }
    ```

    This sets your workspace and restricts who can trigger the bot.

  </Accordion>

  <Accordion title="How do I set up Tailscale on a VPS and connect from my Mac?">
    Minimal steps:

    1. **Install + login on the VPS**

       ```bash
       curl -fsSL https://tailscale.com/install.sh | sh
       sudo tailscale up
       ```

    2. **Install + login on your Mac**
       - Use the Tailscale app and sign in to the same tailnet.
    3. **Enable MagicDNS (recommended)**
       - In the Tailscale admin console, enable MagicDNS so the VPS has a stable name.
    4. **Use the tailnet hostname**
       - SSH: `ssh user@your-vps.tailnet-xxxx.ts.net`
       - Gateway WS: `ws://your-vps.tailnet-xxxx.ts.net:18789`

    If you want browser-facing access without SSH, use Tailscale Serve on the VPS:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    This keeps the gateway bound to loopback and exposes HTTPS via Tailscale. See [Tailscale](/gateway/tailscale).

  </Accordion>

  <Accordion title="How do I connect a remote client to a remote Gateway (Tailscale Serve)?">
    Serve exposes the **Gateway browser-client surface + WS**.

    Recommended setup:

    1. **Make sure the client and Gateway host are on the same tailnet**.
    2. **Use a remote client** (SSH target can be the tailnet hostname).
       It can tunnel the Gateway port and connect to the Gateway.
    3. **Approve the device** on the gateway:

       ```bash
       # Use CrawClaw Desktop or the local Gateway API for this operation.
       # Use CrawClaw Desktop or the local Gateway API for this operation.
       ```

    Docs: [Gateway protocol](/gateway/protocol), [Discovery](/gateway/discovery), [Remote gateway](/gateway/remote).

  </Accordion>

</AccordionGroup>

## Env vars and .env loading

<AccordionGroup>
  <Accordion title="How does CrawClaw load environment variables?">
    CrawClaw reads env vars from the parent process (shell, launchd/systemd, CI, etc.) and additionally loads:

    - `.env` from the current working directory
    - a global fallback `.env` from `~/.crawclaw/.env` (aka `$CRAWCLAW_STATE_DIR/.env`, legacy: `$CRAWCLAW_STATE_DIR/.env`)

    Neither `.env` file overrides existing env vars.

    You can also define inline env vars in config (applied only if missing from the process env):

    ```json5
    {
      env: {
        OPENROUTER_API_KEY: "sk-or-...",
        vars: { GROQ_API_KEY: "gsk-..." },
      },
    }
    ```

    See [/environment](/help/environment) for full precedence and sources.

  </Accordion>

  <Accordion title="I started the Gateway via the service and my env vars disappeared. What now?">
    Two common fixes:

    1. Put the missing keys in `~/.crawclaw/.env` so they're picked up even when the service doesn't inherit your shell env.
    2. Enable shell import (opt-in convenience):

    ```json5
    {
      env: {
        shellEnv: {
          enabled: true,
          timeoutMs: 15000,
        },
      },
    }
    ```

    This runs your login shell and imports only missing expected keys (never overrides). Env var equivalents:
    `CRAWCLAW_LOAD_SHELL_ENV=1`, `CRAWCLAW_SHELL_ENV_TIMEOUT_MS=15000`.

  </Accordion>

  <Accordion title='I set COPILOT_GITHUB_TOKEN, but models status shows "Shell env: off." Why?'>
    CrawClaw Desktop or the local Gateway API reports whether **shell env import** is enabled. "Shell env: off"
    does **not** mean your env vars are missing - it just means CrawClaw won't load
    your login shell automatically.

    If the Gateway runs as a service (launchd/systemd), it won't inherit your shell
    environment. Fix by doing one of these:

    1. Put the token in `~/.crawclaw/.env`:

       ```
       COPILOT_GITHUB_TOKEN=...
       ```

    2. Or enable shell import (`env.shellEnv.enabled: true`).
    3. Or add it to your config `env` block (applies only if missing).

    Then restart the gateway and recheck:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Copilot tokens are read from `COPILOT_GITHUB_TOKEN` (also `GH_TOKEN` / `GITHUB_TOKEN`).
    See [/concepts/model-providers](/concepts/model-providers) and [/environment](/help/environment).

  </Accordion>
</AccordionGroup>

## Sessions and multiple chats

<AccordionGroup>
  <Accordion title="How do I start a fresh conversation?">
    Send `/new` as a standalone message. See [Session management](/concepts/session).
  </Accordion>

  <Accordion title="Do sessions reset automatically if I never send /new?">
    Sessions can expire after `session.idleMinutes`, but this is **disabled by default** (default **0**).
    Set it to a positive value to enable idle expiry. When enabled, the **next**
    message after the idle period starts a fresh session id for that chat key.
    This does not delete transcripts - it just starts a new session.

    ```json5
    {
      session: {
        idleMinutes: 240,
      },
    }
    ```

  </Accordion>

  <Accordion title="Is there a way to make a team of CrawClaw instances (one CEO and many agents)?">
    Yes, via **multi-agent routing** and **sub-agents**. You can create one coordinator
    agent and several worker agents with their own workspaces and models.

    That said, this is best seen as a **fun experiment**. It is token heavy and often
    less efficient than using one bot with separate sessions. The typical model we
    envision is one bot you talk to, with different sessions for parallel work. That
    bot can also spawn sub-agents when needed.

    Docs: [Multi-agent routing](/concepts/multi-agent), [Sub-agents](/tools/subagents), [Multi-agent Gateway API](/concepts/multi-agent).

  </Accordion>

  <Accordion title="Why did context get truncated mid-task? How do I prevent it?">
    Session context is limited by the model window. Long chats, large tool outputs, or many
    files can trigger compaction or truncation.

    What helps:

    - Ask the bot to summarize the current state and write it to a file.
    - Use `/compact` before long tasks, and `/new` when switching topics.
    - Keep important context in the workspace and ask the bot to read it back.
    - Use sub-agents for long or parallel work so the main chat stays smaller.
    - Pick a model with a larger context window if this happens often.

  </Accordion>

  <Accordion title="How do I completely reset CrawClaw but keep it installed?">
    Use the reset command:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Non-interactive full reset:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Then re-run setup:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Notes:

    - Onboarding also offers **Reset** if it sees an existing config. See [Desktop onboarding](/start/wizard).
    - If you used profiles (`--profile` / `CRAWCLAW_PROFILE`), reset each state dir (defaults are `~/.crawclaw-<profile>`).
    - Dev reset: CrawClaw Desktop or the local Gateway API (dev-only; wipes dev config + credentials + sessions + workspace).

  </Accordion>

  <Accordion title='I am getting "context too large" errors - how do I reset or compact?'>
    Use one of these:

    - **Compact** (keeps the conversation but summarizes older turns):

      ```
      /compact
      ```

      or `/compact <instructions>` to guide the summary.

    - **Reset** (fresh session ID for the same chat key):

      ```
      /new
      ```

    If it keeps happening:

    - Enable or tune **session pruning** (`agents.defaults.contextPruning`) to trim old tool output.
    - Use a model with a larger context window.

    Docs: [Compaction](/concepts/compaction), [Session pruning](/concepts/session-pruning), [Session management](/concepts/session).

  </Accordion>

  <Accordion title='Why am I seeing "LLM request rejected: messages.content.tool_use.input field required"?'>
    This is a provider validation error: the model emitted a `tool_use` block without the required
    `input`. It usually means the session history is stale or corrupted (often after long threads
    or a tool/schema change).

    Fix: start a fresh session with `/new` (standalone message).

  </Accordion>

  <Accordion title="Why am I getting legacy heartbeat messages?">
    Current CrawClaw releases no longer schedule periodic legacy agent heartbeat
    by default. If you still see old heartbeat-style messages, check whether an
    older Gateway process is running or whether a cron job, hook, or plugin is
    sending them.

    Use CrawClaw Desktop or the local Gateway API for the latest main-session wake
    diagnostic event, then inspect CrawClaw Desktop or the local Gateway API and CrawClaw Desktop or the local Gateway API
    for scheduled jobs.

    Docs: [Heartbeat](/gateway/heartbeat), [Cron jobs](/automation/cron-jobs).

  </Accordion>

  <Accordion title='Do I need to add a "bot account" to a Weixin group?'>
    No. CrawClaw runs on **your own account**, so if you're in the group, CrawClaw can see it.
    By default, group replies are blocked until you allow senders (`groupPolicy: "allowlist"`).

    If you want only **you** to be able to trigger group replies:

    ```json5
    {
      channels: {
        weixin: {
          groupPolicy: "allowlist",
          groupAllowFrom: ["+15551234567"],
        },
      },
    }
    ```

  </Accordion>

  <Accordion title="How do I get the JID of a Weixin group?">
    Option 1 (fastest): tail logs and send a test message in the group:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Look for `chatId` (or `from`) ending in `@g.us`, like:
    `1234567890-1234567890@g.us`.

    Option 2 (if already configured/allowlisted): list groups from config:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Docs: [Weixin](/channels/index), [Directory](/channels/pairing), [Logs](/gateway/logging).

  </Accordion>

  <Accordion title="Why does CrawClaw not reply in a group?">
    Two common causes:

    - Mention gating is on (default). You must @mention the bot (or match `mentionPatterns`).
    - You configured `channels.weixin.groups` without `"*"` and the group isn't allowlisted.

    See [Groups](/channels/groups) and [Group messages](/channels/group-messages).

  </Accordion>

  <Accordion title="Do groups/threads share context with DMs?">
    Direct chats collapse to the main session by default. Groups/channels have their own session keys, and Feishu topics / QQBot threads are separate sessions. See [Groups](/channels/groups) and [Group messages](/channels/group-messages).
  </Accordion>

  <Accordion title="How many workspaces and agents can I create?">
    No hard limits. Dozens (even hundreds) are fine, but watch for:

    - **Disk growth:** sessions + transcripts live under `~/.crawclaw/agents/<agentId>/sessions/`.
    - **Token cost:** more agents means more concurrent model usage.
    - **Ops overhead:** per-agent auth profiles, workspaces, and channel routing.

    Tips:

    - Keep one **active** workspace per agent (`agents.defaults.workspace`).
    - Prune old sessions (delete JSONL or store entries) if disk grows.
    - Use CrawClaw Desktop or the local Gateway API to spot stray workspaces and profile mismatches.

  </Accordion>

  <Accordion title="Can I run multiple bots or chats at the same time (DingTalk), and how should I set that up?">
    Yes. Use **Multi-Agent Routing** to run multiple isolated agents and route inbound messages by
    channel/account/peer. DingTalk is supported as a channel and can be bound to specific agents.

    Browser access is powerful but not "do anything a human can" - anti-bot, CAPTCHAs, and MFA can
    still block automation. For the most reliable browser control, use a managed browser on the host,
    or use CDP on the machine that actually runs the browser.

    Best-practice setup:

    - Always-on Gateway host (VPS/Mac mini).
    - One agent per role (bindings).
    - DingTalk channel(s) bound to those agents.
    - Local browser on the Gateway host or remote CDP when needed.

    Docs: [Multi-Agent Routing](/concepts/multi-agent), [DingTalk](/channels/index),
    [Browser](/tools/browser).

  </Accordion>
</AccordionGroup>

## Models: defaults, selection, aliases, switching

<AccordionGroup>
  <Accordion title='What is the "default model"?'>
    CrawClaw's default model is whatever you set as:

    ```
    agents.defaults.model.primary
    ```

    Models are referenced as `provider/model` (example: `anthropic/claude-opus-4-6`). If you omit the provider, CrawClaw currently assumes `anthropic` as a temporary deprecation fallback - but you should still **explicitly** set `provider/model`.

  </Accordion>

  <Accordion title="What model do you recommend?">
    **Recommended default:** use the strongest latest-generation model available in your provider stack.
    **For tool-enabled or untrusted-input agents:** prioritize model strength over cost.
    **For routine/low-stakes chat:** use cheaper fallback models and route by agent role.

    MiniMax has its own docs: [MiniMax](/providers/minimax) and
    [Local models](/gateway/local-models).

    Rule of thumb: use the **best model you can afford** for high-stakes work, and a cheaper
    model for routine chat or summaries. You can route models per agent and use sub-agents to
    parallelize long tasks (each sub-agent consumes tokens). See [Models](/concepts/models) and
    [Sub-agents](/tools/subagents).

    Strong warning: weaker/over-quantized models are more vulnerable to prompt
    injection and unsafe behavior. See [Security](/gateway/security).

    More context: [Models](/concepts/models).

  </Accordion>

  <Accordion title="How do I switch models without wiping my config?">
    Use **model commands** or edit only the **model** fields. Avoid full config replaces.

    Safe options:

    - `/model` in chat (quick, per-session)
    - CrawClaw Desktop or the local Gateway API (updates just model config)
    - CrawClaw Desktop or the local Gateway API (interactive)
    - edit `agents.defaults.model` in `~/.crawclaw/crawclaw.json`

    Avoid `config.apply` with a partial object unless you intend to replace the whole config.
    If you did overwrite config, restore from backup or re-run CrawClaw Desktop or the local Gateway API to repair.

    Docs: [Models](/concepts/models), [Configure](/gateway/configuration), [Config](/gateway/configuration), [Doctor](/gateway/doctor).

  </Accordion>

  <Accordion title="Can I use self-hosted models (llama.cpp, vLLM, Ollama)?">
    Yes. Ollama is the easiest path for local models.

    Quickest setup:

    1. Install Ollama from `https://ollama.com/download`
    2. Pull a local model such as `ollama pull glm-4.7-flash`
    3. If you want Ollama Cloud too, run `ollama signin`
    4. Run CrawClaw Desktop or the local Gateway API and choose `Ollama`
    5. Pick `Local` or `Cloud + Local`

    Notes:

    - `Cloud + Local` gives you Ollama Cloud models plus your local Ollama models
    - cloud models such as `kimi-k2.5:cloud` do not need a local pull
    - for manual switching, use CrawClaw Desktop or the local Gateway API and CrawClaw Desktop or the local Gateway API

    Security note: smaller or heavily quantized models are more vulnerable to prompt
    injection. We strongly recommend **large models** for any bot that can use tools.

    Docs: [Ollama](/providers/ollama), [Local models](/gateway/local-models),
    [Model providers](/concepts/model-providers), [Security](/gateway/security),
    [Security](/gateway/security).

  </Accordion>

  <Accordion title="What do CrawClaw, Flawd, and Krill use for models?">
    - These deployments can differ and may change over time; there is no fixed provider recommendation.
    - Check the current runtime setting on each gateway with CrawClaw Desktop or the local Gateway API.
    - For security-sensitive/tool-enabled agents, use the strongest latest-generation model available.
  </Accordion>

  <Accordion title="How do I switch models on the fly (without restarting)?">
    Use the `/model` command as a standalone message:

    ```
    /model sonnet
    /model opus
    /model gpt
    /model gpt-mini
    /model gemini
    /model gemini-flash
    /model gemini-flash-lite
    ```

    These are the built-in aliases. Custom aliases can be added via `agents.defaults.models`.

    You can list available models with `/model`, `/model list`, or `/model status`.

    `/model` (and `/model list`) shows a compact, numbered picker. Select by number:

    ```
    /model 3
    ```

    You can also force a specific auth profile for the provider (per session):

    ```
    /model opus@anthropic:default
    /model opus@anthropic:work
    ```

    Tip: `/model status` shows which agent is active, which `auth-profiles.json` file is being used, and which auth profile will be tried next.
    It also shows the configured provider endpoint (`baseUrl`) and API mode (`api`) when available.

    **How do I unpin a profile I set with @profile?**

    Re-run `/model` **without** the `@profile` suffix:

    ```
    /model anthropic/claude-opus-4-6
    ```

    If you want to return to the default, pick it from `/model` (or send `/model <default provider/model>`).
    Use `/model status` to confirm which auth profile is active.

  </Accordion>

  <Accordion title="Can I use GPT 5.2 for daily tasks and Codex 5.3 for coding?">
    Yes. Set one as default and switch as needed:

    - **Quick switch (per session):** `/model gpt-5.4` for daily tasks, `/model openai-codex/gpt-5.4` for coding when compatible Codex auth is already available.
    - **Default + switch:** set `agents.defaults.model.primary` to `openai/gpt-5.4`, then switch to `openai-codex/gpt-5.4` when coding (or the other way around).
    - **Sub-agents:** route coding tasks to sub-agents with a different default model.

    See [Models](/concepts/models) and [Slash commands](/tools/slash-commands).

  </Accordion>

  <Accordion title='Why do I see "Model ... is not allowed" and then no reply?'>
    If `agents.defaults.models` is set, it becomes the **allowlist** for `/model` and any
    session overrides. Choosing a model that isn't in that list returns:

    ```
    Model "provider/model" is not allowed. Use /model to list available models.
    ```

    That error is returned **instead of** a normal reply. Fix: add the model to
    `agents.defaults.models`, remove the allowlist, or pick a model from `/model list`.

  </Accordion>

  <Accordion title='Why do I see "Unknown model: minimax/MiniMax-M2.7"?'>
    This means the **provider isn't configured** (no MiniMax provider config or auth
    profile was found), so the model can't be resolved.

    Fix checklist:

    1. Upgrade to a current CrawClaw release (or run from source `main`), then restart the gateway.
    2. Make sure MiniMax is configured (wizard or JSON), or that a MiniMax API key
       exists in env/auth profiles so the provider can be injected.
    3. Use the exact model id (case-sensitive): `minimax/MiniMax-M2.7` or
       `minimax/MiniMax-M2.7-highspeed`.
    4. Run:

       ```bash
       # Use CrawClaw Desktop or the local Gateway API for this operation.
       ```

       and pick from the list (or `/model list` in chat).

    See [MiniMax](/providers/minimax) and [Models](/concepts/models).

  </Accordion>

  <Accordion title="Can I use MiniMax as my default and OpenAI for complex tasks?">
    Yes. Use **MiniMax as the default** and switch models **per session** when needed.
    Fallbacks are for **errors**, not "hard tasks," so use `/model` or a separate agent.

    **Option A: switch per session**

    ```json5
    {
      env: { MINIMAX_API_KEY: "sk-...", OPENAI_API_KEY: "sk-..." },
      agents: {
        defaults: {
          model: { primary: "minimax/MiniMax-M2.7" },
          models: {
            "minimax/MiniMax-M2.7": { alias: "minimax" },
            "openai/gpt-5.4": { alias: "gpt" },
          },
        },
      },
    }
    ```

    Then:

    ```
    /model gpt
    ```

    **Option B: separate agents**

    - Agent A default: MiniMax
    - Agent B default: OpenAI
    - Route by agent or use `/agent` to switch

    Docs: [Models](/concepts/models), [Multi-Agent Routing](/concepts/multi-agent), [MiniMax](/providers/minimax), [OpenAI](/providers/openai).

  </Accordion>

  <Accordion title="Are opus / sonnet / gpt built-in shortcuts?">
    Yes. CrawClaw ships a few default shorthands (only applied when the model exists in `agents.defaults.models`):

    - `opus` → `anthropic/claude-opus-4-6`
    - `sonnet` → `anthropic/claude-sonnet-4-6`
    - `gpt` → `openai/gpt-5.4`
    - `gpt-mini` → `openai/gpt-5-mini`
    - `gemini` → `google/gemini-3.1-pro-preview`
    - `gemini-flash` → `google/gemini-3-flash-preview`
    - `gemini-flash-lite` → `google/gemini-3.1-flash-lite-preview`

    If you set your own alias with the same name, your value wins.

  </Accordion>

  <Accordion title="How do I define/override model shortcuts (aliases)?">
    Aliases come from `agents.defaults.models.<modelId>.alias`. Example:

    ```json5
    {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-opus-4-6" },
          models: {
            "anthropic/claude-opus-4-6": { alias: "opus" },
            "anthropic/claude-sonnet-4-6": { alias: "sonnet" },
            "anthropic/claude-haiku-4-5": { alias: "haiku" },
          },
        },
      },
    }
    ```

    Then `/model sonnet` (or `/<alias>` when supported) resolves to that model ID.

  </Accordion>

  <Accordion title="How do I add models from other providers like OpenRouter or Z.AI?">
    OpenRouter (pay-per-token; many models):

    ```json5
    {
      agents: {
        defaults: {
          model: { primary: "openrouter/anthropic/claude-sonnet-4-6" },
          models: { "openrouter/anthropic/claude-sonnet-4-6": {} },
        },
      },
      env: { OPENROUTER_API_KEY: "sk-or-..." },
    }
    ```

    Z.AI (GLM models):

    ```json5
    {
      agents: {
        defaults: {
          model: { primary: "zai/glm-5" },
          models: { "zai/glm-5": {} },
        },
      },
      env: { ZAI_API_KEY: "..." },
    }
    ```

    If you reference a provider/model but the required provider key is missing, you'll get a runtime auth error (e.g. `No API key found for provider "zai"`).

    **No API key found for provider after adding a new agent**

    This usually means the **new agent** has an empty auth store. Auth is per-agent and
    stored in:

    ```
    ~/.crawclaw/agents/<agentId>/agent/auth-profiles.json
    ```

    Fix options:

    - Run CrawClaw Desktop or the local Gateway API and configure auth during the wizard.
    - Or copy `auth-profiles.json` from the main agent's `agentDir` into the new agent's `agentDir`.

    Do **not** reuse `agentDir` across agents; it causes auth/session collisions.

  </Accordion>
</AccordionGroup>

## Model failover and "All models failed"

<AccordionGroup>
  <Accordion title="How does failover work?">
    Failover happens in two stages:

    1. **Auth profile rotation** within the same provider.
    2. **Model fallback** to the next model in `agents.defaults.model.fallbacks`.

    Cooldowns apply to failing profiles (exponential backoff), so CrawClaw can keep responding even when a provider is rate-limited or temporarily failing.

  </Accordion>

  <Accordion title='What does "No credentials found for profile anthropic:default" mean?'>
    It means the system attempted to use the auth profile ID `anthropic:default`, but could not find credentials for it in the expected auth store.

    **Fix checklist:**

    - **Confirm where auth profiles live** (new vs legacy paths)
      - Current: `~/.crawclaw/agents/<agentId>/agent/auth-profiles.json`
      - Legacy: `~/.crawclaw/agent/*` (migrated by CrawClaw Desktop or the local Gateway API)
    - **Confirm your env var is loaded by the Gateway**
      - If you set `ANTHROPIC_API_KEY` in your shell but run the Gateway via systemd/launchd, it may not inherit it. Put it in `~/.crawclaw/.env` or enable `env.shellEnv`.
    - **Make sure you're editing the correct agent**
      - Multi-agent setups mean there can be multiple `auth-profiles.json` files.
    - **Sanity-check model/auth status**
      - Use CrawClaw Desktop or the local Gateway API to see configured models and whether providers are authenticated.

    **Fix checklist for "No credentials found for profile anthropic"**

    This means the run is pinned to an Anthropic auth profile, but the Gateway
    can't find it in its auth store.

    - **Use a setup-token**
      - Run `claude setup-token`, then paste it with CrawClaw Desktop or the local Gateway API.
      - If the token was created on another machine, use CrawClaw Desktop or the local Gateway API.
    - **If you want to use an API key instead**
      - Put `ANTHROPIC_API_KEY` in `~/.crawclaw/.env` on the **gateway host**.
      - Clear any pinned order that forces a missing profile:

        ```bash
        # Use CrawClaw Desktop or the local Gateway API for this operation.
        ```

    - **Confirm you're running commands on the gateway host**
      - In remote mode, auth profiles live on the gateway machine, not your laptop.

  </Accordion>

  <Accordion title="Why did it also try Google Gemini and fail?">
    If your model config includes Google Gemini as a fallback (or you switched to a Gemini shorthand), CrawClaw will try it during model fallback. If you haven't configured Google credentials, you'll see `No API key found for provider "google"`.

    Fix: either provide Google auth, or remove/avoid Google models in `agents.defaults.model.fallbacks` / aliases so fallback doesn't route there.

    **LLM request rejected: thinking signature required (Google Antigravity)**

    Cause: the session history contains **thinking blocks without signatures** (often from
    an aborted/partial stream). Google Antigravity requires signatures for thinking blocks.

    Fix: CrawClaw now strips unsigned thinking blocks for Google Antigravity Claude. If it still appears, start a **new session** or set `/thinking off` for that agent.

  </Accordion>
</AccordionGroup>

## Auth profiles: what they are and how to manage them

Related: [/concepts/oauth](/concepts/oauth) (OAuth flows, token storage, multi-account patterns)

<AccordionGroup>
  <Accordion title="What is an auth profile?">
    An auth profile is a named credential record (OAuth or API key) tied to a provider. Profiles live in:

    ```
    ~/.crawclaw/agents/<agentId>/agent/auth-profiles.json
    ```

  </Accordion>

  <Accordion title="What are typical profile IDs?">
    CrawClaw uses provider-prefixed IDs like:

    - `anthropic:default` (common when no email identity exists)
    - `anthropic:<email>` for OAuth identities
    - custom IDs you choose (e.g. `anthropic:work`)

  </Accordion>

  <Accordion title="Can I control which auth profile is tried first?">
    Yes. Config supports optional metadata for profiles and an ordering per provider (`auth.order.<provider>`). This does **not** store secrets; it maps IDs to provider/mode and sets rotation order.

    CrawClaw may temporarily skip a profile if it's in a short **cooldown** (rate limits/timeouts/auth failures) or a longer **disabled** state (billing/insufficient credits). To inspect this, run CrawClaw Desktop or the local Gateway API and check `auth.unusableProfiles`. Tuning: `auth.cooldowns.billingBackoffHours*`.

    You can also set a **per-agent** order override (stored in that agent's `auth-profiles.json`) from CrawClaw Desktop or the local Gateway API.

  </Accordion>

  <Accordion title="OAuth vs API key - what is the difference?">
    CrawClaw supports both:

    - **OAuth** often leverages subscription access (where applicable).
    - **API keys** use pay-per-token billing.

    The wizard supports Anthropic setup-token and API key storage. Provider-specific bundled JavaScript OAuth login helpers have been removed.

  </Accordion>
</AccordionGroup>

## Gateway: ports, "already running", and remote mode

<AccordionGroup>
  <Accordion title="What port does the Gateway use?">
    `gateway.port` controls the single multiplexed port for WebSocket + HTTP (browser clients, hooks, etc.).

    Precedence:

    ```
    --port > CRAWCLAW_GATEWAY_PORT > gateway.port > default 18789
    ```

  </Accordion>

  <Accordion title="Why does the process look alive but RPC is unavailable?">
Because process state and API reachability are different checks. The RPC probe connects to the Gateway WebSocket and calls `status`.

    Use CrawClaw Desktop or the local Gateway API and trust these lines:

    - `Probe target:` (the URL the probe actually used)
    - `Listening:` (what's actually bound on the port)
    - `Last gateway error:` (common root cause when the process is alive but the port isn't listening)

  </Accordion>

  <Accordion title='Why are "Config (file)" and "Config (service)" different?'>
    You're editing one config file while the service is running another (often a `--profile` / `CRAWCLAW_STATE_DIR` mismatch).

    Fix:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Run that from the same `--profile` / environment you want the service to use.

  </Accordion>

  <Accordion title='What does "another gateway instance is already listening" mean?'>
    CrawClaw enforces a runtime lock by binding the WebSocket listener immediately on startup (default `ws://127.0.0.1:18789`). If the bind fails with `EADDRINUSE`, it throws `GatewayLockError` indicating another instance is already listening.

    Fix: stop the other instance, free the port, or run with CrawClaw Desktop or the local Gateway API.

  </Accordion>

  <Accordion title="How do I run CrawClaw in remote mode (client connects to a Gateway elsewhere)?">
    Set `gateway.mode: "remote"` and point to a remote WebSocket URL, optionally with a token/password:

    ```json5
    {
      gateway: {
        mode: "remote",
        remote: {
          url: "ws://gateway.tailnet:18789",
          token: "your-token",
          password: "your-password",
        },
      },
    }
    ```

    Notes:

    - CrawClaw Desktop or the local Gateway API only starts when `gateway.mode` is `local` (or you pass the override flag).
    - Local clients that supervise the Gateway may watch the config file and switch modes live when these values change.

  </Accordion>

  <Accordion title='A browser client says "unauthorized" (or keeps reconnecting). What now?'>
    Your gateway is running with auth enabled (`gateway.auth.*`), but the UI is not sending the matching token/password.

    Facts (from code):

    - Browser clients may keep the token in session-scoped storage for the selected gateway URL, so same-tab refreshes can keep working without restoring long-lived token persistence.
    - On `AUTH_TOKEN_MISMATCH`, refresh the client token/password so it matches the gateway auth configuration.

    Fix:

    - Fastest local check: CrawClaw Desktop or the local Gateway API.
    - If you don't have a token yet: CrawClaw Desktop or the local Gateway API.
    - If remote, tunnel first: `ssh -N -L 18789:127.0.0.1:18789 user@host` then open `http://127.0.0.1:18789/`.
    - Set `gateway.auth.token` (or `CRAWCLAW_GATEWAY_TOKEN`) on the gateway host.
    - Configure the same token in the client you are using.
    - If mismatch persists after the one retry, rotate/re-approve the paired device token:
      - CrawClaw Desktop or the local Gateway API
      - CrawClaw Desktop or the local Gateway API
    - Still stuck? Run CrawClaw Desktop or the local Gateway API and follow [Troubleshooting](/gateway/troubleshooting).

  </Accordion>

  <Accordion title="I set gateway.bind tailnet but it cannot bind and nothing listens">
    `tailnet` bind picks a Tailscale IP from your network interfaces (100.64.0.0/10). If the machine isn't on Tailscale (or the interface is down), there's nothing to bind to.

    Fix:

    - Start Tailscale on that host (so it has a 100.x address), or
    - Switch to `gateway.bind: "loopback"` / `"lan"`.

    Note: `tailnet` is explicit. `auto` prefers loopback; use `gateway.bind: "tailnet"` when you want a tailnet-only bind.

  </Accordion>

  <Accordion title="Can I run multiple Gateways on the same host?">
    Usually no - one Gateway can run multiple messaging channels and agents. Use multiple Gateways only when you need redundancy (ex: rescue bot) or hard isolation.

    Yes, but you must isolate:

    - `CRAWCLAW_CONFIG_PATH` (per-instance config)
    - `CRAWCLAW_STATE_DIR` (per-instance state)
    - `agents.defaults.workspace` (workspace isolation)
    - `gateway.port` (unique ports)

    Quick setup (recommended):

    - Use CrawClaw Desktop or the local Gateway API per instance (auto-creates `~/.crawclaw-<name>`).
    - Set a unique `gateway.port` in each profile config (or pass `--port` for manual runs).
    - Install a per-profile service: CrawClaw Desktop or the local Gateway API.

    Profiles also suffix service names (`ai.crawclaw.<profile>`; legacy `com.crawclaw.*`, `crawclaw-gateway-<profile>.service`, `CrawClaw Gateway (<profile>)`).
    Full guide: [Multiple gateways](/gateway/multiple-gateways).

  </Accordion>

  <Accordion title='What does "invalid handshake" / code 1008 mean?'>
    The Gateway is a **WebSocket server**, and it expects the very first message to
    be a `connect` frame. If it receives anything else, it closes the connection
    with **code 1008** (policy violation).

    Common causes:

    - You opened the **HTTP** URL in a browser (`http://...`) instead of a WS client.
    - You used the wrong port or path.
    - A proxy or tunnel stripped auth headers or sent a non-Gateway request.

    Quick fixes:

    1. Use the WS URL: `ws://<host>:18789` (or `wss://...` if HTTPS).
    2. Don't open the WS port in a normal browser tab.
    3. If auth is on, include the token/password in the `connect` frame.

    If you're using a remote Gateway client, the URL should look like:

    ```
    ```

    Protocol details: [Gateway protocol](/gateway/protocol).

  </Accordion>
</AccordionGroup>

## Logging and debugging

<AccordionGroup>
  <Accordion title="Where are logs?">
    File logs (structured):

    ```
    /tmp/crawclaw/crawclaw-YYYY-MM-DD.log
    ```

    You can set a stable path via `logging.file`. File log level is controlled by `logging.level`. Console verbosity is controlled by `--verbose` and `logging.consoleLevel`.

    Fastest log tail:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Gateway runtime logs:

    - `$CRAWCLAW_STATE_DIR/logs/gateway.log`
    - `$CRAWCLAW_STATE_DIR/logs/gateway.err.log`

    See [Troubleshooting](/gateway/troubleshooting) for more.

  </Accordion>

  <Accordion title="How do I start/stop/restart the local Gateway runtime?">
    Use CrawClaw Desktop as the default runtime owner. If you run a manual
    debug process on the same port, quit it before starting the desktop app.
    See [Gateway](/gateway).

  </Accordion>

  <Accordion title="I closed my terminal on Windows - how do I restart CrawClaw?">
    The supported Windows path is native Windows. Open PowerShell and run:

    ```powershell
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    If you run it manually (no service), use:

    ```powershell
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Docs: [Windows](/platforms/windows), [Gateway runbook](/gateway).

  </Accordion>

  <Accordion title="The Gateway is up but replies never arrive. What should I check?">
    Start with a quick health sweep:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Common causes:

    - Model auth not loaded on the **gateway host** (check `models status`).
    - Channel pairing/allowlist blocking replies (check channel config + logs).
    - The Gateway client is using the wrong token.

    If you are remote, confirm the tunnel/Tailscale connection is up and that the
    Gateway WebSocket is reachable.

    Docs: [Channels](/channels), [Troubleshooting](/gateway/troubleshooting), [Remote access](/gateway/remote).

  </Accordion>

  <Accordion title='"Disconnected from gateway: no reason" - what now?'>
    This usually means the UI lost the WebSocket connection. Check:

    1. Is the Gateway running? CrawClaw Desktop or the local Gateway API
    2. Is the Gateway healthy? CrawClaw Desktop or the local Gateway API
    3. Does the client have the right token?
    4. If remote, is the tunnel/Tailscale link up?

    Then tail logs:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Docs: [Remote access](/gateway/remote), [Troubleshooting](/gateway/troubleshooting).

  </Accordion>

  <Accordion title="Feishu setMyCommands fails. What should I check?">
    Start with logs and channel status:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Then match the error:

    - `BOT_COMMANDS_TOO_MUCH`: the Feishu menu has too many entries. CrawClaw already trims to the Feishu limit and retries with fewer commands, but some menu entries still need to be dropped. Reduce plugin/skill/custom commands, or disable `channels.feishu.commands.native` if you do not need the menu.
    - `TypeError: fetch failed`, `Network request for 'setMyCommands' failed!`, or similar network errors: if you are on a VPS or behind a proxy, confirm outbound HTTPS is allowed and DNS works for `api.feishu.org`.

    If the Gateway is remote, make sure you are looking at logs on the Gateway host.

    Docs: [Feishu](/channels/index), [Channel troubleshooting](/channels/troubleshooting).

  </Accordion>

  <Accordion title="Desktop client shows no output. What should I check?">
    First confirm the Gateway is reachable and the agent can run:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Use CrawClaw Desktop or the local Gateway API to see the current state. If you expect replies in a chat
    channel, make sure delivery is enabled (`/deliver on`).

    Docs: [Slash commands](/tools/slash-commands).

  </Accordion>

  <Accordion title="How do I completely stop then start the Gateway?">
    If you installed the service:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    This stops/starts the **supervised service** (launchd on macOS, systemd on Linux).
    Use this when the Gateway runs in the background as a daemon.

    If you're running in the foreground, stop with Ctrl-C, then:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Docs: [Gateway runbook](/gateway).

  </Accordion>

<Accordion title="ELI5: CrawClaw Desktop owns the local Gateway runtime">

    Use CrawClaw Desktop for the normal local runtime. Use the local Gateway API for integrations and diagnostics.

  </Accordion>

  <Accordion title="Fastest way to get more details when something fails">
    Start the Gateway with `--verbose` to get more console detail. Then inspect the log file for channel auth, model routing, and RPC errors.
  </Accordion>
</AccordionGroup>

## Media and attachments

<AccordionGroup>
  <Accordion title="My skill generated an image/PDF, but nothing was sent">
    Outbound attachments from the agent must include a `MEDIA:<path-or-url>` line (on its own line). See [CrawClaw assistant setup](/start/crawclaw) and [Agent send](/tools/agent-send).

    Send from a connected channel, CrawClaw Desktop, or the local Gateway API.

    Also check:

    - The target channel supports outbound media and isn't blocked by allowlists.
    - The file is within the provider's size limits (images are resized to max 2048px).
    - `tools.fs.workspaceOnly=false` lets `MEDIA:` send host-local files the agent can already read, but only for media plus safe document types (images, audio, video, PDF, and Office docs). Plain text and secret-like files are still blocked.

    See [Messages](/concepts/messages).

  </Accordion>
</AccordionGroup>

## Security and access control

<AccordionGroup>
  <Accordion title="Is it safe to expose CrawClaw to inbound DMs?">
    Treat inbound DMs as untrusted input. Defaults are designed to reduce risk:

    - Default behavior on DM-capable channels is **pairing**:
      - Unknown senders receive a pairing code; the bot does not process their message.
      - Approve with: CrawClaw Desktop or the local Gateway API
      - Pending requests are capped at **3 per channel**; check CrawClaw Desktop or the local Gateway API if a code didn't arrive.
    - Opening DMs publicly requires explicit opt-in (`dmPolicy: "open"` and allowlist `"*"`).

    Run CrawClaw Desktop or the local Gateway API to surface risky DM policies.

  </Accordion>

  <Accordion title="Is prompt injection only a concern for public bots?">
    No. Prompt injection is about **untrusted content**, not just who can DM the bot.
    If your assistant reads external content (web search/fetch, browser pages, emails,
    docs, attachments, pasted logs), that content can include instructions that try
    to hijack the model. This can happen even if **you are the only sender**.

    The biggest risk is when tools are enabled: the model can be tricked into
    exfiltrating context or calling tools on your behalf. Reduce the blast radius by:

    - using a read-only or tool-disabled "reader" agent to summarize untrusted content
    - keeping `web_search` / `web_fetch` / `browser` off for tool-enabled agents

    Details: [Security](/gateway/security).

  </Accordion>

  <Accordion title="Should my bot have its own email, GitHub account, or phone number?">
    Yes, for most setups. Isolating the bot with separate accounts and phone numbers
    reduces the blast radius if something goes wrong. This also makes it easier to rotate
    credentials or revoke access without impacting your personal accounts.

    Start small. Give access only to the tools and accounts you actually need, and expand
    later if required.

    Docs: [Security](/gateway/security), [Pairing](/channels/pairing).

  </Accordion>

  <Accordion title="Can I give it autonomy over my text messages and is that safe?">
    We do **not** recommend full autonomy over your personal messages. The safest pattern is:

    - Keep DMs in **pairing mode** or a tight allowlist.
    - Use a **separate number or account** if you want it to message on your behalf.
    - Let it draft, then **approve before sending**.

    If you want to experiment, do it on a dedicated account and keep it isolated. See
    [Security](/gateway/security).

  </Accordion>

  <Accordion title="Can I use cheaper models for personal assistant tasks?">
    Yes, **if** the agent is chat-only and the input is trusted. Smaller tiers are
    more susceptible to instruction hijacking, so avoid them for tool-enabled agents
    or when reading untrusted content. If you must use a smaller model, lock down
  </Accordion>

  <Accordion title="I ran /start in Feishu but did not get a pairing code">
    Pairing codes are sent **only** when an unknown sender messages the bot and
    `dmPolicy: "pairing"` is enabled. `/start` by itself doesn't generate a code.

    Check pending requests:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    If you want immediate access, allowlist your sender id or set `dmPolicy: "open"`
    for that account.

  </Accordion>

  <Accordion title="Weixin: will it message my contacts? How does pairing work?">
    No. Default Weixin DM policy is **pairing**. Unknown senders only get a pairing code and their message is **not processed**. CrawClaw only replies to chats it receives or to explicit sends you trigger.

    Approve pairing with:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    List pending requests:

    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Wizard phone number prompt: it's used to set your **allowlist/owner** so your own DMs are permitted. It's not used for auto-sending. If you run on your personal Weixin number, use that number and enable `channels.weixin.selfChatMode`.

  </Accordion>
</AccordionGroup>

## Chat commands, aborting tasks, and "it will not stop"

<AccordionGroup>
  <Accordion title="How do I stop internal system messages from showing in chat?">
    Most internal or tool messages only appear when **verbose** or **reasoning** is enabled
    for that session.

    Fix in the chat where you see it:

    ```
    /verbose off
    /reasoning off
    ```

    If it is still noisy, check the session settings in the client you are using and set verbose
    to **inherit**. Also confirm you are not using a bot profile with `verboseDefault` set
    to `on` in config.

    Docs: [Thinking and verbose](/tools/thinking), [Security](/gateway/security#reasoning-verbose-output-in-groups).

  </Accordion>

  <Accordion title="How do I stop/cancel a running task?">
    Send any of these **as a standalone message** (no slash):

    ```
    stop
    stop action
    stop current action
    stop run
    stop current run
    stop agent
    stop the agent
    stop crawclaw
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    stop don't do anything
    stop do not do anything
    stop doing anything
    please stop
    stop please
    abort
    esc
    wait
    exit
    interrupt
    ```

    These are abort triggers (not slash commands).

    For background processes (from the exec tool), you can ask the agent to run:

    ```
    process action:kill sessionId:XXX
    ```

    Slash commands overview: see [Slash commands](/tools/slash-commands).

    Most commands must be sent as a **standalone** message that starts with `/`, but a few shortcuts (like `/status`) also work inline for allowlisted senders.

  </Accordion>

  <Accordion title='How do I send a QQBot message from Feishu? ("Cross-context messaging denied")'>
    CrawClaw blocks **cross-provider** messaging by default. If a tool call is bound
    to Feishu, it won't send to QQBot unless you explicitly allow it.

    Enable cross-provider messaging for the agent:

    ```json5
    {
      tools: {
        message: {
          crossContext: {
            allowAcrossProviders: true,
            marker: { enabled: true, prefix: "[from {channel}] " },
          },
        },
      },
    }
    ```

    Restart the gateway after editing config.

  </Accordion>

  <Accordion title='Why does it feel like the bot "ignores" rapid-fire messages?'>
    Queue mode controls how new messages interact with an in-flight run. Use `/queue` to change modes:

    - `steer` - new messages redirect the current task
    - `followup` - run messages one at a time
    - `collect` - batch messages and reply once (default)
    - `steer-backlog` - steer now, then process backlog
    - `interrupt` - abort current run and start fresh

    You can add options like `debounce:2s cap:25 drop:summarize` for followup modes.

  </Accordion>
</AccordionGroup>

## Miscellaneous

<AccordionGroup>
  <Accordion title='What is the default model for Anthropic with an API key?'>
    In CrawClaw, credentials and model selection are separate. Setting `ANTHROPIC_API_KEY` (or storing an Anthropic API key in auth profiles) enables authentication, but the actual default model is whatever you configure in `agents.defaults.model.primary` (for example, `anthropic/claude-sonnet-4-6` or `anthropic/claude-opus-4-6`). If you see `No credentials found for profile "anthropic:default"`, it means the Gateway couldn't find Anthropic credentials in the expected `auth-profiles.json` for the agent that's running.
  </Accordion>
</AccordionGroup>

---

Still stuck? Ask in [QQBot](https://qqbot.com/invite/clawd) or open a [GitHub discussion](https://github.com/qianleigood/crawclaw/discussions).
