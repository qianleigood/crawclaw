---
summary: "Configuration overview: common tasks, quick setup, and links to the full reference"
read_when:
  - Setting up CrawClaw for the first time
  - Looking for common configuration patterns
  - Navigating to specific config sections
title: "Configuration"
---

# Configuration

CrawClaw reads an optional <Tooltip tip="JSON5 supports comments and trailing commas">**JSON5**</Tooltip> config from `~/.crawclaw/crawclaw.json`.

If the file is missing, CrawClaw uses safe defaults. Common reasons to add a config:

- Connect channels and control who can message the bot
- Tune sessions, media, networking, or UI

See the [full reference](/gateway/configuration-reference) for every available field.

<Tip>
**New to configuration?** Start with `crawclaw onboard` for interactive setup, or check out the [Configuration Examples](/gateway/configuration-examples) guide for complete copy-paste configs.
</Tip>

## Minimal config

```json5
// ~/.crawclaw/crawclaw.json
{
  agents: { defaults: { workspace: "~/.crawclaw/workspace" } },
  channels: { whatsapp: { allowFrom: ["+15555550123"] } },
}
```

## Editing config

<Tabs>
  <Tab title="Interactive wizard">
    ```bash
    crawclaw onboard       # full onboarding flow
    crawclaw configure     # config wizard
    ```
  </Tab>
  <Tab title="CLI (one-liners)">
    ```bash
    crawclaw config get agents.defaults.workspace
    crawclaw config set cron.enabled true
    crawclaw config unset plugins.entries.brave.config.webSearch.apiKey
    ```
  </Tab>
  <Tab title="Direct edit">
    Edit `~/.crawclaw/crawclaw.json` directly. The Gateway watches the file and applies changes automatically (see [hot reload](#config-hot-reload)).
  </Tab>
</Tabs>

## Strict validation

<Warning>
CrawClaw only accepts configurations that fully match the schema. Unknown keys, malformed types, or invalid values cause the Gateway to **refuse to start**. The only root-level exception is `$schema` (string), so editors can attach JSON Schema metadata.
</Warning>

When validation fails:

- The Gateway does not boot
- Only diagnostic commands work (`crawclaw doctor`, `crawclaw logs`, `crawclaw health`, `crawclaw status`)
- Run `crawclaw doctor` to see exact issues
- Run `crawclaw doctor --fix` (or `--yes`) to apply repairs

## Common tasks

<AccordionGroup>
  <Accordion title="Set up a channel (WhatsApp, Telegram, Discord, etc.)">
    Each channel has its own config section under `channels.<provider>`. See the dedicated channel page for setup steps:

    - [WhatsApp](/channels/whatsapp) — `channels.whatsapp`
    - [Telegram](/channels/telegram) — `channels.telegram`
    - [Discord](/channels/discord) — `channels.discord`
    - [Slack](/channels/slack) — `channels.slack`
    - [Signal](/channels/signal) — `channels.signal`
    - [iMessage](/channels/imessage) — `channels.imessage`
    - [Google Chat](/channels/googlechat) — `channels.googlechat`
    - [Mattermost](/channels/mattermost) — `channels.mattermost`
    - [Microsoft Teams](/channels/msteams) — `channels.msteams`

    All channels share the same DM policy pattern:

    ```json5
    {
      channels: {
        telegram: {
          enabled: true,
          botToken: "123:abc",
          dmPolicy: "pairing",   // pairing | allowlist | open | disabled
          allowFrom: ["tg:123"], // only for allowlist/open
        },
      },
    }
    ```

  </Accordion>

  <Accordion title="Choose and configure models">
    Set the primary model and optional fallbacks:

    ```json5
    {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-sonnet-4-6",
            fallbacks: ["openai/gpt-5.2"],
          },
          models: {
            "anthropic/claude-sonnet-4-6": { alias: "Sonnet" },
            "openai/gpt-5.2": { alias: "GPT" },
          },
        },
      },
    }
    ```

    - `agents.defaults.models` defines the model catalog and acts as the allowlist for `/model`.
    - Model refs use `provider/model` format (e.g. `anthropic/claude-opus-4-6`).
    - `agents.defaults.imageMaxDimensionPx` controls transcript/tool image downscaling (default `1200`); lower values usually reduce vision-token usage on screenshot-heavy runs.
    - See [Models CLI](/concepts/models) for switching models in chat and [Model Failover](/concepts/model-failover) for auth rotation and fallback behavior.
    - For custom/self-hosted providers, see [Custom providers](/gateway/configuration-reference#custom-providers-and-base-urls) in the reference.

  </Accordion>

  <Accordion title="Control who can message the bot">
    DM access is controlled per channel via `dmPolicy`:

    - `"pairing"` (default): unknown senders get a one-time pairing code to approve
    - `"allowlist"`: only senders in `allowFrom` (or the paired allow store)
    - `"open"`: allow all inbound DMs (requires `allowFrom: ["*"]`)
    - `"disabled"`: ignore all DMs

    For groups, use `groupPolicy` + `groupAllowFrom` or channel-specific allowlists.

    See the [full reference](/gateway/configuration-reference#dm-and-group-access) for per-channel details.

  </Accordion>

  <Accordion title="Set up group chat mention gating">
    Group messages default to **require mention**. Configure patterns per agent:

    ```json5
    {
      agents: {
        list: [
          {
            id: "main",
            groupChat: {
              mentionPatterns: ["@crawclaw", "crawclaw"],
            },
          },
        ],
      },
      channels: {
        whatsapp: {
          groups: { "*": { requireMention: true } },
        },
      },
    }
    ```

    - **Metadata mentions**: native @-mentions (WhatsApp tap-to-mention, Telegram @bot, etc.)
    - **Text patterns**: safe regex patterns in `mentionPatterns`
    - See [full reference](/gateway/configuration-reference#group-chat-mention-gating) for per-channel overrides and self-chat mode.

  </Accordion>

  <Accordion title="Tune gateway channel health monitoring">
    Control how aggressively the gateway restarts channels that look stale:

    ```json5
    {
      gateway: {
        channelHealthCheckMinutes: 5,
        channelStaleEventThresholdMinutes: 30,
        channelMaxRestartsPerHour: 10,
      },
      channels: {
        telegram: {
          healthMonitor: { enabled: false },
          accounts: {
            alerts: {
              healthMonitor: { enabled: true },
            },
          },
        },
      },
    }
    ```

    - Set `gateway.channelHealthCheckMinutes: 0` to disable health-monitor restarts globally.
    - `channelStaleEventThresholdMinutes` should be greater than or equal to the check interval.
    - Use `channels.<provider>.healthMonitor.enabled` or `channels.<provider>.accounts.<id>.healthMonitor.enabled` to disable auto-restarts for one channel or account without disabling the global monitor.
    - See [Health Checks](/gateway/health) for operational debugging and the [full reference](/gateway/configuration-reference#gateway) for all fields.

  </Accordion>

  <Accordion title="Configure sessions and resets">
    Sessions control conversation continuity and isolation:

    ```json5
    {
      session: {
        dmScope: "per-channel-peer",  // recommended for multi-user
        threadBindings: {
          enabled: true,
          idleHours: 24,
          maxAgeHours: 0,
        },
        reset: {
          mode: "daily",
          atHour: 4,
          idleMinutes: 120,
        },
      },
    }
    ```

    - `dmScope`: `main` (shared) | `per-peer` | `per-channel-peer` | `per-account-channel-peer`
    - `threadBindings`: global defaults for thread-bound session routing (Discord supports `/focus`, `/unfocus`, `/agents`, `/session idle`, and `/session max-age`).
    - See [Session Management](/concepts/session) for scoping, identity links, and send policy.
    - See [full reference](/gateway/configuration-reference#session) for all fields.

  </Accordion>

    ```json5
    {
      agents: {
        defaults: {
            mode: "non-main",  // off | non-main | all
            scope: "agent",    // session | agent | shared
          },
        },
      },
    }
    ```

  </Accordion>

  <Accordion title="Replace legacy heartbeat with cron">
    ```json5
    {
      cron: {
        enabled: true,
      },
    }
    ```

    Legacy periodic agent heartbeat is no longer configured by default. Use
    [Scheduled Tasks](/automation/cron-jobs) for new periodic checks and
    [Heartbeat](/gateway/heartbeat) for compatibility notes.

  </Accordion>

  <Accordion title="Configure cron jobs">
    ```json5
    {
      cron: {
        enabled: true,
        maxConcurrentRuns: 2,
        sessionRetention: "24h",
        runLog: {
          maxBytes: "2mb",
          keepLines: 2000,
        },
      },
    }
    ```

    - `sessionRetention`: prune completed isolated run sessions from `sessions.json` (default `24h`; set `false` to disable).
    - `runLog`: prune `cron/runs/<jobId>.jsonl` by size and retained lines.
    - See [Cron jobs](/automation/cron-jobs) for feature overview and CLI examples.

  </Accordion>

  <Accordion title="Set up webhooks (hooks)">
    Enable HTTP webhook endpoints on the Gateway:

    ```json5
    {
      hooks: {
        enabled: true,
        token: "shared-secret",
        path: "/hooks",
        defaultSessionKey: "hook:ingress",
        allowRequestSessionKey: false,
        allowedSessionKeyPrefixes: ["hook:"],
        mappings: [
          {
            match: { path: "gmail" },
            action: "agent",
            agentId: "main",
            deliver: true,
          },
        ],
      },
    }
    ```

    Security note:
    - Treat all hook/webhook payload content as untrusted input.
    - Keep unsafe-content bypass flags disabled (`hooks.gmail.allowUnsafeExternalContent`, `hooks.mappings[].allowUnsafeExternalContent`) unless doing tightly scoped debugging.

    See [full reference](/gateway/configuration-reference#hooks) for all mapping options and Gmail integration.

  </Accordion>

  <Accordion title="Configure multi-agent routing">
    Run multiple isolated agents with separate workspaces and sessions:

    ```json5
    {
      agents: {
        list: [
          { id: "home", default: true, workspace: "~/.crawclaw/workspace-home" },
          { id: "work", workspace: "~/.crawclaw/workspace-work" },
        ],
      },
      bindings: [
        { agentId: "home", match: { channel: "whatsapp", accountId: "personal" } },
        { agentId: "work", match: { channel: "whatsapp", accountId: "biz" } },
      ],
    }
    ```

    See [Multi-Agent](/concepts/multi-agent) and [full reference](/gateway/configuration-reference#multi-agent-routing) for binding rules and per-agent access profiles.

  </Accordion>

  <Accordion title="Split config into multiple files ($include)">
    Use `$include` to organize large configs:

    ```json5
    // ~/.crawclaw/crawclaw.json
    {
      gateway: { port: 18789 },
      agents: { $include: "./agents.json5" },
      broadcast: {
        $include: ["./clients/a.json5", "./clients/b.json5"],
      },
    }
    ```

    - **Single file**: replaces the containing object
    - **Array of files**: deep-merged in order (later wins)
    - **Sibling keys**: merged after includes (override included values)
    - **Nested includes**: supported up to 10 levels deep
    - **Relative paths**: resolved relative to the including file
    - **Error handling**: clear errors for missing files, parse errors, and circular includes

  </Accordion>
</AccordionGroup>

## Config hot reload

The Gateway watches `~/.crawclaw/crawclaw.json` and applies changes automatically — no manual restart needed for most settings.

### Reload modes

| Mode                   | Behavior                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------- |
| **`hybrid`** (default) | Hot-applies safe changes instantly. Automatically restarts for critical ones.           |
| **`hot`**              | Hot-applies safe changes only. Logs a warning when a restart is needed — you handle it. |
| **`restart`**          | Restarts the Gateway on any config change, safe or not.                                 |
| **`off`**              | Disables file watching. Changes take effect on the next manual restart.                 |

```json5
{
  gateway: {
    reload: { mode: "hybrid", debounceMs: 300 },
  },
}
```

### What reconfigures in-process

In `hybrid` mode, schema-owned config changes reconfigure the running Gateway in-process instead of restarting the Gateway process.

| Category            | Fields                                                                          | Runtime behavior                                            |
| ------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Channels            | `channels.*`, `web` (WhatsApp) — all built-in and extension channels            | Reconfigure or restart only the affected channel runtime    |
| Agent & models      | `agents`, `models`, `auth`                                                      | Update future runs, model/auth caches, and lane concurrency |
| Automation          | `hooks`, `cron`                                                                 | Rebuild the affected watcher, hook loader, or cron service  |
| Sessions & messages | `session`, `messages`                                                           | Read dynamically for future operations                      |
| Tools & media       | `tools`, `browser`, `nodeHost.browserProxy`, `skills`, `media`, `talk`          | Refresh runtime policy/timers or read dynamically           |
| Runtime metadata    | `acp`, `approvals`, `bindings`, `broadcast`, `cli`, `commands`, `env`, `memory` | Reconfigure owner or explicit no-op                         |
| Gateway server      | `gateway.*` (port, bind, auth, tailscale, TLS, HTTP, trusted proxy settings)    | Reconfigure; listener changes may briefly reconnect clients |
| Infrastructure      | `discovery`, `plugins`, `update`, `workflow`, `$schema`, `meta`, `wizard`       | Reconfigure owner or explicit no-op                         |

<Note>
`gateway.reload.mode="restart"` remains available as an explicit debugging/ops override. Routine desktop settings saves should not need a Gateway process restart.
</Note>

## Config RPC (programmatic updates)

<Note>
Control-plane write RPCs (`config.apply`, `config.patch`, `update.run`) are rate-limited to **3 requests per 60 seconds** per `deviceId+clientIp`. When limited, the RPC returns `UNAVAILABLE` with `retryAfterMs`.
</Note>

<AccordionGroup>
  <Accordion title="config.apply (full replace)">
    Validates + writes the full config. The running Gateway applies changed settings through the live reconfigure pipeline.

    <Warning>
    `config.apply` replaces the **entire config**. Use `config.patch` for partial updates, or `crawclaw config set` for single keys.
    </Warning>

    Params:

    - `raw` (string) — JSON5 payload for the entire config
    - `baseHash` (optional) — config hash from `config.get` (required when config exists)
    - `sessionKey` (optional) — session key for a follow-up wake ping when a restart override is used
    - `note` (optional) — note for the restart sentinel when a restart override is used
    - `restartDelayMs` (optional) — delay before an explicit restart override

    If `gateway.reload.mode="restart"` is set, restart requests are coalesced while one is already pending/in-flight, and a 30-second cooldown applies between restart cycles.

    ```bash
    crawclaw gateway call config.get --params '{}'  # capture payload.hash
    crawclaw gateway call config.apply --params '{
      "raw": "{ agents: { defaults: { workspace: \"~/.crawclaw/workspace\" } } }",
      "baseHash": "<hash>",
      "sessionKey": "agent:main:whatsapp:direct:+15555550123"
    }'
    ```

  </Accordion>

  <Accordion title="config.patch (partial update)">
    Merges a partial update into the existing config (JSON merge patch semantics):

    - Objects merge recursively
    - `null` deletes a key
    - Arrays replace

    Params:

    - `raw` (string) — JSON5 with just the keys to change
    - `baseHash` (required) — config hash from `config.get`
    - `sessionKey`, `note`, `restartDelayMs` — same as `config.apply`

    Reconfigure behavior matches `config.apply`: settings are applied online by default; explicit restart mode keeps the same coalescing and cooldown behavior.

    ```bash
    crawclaw gateway call config.patch --params '{
      "raw": "{ channels: { telegram: { groups: { \"*\": { requireMention: false } } } } }",
      "baseHash": "<hash>"
    }'
    ```

  </Accordion>
</AccordionGroup>

## Environment variables

CrawClaw reads env vars from the parent process plus:

- `.env` from the current working directory (if present)
- `~/.crawclaw/.env` (global fallback)

Neither file overrides existing env vars. You can also set inline env vars in config:

```json5
{
  env: {
    OPENROUTER_API_KEY: "sk-or-...",
    vars: { GROQ_API_KEY: "gsk-..." },
  },
}
```

<Accordion title="Shell env import (optional)">
  If enabled and expected keys aren't set, CrawClaw runs your login shell and imports only the missing keys:

```json5
{
  env: {
    shellEnv: { enabled: true, timeoutMs: 15000 },
  },
}
```

Env var equivalent: `CRAWCLAW_LOAD_SHELL_ENV=1`
</Accordion>

<Accordion title="Env var substitution in config values">
  Reference env vars in any config string value with `${VAR_NAME}`:

```json5
{
  gateway: { auth: { token: "${CRAWCLAW_GATEWAY_TOKEN}" } },
  models: { providers: { custom: { apiKey: "${CUSTOM_API_KEY}" } } },
}
```

Rules:

- Only uppercase names matched: `[A-Z_][A-Z0-9_]*`
- Missing/empty vars throw an error at load time
- Escape with `$${VAR}` for literal output
- Works inside `$include` files
- Inline substitution: `"${BASE}/v1"` → `"https://api.example.com/v1"`

</Accordion>

<Accordion title="Secret refs (env, file, exec)">
  For fields that support SecretRef objects, you can use:

```json5
{
  models: {
    providers: {
      openai: { apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" } },
    },
  },
  skills: {
    entries: {
      "image-lab": {
        apiKey: {
          source: "file",
          provider: "filemain",
          id: "/skills/entries/image-lab/apiKey",
        },
      },
    },
  },
  channels: {
    googlechat: {
      serviceAccountRef: {
        source: "exec",
        provider: "vault",
        id: "channels/googlechat/serviceAccount",
      },
    },
  },
}
```

SecretRef details (including `secrets.providers` for `env`/`file`/`exec`) are in [Secrets Management](/gateway/secrets).
Supported credential paths are listed in [SecretRef Credential Surface](/reference/secretref-credential-surface).
</Accordion>

See [Environment](/help/environment) for full precedence and sources.

## Full reference

For the complete field-by-field reference, see **[Configuration Reference](/gateway/configuration-reference)**.

---

_Related: [Configuration Examples](/gateway/configuration-examples) · [Configuration Reference](/gateway/configuration-reference) · [Doctor](/gateway/doctor)_
