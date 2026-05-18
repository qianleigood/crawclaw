---
title: "Configuration Reference"
summary: "Complete reference for every CrawClaw config key, defaults, and channel settings"
read_when:
  - You need exact field-level config semantics or defaults
  - You are validating channel, model, gateway, or tool config blocks
---

# Configuration Reference

Every field available in `~/.crawclaw/crawclaw.json`. For a task-oriented overview, see [Configuration](/gateway/configuration).

Config format is **JSON5** (comments + trailing commas allowed). All fields are optional — CrawClaw uses safe defaults when omitted.

---

## Channels

Each channel starts automatically when its config section exists (unless `enabled: false`).

### DM and group access

All channels support DM policies and group policies:

| DM policy           | Behavior                                                        |
| ------------------- | --------------------------------------------------------------- |
| `pairing` (default) | Unknown senders get a one-time pairing code; owner must approve |
| `allowlist`         | Only senders in `allowFrom` (or paired allow store)             |
| `open`              | Allow all inbound DMs (requires `allowFrom: ["*"]`)             |
| `disabled`          | Ignore all inbound DMs                                          |

| Group policy          | Behavior                                               |
| --------------------- | ------------------------------------------------------ |
| `allowlist` (default) | Only groups matching the configured allowlist          |
| `open`                | Bypass group allowlists (mention-gating still applies) |
| `disabled`            | Block all group/room messages                          |

<Note>
`channels.defaults.groupPolicy` sets the default when a provider's `groupPolicy` is unset.
Pairing codes expire after 1 hour. Pending DM pairing requests are capped at **3 per channel**.
If a provider block is missing entirely (`channels.<provider>` absent), runtime group policy falls back to `allowlist` (fail-closed) with a startup warning.
</Note>

### Channel model overrides

Use `channels.modelByChannel` to pin specific channel IDs to a model. Values accept `provider/model` or configured model aliases. The channel mapping applies when a session does not already have a model override (for example, set via `/model`).

```json5
{
  channels: {
    modelByChannel: {
      qqbot: {
        "123456789012345678": "anthropic/claude-opus-4-6",
      },
      ddingtalk: {
        C1234567890: "openai/gpt-4.1",
      },
      feishu: {
        "-1001234567890": "openai/gpt-4.1-mini",
        "-1001234567890:topic:99": "anthropic/claude-sonnet-4-6",
      },
    },
  },
}
```

### Channel defaults and legacy heartbeat visibility

Use `channels.defaults` for shared group policy and legacy heartbeat visibility
behavior across providers:

```json5
{
  channels: {
    defaults: {
      groupPolicy: "allowlist", // open | allowlist | disabled
      heartbeat: {
        showOk: false,
        showAlerts: true,
        useIndicator: true,
      },
    },
  },
}
```

- `channels.defaults.groupPolicy`: fallback group policy when a provider-level `groupPolicy` is unset.
- `channels.defaults.heartbeat.showOk`: include healthy channel statuses in legacy heartbeat output.
- `channels.defaults.heartbeat.showAlerts`: include degraded/error statuses in legacy heartbeat output.
- `channels.defaults.heartbeat.useIndicator`: render compact indicator-style legacy heartbeat output.

### Weixin

Weixin runs through the gateway's web channel (Baileys Web). It starts automatically when a linked session exists.

```json5
{
  channels: {
    weixin: {
      dmPolicy: "pairing", // pairing | allowlist | open | disabled
      allowFrom: ["+15555550123", "+447700900123"],
      textChunkLimit: 4000,
      chunkMode: "length", // length | newline
      mediaMaxMb: 50,
      sendReadReceipts: true, // blue ticks (false in self-chat mode)
      groups: {
        "*": { requireMention: true },
      },
      groupPolicy: "allowlist",
      groupAllowFrom: ["+15551234567"],
    },
  },
  web: {
    enabled: true,
    heartbeatSeconds: 60,
    reconnect: {
      initialMs: 2000,
      maxMs: 120000,
      factor: 1.4,
      jitter: 0.2,
      maxAttempts: 0,
    },
  },
}
```

<Accordion title="Multi-account Weixin">

```json5
{
  channels: {
    weixin: {
      accounts: {
        default: {},
        personal: {},
        biz: {
          // authDir: "~/.crawclaw/credentials/weixin/biz",
        },
      },
    },
  },
}
```

- Outbound commands default to account `default` if present; otherwise the first configured account id (sorted).
- Optional `channels.weixin.defaultAccount` overrides that fallback default account selection when it matches a configured account id.
- Legacy single-account Baileys auth dir is migrated by CrawClaw Desktop or the local Gateway API into `weixin/default`.
- Per-account overrides: `channels.weixin.accounts.<id>.sendReadReceipts`, `channels.weixin.accounts.<id>.dmPolicy`, `channels.weixin.accounts.<id>.allowFrom`.

</Accordion>

### Feishu service-account example

```json5
{
  channels: {
    feishu: {
      enabled: true,
      botToken: "your-bot-token",
      dmPolicy: "pairing",
      allowFrom: ["tg:123456789"],
      groups: {
        "*": { requireMention: true },
        "-1001234567890": {
          allowFrom: ["@admin"],
          systemPrompt: "Keep answers brief.",
          topics: {
            "99": {
              requireMention: false,
              skills: ["search"],
              systemPrompt: "Stay on topic.",
            },
          },
        },
      },
      customCommands: [
        { command: "backup", description: "Git backup" },
        { command: "generate", description: "Create an image" },
      ],
      historyLimit: 50,
      replyToMode: "first", // off | first | all
      linkPreview: true,
      streaming: "partial", // off | partial | block | progress (default: off; opt in explicitly to avoid preview-edit rate limits)
      actions: { reactions: true, sendMessage: true },
      reactionNotifications: "own", // off | own | all
      mediaMaxMb: 100,
      retry: {
        attempts: 3,
        minDelayMs: 400,
        maxDelayMs: 30000,
        jitter: 0.1,
      },
      network: {
        autoSelectFamily: true,
        dnsResultOrder: "ipv4first",
      },
      proxy: "socks5://localhost:9050",
      webhookUrl: "https://example.com/feishu-webhook",
      webhookSecret: "secret",
      webhookPath: "/feishu-webhook",
    },
  },
}
```

- Bot token: `channels.feishu.botToken` or `channels.feishu.tokenFile` (regular file only; symlinks rejected), with `TELEGRAM_BOT_TOKEN` as fallback for the default account.
- Optional `channels.feishu.defaultAccount` overrides default account selection when it matches a configured account id.
- In multi-account setups (2+ account ids), set an explicit default (`channels.feishu.defaultAccount` or `channels.feishu.accounts.default`) to avoid fallback routing; CrawClaw Desktop or the local Gateway API warns when this is missing or invalid.
- `configWrites: false` blocks Feishu-initiated config writes (supergroup ID migrations, `/config set|unset`).
- Top-level `bindings[]` entries with `type: "acp"` configure persistent ACP bindings for forum topics (use canonical `chatId:topic:topicId` in `match.peer.id`). Field semantics are shared in [ACP Agents](/tools/acp-agents#channel-specific-settings).
- Feishu stream previews use `sendMessage` + `editMessageText` (works in direct and group chats).
- Retry policy: see [Retry policy](/concepts/retry).

### QQBot

```json5
{
  channels: {
    qqbot: {
      enabled: true,
      token: "your-bot-token",
      mediaMaxMb: 8,
      allowBots: false,
      actions: {
        reactions: true,
        stickers: true,
        polls: true,
        permissions: true,
        messages: true,
        threads: true,
        pins: true,
        search: true,
        memberInfo: true,
        roleInfo: true,
        roles: false,
        channelInfo: true,
        voiceStatus: true,
        events: true,
        moderation: false,
      },
      replyToMode: "off", // off | first | all
      dmPolicy: "pairing",
      allowFrom: ["1234567890", "123456789012345678"],
      dm: { enabled: true, groupEnabled: false, groupChannels: ["crawclaw-dm"] },
      guilds: {
        "123456789012345678": {
          slug: "friends-of-crawclaw",
          requireMention: false,
          ignoreOtherMentions: true,
          reactionNotifications: "own",
          users: ["987654321098765432"],
          channels: {
            general: { allow: true },
            help: {
              allow: true,
              requireMention: true,
              users: ["987654321098765432"],
              skills: ["docs"],
              systemPrompt: "Short answers only.",
            },
          },
        },
      },
      historyLimit: 20,
      textChunkLimit: 2000,
      chunkMode: "length", // length | newline
      streaming: "off", // off | partial | block | progress (progress maps to partial on QQBot)
      maxLinesPerMessage: 17,
      ui: {
        components: {
          accentColor: "#5865F2",
        },
      },
      threadBindings: {
        enabled: true,
        idleHours: 24,
        maxAgeHours: 0,
        spawnSubagentSessions: false, // opt-in for sessions_spawn({ thread: true })
      },
      voice: {
        enabled: true,
        autoJoin: [
          {
            guildId: "123456789012345678",
            channelId: "234567890123456789",
          },
        ],
        daveEncryption: true,
        decryptionFailureTolerance: 24,
        tts: {
          provider: "openai",
          openai: { voice: "alloy" },
        },
      },
      retry: {
        attempts: 3,
        minDelayMs: 500,
        maxDelayMs: 30000,
        jitter: 0.1,
      },
    },
  },
}
```

- Token: `channels.qqbot.token`, with `DISCORD_BOT_TOKEN` as fallback for the default account.
- Direct outbound calls that provide an explicit QQBot `token` use that token for the call; account retry/policy settings still come from the selected account in the active runtime snapshot.
- Optional `channels.qqbot.defaultAccount` overrides default account selection when it matches a configured account id.
- Use `user:<id>` (DM) or `channel:<id>` (guild channel) for delivery targets; bare numeric IDs are rejected.
- Guild slugs are lowercase with spaces replaced by `-`; channel keys use the slugged name (no `#`). Prefer guild IDs.
- Bot-authored messages are ignored by default. `allowBots: true` enables them; use `allowBots: "mentions"` to only accept bot messages that mention the bot (own messages still filtered).
- `channels.qqbot.guilds.<id>.ignoreOtherMentions` (and channel overrides) drops messages that mention another user or role but not the bot (excluding @everyone/@here).
- `maxLinesPerMessage` (default 17) splits tall messages even when under 2000 chars.
- `channels.qqbot.threadBindings` controls QQBot thread-bound routing:
  - `enabled`: QQBot override for thread-bound session features (`/focus`, `/unfocus`, `/agents`, `/session idle`, `/session max-age`, and bound delivery/routing)
  - `idleHours`: QQBot override for inactivity auto-unfocus in hours (`0` disables)
  - `maxAgeHours`: QQBot override for hard max age in hours (`0` disables)
  - `spawnSubagentSessions`: opt-in switch for `sessions_spawn({ thread: true })` auto thread creation/binding
- Top-level `bindings[]` entries with `type: "acp"` configure persistent ACP bindings for channels and threads (use channel/thread id in `match.peer.id`). Field semantics are shared in [ACP Agents](/tools/acp-agents#channel-specific-settings).
- `channels.qqbot.ui.components.accentColor` sets the accent color for QQBot components v2 containers.
- `channels.qqbot.voice` enables QQBot voice channel conversations and optional auto-join + TTS overrides.
- `channels.qqbot.voice.daveEncryption` and `channels.qqbot.voice.decryptionFailureTolerance` pass through to `@qqbotjs/voice` DAVE options (`true` and `24` by default).
- CrawClaw additionally attempts voice receive recovery by leaving/rejoining a voice session after repeated decrypt failures.
- `channels.qqbot.streaming` is the canonical preview stream mode key.
- `channels.qqbot.autoPresence` maps runtime availability to bot presence (healthy => online, degraded => idle, exhausted => dnd) and allows optional status text overrides.
- `channels.qqbot.dangerouslyAllowNameMatching` re-enables mutable name/tag matching (break-glass compatibility mode).

**Reaction notification modes:** `off` (none), `own` (bot's messages, default), `all` (all messages), `allowlist` (from `guilds.<id>.users` on all messages).

### Feishu native channel

```json5
{
  channels: {
    feishu: {
      enabled: true,
      serviceAccountFile: "/path/to/service-account.json",
      audienceType: "app-url", // app-url | project-number
      audience: "https://gateway.example.com/feishu",
      webhookPath: "/feishu",
      botUser: "users/1234567890",
      dm: {
        enabled: true,
        policy: "pairing",
        allowFrom: ["users/1234567890"],
      },
      groupPolicy: "allowlist",
      groups: {
        "spaces/AAAA": { allow: true, requireMention: true },
      },
      actions: { reactions: true },
      typingIndicator: "message",
      mediaMaxMb: 20,
    },
  },
}
```

- Service account JSON: inline (`serviceAccount`) or file-based (`serviceAccountFile`).
- Service account SecretRef is also supported (`serviceAccountRef`).
- Env fallbacks: `GOOGLE_CHAT_SERVICE_ACCOUNT` or `GOOGLE_CHAT_SERVICE_ACCOUNT_FILE`.
- Use `spaces/<spaceId>` or `users/<userId>` for delivery targets.
- `channels.feishu.dangerouslyAllowNameMatching` re-enables mutable email principal matching (break-glass compatibility mode).

### DingTalk

```json5
{
  channels: {
    ddingtalk: {
      enabled: true,
      botToken: "xoxb-...",
      appToken: "xapp-...",
      dmPolicy: "pairing",
      allowFrom: ["U123", "U456", "*"],
      dm: { enabled: true, groupEnabled: false, groupChannels: ["G123"] },
      channels: {
        C123: { allow: true, requireMention: true, allowBots: false },
        "#general": {
          allow: true,
          requireMention: true,
          allowBots: false,
          users: ["U123"],
          skills: ["docs"],
          systemPrompt: "Short answers only.",
        },
      },
      historyLimit: 50,
      allowBots: false,
      reactionNotifications: "own",
      reactionAllowlist: ["U123"],
      replyToMode: "off", // off | first | all
      thread: {
        historyScope: "thread", // thread | channel
        inheritParent: false,
      },
      actions: {
        reactions: true,
        messages: true,
        pins: true,
        memberInfo: true,
        emojiList: true,
      },
      slashCommand: {
        enabled: true,
        name: "crawclaw",
        sessionPrefix: "ddingtalk:slash",
        ephemeral: true,
      },
      typingReaction: "hourglass_flowing_sand",
      textChunkLimit: 4000,
      chunkMode: "length",
      streaming: "partial", // off | partial | block | progress (preview mode)
      nativeStreaming: true, // use DingTalk native streaming API when streaming=partial
      mediaMaxMb: 20,
    },
  },
}
```

- **Socket mode** requires both `botToken` and `appToken` (`SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` for default account env fallback).
- **HTTP mode** requires `botToken` plus `signingSecret` (at root or per-account).
- `configWrites: false` blocks DingTalk-initiated config writes.
- Optional `channels.ddingtalk.defaultAccount` overrides default account selection when it matches a configured account id.
- `channels.ddingtalk.streaming` is the canonical preview stream mode key. `channels.ddingtalk.nativeStreaming` separately controls DingTalk's native streaming API path.
- Use `user:<id>` (DM) or `channel:<id>` for delivery targets.

**Reaction notification modes:** `off`, `own` (default), `all`, `allowlist` (from `reactionAllowlist`).

**Thread session isolation:** `thread.historyScope` is per-thread (default) or shared across channel. `thread.inheritParent` copies parent channel transcript to new threads.

- `typingReaction` adds a temporary reaction to the inbound DingTalk message while a reply is running, then removes it on completion. Use a DingTalk emoji shortcode such as `"hourglass_flowing_sand"`.

| Action group | Default | Notes                  |
| ------------ | ------- | ---------------------- |
| reactions    | enabled | React + list reactions |
| messages     | enabled | Read/send/edit/delete  |
| pins         | enabled | Pin/unpin/list         |
| memberInfo   | enabled | Member info            |
| emojiList    | enabled | Custom emoji list      |

### Feishu

Feishu is configured through the Rust-native channel catalog.

```json5
{
  channels: {
    feishu: {
      enabled: true,
      botToken: "mm-token",
      baseUrl: "https://chat.example.com",
      dmPolicy: "pairing",
      chatmode: "oncall", // oncall | onmessage | onchar
      oncharPrefixes: [">", "!"],
      commands: {
        native: true, // opt-in
        nativeSkills: true,
        callbackPath: "/api/channels/index/command",
        // Optional explicit URL for reverse-proxy/public deployments
        callbackUrl: "https://gateway.example.com/api/channels/index/command",
      },
      textChunkLimit: 4000,
      chunkMode: "length",
    },
  },
}
```

Chat modes: `oncall` (respond on @-mention, default), `onmessage` (every message), `onchar` (messages starting with trigger prefix).

When Feishu native commands are enabled:

- `commands.callbackPath` must be a path (for example `/api/channels/index/command`), not a full URL.
- `commands.callbackUrl` must resolve to the CrawClaw gateway endpoint and be reachable from the Feishu server.
- For private/tailnet/internal callback hosts, Feishu may require
  `ServiceSettings.AllowedUntrustedInternalConnections` to include the callback host/domain.
  Use host/domain values, not full URLs.
- `channels.feishu.configWrites`: allow or deny Feishu-initiated config writes.
- `channels.feishu.requireMention`: require `@mention` before replying in channels.
- Optional `channels.feishu.defaultAccount` overrides default account selection when it matches a configured account id.

### Weixin native channel

Weixin is the recommended Weixin path (plugin-backed, configured under `channels.weixin`).

```json5
{
  channels: {
    weixin: {
      enabled: true,
      dmPolicy: "pairing",
      // serverUrl, password, webhookPath, group controls, and advanced actions:
      // see /channels/index
    },
  },
}
```

- Core key paths covered here: `channels.weixin`, `channels.weixin.dmPolicy`.
- Optional `channels.weixin.defaultAccount` overrides default account selection when it matches a configured account id.
- Top-level `bindings[]` entries with `type: "acp"` can bind Weixin conversations to persistent ACP sessions. Use a Weixin handle or target string (`chat_id:*`, `chat_guid:*`, `chat_identifier:*`) in `match.peer.id`. Shared field semantics: [ACP Agents](/tools/acp-agents#channel-specific-settings).
- Full Weixin channel configuration is documented in [Weixin](/channels/index).

### Native channel catalog

Repo-owned TypeScript channel plugins have been removed. Channel control-plane
configuration is now owned by the Rust Gateway/native channel catalog. The
repo-owned channel keys are:

- `channels.ddingtalk`
- `channels.esp32`
- `channels.feishu`
- `channels.qqbot`
- `channels.weixin`

### QQBot native channel

QQBot is Rust-native and configured under `channels.qqbot`.

```json5
{
  channels: {
    qqbot: {
      enabled: true,
      configWrites: true,
      // appId, appPassword, tenantId, webhook, team/channel policies:
      // see /channels/index
    },
  },
}
```

- Core key paths covered here: `channels.qqbot`, `channels.qqbot.configWrites`.
- Full QQBot config (credentials, webhook, DM/group policy, per-team/per-channel overrides) is documented in [Channels](/channels/index).

### Multi-account (all channels)

Run multiple accounts per channel (each with its own `accountId`):

```json5
{
  channels: {
    feishu: {
      accounts: {
        default: {
          name: "Primary bot",
          botToken: "123456:ABC...",
        },
        alerts: {
          name: "Alerts bot",
          botToken: "987654:XYZ...",
        },
      },
    },
  },
}
```

- `default` is used when `accountId` is omitted (CLI + routing).
- Env tokens only apply to the **default** account.
- Base channel settings apply to all accounts unless overridden per account.
- Use `bindings[].match.accountId` to route each account to a different agent.
- If you add a non-default account via CrawClaw Desktop or the local Gateway API (or channel onboarding) while still on a single-account top-level channel config, CrawClaw moves account-scoped top-level single-account values into `channels.<channel>.accounts.default` first so the original account keeps working.
- Existing channel-only bindings (no `accountId`) keep matching the default account; account-scoped bindings remain optional.
- CrawClaw Desktop or the local Gateway API also repairs mixed shapes by moving account-scoped top-level single-account values into `accounts.default` when named accounts exist but `default` is missing.

### Group chat mention gating

Group messages default to **require mention** (metadata mention or safe regex patterns). Applies to Weixin, Feishu, QQBot, Feishu, and Weixin group chats.

**Mention types:**

- **Metadata mentions**: Native platform @-mentions. Ignored in Weixin self-chat mode.
- **Text patterns**: Safe regex patterns in `agents.list[].groupChat.mentionPatterns`. Invalid patterns and unsafe nested repetition are ignored.
- Mention gating is enforced only when detection is possible (native mentions or at least one pattern).

```json5
{
  messages: {
    groupChat: { historyLimit: 50 },
  },
  agents: {
    list: [{ id: "main", groupChat: { mentionPatterns: ["@crawclaw", "crawclaw"] } }],
  },
}
```

`messages.groupChat.historyLimit` sets the global default. Channels can override with `channels.<channel>.historyLimit` (or per-account). Set `0` to disable.

#### DM history limits

```json5
{
  channels: {
    feishu: {
      dmHistoryLimit: 30,
      dms: {
        "123456789": { historyLimit: 50 },
      },
    },
  },
}
```

Resolution: per-DM override → provider default → no limit (all retained).

Supported: `feishu`, `weixin`, `qqbot`, `ddingtalk`, `signal`, `weixin`, `qqbot`.

#### Self-chat mode

Include your own number in `allowFrom` to enable self-chat mode (ignores native @-mentions, only responds to text patterns):

```json5
{
  channels: {
    weixin: {
      allowFrom: ["+15555550123"],
      groups: { "*": { requireMention: true } },
    },
  },
  agents: {
    list: [
      {
        id: "main",
        groupChat: { mentionPatterns: ["reisponde", "@crawclaw"] },
      },
    ],
  },
}
```

### Commands (chat command handling)

```json5
{
  commands: {
    native: "auto", // register native commands when supported
    text: true, // parse /commands in chat messages
    bash: false, // allow ! (alias: /bash)
    bashForegroundMs: 2000,
    config: false, // allow /config
    debug: false, // allow /debug
    restart: true, // allow /restart + gateway restart tool (default; set false to disable manual restart)
    allowFrom: {
      "*": ["user1"],
      qqbot: ["user:123"],
    },
    useAccessGroups: true,
  },
}
```

<Accordion title="Command details">

- Text commands must be **standalone** messages with leading `/`.
- `native: "auto"` turns on native commands for QQBot/Feishu, leaves DingTalk off.
- Override per channel: `channels.qqbot.commands.native` (bool or `"auto"`). `false` clears previously registered commands.
- `channels.feishu.customCommands` adds extra Feishu bot menu entries.
- `bash: true` enables `! <cmd>` for host shell. Requires `tools.elevated.enabled` and sender in `tools.elevated.allowFrom.<channel>`.
- `config: true` enables `/config` (reads/writes `crawclaw.json`). For gateway `chat.send` clients, persistent `/config set|unset` writes also require `operator.admin`; read-only `/config show` stays available to normal write-scoped operator clients.
- `channels.<provider>.configWrites` gates config mutations per channel (default: true).
- For multi-account channels, `channels.<provider>.accounts.<id>.configWrites` also gates writes that target that account (for example `/allowlist --config --account <id>` or `/config set channels.<provider>.accounts.<id>...`).
- `allowFrom` is per-provider. When set, it is the **only** authorization source (channel allowlists/pairing and `useAccessGroups` are ignored).
- `useAccessGroups: false` allows commands to bypass access-group policies when `allowFrom` is not set.

</Accordion>

---

## Agent defaults

### `agents.defaults.workspace`

Default: `~/.crawclaw/workspace`.

```json5
{
  agents: { defaults: { workspace: "~/.crawclaw/workspace" } },
}
```

### `agents.defaults.repoRoot`

Optional repository root shown in the system prompt's Runtime line. If unset, CrawClaw auto-detects by walking upward from the workspace.

```json5
{
  agents: { defaults: { repoRoot: "~/Projects/crawclaw" } },
}
```

### `agents.defaults.skipBootstrap`

Disables automatic creation of workspace bootstrap files (`AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`).

```json5
{
  agents: { defaults: { skipBootstrap: true } },
}
```

### `agents.defaults.bootstrapMaxChars`

Max characters per workspace bootstrap file before truncation. Default: `20000`.

```json5
{
  agents: { defaults: { bootstrapMaxChars: 20000 } },
}
```

### `agents.defaults.bootstrapTotalMaxChars`

Max total characters injected across all workspace bootstrap files. Default: `150000`.

```json5
{
  agents: { defaults: { bootstrapTotalMaxChars: 150000 } },
}
```

### `agents.defaults.bootstrapPromptTruncationWarning`

Controls agent-visible warning text when bootstrap context is truncated.
Default: `"once"`.

- `"off"`: never inject warning text into the system prompt.
- `"once"`: inject warning once per unique truncation signature (recommended).
- `"always"`: inject warning on every run when truncation exists.

```json5
{
  agents: { defaults: { bootstrapPromptTruncationWarning: "once" } }, // off | once | always
}
```

### `agents.defaults.imageMaxDimensionPx`

Max pixel size for the longest image side in transcript/tool image blocks before provider calls.
Default: `1200`.

Lower values usually reduce vision-token usage and request payload size for screenshot-heavy runs.
Higher values preserve more visual detail.

```json5
{
  agents: { defaults: { imageMaxDimensionPx: 1200 } },
}
```

### `agents.defaults.userTimezone`

Timezone for system prompt context (not message timestamps). Falls back to host timezone.

```json5
{
  agents: { defaults: { userTimezone: "America/Chicago" } },
}
```

### `agents.defaults.timeFormat`

Time format in system prompt. Default: `auto` (OS preference).

```json5
{
  agents: { defaults: { timeFormat: "auto" } }, // auto | 12 | 24
}
```

### `agents.defaults.model`

```json5
{
  agents: {
    defaults: {
      models: {
        "anthropic/claude-opus-4-6": { alias: "opus" },
        "minimax/MiniMax-M2.7": { alias: "minimax" },
      },
      model: {
        primary: "anthropic/claude-opus-4-6",
        fallbacks: ["minimax/MiniMax-M2.7"],
      },
      imageModel: {
        primary: "openrouter/qwen/qwen-2.5-vl-72b-instruct:free",
        fallbacks: ["openrouter/google/gemini-2.0-flash-vision:free"],
      },
      pdfModel: {
        primary: "anthropic/claude-opus-4-6",
        fallbacks: ["openai/gpt-5-mini"],
      },
      params: { cacheRetention: "long" }, // global default provider params
      pdfMaxBytesMb: 10,
      pdfMaxPages: 20,
      thinkingDefault: "low",
      verboseDefault: "off",
      elevatedDefault: "on",
      timeoutSeconds: 600,
      mediaMaxMb: 5,
      contextTokens: 200000,
      maxConcurrent: 3,
    },
  },
}
```

- `model`: accepts either a string (`"provider/model"`) or an object (`{ primary, fallbacks }`).
  - String form sets only the primary model.
  - Object form sets primary plus ordered failover models.
- `imageModel`: accepts either a string (`"provider/model"`) or an object (`{ primary, fallbacks }`).
  - Used by the `image` tool path as its vision-model config.
  - Also used as fallback routing when the selected/default model cannot accept image input.
- `pdfModel`: accepts either a string (`"provider/model"`) or an object (`{ primary, fallbacks }`).
  - Used by the `pdf` tool for model routing.
  - If omitted, the PDF tool falls back to `imageModel`, then to best-effort provider defaults.
- `pdfMaxBytesMb`: default PDF size limit for the `pdf` tool when `maxBytesMb` is not passed at call time.
- `pdfMaxPages`: default maximum pages considered by extraction fallback mode in the `pdf` tool.
- `verboseDefault`: default verbose level for agents. Values: `"off"`, `"on"`, `"full"`. Default: `"off"`.
  Onboarding presets may write a different explicit value into `crawclaw.json`; for example,
  the default `balanced` output preset sets `verboseDefault` to `"on"`.
- `elevatedDefault`: default elevated-output level for agents. Values: `"off"`, `"on"`, `"ask"`, `"full"`. Default: `"on"`.
- `model.primary`: format `provider/model` (e.g. `anthropic/claude-opus-4-6`). If you omit the provider, CrawClaw assumes `anthropic` (deprecated).
- `models`: the configured model catalog and allowlist for `/model`. Each entry can include `alias` (shortcut) and `params` (provider-specific, for example `temperature`, `maxTokens`, `cacheRetention`, `context1m`).
- `params`: global default provider parameters applied to all models. Set at `agents.defaults.params` (e.g. `{ cacheRetention: "long" }`).
- `params` merge precedence (config): `agents.defaults.params` (global base) is overridden by `agents.defaults.models["provider/model"].params` (per-model), then `agents.list[].params` (matching agent id) overrides by key. See [Prompt Caching](/reference/prompt-caching) for details.
- Config writers that mutate these fields (for example `/models set`, `/models set-image`, and fallback add/remove commands) save canonical object form and preserve existing fallback lists when possible.
- `maxConcurrent`: max parallel agent runs across sessions (each session still serialized). Default: 4.

**Built-in alias shorthands** (only apply when the model is in `agents.defaults.models`):

| Alias               | Model                                  |
| ------------------- | -------------------------------------- |
| `opus`              | `anthropic/claude-opus-4-6`            |
| `sonnet`            | `anthropic/claude-sonnet-4-6`          |
| `gpt`               | `openai/gpt-5.4`                       |
| `gpt-mini`          | `openai/gpt-5-mini`                    |
| `gemini`            | `google/gemini-3.1-pro-preview`        |
| `gemini-flash`      | `google/gemini-3-flash-preview`        |
| `gemini-flash-lite` | `google/gemini-3.1-flash-lite-preview` |

Your configured aliases always win over defaults.

Z.AI GLM-4.x models automatically enable thinking mode unless you set `--thinking off` or define `agents.defaults.models["zai/<model>"].params.thinking` yourself.
Z.AI models enable `tool_stream` by default for tool call streaming. Set `agents.defaults.models["zai/<model>"].params.tool_stream` to `false` to disable it.
Anthropic Claude 4.6 models default to `adaptive` thinking when no explicit thinking level is set.

### `agents.defaults.heartbeat`

Event-driven main-session wake settings. The Gateway no longer schedules
periodic agent heartbeat runs, and legacy cadence keys are not accepted. Use
[Scheduled Tasks](/automation/cron-jobs) for scheduled automation.

```json5
{
  agents: {
    defaults: {
      heartbeat: {
        directPolicy: "allow", // allow (default) | block
        target: "none",
      },
    },
  },
}
```

- `every` and `activeHours` are not valid here. For periodic work, configure
  cron jobs instead of heartbeat cadence.
- `prompt`, `model`, `lightContext`, `isolatedSession`, `includeReasoning`,
  `ackMaxChars`, `target`, `to`, `accountId`, and `directPolicy` apply only to
  event-driven main-session wake runs.

### `agents.defaults.compaction`

```json5
{
  agents: {
    defaults: {
      compaction: {
        mode: "safeguard", // default | safeguard
        timeoutSeconds: 900,
        reserveTokensFloor: 24000,
        identifierPolicy: "strict", // strict | off | custom
        identifierInstructions: "Preserve deployment IDs, ticket IDs, and host:port pairs exactly.", // used when identifierPolicy=custom
        postCompactionSections: ["Session Startup", "Red Lines"], // [] disables reinjection
        model: "openrouter/anthropic/claude-sonnet-4-6", // optional compaction-only model override
        notifyUser: true, // send a brief notice when compaction starts (default: false)
        memoryFlush: {
          enabled: true,
          softThresholdTokens: 6000,
          systemPrompt: "Session nearing compaction. Store durable memories now.",
          prompt: "Write any lasting notes to memory/YYYY-MM-DD.md; reply with NO_REPLY if nothing to store.",
        },
      },
    },
  },
}
```

- `mode`: `default` or `safeguard` (chunked summarization for long histories). See [Compaction](/concepts/compaction).
- `timeoutSeconds`: maximum seconds allowed for a single compaction operation before CrawClaw aborts it. Default: `900`.
- `identifierPolicy`: `strict` (default), `off`, or `custom`. `strict` prepends built-in opaque identifier retention guidance during compaction summarization.
- `identifierInstructions`: optional custom identifier-preservation text used when `identifierPolicy=custom`.
- `postCompactionSections`: optional AGENTS.md H2/H3 section names to re-inject after compaction. Defaults to `["Session Startup", "Red Lines"]`; set `[]` to disable reinjection. When unset or explicitly set to that default pair, older `Every Session`/`Safety` headings are also accepted as a legacy fallback.
- `model`: optional `provider/model-id` override for compaction summarization only. Use this when the main session should keep one model but compaction summaries should run on another; when unset, compaction uses the session's primary model.
- `notifyUser`: when `true`, sends a brief notice to the user when compaction starts (for example, "Compacting context..."). Disabled by default to keep compaction silent.
- `memoryFlush`: silent agentic turn before auto-compaction to store durable memories. Skipped when workspace is read-only.

### `agents.defaults.contextPruning`

Prunes **old tool results** from in-memory context before sending to the LLM. Does **not** modify session history on disk.

```json5
{
  agents: {
    defaults: {
      contextPruning: {
        mode: "cache-ttl", // off | cache-ttl
        ttl: "1h", // duration (ms/s/m/h), default unit: minutes
        keepLastAssistants: 3,
        softTrimRatio: 0.3,
        hardClearRatio: 0.5,
        minPrunableToolChars: 50000,
        softTrim: { maxChars: 4000, headChars: 1500, tailChars: 1500 },
        hardClear: { enabled: true, placeholder: "[Old tool result content cleared]" },
        tools: { deny: ["browser", "canvas"] },
      },
    },
  },
}
```

<Accordion title="cache-ttl mode behavior">

- `mode: "cache-ttl"` enables pruning passes.
- `ttl` controls how often pruning can run again (after the last cache touch).
- Pruning soft-trims oversized tool results first, then hard-clears older tool results if needed.

**Soft-trim** keeps beginning + end and inserts `...` in the middle.

**Hard-clear** replaces the entire tool result with the placeholder.

Notes:

- Image blocks are never trimmed/cleared.
- Ratios are character-based (approximate), not exact token counts.
- If fewer than `keepLastAssistants` assistant messages exist, pruning is skipped.

</Accordion>

See [Session Pruning](/concepts/session-pruning) for behavior details.

### Block streaming

```json5
{
  agents: {
    defaults: {
      blockStreamingDefault: "off", // on | off
      blockStreamingBreak: "text_end", // text_end | message_end
      blockStreamingChunk: { minChars: 800, maxChars: 1200 },
      blockStreamingCoalesce: { idleMs: 1000 },
      humanDelay: { mode: "natural" }, // off | natural | custom (use minMs/maxMs)
    },
  },
}
```

- Non-Feishu channels require explicit `*.blockStreaming: true` to enable block replies.
- Channel overrides: `channels.<channel>.blockStreamingCoalesce` (and per-account variants). Signal/DingTalk/QQBot/Feishu default `minChars: 1500`.
- `humanDelay`: randomized pause between block replies. `natural` = 800–2500ms. Per-agent override: `agents.list[].humanDelay`.

See [Streaming](/concepts/streaming) for behavior + chunking details.

### Typing indicators

```json5
{
  agents: {
    defaults: {
      typingMode: "instant", // never | instant | thinking | message
      typingIntervalSeconds: 6,
    },
  },
}
```

- Defaults: `instant` for direct chats/mentions, `message` for unmentioned group chats.
- Per-session overrides: `session.typingMode`, `session.typingIntervalSeconds`.

See [Typing Indicators](/concepts/typing-indicators).

### `agents.list` (per-agent overrides)

```json5
{
  agents: {
    list: [
      {
        id: "main",
        default: true,
        name: "Main Agent",
        workspace: "~/.crawclaw/workspace",
        agentDir: "~/.crawclaw/agents/main/agent",
        model: "anthropic/claude-opus-4-6", // or { primary, fallbacks }
        thinkingDefault: "high", // per-agent thinking level override
        reasoningDefault: "on", // per-agent reasoning visibility override
        fastModeDefault: false, // per-agent fast mode override
        params: { cacheRetention: "none" }, // overrides matching defaults.models params by key
        identity: {
          name: "Samantha",
          theme: "helpful sloth",
          emoji: "🦥",
          avatar: "avatars/samantha.png",
        },
        groupChat: { mentionPatterns: ["@crawclaw"] },
        runtime: {
          type: "acp",
          acp: {
            agent: "codex",
            backend: "acpx",
            mode: "persistent",
            cwd: "/workspace/crawclaw",
          },
        },
        subagents: { allowAgents: ["*"] },
        tools: {
          profile: "coding",
          allow: ["browser"],
          deny: ["canvas"],
          elevated: { enabled: true },
        },
      },
    ],
  },
}
```

- `id`: stable agent id (required).
- `default`: when multiple are set, first wins (warning logged). If none set, first list entry is default.
- `model`: string form overrides `primary` only; object form `{ primary, fallbacks }` overrides both (`[]` disables global fallbacks). Cron jobs that only override `primary` still inherit default fallbacks unless you set `fallbacks: []`.
- `params`: per-agent stream params merged over the selected model entry in `agents.defaults.models`. Use this for agent-specific overrides like `cacheRetention`, `temperature`, or `maxTokens` without duplicating the whole model catalog.
- `thinkingDefault`: optional per-agent default thinking level (`off | minimal | low | medium | high | xhigh | adaptive`). Overrides `agents.defaults.thinkingDefault` for this agent when no per-message or session override is set.
- `reasoningDefault`: optional per-agent default reasoning visibility (`on | off | stream`). Applies when no per-message or session reasoning override is set.
- `fastModeDefault`: optional per-agent default for fast mode (`true | false`). Applies when no per-message or session fast-mode override is set.
- `runtime`: optional per-agent runtime descriptor. Use `type: "acp"` with `runtime.acp` defaults (`agent`, `backend`, `mode`, `cwd`) when the agent should default to ACP harness sessions.
- `identity.avatar`: workspace-relative path, `http(s)` URL, or `data:` URI.
- `identity` derives defaults: `ackReaction` from `emoji`, `mentionPatterns` from `name`/`emoji`.
- `subagents.allowAgents`: allowlist of agent ids for `sessions_spawn` (`["*"]` = any; default: same agent only).
- `subagents.requireAgentId`: when true, block `sessions_spawn` calls that omit `agentId` (forces explicit profile selection; default: false).

---

## Multi-agent routing

Run multiple isolated agents inside one Gateway. See [Multi-Agent](/concepts/multi-agent).

```json5
{
  agents: {
    list: [
      { id: "home", default: true, workspace: "~/.crawclaw/workspace-home" },
      { id: "work", workspace: "~/.crawclaw/workspace-work" },
    ],
  },
  bindings: [
    { agentId: "home", match: { channel: "weixin", accountId: "personal" } },
    { agentId: "work", match: { channel: "weixin", accountId: "biz" } },
  ],
}
```

### Binding match fields

- `type` (optional): `route` for normal routing (missing type defaults to route), `acp` for persistent ACP conversation bindings.
- `match.channel` (required)
- `match.accountId` (optional; `*` = any account; omitted = default account)
- `match.peer` (optional; `{ kind: direct|group|channel, id }`)
- `match.guildId` / `match.teamId` (optional; channel-specific)
- `acp` (optional; only for `type: "acp"`): `{ mode, label, cwd, backend }`

**Deterministic match order:**

1. `match.peer`
2. `match.guildId`
3. `match.teamId`
4. `match.accountId` (exact, no peer/guild/team)
5. `match.accountId: "*"` (channel-wide)
6. Default agent

Within each tier, the first matching `bindings` entry wins.

For `type: "acp"` entries, CrawClaw resolves by exact conversation identity (`match.channel` + account + `match.peer.id`) and does not use the route binding tier order above.

### Per-agent access profiles

```json5
{
  agents: {
    list: [
      {
        id: "personal",
        workspace: "~/.crawclaw/workspace-personal",
      },
    ],
  },
}
```

</Accordion>

<Accordion title="Read-only tools + workspace">

```json5
{
  agents: {
    list: [
      {
        id: "family",
        workspace: "~/.crawclaw/workspace-family",
        tools: {
          allow: [
            "read",
            "sessions_list",
            "sessions_history",
            "sessions_send",
            "sessions_spawn",
            "session_status",
          ],
          deny: ["write", "edit", "apply_patch", "exec", "process", "browser"],
        },
      },
    ],
  },
}
```

</Accordion>

<Accordion title="No filesystem access (messaging only)">

```json5
{
  agents: {
    list: [
      {
        id: "public",
        workspace: "~/.crawclaw/workspace-public",
        tools: {
          allow: [
            "sessions_list",
            "sessions_history",
            "sessions_send",
            "sessions_spawn",
            "session_status",
            "weixin",
            "feishu",
            "ddingtalk",
            "qqbot",
            "gateway",
          ],
          deny: [
            "read",
            "write",
            "edit",
            "apply_patch",
            "exec",
            "process",
            "browser",
            "canvas",
            "cron",
            "gateway",
            "image",
          ],
        },
      },
    ],
  },
}
```

</Accordion>

See [Subagents](/tools/subagents) for precedence details.

---

## Session

```json5
{
  session: {
    scope: "per-sender",
    dmScope: "main", // main | per-peer | per-channel-peer | per-account-channel-peer
    identityLinks: {
      alice: ["feishu:123456789", "qqbot:987654321012345678"],
    },
    reset: {
      mode: "daily", // daily | idle
      atHour: 4,
      idleMinutes: 60,
    },
    resetByType: {
      thread: { mode: "daily", atHour: 4 },
      direct: { mode: "idle", idleMinutes: 240 },
      group: { mode: "idle", idleMinutes: 120 },
    },
    resetTriggers: ["/new"],
    store: "~/.crawclaw/agents/{agentId}/sessions/sessions.json",
    parentForkMaxTokens: 100000, // skip parent-thread fork above this token count (0 disables)
    maintenance: {
      mode: "warn", // warn | enforce
      pruneAfter: "30d",
      maxEntries: 500,
      rotateBytes: "10mb",
      resetArchiveRetention: "30d", // duration or false
      maxDiskBytes: "500mb", // optional hard budget
      highWaterBytes: "400mb", // optional cleanup target
    },
    threadBindings: {
      enabled: true,
      idleHours: 24, // default inactivity auto-unfocus in hours (`0` disables)
      maxAgeHours: 0, // default hard max age in hours (`0` disables)
    },
    mainKey: "main", // legacy (runtime always uses "main")
    agentToAgent: { maxPingPongTurns: 5 },
    sendPolicy: {
      rules: [{ action: "deny", match: { channel: "qqbot", chatType: "group" } }],
      default: "allow",
    },
  },
}
```

<Accordion title="Session field details">

- **`scope`**: base session grouping strategy for group-chat contexts.
  - `per-sender` (default): each sender gets an isolated session within a channel context.
  - `global`: all participants in a channel context share a single session (use only when shared context is intended).
- **`dmScope`**: how DMs are grouped.
  - `main`: all DMs share the main session.
  - `per-peer`: isolate by sender id across channels.
  - `per-channel-peer`: isolate per channel + sender (recommended for multi-user inboxes).
  - `per-account-channel-peer`: isolate per account + channel + sender (recommended for multi-account).
- **`identityLinks`**: map canonical ids to provider-prefixed peers for cross-channel session sharing.
- **`reset`**: primary reset policy. `daily` resets at `atHour` local time; `idle` resets after `idleMinutes`. When both configured, whichever expires first wins.
- **`resetByType`**: per-type overrides (`direct`, `group`, `thread`). Legacy `dm` accepted as alias for `direct`.
- **`parentForkMaxTokens`**: max parent-session `totalTokens` allowed when creating a forked thread session (default `100000`).
  - If parent `totalTokens` is above this value, CrawClaw starts a fresh thread session instead of inheriting parent transcript history.
  - Set `0` to disable this guard and always allow parent forking.
- **`mainKey`**: legacy field. Runtime now always uses `"main"` for the main direct-chat bucket.
- **`agentToAgent.maxPingPongTurns`**: maximum reply-back turns between agents during agent-to-agent exchanges (integer, range: `0`–`5`). `0` disables ping-pong chaining.
- **`sendPolicy`**: match by `channel`, `chatType` (`direct|group|channel`, with legacy `dm` alias), `keyPrefix`, or `rawKeyPrefix`. First deny wins.
- **`maintenance`**: session-store cleanup + retention controls.
  - `mode`: `warn` emits warnings only; `enforce` applies cleanup.
  - `pruneAfter`: age cutoff for stale entries (default `30d`).
  - `maxEntries`: maximum number of entries in `sessions.json` (default `500`).
  - `rotateBytes`: rotate `sessions.json` when it exceeds this size (default `10mb`).
  - `resetArchiveRetention`: retention for `*.reset.<timestamp>` transcript archives. Defaults to `pruneAfter`; set `false` to disable.
  - `maxDiskBytes`: optional sessions-directory disk budget. In `warn` mode it logs warnings; in `enforce` mode it removes oldest artifacts/sessions first.
  - `highWaterBytes`: optional target after budget cleanup. Defaults to `80%` of `maxDiskBytes`.
- **`threadBindings`**: global defaults for thread-bound session features.
  - `enabled`: master default switch (providers can override; QQBot uses `channels.qqbot.threadBindings.enabled`)
  - `idleHours`: default inactivity auto-unfocus in hours (`0` disables; providers can override)
  - `maxAgeHours`: default hard max age in hours (`0` disables; providers can override)

</Accordion>

---

## Messages

```json5
{
  messages: {
    responsePrefix: "🦀", // or "auto"
    ackReaction: "👀",
    ackReactionScope: "group-mentions", // group-mentions | group-all | direct | all
    removeAckAfterReply: false,
    queue: {
      mode: "collect", // steer | followup | collect | steer-backlog | steer+backlog | queue | interrupt
      debounceMs: 1000,
      cap: 20,
      drop: "summarize", // old | new | summarize
      byChannel: {
        weixin: "collect",
        feishu: "collect",
      },
    },
    inbound: {
      debounceMs: 2000, // 0 disables
      byChannel: {
        weixin: 5000,
        ddingtalk: 1500,
      },
    },
  },
}
```

### Response prefix

Per-channel/account overrides: `channels.<channel>.responsePrefix`, `channels.<channel>.accounts.<id>.responsePrefix`.

Resolution (most specific wins): account → channel → global. `""` disables and stops cascade. `"auto"` derives `[{identity.name}]`.

**Template variables:**

| Variable          | Description            | Example                     |
| ----------------- | ---------------------- | --------------------------- |
| `{model}`         | Short model name       | `claude-opus-4-6`           |
| `{modelFull}`     | Full model identifier  | `anthropic/claude-opus-4-6` |
| `{provider}`      | Provider name          | `anthropic`                 |
| `{thinkingLevel}` | Current thinking level | `high`, `low`, `off`        |
| `{identity.name}` | Agent identity name    | (same as `"auto"`)          |

Variables are case-insensitive. `{think}` is an alias for `{thinkingLevel}`.

### Ack reaction

- Defaults to active agent's `identity.emoji`, otherwise `"👀"`. Set `""` to disable.
- Per-channel overrides: `channels.<channel>.ackReaction`, `channels.<channel>.accounts.<id>.ackReaction`.
- Resolution order: account → channel → `messages.ackReaction` → identity fallback.
- Scope: `group-mentions` (default), `group-all`, `direct`, `all`.
- `removeAckAfterReply`: removes ack after reply (DingTalk/QQBot/Feishu/Feishu only).

### Inbound debounce

Batches rapid text-only messages from the same sender into a single agent turn. Media/attachments flush immediately. Control commands bypass debouncing.

### TTS (text-to-speech)

```json5
{
  messages: {
    tts: {
      auto: "always", // off | always | inbound | tagged
      mode: "final", // final | all
      provider: "qwen3-tts",
      summaryModel: "openai/gpt-4.1-mini",
      modelOverrides: { enabled: true },
      maxTextLength: 4000,
      timeoutMs: 30000,
      prefsPath: "~/.crawclaw/settings/tts.json",
      providers: {
        "qwen3-tts": {
          enabled: true,
          runtime: "qwen-tts",
          baseUrl: "http://127.0.0.1:8013",
          profiles: {
            assistant: {
              voice: "Cherry",
              speed: 1.0,
            },
          },
        },
      },
    },
  },
}
```

- `auto` controls auto-TTS. `/tts off|always|inbound|tagged` overrides per session.
- `summaryModel` overrides `agents.defaults.model.primary` for auto-summary.
- `modelOverrides` is enabled by default; `modelOverrides.allowProvider` defaults to `false` (opt-in).
- Desktop speech uses the local `qwen3-tts` native provider. The default product runtime does not call ElevenLabs, Microsoft, or OpenAI TTS APIs.
- Provider-specific settings live under `messages.tts.providers.<provider>`.

---

## Talk

Defaults for Talk mode (macOS; archived mobile runtimes had separate compatibility defaults).

```json5
{
  talk: {
    provider: "qwen3-tts",
    providers: {
      "qwen3-tts": {
        voiceId: "Cherry",
        outputFormat: "wav",
        voiceAliases: {
          assistant: "Cherry",
        },
      },
    },
    silenceTimeoutMs: 1500,
    interruptOnSpeech: true,
  },
}
```

- `talk.provider` selects the active Talk provider when more than one provider is configured.
- `talk.providers.*.apiKey` accepts plaintext strings or SecretRef objects for providers that require credentials.
- `talk.providers.*.voiceAliases` lets Talk directives use friendly names.
- `silenceTimeoutMs` controls how long Talk mode waits after user silence before it sends the transcript. Unset keeps the platform default pause window (`700 ms on macOS and Android, 900 ms on iOS`).

---

## Tools

### Tool profiles

`tools.profile` sets a base allowlist before `tools.allow`/`tools.deny`:

Local onboarding defaults new local configs to `tools.profile: "coding"` when unset
(existing explicit profiles are preserved). The `coding` profile includes
`write_experience_note` and the scoped durable-memory file tools; onboarding
does not add a `main` agent `tools.alsoAllow` override for them.

Some tools are lifecycle-gated before profile allow/deny policy. Runtime
conditional tools still require their runtime/plugin/channel capability, and
special-agent-only tools such as `session_summary_file_read`,
`session_summary_file_edit` are not main-agent defaults.

| Profile     | Includes                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minimal`   | `session_status` only                                                                                                                                 |
| `coding`    | `group:fs`, `group:runtime`, `group:web`, `sessions_spawn`, `sessions_yield`, `session_status`, `browser`, `discover_skills`, `write_experience_note` |
| `messaging` | `group:messaging`, `session_status`                                                                                                                   |

### Tool groups

| Group                   | Tools                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `group:runtime`         | `bash`, `process`, `grep`, `find`, `ls`                                                                                            |
| `group:fs`              | `read`, `write`, `edit`, `apply_patch`                                                                                             |
| `group:web`             | `web_search`, `web_fetch`                                                                                                          |
| `group:sessions`        | `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `sessions_yield`, `subagents`, `session_status`            |
| `group:ui`              | `browser`, `canvas`                                                                                                                |
| `group:messaging`       | `message`                                                                                                                          |
| `group:automation`      | `cron`, `gateway`                                                                                                                  |
| `group:skills`          | `discover_skills`                                                                                                                  |
| `group:workflow`        | `workflow`, `workflowize`                                                                                                          |
| `group:review`          | `review_task`                                                                                                                      |
| `group:memory`          | `write_experience_note`, `memory_manifest_read`, `memory_note_read`, `memory_note_write`, `memory_note_edit`, `memory_note_delete` |
| `group:session_summary` | `session_summary_file_read`, `session_summary_file_edit`                                                                           |
| `group:media`           | `image`, `pdf`, `tts`                                                                                                              |
| `group:crawclaw`        | All built-in tools (excludes provider plugins)                                                                                     |

Group expansion does not bypass lifecycle gates. For example, adding
`group:memory` to an allowlist does not expose scoped durable-memory file tools
to `main` unless the host opened those tools for the current turn or the run is
a matching special agent.

### `tools.allow` / `tools.deny`

```json5
{
  tools: { deny: ["browser", "canvas"] },
}
```

### `tools.byProvider`

Further restrict tools for specific providers or models. Order: base profile → provider profile → allow/deny.

```json5
{
  tools: {
    profile: "coding",
    byProvider: {
      "google-antigravity": { profile: "minimal" },
      "openai/gpt-5.2": { allow: ["group:fs", "sessions_list"] },
    },
  },
}
```

### `tools.elevated`

Controls elevated (host) exec access:

```json5
{
  tools: {
    elevated: {
      enabled: true,
      allowFrom: {
        weixin: ["+15555550123"],
        qqbot: ["1234567890123", "987654321098765432"],
      },
    },
  },
}
```

- Per-agent override (`agents.list[].tools.elevated`) can only further restrict.
- `/elevated on|off|ask|full` stores state per session; inline directives apply to single message.

### `tools.exec`

```json5
{
  tools: {
    exec: {
      backgroundMs: 10000,
      timeoutSec: 1800,
      cleanupMs: 1800000,
      notifyOnExit: true,
      notifyOnExitEmptySuccess: false,
      applyPatch: {
        enabled: false,
        allowModels: ["gpt-5.2"],
      },
    },
  },
}
```

### `tools.loopDetection`

Tool-loop safety checks are **disabled by default**. Set `enabled: true` to activate detection.
Settings can be defined globally in `tools.loopDetection` and overridden per-agent at `agents.list[].tools.loopDetection`.

```json5
{
  tools: {
    loopDetection: {
      enabled: true,
      historySize: 30,
      warningThreshold: 10,
      criticalThreshold: 20,
      globalCircuitBreakerThreshold: 30,
      detectors: {
        genericRepeat: true,
        knownPollNoProgress: true,
        pingPong: true,
      },
    },
  },
}
```

- `historySize`: max tool-call history retained for loop analysis.
- `warningThreshold`: repeating no-progress pattern threshold for warnings.
- `criticalThreshold`: higher repeating threshold for blocking critical loops.
- `globalCircuitBreakerThreshold`: hard stop threshold for any no-progress run.
- `detectors.genericRepeat`: warn on repeated same-tool/same-args calls.
- `detectors.knownPollNoProgress`: warn/block on known poll tools (`process.poll`, `command_status`, etc.).
- `detectors.pingPong`: warn/block on alternating no-progress pair patterns.
- If `warningThreshold >= criticalThreshold` or `criticalThreshold >= globalCircuitBreakerThreshold`, validation fails.

### `tools.web`

```json5
{
  tools: {
    web: {
      search: {
        enabled: true,
        provider: "searxng",
        maxResults: 5,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
      },
      fetch: {
        enabled: true,
        maxChars: 50000,
        maxCharsCap: 50000,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
        userAgent: "custom-ua",
      },
    },
  },
}
```

### `tools.media`

Configures inbound media understanding (image/audio/video):

```json5
{
  tools: {
    media: {
      concurrency: 2,
      audio: {
        enabled: true,
        maxBytes: 20971520,
        scope: {
          default: "deny",
          rules: [{ action: "allow", match: { chatType: "direct" } }],
        },
        models: [
          { provider: "openai", model: "gpt-4o-mini-transcribe" },
          { type: "cli", command: "whisper", args: ["--model", "base", "{{MediaPath}}"] },
        ],
      },
      video: {
        enabled: true,
        maxBytes: 52428800,
        models: [{ provider: "google", model: "gemini-3-flash-preview" }],
      },
    },
  },
}
```

<Accordion title="Media model entry fields">

**Provider entry** (`type: "provider"` or omitted):

- `provider`: API provider id (`openai`, `anthropic`, `google`/`gemini`, `groq`, etc.)
- `model`: model id override
- `profile` / `preferredProfile`: `auth-profiles.json` profile selection

**CLI entry** (`type: "cli"`):

- `command`: executable to run
- `args`: templated args (supports `{{MediaPath}}`, `{{Prompt}}`, `{{MaxChars}}`, etc.)

**Common fields:**

- `capabilities`: optional list (`image`, `audio`, `video`). Defaults: `openai`/`anthropic`/`minimax` → image, `google` → image+audio+video, `groq` → audio.
- `prompt`, `maxChars`, `maxBytes`, `timeoutSeconds`, `language`: per-entry overrides.
- Failures fall back to the next entry.

Provider auth follows standard order: `auth-profiles.json` → env vars → `models.providers.*.apiKey`.

</Accordion>

### `tools.agentToAgent`

```json5
{
  tools: {
    agentToAgent: {
      enabled: false,
      allow: ["home", "work"],
    },
  },
}
```

### `tools.sessions`

Controls which sessions can be targeted by the session tools (`sessions_list`, `sessions_history`, `sessions_send`).

Default: `tree` (current session + sessions spawned by it, such as subagents).

```json5
{
  tools: {
    sessions: {
      // "self" | "tree" | "agent" | "all"
      visibility: "tree",
    },
  },
}
```

Notes:

- `self`: only the current session key.
- `tree`: current session + sessions spawned by the current session (subagents).
- `agent`: any session belonging to the current agent id (can include other users if you run per-sender sessions under the same agent id).
- `all`: any session. Cross-agent targeting still requires `tools.agentToAgent`.

### `tools.sessions_spawn`

Controls inline attachment support for `sessions_spawn`.

```json5
{
  tools: {
    sessions_spawn: {
      attachments: {
        enabled: false, // opt-in: set true to allow inline file attachments
        maxTotalBytes: 5242880, // 5 MB total across all files
        maxFiles: 50,
        maxFileBytes: 1048576, // 1 MB per file
        retainOnSessionKeep: false, // keep attachments when cleanup="keep"
      },
    },
  },
}
```

Notes:

- Attachments are only supported for `runtime: "subagent"`. ACP runtime rejects them.
- Files are materialized into the child workspace at `.crawclaw/attachments/<uuid>/` with a `.manifest.json`.
- Attachment content is automatically redacted from transcript persistence.
- Base64 inputs are validated with strict alphabet/padding checks and a pre-decode size guard.
- File permissions are `0700` for directories and `0600` for files.
- Cleanup follows the `cleanup` policy: `delete` always removes attachments; `keep` retains them only when `retainOnSessionKeep: true`.

### `agents.defaults.subagents`

```json5
{
  agents: {
    defaults: {
      subagents: {
        model: "minimax/MiniMax-M2.7",
        maxConcurrent: 8,
        runTimeoutSeconds: 900,
        archiveAfterMinutes: 60,
      },
    },
  },
}
```

- `model`: default model for spawned sub-agents. If omitted, sub-agents inherit the caller's model.
- `runTimeoutSeconds`: default timeout (seconds) for `sessions_spawn` when the tool call omits `runTimeoutSeconds`. `0` means no timeout.
- Per-subagent tool policy: `tools.subagents.tools.allow` / `tools.subagents.tools.deny`.

---

## Custom providers and base URLs

CrawClaw uses the built-in model catalog. Add custom providers via `models.providers` in config or `~/.crawclaw/agents/<agentId>/agent/models.json`.

```json5
{
  models: {
    mode: "merge", // merge (default) | replace
    providers: {
      "custom-proxy": {
        baseUrl: "http://localhost:4000/v1",
        apiKey: "LITELLM_KEY",
        api: "openai-completions", // openai-completions | openai-responses | anthropic-messages | google-generative-ai
        models: [
          {
            id: "llama-3.1-8b",
            name: "Llama 3.1 8B",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 32000,
          },
        ],
      },
    },
  },
}
```

- Use `authHeader: true` + `headers` for custom auth needs.
- Override agent config root with `CRAWCLAW_AGENT_DIR` (or `PI_CODING_AGENT_DIR`, a legacy environment variable alias).
- Merge precedence for matching provider IDs:
  - Non-empty agent `models.json` `baseUrl` values win.
  - Non-empty agent `apiKey` values win only when that provider is not SecretRef-managed in current config/auth-profile context.
  - SecretRef-managed provider `apiKey` values are refreshed from source markers (`ENV_VAR_NAME` for env refs, `secretref-managed` for file/exec refs) instead of persisting resolved secrets.
  - SecretRef-managed provider header values are refreshed from source markers (`secretref-env:ENV_VAR_NAME` for env refs, `secretref-managed` for file/exec refs).
  - Empty or missing agent `apiKey`/`baseUrl` fall back to `models.providers` in config.
  - Only explicitly configured provider model entries are written to agent `models.json`; runtime provider metadata remains Rust-owned.
  - Use `models.mode: "replace"` when you want config to fully rewrite `models.json`.
  - Marker persistence is source-authoritative: markers are written from the active source config snapshot (pre-resolution), not from resolved runtime secret values.

### Provider field details

- `models.mode`: provider catalog behavior (`merge` or `replace`).
- `models.providers`: custom provider map keyed by provider id.
- `models.providers.*.api`: request adapter (`openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`, etc).
- `models.providers.*.apiKey`: provider credential (prefer SecretRef/env substitution).
- `models.providers.*.auth`: auth strategy (`api-key`, `token`, `oauth`, `aws-sdk`).
- `models.providers.*.injectNumCtxForOpenAICompat`: for Ollama + `openai-completions`, inject `options.num_ctx` into requests (default: `true`).
- `models.providers.*.authHeader`: force credential transport in the `Authorization` header when required.
- `models.providers.*.baseUrl`: upstream API base URL.
- `models.providers.*.headers`: extra static headers for proxy/tenant routing.
- `models.providers.*.models`: explicit provider model catalog entries.
- `models.providers.*.models.*.compat.supportsDeveloperRole`: optional compatibility hint. For `api: "openai-completions"` with a non-empty non-native `baseUrl` (host not `api.openai.com`), CrawClaw forces this to `false` at runtime. Empty/omitted `baseUrl` keeps default OpenAI behavior.
- `models.bedrockDiscovery`: Bedrock auto-discovery settings root.
- `models.bedrockDiscovery.enabled`: turn discovery polling on/off.
- `models.bedrockDiscovery.region`: AWS region for discovery.
- `models.bedrockDiscovery.providerFilter`: optional provider-id filter for targeted discovery.
- `models.bedrockDiscovery.refreshInterval`: polling interval for discovery refresh.
- `models.bedrockDiscovery.defaultContextWindow`: fallback context window for discovered models.
- `models.bedrockDiscovery.defaultMaxTokens`: fallback max output tokens for discovered models.

### Provider examples

<Accordion title="Cerebras (GLM 4.6 / 4.7)">

```json5
{
  env: { CEREBRAS_API_KEY: "sk-..." },
  agents: {
    defaults: {
      model: {
        primary: "cerebras/zai-glm-4.7",
        fallbacks: ["cerebras/zai-glm-4.6"],
      },
      models: {
        "cerebras/zai-glm-4.7": { alias: "GLM 4.7 (Cerebras)" },
        "cerebras/zai-glm-4.6": { alias: "GLM 4.6 (Cerebras)" },
      },
    },
  },
  models: {
    mode: "merge",
    providers: {
      cerebras: {
        baseUrl: "https://api.cerebras.ai/v1",
        apiKey: "${CEREBRAS_API_KEY}",
        api: "openai-completions",
        models: [
          { id: "zai-glm-4.7", name: "GLM 4.7 (Cerebras)" },
          { id: "zai-glm-4.6", name: "GLM 4.6 (Cerebras)" },
        ],
      },
    },
  },
}
```

Use `cerebras/zai-glm-4.7` for Cerebras; `zai/glm-4.7` for Z.AI direct.

</Accordion>

<Accordion title="OpenCode">

```json5
{
  agents: {
    defaults: {
      model: { primary: "opencode/claude-opus-4-6" },
      models: { "opencode/claude-opus-4-6": { alias: "Opus" } },
    },
  },
}
```

Set `OPENCODE_API_KEY` (or `OPENCODE_ZEN_API_KEY`). Use `opencode/...` refs for the Zen catalog or `opencode-go/...` refs for the Go catalog. Shortcut: CrawClaw Desktop or the local Gateway API or CrawClaw Desktop or the local Gateway API.

</Accordion>

<Accordion title="Z.AI (GLM-4.7)">

```json5
{
  agents: {
    defaults: {
      model: { primary: "zai/glm-4.7" },
      models: { "zai/glm-4.7": {} },
    },
  },
}
```

Set `ZAI_API_KEY`. `z.ai/*` and `z-ai/*` are accepted aliases. Shortcut: CrawClaw Desktop or the local Gateway API.

- General endpoint: `https://api.z.ai/api/paas/v4`
- Coding endpoint (default): `https://api.z.ai/api/coding/paas/v4`
- For the general endpoint, define a custom provider with the base URL override.

</Accordion>

<Accordion title="Moonshot AI (Kimi)">

```json5
{
  env: { MOONSHOT_API_KEY: "sk-..." },
  agents: {
    defaults: {
      model: { primary: "moonshot/kimi-k2.5" },
      models: { "moonshot/kimi-k2.5": { alias: "Kimi K2.5" } },
    },
  },
  models: {
    mode: "merge",
    providers: {
      moonshot: {
        baseUrl: "https://api.moonshot.ai/v1",
        apiKey: "${MOONSHOT_API_KEY}",
        api: "openai-completions",
        models: [
          {
            id: "kimi-k2.5",
            name: "Kimi K2.5",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 256000,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
}
```

For the China endpoint: `baseUrl: "https://api.moonshot.cn/v1"` or CrawClaw Desktop or the local Gateway API.

</Accordion>

<Accordion title="Kimi Coding">

```json5
{
  env: { KIMI_API_KEY: "sk-..." },
  agents: {
    defaults: {
      model: { primary: "kimi-coding/k2p5" },
      models: { "kimi-coding/k2p5": { alias: "Kimi K2.5" } },
    },
  },
}
```

Anthropic-compatible, built-in provider. Shortcut: CrawClaw Desktop or the local Gateway API.

</Accordion>

<Accordion title="Synthetic (Anthropic-compatible)">

```json5
{
  env: { SYNTHETIC_API_KEY: "sk-..." },
  agents: {
    defaults: {
      model: { primary: "synthetic/hf:MiniMaxAI/MiniMax-M2.5" },
      models: { "synthetic/hf:MiniMaxAI/MiniMax-M2.5": { alias: "MiniMax M2.5" } },
    },
  },
  models: {
    mode: "merge",
    providers: {
      synthetic: {
        baseUrl: "https://api.synthetic.new/anthropic",
        apiKey: "${SYNTHETIC_API_KEY}",
        api: "anthropic-messages",
        models: [
          {
            id: "hf:MiniMaxAI/MiniMax-M2.5",
            name: "MiniMax M2.5",
            reasoning: true,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 192000,
            maxTokens: 65536,
          },
        ],
      },
    },
  },
}
```

Base URL should omit `/v1` (Anthropic client appends it). Shortcut: CrawClaw Desktop or the local Gateway API.

</Accordion>

<Accordion title="MiniMax M2.7 (direct)">

```json5
{
  agents: {
    defaults: {
      model: { primary: "minimax/MiniMax-M2.7" },
      models: {
        "minimax/MiniMax-M2.7": { alias: "Minimax" },
      },
    },
  },
  models: {
    mode: "merge",
    providers: {
      minimax: {
        baseUrl: "https://api.minimax.io/anthropic",
        apiKey: "${MINIMAX_API_KEY}",
        api: "anthropic-messages",
        models: [
          {
            id: "MiniMax-M2.7",
            name: "MiniMax M2.7",
            reasoning: true,
            input: ["text"],
            cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.12 },
            contextWindow: 200000,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
}
```

Set `MINIMAX_API_KEY`. Shortcut: CrawClaw Desktop or the local Gateway API.
The model catalog now defaults to M2.7 only.

</Accordion>

<Accordion title="Local models (LM Studio)">

See [Local Models](/gateway/local-models). TL;DR: run a large local model via LM Studio Responses API on serious hardware; keep hosted models merged for fallback.

</Accordion>

---

## Skills

```json5
{
  skills: {
    allowBundled: ["gemini", "peekaboo"],
    load: {
      extraDirs: ["~/Projects/agent-scripts/skills"],
    },
    install: {
      preferBrew: true,
      nodeManager: "npm", // npm | pnpm | yarn
    },
    entries: {
      "image-lab": {
        apiKey: { source: "env", provider: "default", id: "GEMINI_API_KEY" }, // or plaintext string
        env: { GEMINI_API_KEY: "GEMINI_KEY_HERE" },
      },
      peekaboo: { enabled: true },
      sag: { enabled: false },
    },
  },
}
```

- `allowBundled`: optional allowlist for bundled skills only (managed/workspace skills unaffected).
- `entries.<skillKey>.enabled: false` disables a skill even if bundled/installed.
- `entries.<skillKey>.apiKey`: convenience for skills declaring a primary env var (plaintext string or SecretRef object).

---

## Plugins

```json5
{
  plugins: {
    enabled: true,
    allow: ["my-plugin"],
    deny: [],
    load: {
      paths: ["~/Projects/oss/my-plugin"],
    },
    entries: {
      "my-plugin": {
        enabled: true,
        config: {},
      },
    },
  },
}
```

- Loaded from `~/.crawclaw/extensions`, `<workspace>/.crawclaw/extensions`, plus `plugins.load.paths`.
- Discovery accepts native CrawClaw plugins plus compatible Codex bundles and Claude bundles, including manifestless Claude default-layout bundles.
- Config changes are applied through Gateway live reconfigure.
- `allow`: optional allowlist (only listed plugins load). `deny` wins.
- `plugins.entries.<id>.apiKey`: plugin-level API key convenience field (when supported by the plugin).
- `plugins.entries.<id>.env`: plugin-scoped env var map.
- `plugins.entries.<id>.subagent.allowModelOverride`: explicitly trust this plugin to request per-run `provider` and `model` overrides for background subagent runs.
- `plugins.entries.<id>.subagent.allowedModels`: optional allowlist of canonical `provider/model` targets for trusted subagent overrides. Use `"*"` only when you intentionally want to allow any model.
- `plugins.entries.<id>.config`: plugin-defined config object (validated by native CrawClaw plugin schema when available).
- Enabled Claude bundle plugins can also contribute sanitized runtime defaults from `settings.json`; CrawClaw applies those as agent runtime settings, not as raw CrawClaw config patches.
- `plugins.installs`: CLI-managed install metadata used by CrawClaw Desktop or the local Gateway API.
  - Includes `source`, `spec`, `sourcePath`, `installPath`, `version`, `resolvedName`, `resolvedVersion`, `resolvedSpec`, `integrity`, `shasum`, `resolvedAt`, `installedAt`.
  - Treat `plugins.installs.*` as managed state; prefer Desktop and Gateway API actions over manual edits.

See [Plugins](/tools/plugin).

---

## Browser

```json5
{
  browser: {
    enabled: true,
    evaluateEnabled: true,
    defaultProfile: "crawclaw",
    ssrfPolicy: {
      dangerouslyAllowPrivateNetwork: true, // default trusted-network mode
      // allowPrivateNetwork: true, // legacy alias
      // hostnameAllowlist: ["*.example.com", "example.com"],
      // allowedHostnames: ["localhost"],
    },
    profiles: {
      crawclaw: { color: "#FF4500" },
      work: { color: "#0066CC" },
    },
    color: "#FF4500",
    // headless: false,
    // extraArgs: [],
  },
}
```

- `evaluateEnabled: false` disables `act:evaluate` and `wait --fn`.
- `ssrfPolicy.dangerouslyAllowPrivateNetwork` defaults to `true` when unset (trusted-network model).
- Set `ssrfPolicy.dangerouslyAllowPrivateNetwork: false` for strict public-only browser navigation.
- `ssrfPolicy.allowPrivateNetwork` remains supported as a legacy alias.
- In strict mode, use `ssrfPolicy.hostnameAllowlist` and `ssrfPolicy.allowedHostnames` for explicit exceptions.
- Control service: loopback only (port derived from `gateway.port`, default `18791`).
- The bundled browser tool is registered by the Rust native plugin registry and
  uses the managed `agent-browser` runtime.

---

## Gateway

```json5
{
  gateway: {
    mode: "local", // local | remote
    port: 18789,
    bind: "loopback",
    auth: {
      mode: "token", // none | token | password | trusted-proxy
      token: "your-token",
      // password: "your-password", // or CRAWCLAW_GATEWAY_PASSWORD
      // trustedProxy: { userHeader: "x-forwarded-user" }, // for mode=trusted-proxy; see /gateway/trusted-proxy-auth
      allowTailscale: true,
      rateLimit: {
        maxAttempts: 10,
        windowMs: 60000,
        lockoutMs: 300000,
        exemptLoopback: true,
      },
    },
    tailscale: {
      mode: "off", // off | serve | funnel
      resetOnExit: false,
    },
    browserClients: {
      enabled: true,
      basePath: "/crawclaw",
      // allowedOrigins: ["https://control.example.com"], // required for non-loopback browser-client access
      // dangerouslyAllowHostHeaderOriginFallback: false, // dangerous Host-header origin fallback mode
      // allowInsecureAuth: false,
    },
    remote: {
      url: "ws://gateway.tailnet:18789",
      transport: "ssh", // ssh | direct
      token: "your-token",
      // password: "your-password",
    },
    trustedProxies: ["10.0.0.1"],
    // Optional. Default false.
    allowRealIpFallback: false,
    tools: {
      // Additional /tools/invoke HTTP denies
      deny: ["browser"],
      // Remove tools from the default HTTP deny list
      allow: ["gateway"],
    },
  },
}
```

<Accordion title="Gateway field details">

- `mode`: `local` (run gateway) or `remote` (connect to remote gateway). Gateway refuses to start unless `local`.
- `port`: single multiplexed port for WS + HTTP. Precedence: `--port` > `CRAWCLAW_GATEWAY_PORT` > `gateway.port` > `18789`.
- `bind`: `auto`, `loopback` (default), `lan` (`0.0.0.0`), `tailnet` (Tailscale IP only), or `custom`.
- **Legacy bind aliases**: use bind mode values in `gateway.bind` (`auto`, `loopback`, `lan`, `tailnet`, `custom`), not host aliases (`0.0.0.0`, `127.0.0.1`, `localhost`, `::`, `::1`).
- **Auth**: required by default. Non-loopback binds require a shared token/password. CrawClaw Desktop can generate a token during setup.
- If both `gateway.auth.token` and `gateway.auth.password` are configured (including SecretRefs), set `gateway.auth.mode` explicitly to `token` or `password`. Startup and service install/repair flows fail when both are configured and mode is unset.
- `gateway.auth.mode: "none"`: explicit no-auth mode. Use only for trusted local loopback setups; this is intentionally not offered by onboarding prompts.
- `gateway.auth.mode: "trusted-proxy"`: delegate auth to an identity-aware reverse proxy and trust identity headers from `gateway.trustedProxies` (see [Trusted Proxy Auth](/gateway/trusted-proxy-auth)).
- `gateway.auth.allowTailscale`: when `true`, Tailscale Serve identity headers can satisfy browser-client/WebSocket auth (verified via `tailscale whois`); HTTP API endpoints still require token/password auth. This tokenless flow assumes the gateway host is trusted. Defaults to `true` when `tailscale.mode = "serve"`.
- `gateway.auth.rateLimit`: optional failed-auth limiter. Applies per client IP and auth scope. Blocked attempts return `429` + `Retry-After`.
  - `gateway.auth.rateLimit.exemptLoopback` defaults to `true`; set `false` when you intentionally want localhost traffic rate-limited too (for test setups or strict proxy deployments).
- Browser-origin WS auth attempts are always throttled with loopback exemption disabled (defense-in-depth against browser-based localhost brute force).
- `tailscale.mode`: `serve` (tailnet only, loopback bind) or `funnel` (public, requires auth).
- `browserClients.allowedOrigins`: explicit browser-origin allowlist for Gateway WebSocket connects. Required when browser clients are expected from non-loopback origins.
- `browserClients.dangerouslyAllowHostHeaderOriginFallback`: dangerous mode that enables Host-header origin fallback for deployments that intentionally rely on Host-header origin policy.
- `remote.transport`: `ssh` (default) or `direct` (ws/wss). For `direct`, `remote.url` must be `ws://` or `wss://`.
- `CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS=1`: client-side break-glass override that allows plaintext `ws://` to trusted private-network IPs; default remains loopback-only for plaintext.
- `gateway.remote.token` / `.password` are remote-client credential fields. They do not configure gateway auth by themselves.
- `gateway.channelHealthCheckMinutes`: channel health-monitor interval in minutes. Set `0` to disable health-monitor restarts globally. Default: `5`.
- `gateway.channelStaleEventThresholdMinutes`: stale-socket threshold in minutes. Keep this greater than or equal to `gateway.channelHealthCheckMinutes`. Default: `30`.
- `gateway.channelMaxRestartsPerHour`: maximum health-monitor restarts per channel/account in a rolling hour. Default: `10`.
- `channels.<provider>.healthMonitor.enabled`: per-channel opt-out for health-monitor restarts while keeping the global monitor enabled.
- `channels.<provider>.accounts.<accountId>.healthMonitor.enabled`: per-account override for multi-account channels. When set, it takes precedence over the channel-level override.
- Local gateway call paths can use `gateway.remote.*` as fallback only when `gateway.auth.*` is unset.
- If `gateway.auth.token` / `gateway.auth.password` is explicitly configured via SecretRef and unresolved, resolution fails closed (no remote fallback masking).
- `trustedProxies`: reverse proxy IPs that terminate TLS. Only list proxies you control.
- `allowRealIpFallback`: when `true`, the gateway accepts `X-Real-IP` if `X-Forwarded-For` is missing. Default `false` for fail-closed behavior.
- `gateway.tools.deny`: extra tool names blocked for HTTP `POST /tools/invoke` (extends default deny list).
- `gateway.tools.allow`: remove tool names from the default HTTP deny list.

</Accordion>

### OpenAI-compatible endpoints

- Chat Completions: disabled by default. Enable with `gateway.http.endpoints.chatCompletions.enabled: true`.
- Responses API: `gateway.http.endpoints.responses.enabled`.
- The Rust-native Responses endpoint is currently text-only. These URL-input hardening keys are reserved for deployments that enable file or image inputs:
  - `gateway.http.endpoints.responses.maxUrlParts`
  - `gateway.http.endpoints.responses.files.urlAllowlist`
  - `gateway.http.endpoints.responses.images.urlAllowlist`
    Empty allowlists are treated as unset; use `gateway.http.endpoints.responses.files.allowUrl=false`
    and/or `gateway.http.endpoints.responses.images.allowUrl=false` to disable URL fetching.
- Optional response hardening header:
  - `gateway.http.securityHeaders.strictTransportSecurity` (set only for HTTPS origins you control; see [Trusted Proxy Auth](/gateway/trusted-proxy-auth#tls-termination-and-hsts))

### Multi-instance isolation

Run multiple gateways on one host with unique ports and state dirs:

```bash
CRAWCLAW_CONFIG_PATH=~/.crawclaw/a.json \
CRAWCLAW_STATE_DIR=~/.crawclaw-a \
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Convenience flags: `--dev` (uses `~/.crawclaw-dev` + port `19001`), `--profile <name>` (uses `~/.crawclaw-<name>`).

See [Multiple Gateways](/gateway/multiple-gateways).

### `gateway.tls`

```json5
{
  gateway: {
    tls: {
      enabled: false,
      autoGenerate: false,
      certPath: "/etc/crawclaw/tls/server.crt",
      keyPath: "/etc/crawclaw/tls/server.key",
      caPath: "/etc/crawclaw/tls/ca-bundle.crt",
    },
  },
}
```

- `enabled`: enables TLS termination at the gateway listener (HTTPS/WSS) (default: `false`).
- `autoGenerate`: auto-generates a local self-signed cert/key pair when explicit files are not configured; for local/dev use only.
- `certPath`: filesystem path to the TLS certificate file.
- `keyPath`: filesystem path to the TLS private key file; keep permission-restricted.
- `caPath`: optional CA bundle path for client verification or custom trust chains.

## Hooks

```json5
{
  hooks: {
    enabled: true,
    token: "shared-secret",
    path: "/hooks",
    maxBodyBytes: 262144,
    defaultSessionKey: "hook:ingress",
    allowRequestSessionKey: false,
    allowedSessionKeyPrefixes: ["hook:"],
    allowedAgentIds: ["hooks", "main"],
    presets: ["gmail"],
    transformsDir: "~/.crawclaw/hooks/transforms",
    mappings: [
      {
        match: { path: "gmail" },
        action: "agent",
        agentId: "hooks",
        wakeMode: "now",
        name: "Gmail",
        sessionKey: "hook:gmail:{{messages[0].id}}",
        messageTemplate: "From: {{messages[0].from}}\nSubject: {{messages[0].subject}}\n{{messages[0].snippet}}",
        deliver: true,
        channel: "last",
        model: "openai/gpt-5.2-mini",
      },
    ],
  },
}
```

Auth: `Authorization: Bearer <token>` or `x-crawclaw-token: <token>`.

**Endpoints:**

- `POST /hooks/wake` → `{ text, mode?: "now" }`
- `POST /hooks/agent` → `{ message, name?, agentId?, sessionKey?, wakeMode?, deliver?, channel?, to?, model?, thinking?, timeoutSeconds? }`
  - `sessionKey` from request payload is accepted only when `hooks.allowRequestSessionKey=true` (default: `false`).
- `POST /hooks/<name>` → resolved via `hooks.mappings`

<Accordion title="Mapping details">

- `match.path` matches sub-path after `/hooks` (e.g. `/hooks/gmail` → `gmail`).
- `match.source` matches a payload field for generic paths.
- Templates like `{{messages[0].subject}}` read from the payload.
- `transform` can point to a JS/TS module returning a hook action.
  - `transform.module` must be a relative path and stays within `hooks.transformsDir` (absolute paths and traversal are rejected).
- `agentId` routes to a specific agent; unknown IDs fall back to default.
- `allowedAgentIds`: restricts explicit routing (`*` or omitted = allow all, `[]` = deny all).
- `defaultSessionKey`: optional fixed session key for hook agent runs without explicit `sessionKey`.
- `allowRequestSessionKey`: allow `/hooks/agent` callers to set `sessionKey` (default: `false`).
- `allowedSessionKeyPrefixes`: optional prefix allowlist for explicit `sessionKey` values (request + mapping), e.g. `["hook:"]`.
- `deliver: true` sends final reply to a channel; `channel` defaults to `last`.
- `model` overrides LLM for this hook run (must be allowed if model catalog is set).

</Accordion>

### Gmail integration

```json5
{
  hooks: {
    gmail: {
      account: "crawclaw@gmail.com",
      topic: "projects/<project-id>/topics/gog-gmail-watch",
      subscription: "gog-gmail-watch-push",
      pushToken: "shared-push-token",
      hookUrl: "http://127.0.0.1:18789/hooks/gmail",
      includeBody: true,
      maxBytes: 20000,
      renewEveryMinutes: 720,
      serve: { bind: "127.0.0.1", port: 8788, path: "/" },
      tailscale: { mode: "funnel", path: "/gmail-pubsub" },
      model: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
      thinking: "off",
    },
  },
}
```

- Gateway auto-starts `gog gmail watch serve` on boot when configured. Set `CRAWCLAW_SKIP_GMAIL_WATCHER=1` to disable.
- Don't run a separate `gog gmail watch serve` alongside the Gateway.

---

## Discovery

### mDNS (Bonjour)

```json5
{
  discovery: {
    mdns: {
      mode: "minimal", // minimal | full | off
    },
  },
}
```

- `minimal` (default): omit `sshPort` from TXT records.
- `full`: include `sshPort`.
- Hostname defaults to `crawclaw`. Override with `CRAWCLAW_MDNS_HOSTNAME`.

### Wide-area (DNS-SD)

```json5
{
  discovery: {
    wideArea: { enabled: true },
  },
}
```

Writes a unicast DNS-SD zone under `~/.crawclaw/dns/`. For cross-network discovery, pair with a DNS server (CoreDNS recommended) + Tailscale split DNS.

Setup: CrawClaw Desktop or the local Gateway API.

---

## Environment

### `env` (inline env vars)

```json5
{
  env: {
    OPENROUTER_API_KEY: "sk-or-...",
    vars: {
      GROQ_API_KEY: "gsk-...",
    },
    shellEnv: {
      enabled: true,
      timeoutMs: 15000,
    },
  },
}
```

- Inline env vars are only applied if the process env is missing the key.
- `.env` files: CWD `.env` + `~/.crawclaw/.env` (neither overrides existing vars).
- `shellEnv`: imports missing expected keys from your login shell profile.
- See [Environment](/help/environment) for full precedence.

### Env var substitution

Reference env vars in any config string with `${VAR_NAME}`:

```json5
{
  gateway: {
    auth: { token: "${CRAWCLAW_GATEWAY_TOKEN}" },
  },
}
```

- Only uppercase names matched: `[A-Z_][A-Z0-9_]*`.
- Missing/empty vars throw an error at config load.
- Escape with `$${VAR}` for a literal `${VAR}`.
- Works with `$include`.

---

## Secrets

Secret refs are additive: plaintext values still work.

### `SecretRef`

Use one object shape:

```json5
{ source: "env" | "file" | "exec", provider: "default", id: "..." }
```

Validation:

- `provider` pattern: `^[a-z][a-z0-9_-]{0,63}$`
- `source: "env"` id pattern: `^[A-Z][A-Z0-9_]{0,127}$`
- `source: "file"` id: absolute JSON pointer (for example `"/providers/openai/apiKey"`)
- `source: "exec"` id pattern: `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$`
- `source: "exec"` ids must not contain `.` or `..` slash-delimited path segments (for example `a/../b` is rejected)

### Supported credential surface

- Canonical matrix: [SecretRef Credential Surface](/reference/secretref-credential-surface)
- `secrets apply` targets supported `crawclaw.json` credential paths.
- `auth-profiles.json` refs are included in runtime resolution and audit coverage.

### Secret providers config

```json5
{
  secrets: {
    providers: {
      default: { source: "env" }, // optional explicit env provider
      filemain: {
        source: "file",
        path: "~/.crawclaw/secrets.json",
        mode: "json",
        timeoutMs: 5000,
      },
      vault: {
        source: "exec",
        command: "/usr/local/bin/crawclaw-vault-resolver",
        passEnv: ["PATH", "VAULT_ADDR"],
      },
    },
    defaults: {
      env: "default",
      file: "filemain",
      exec: "vault",
    },
  },
}
```

Notes:

- `file` provider supports `mode: "json"` and `mode: "singleValue"` (`id` must be `"value"` in singleValue mode).
- `exec` provider requires an absolute `command` path and uses protocol payloads on stdin/stdout.
- By default, symlink command paths are rejected. Set `allowSymlinkCommand: true` to allow symlink paths while validating the resolved target path.
- If `trustedDirs` is configured, the trusted-dir check applies to the resolved target path.
- `exec` child environment is minimal by default; pass required variables explicitly with `passEnv`.
- Secret refs are resolved at activation time into an in-memory snapshot, then request paths read the snapshot only.
- Active-surface filtering applies during activation: unresolved refs on enabled surfaces fail startup/reload, while inactive surfaces are skipped with diagnostics.

---

## Auth storage

```json5
{
  auth: {
    profiles: {
      "anthropic:me@example.com": { provider: "anthropic", mode: "oauth", email: "me@example.com" },
      "anthropic:work": { provider: "anthropic", mode: "api_key" },
    },
    order: {
      anthropic: ["anthropic:me@example.com", "anthropic:work"],
    },
  },
}
```

- Per-agent profiles are stored at `<agentDir>/auth-profiles.json`.
- `auth-profiles.json` supports value-level refs (`keyRef` for `api_key`, `tokenRef` for `token`) for static credential modes.
- OAuth-mode profiles (`auth.profiles.<id>.mode = "oauth"`) do not support SecretRef-backed auth-profile credentials.
- Static runtime credentials come from in-memory resolved snapshots; legacy static `auth.json` entries are scrubbed when discovered.
- Legacy OAuth imports from `~/.crawclaw/credentials/oauth.json`.
- See [OAuth](/concepts/oauth).
- Secrets runtime behavior and `audit/configure/apply` tooling: [Secrets Management](/gateway/secrets).

### `auth.cooldowns`

```json5
{
  auth: {
    cooldowns: {
      billingBackoffHours: 5,
      billingBackoffHoursByProvider: { anthropic: 3, openai: 8 },
      billingMaxHours: 24,
      failureWindowHours: 24,
      overloadedProfileRotations: 1,
      overloadedBackoffMs: 0,
      rateLimitedProfileRotations: 1,
    },
  },
}
```

- `billingBackoffHours`: base backoff in hours when a profile fails due to billing/insufficient credits (default: `5`).
- `billingBackoffHoursByProvider`: optional per-provider overrides for billing backoff hours.
- `billingMaxHours`: cap in hours for billing backoff exponential growth (default: `24`).
- `failureWindowHours`: rolling window in hours used for backoff counters (default: `24`).
- `overloadedProfileRotations`: maximum same-provider auth-profile rotations for overloaded errors before switching to model fallback (default: `1`).
- `overloadedBackoffMs`: fixed delay before retrying an overloaded provider/profile rotation (default: `0`).
- `rateLimitedProfileRotations`: maximum same-provider auth-profile rotations for rate-limit errors before switching to model fallback (default: `1`).

---

## Logging

```json5
{
  logging: {
    level: "info",
    file: "/tmp/crawclaw/crawclaw.log",
    consoleLevel: "info",
    consoleStyle: "pretty", // pretty | compact | json
    redactSensitive: "tools", // off | tools
    redactPatterns: ["\\bTOKEN\\b\\s*[=:]\\s*([\"']?)([^\\s\"']+)\\1"],
  },
}
```

- Default log file: `/tmp/crawclaw/crawclaw-YYYY-MM-DD.log`.
- Set `logging.file` for a stable path.
- `consoleLevel` bumps to `debug` when `--verbose`.
- `maxFileBytes`: maximum log file size in bytes before writes are suppressed (positive integer; default: `524288000` = 500 MB). Use external log rotation for production deployments.

---

## Diagnostics

```json5
{
  diagnostics: {
    enabled: true,
    flags: ["feishu.*"],
    stuckSessionWarnMs: 30000,

    otel: {
      enabled: false,
      endpoint: "https://otel-collector.example.com:4318",
      protocol: "http/protobuf", // http/protobuf | grpc
      headers: { "x-tenant-id": "my-org" },
      serviceName: "crawclaw-gateway",
      traces: true,
      metrics: true,
      logs: false,
      sampleRate: 1.0,
      flushIntervalMs: 5000,
    },

    cacheTrace: {
      enabled: false,
      includeMessages: true,
      includePrompt: true,
      includeSystem: true,
    },
  },
}
```

- `enabled`: master toggle for instrumentation output (default: `true`).
- `flags`: array of flag strings enabling targeted log output (supports wildcards like `"feishu.*"` or `"*"`).
- `stuckSessionWarnMs`: age threshold in ms for emitting stuck-session warnings while a session remains in processing state.
- `otel.enabled`: enables the OpenTelemetry export pipeline (default: `false`).
- `otel.endpoint`: collector URL for OTel export.
- `otel.protocol`: `"http/protobuf"` (default) or `"grpc"`.
- `otel.headers`: extra HTTP/gRPC metadata headers sent with OTel export requests.
- `otel.serviceName`: service name for resource attributes.
- `otel.traces` / `otel.metrics` / `otel.logs`: enable trace, metrics, or log export.
- `otel.sampleRate`: trace sampling rate `0`–`1`.
- `otel.flushIntervalMs`: periodic telemetry flush interval in ms.
- `cacheTrace.enabled`: log cache trace snapshots for embedded runs (default: `false`).
- `cacheTrace.includeMessages` / `includePrompt` / `includeSystem`: control what is included in cache trace output (all default: `true`).

---

## Update

```json5
{
  update: {
    channel: "stable", // stable | beta | dev
    checkOnStart: true,

    auto: {
      enabled: false,
      stableDelayHours: 6,
      stableJitterHours: 12,
      betaCheckIntervalHours: 1,
    },
  },
}
```

- `channel`: release channel for npm/git installs — `"stable"`, `"beta"`, or `"dev"`.
- `checkOnStart`: check for npm updates when the gateway starts (default: `true`).
- `auto.enabled`: enable background auto-update for package installs (default: `false`).
- `auto.stableDelayHours`: minimum delay in hours before stable-channel auto-apply (default: `6`; max: `168`).
- `auto.stableJitterHours`: extra stable-channel rollout spread window in hours (default: `12`; max: `168`).
- `auto.betaCheckIntervalHours`: how often beta-channel checks run in hours (default: `1`; max: `24`).

---

## ACP

```json5
{
  acp: {
    enabled: false,
    dispatch: { enabled: true },
    backend: "acpx",
    defaultAgent: "main",
    allowedAgents: ["main", "ops"],
    maxConcurrentSessions: 10,

    stream: {
      coalesceIdleMs: 50,
      maxChunkChars: 1000,
      repeatSuppression: true,
      deliveryMode: "live", // live | final_only
      hiddenBoundarySeparator: "paragraph", // none | space | newline | paragraph
      maxOutputChars: 50000,
      maxSessionUpdateChars: 500,
    },

    runtime: {
      ttlMinutes: 30,
    },
  },
}
```

- `enabled`: global ACP feature gate (default: `false`).
- `dispatch.enabled`: independent gate for ACP session turn dispatch (default: `true`). Set `false` to keep ACP commands available while blocking execution.
- `backend`: default ACP runtime backend id (must match a registered ACP runtime plugin).
- `defaultAgent`: fallback ACP target agent id when spawns do not specify an explicit target.
- `allowedAgents`: allowlist of agent ids permitted for ACP runtime sessions; empty means no additional restriction.
- `maxConcurrentSessions`: maximum concurrently active ACP sessions.
- `stream.coalesceIdleMs`: idle flush window in ms for streamed text.
- `stream.maxChunkChars`: maximum chunk size before splitting streamed block projection.
- `stream.repeatSuppression`: suppress repeated status/tool lines per turn (default: `true`).
- `stream.deliveryMode`: `"live"` streams incrementally; `"final_only"` buffers until turn terminal events.
- `stream.hiddenBoundarySeparator`: separator before visible text after hidden tool events (default: `"paragraph"`).
- `stream.maxOutputChars`: maximum assistant output characters projected per ACP turn.
- `stream.maxSessionUpdateChars`: maximum characters for projected ACP status/update lines.
- `runtime.ttlMinutes`: idle TTL in minutes for ACP session workers before eligible cleanup.

---

## Terminal

```json5
{
  cli: {
    banner: {
      taglineMode: "off", // random | default | off
    },
  },
}
```

- `cli.banner.taglineMode` controls retained terminal banner tagline style:
  - `"random"` (default): rotating funny/seasonal taglines.
  - `"default"`: fixed neutral tagline (`All your chats, one CrawClaw.`).
  - `"off"`: no tagline text (banner title/version still shown).
- To hide the entire banner (not just taglines), set env `CRAWCLAW_HIDE_BANNER=1`.

---

## Identity

See `agents.list` identity fields under [Agent defaults](#agent-defaults).

---

## Bridge (legacy, removed)

Current builds no longer include the TCP bridge. `bridge.*` keys are no longer part of the config schema (validation fails until removed; CrawClaw Desktop or the local Gateway API can strip unknown keys).

<Accordion title="Legacy bridge config (historical reference)">

```json
{
  "bridge": {
    "enabled": true,
    "port": 18790,
    "bind": "tailnet",
    "tls": {
      "enabled": true,
      "autoGenerate": true
    }
  }
}
```

</Accordion>

---

## Cron

```json5
{
  cron: {
    enabled: true,
    maxConcurrentRuns: 2,
    webhook: "https://example.invalid/legacy", // deprecated fallback for stored notify:true jobs
    webhookToken: "replace-with-dedicated-token", // optional bearer token for outbound webhook auth
    sessionRetention: "24h", // duration string or false
    runLog: {
      maxBytes: "2mb", // default 2_000_000 bytes
      keepLines: 2000, // default 2000
    },
  },
}
```

- `sessionRetention`: how long to keep completed isolated cron run sessions before pruning from `sessions.json`. Also controls cleanup of archived deleted cron transcripts. Default: `24h`; set `false` to disable.
- `runLog.maxBytes`: max size per run log file (`cron/runs/<jobId>.jsonl`) before pruning. Default: `2_000_000` bytes.
- `runLog.keepLines`: newest lines retained when run-log pruning is triggered. Default: `2000`.
- `webhookToken`: bearer token used for cron webhook POST delivery (`delivery.mode = "webhook"`), if omitted no auth header is sent.
- `webhook`: deprecated legacy fallback webhook URL (http/https) used only for stored jobs that still have `notify: true`.

### `cron.retry`

```json5
{
  cron: {
    retry: {
      maxAttempts: 3,
      backoffMs: [30000, 60000, 300000],
      retryOn: ["rate_limit", "overloaded", "network", "timeout", "server_error"],
    },
  },
}
```

- `maxAttempts`: maximum retries for one-shot jobs on transient errors (default: `3`; range: `0`–`10`).
- `backoffMs`: array of backoff delays in ms for each retry attempt (default: `[30000, 60000, 300000]`; 1–10 entries).
- `retryOn`: error types that trigger retries — `"rate_limit"`, `"overloaded"`, `"network"`, `"timeout"`, `"server_error"`. Omit to retry all transient types.

Applies only to one-shot cron jobs. Recurring jobs use separate failure handling.

### `cron.failureAlert`

```json5
{
  cron: {
    failureAlert: {
      enabled: false,
      after: 3,
      cooldownMs: 3600000,
      mode: "announce",
      accountId: "main",
    },
  },
}
```

- `enabled`: enable failure alerts for cron jobs (default: `false`).
- `after`: consecutive failures before an alert fires (positive integer, min: `1`).
- `cooldownMs`: minimum milliseconds between repeated alerts for the same job (non-negative integer).
- `mode`: delivery mode — `"announce"` sends via a channel message; `"webhook"` posts to the configured webhook.
- `accountId`: optional account or channel id to scope alert delivery.

See [Cron Jobs](/automation/cron-jobs). Isolated cron executions are tracked as [background tasks](/automation/tasks).

---

## Media model template variables

Template placeholders expanded in `tools.media.models[].args`:

| Variable           | Description                                 |
| ------------------ | ------------------------------------------- |
| `{{Body}}`         | Full inbound message body                   |
| `{{RawBody}}`      | Raw body (no history/sender wrappers)       |
| `{{BodyStripped}}` | Body with group mentions stripped           |
| `{{From}}`         | Sender identifier                           |
| `{{To}}`           | Destination identifier                      |
| `{{MessageSid}}`   | Channel message id                          |
| `{{SessionId}}`    | Current session UUID                        |
| `{{IsNewSession}}` | `"true"` when new session created           |
| `{{MediaUrl}}`     | Inbound media pseudo-URL                    |
| `{{MediaPath}}`    | Local media path                            |
| `{{MediaType}}`    | Media type (image/audio/document/…)         |
| `{{Transcript}}`   | Audio transcript                            |
| `{{Prompt}}`       | Resolved media prompt for CLI entries       |
| `{{MaxChars}}`     | Resolved max output chars for CLI entries   |
| `{{ChatType}}`     | `"direct"` or `"group"`                     |
| `{{GroupSubject}}` | Group subject (best effort)                 |
| `{{GroupMembers}}` | Group members preview (best effort)         |
| `{{SenderName}}`   | Sender display name (best effort)           |
| `{{SenderE164}}`   | Sender phone number (best effort)           |
| `{{Provider}}`     | Provider hint (weixin, feishu, qqbot, etc.) |

---

## Config includes (`$include`)

Split config into multiple files:

```json5
// ~/.crawclaw/crawclaw.json
{
  gateway: { port: 18789 },
  agents: { $include: "./agents.json5" },
  broadcast: {
    $include: ["./clients/mueller.json5", "./clients/schmidt.json5"],
  },
}
```

**Merge behavior:**

- Single file: replaces the containing object.
- Array of files: deep-merged in order (later overrides earlier).
- Sibling keys: merged after includes (override included values).
- Nested includes: up to 10 levels deep.
- Paths: resolved relative to the including file, but must stay inside the top-level config directory (`dirname` of `crawclaw.json`). Absolute/`../` forms are allowed only when they still resolve inside that boundary.
- Errors: clear messages for missing files, parse errors, and circular includes.

---

_Related: [Configuration](/gateway/configuration) · [Configuration Examples](/gateway/configuration-examples) · [Doctor](/gateway/doctor)_
