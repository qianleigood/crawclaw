---
summary: "Text-to-speech (TTS) for outbound replies"
read_when:
  - Enabling text-to-speech for replies
  - Configuring TTS providers or limits
  - Using /tts commands
title: "Text-to-Speech"
---

# Text-to-speech (TTS)

CrawClaw can convert outbound replies into audio using a local Qwen3-TTS sidecar.
It works anywhere CrawClaw can send audio.

## Supported provider

- **Qwen3-TTS**: local sidecar for Qwen3-TTS runtimes

### Qwen3-TTS local notes

The bundled Qwen3-TTS speech provider targets a local sidecar contract:

- `POST /synthesize`
- `POST /synthesize-telephony`

You explicitly enable it with `messages.tts.providers.qwen3-tts.enabled: true`,
then either point it at a local runtime wrapper or let CrawClaw launch a local
loopback sidecar. Platform defaults are:

- macOS Apple Silicon: `mlx-audio` at `http://127.0.0.1:8011`
- Linux, Windows, and non-Apple-Silicon macOS: `qwen-tts` at `http://127.0.0.1:8013`
- Explicit high-throughput Linux runtime: `vllm-omni` at `http://127.0.0.1:8010`
- Explicit Windows native runtime: `qwen3-tts.cpp` at `http://127.0.0.1:8012` (experimental)

Because `isConfigured()` is synchronous, Qwen3-TTS stays disabled until you
explicitly turn it on in config. That prevents auto-select from hijacking TTS
for users who have not started a local runtime yet.

If you want CrawClaw to start a loopback sidecar automatically, set
`providers.qwen3-tts.autoStart: true`. CrawClaw ships two bundled sidecars and
uses the managed venv at `~/.crawclaw/runtimes/qwen3-tts/venv` when you do not
provide an explicit launch command:

- macOS Apple Silicon uses the MLX sidecar and pinned `mlx-audio` packages.
- Linux, Windows, and non-Apple-Silicon macOS use the official `qwen-tts`
  Python package sidecar.

The managed runtime is installed during postinstall and can be repaired with
CrawClaw Desktop or the local Gateway API or CrawClaw Desktop or the local Gateway API. Explicit
`vllm-omni` and `qwen3-tts.cpp` runtimes still require an explicit
`launchCommand`. CrawClaw probes `baseUrl + healthPath`, verifies the managed
runtime imports before spawning the bundled sidecar, then waits for the health
check to turn green before sending TTS requests. The bundled sidecars download
the requested model on first synthesis if it is not already cached locally, so
the first request can be noticeably slower.

## Service links

- [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)
- [vLLM-Omni Qwen3-TTS serving](https://docs.vllm.ai/projects/vllm-omni/en/latest/user_guide/examples/online_serving/qwen3_tts/)

## Is it enabled by default?

No. Auto‑TTS is **off** by default. Enable it in config with
`messages.tts.auto` or per session with `/tts always` (alias: `/tts on`).

When `messages.tts.provider` is unset, CrawClaw picks the first configured
speech provider in registry auto-select order.

## Config

TTS config lives under `messages.tts` in `crawclaw.json`.
Full schema is in [Gateway configuration](/gateway/configuration).

### Minimal config (enable + provider)

```json5
{
  messages: {
    tts: {
      auto: "always",
      provider: "qwen3-tts",
      providers: {
        "qwen3-tts": {
          enabled: true,
          runtime: "auto",
          autoStart: true,
        },
      },
    },
  },
}
```

### Custom limits + prefs path

```json5
{
  messages: {
    tts: {
      auto: "always",
      maxTextLength: 4000,
      timeoutMs: 30000,
      prefsPath: "~/.crawclaw/settings/tts.json",
    },
  },
}
```

### Local Qwen3-TTS primary

```json5
{
  messages: {
    tts: {
      auto: "always",
      provider: "qwen3-tts",
      providers: {
        "qwen3-tts": {
          enabled: true,
          runtime: "auto",
          autoStart: true,
          defaultProfile: "assistant",
          profiles: {
            assistant: {
              source: "preset",
              quality: "balanced",
              voice: "vivian",
              language: "Auto",
              instructions: "natural, warm, expressive",
            },
          },
        },
      },
    },
  },
}
```

### Local Qwen3-TTS clone profile

```json5
{
  messages: {
    tts: {
      provider: "qwen3-tts",
      providers: {
        "qwen3-tts": {
          enabled: true,
          voiceDirectory: "~/.crawclaw/voices",
          defaultProfile: "owner",
          profiles: {
            owner: {
              source: "clone",
              quality: "clone",
              refAudio: "~/.crawclaw/voices/owner.wav",
              refText: "Reference transcript for the cloning sample.",
              language: "en",
            },
          },
        },
      },
    },
  },
}
```

### Only reply with audio after an inbound voice message

```json5
{
  messages: {
    tts: {
      auto: "inbound",
    },
  },
}
```

### Disable auto-summary for long replies

```json5
{
  messages: {
    tts: {
      auto: "always",
    },
  },
}
```

Then run:

```
/tts summary off
```

### Notes on fields

- `auto`: auto‑TTS mode (`off`, `always`, `inbound`, `tagged`).
  - `inbound` only sends audio after an inbound voice message.
  - `tagged` only sends audio when the reply includes `[[tts]]` tags.
- `enabled`: legacy toggle (doctor migrates this to `auto`).
- `mode`: `"final"` (default) or `"all"` (includes tool/block replies).
- `provider`: speech provider id. The bundled provider is `"qwen3-tts"`.
- If `provider` is **unset**, CrawClaw uses the first configured speech provider in registry auto-select order.
- `summaryModel`: optional cheap model for auto-summary; defaults to `agents.defaults.model.primary`.
  - Accepts `provider/model` or a configured model alias.
- `modelOverrides`: allow the model to emit TTS directives (on by default).
  - `allowProvider` defaults to `false` (provider switching is opt-in).
- `providers.<id>`: provider-owned settings keyed by speech provider id.
- `providers.qwen3-tts.enabled`: explicit enable switch for the local provider. Default `false`.
- `providers.qwen3-tts.runtime`: `auto`, `qwen-tts`, `vllm-omni`, `mlx-audio`, `qwen3-tts.cpp`, or `cpu`.
- `providers.qwen3-tts.baseUrl`: local sidecar base URL. Defaults by runtime/platform.
- `providers.qwen3-tts.experimental`: allow experimental Windows native or CPU-only runtimes.
- `providers.qwen3-tts.autoStart`: when `true`, probe a loopback sidecar and start it if needed. CrawClaw uses a bundled sidecar and the managed `qwen3-tts` venv automatically for `mlx-audio`, `qwen-tts`, and `cpu` runtimes when no explicit launch command is configured.
- `providers.qwen3-tts.startupTimeoutMs`: sidecar readiness timeout in milliseconds. Default `30000`.
- `providers.qwen3-tts.healthPath`: health probe path appended to `baseUrl`. Default `/health`.
- `providers.qwen3-tts.launchCommand`: command to spawn when `autoStart` is enabled and the local sidecar is down.
- `providers.qwen3-tts.launchArgs`: optional argument array passed to `launchCommand`.
- `providers.qwen3-tts.launchCwd`: optional working directory for the spawned sidecar command.
- `providers.qwen3-tts.defaultProfile`: default local profile id.
- `providers.qwen3-tts.voiceDirectory`: allowlist root for clone reference audio. Default `~/.crawclaw/voices`.
- `providers.qwen3-tts.profiles.<id>`:
  `source: "preset"` uses built-in voices such as `vivian`, `serena`, or `ryan`.
  `source: "clone"` uses `refAudio` + `refText` and enforces the `voiceDirectory` allowlist.
  `source: "design"` uses a text `prompt` to create a voice in the local runtime wrapper.
- `maxTextLength`: hard cap for TTS input (chars). `/tts audio` fails if exceeded.
- `timeoutMs`: request timeout (ms).
- `prefsPath`: override the local prefs JSON path (provider/limit/summary).

## Model-driven overrides (default on)

By default, the model **can** emit TTS directives for a single reply.
When `messages.tts.auto` is `tagged`, these directives are required to trigger audio.

When enabled, the model can emit `[[tts:...]]` directives to override the voice
for a single reply, plus an optional `[[tts:text]]...[[/tts:text]]` block to
provide expressive tags (laughter, singing cues, etc) that should only appear in
the audio.

`provider=...` directives are ignored unless `modelOverrides.allowProvider: true`.

Example reply payload:

```
Here you go.

[[tts:qwen_voice=vivian qwen_language=en]]
[[tts:text]]Read the status update in a warm assistant voice.[[/tts:text]]
```

Available directive keys (when enabled):

- `provider` (registered speech provider id; requires `allowProvider: true`)
- `voice` or `qwen_voice`
- `model` or `qwen_model`
- `language` or `qwen_language`
- `instructions` or `qwen_instructions`
- `profile` or `qwen_profile`

Disable all model overrides:

```json5
{
  messages: {
    tts: {
      modelOverrides: {
        enabled: false,
      },
    },
  },
}
```

Optional allowlist (enable provider switching while keeping other knobs configurable):

```json5
{
  messages: {
    tts: {
      modelOverrides: {
        enabled: true,
        allowProvider: true,
        allowSeed: false,
      },
    },
  },
}
```

## Per-user preferences

Slash commands write local overrides to `prefsPath` (default:
`~/.crawclaw/settings/tts.json`, override with `CRAWCLAW_TTS_PREFS` or
`messages.tts.prefsPath`).

Stored fields:

- `enabled`
- `provider`
- `maxLength` (summary threshold; default 1500 chars)
- `summarize` (default `true`)

These override `messages.tts.*` for that host.

## Output formats (fixed)

- **Feishu / Matrix / Telegram / WhatsApp**: Opus voice message (`opus` from Qwen3-TTS).
  - 48kHz / 64kbps is a good voice message tradeoff.
- **Other channels**: WAV from the local Qwen3-TTS sidecar.

## Auto-TTS behavior

When enabled, CrawClaw:

- skips TTS if the reply already contains media or a `MEDIA:` directive.
- skips very short replies (< 10 chars).
- summarizes long replies when enabled using `agents.defaults.model.primary` (or `summaryModel`).
- attaches the generated audio to the reply.

If the reply exceeds `maxLength` and summary is off (or the summary model is
unavailable), audio is skipped and the normal text reply is sent.

## Flow diagram

```
Reply -> TTS enabled?
  no  -> send text
  yes -> has media / MEDIA: / short?
          yes -> send text
          no  -> length > limit?
                   no  -> TTS -> attach audio
                   yes -> summary enabled?
                            no  -> send text
                            yes -> summarize (summaryModel or agents.defaults.model.primary)
                                      -> TTS -> attach audio
```

## Slash command usage

There is a single command: `/tts`.
See [Slash commands](/tools/slash-commands) for enablement details.

Discord note: `/tts` is a built-in Discord command, so CrawClaw registers
`/voice` as the native command there. Text `/tts ...` still works.

```
/tts off
/tts always
/tts inbound
/tts tagged
/tts status
/tts provider qwen3-tts
/tts limit 2000
/tts summary off
/tts audio Hello from CrawClaw
```

Notes:

- Commands require an authorized sender (allowlist/owner rules still apply).
- `commands.text` or native command registration must be enabled.
- `off|always|inbound|tagged` are per‑session toggles (`/tts on` is an alias for `/tts always`).
- `limit` and `summary` are stored in local prefs, not the main config.
- `/tts audio` generates a one-off audio reply (does not toggle TTS on).
- `/tts status` includes fallback visibility for the latest attempt:
  - success fallback: `Fallback: <primary> -> <used>` plus `Attempts: ...`
  - failure: `Error: ...` plus `Attempts: ...`
  - detailed diagnostics: `Attempt details: provider:outcome(reasonCode) latency`

## Agent tool

The `tts` tool converts text to speech and returns an audio attachment for
reply delivery. When the channel is Feishu, Matrix, Telegram, or WhatsApp,
the audio is delivered as a voice message rather than a file attachment.

## Gateway RPC

Gateway methods:

- `tts.status`
- `tts.enable`
- `tts.disable`
- `tts.convert`
- `tts.setProvider`
- `tts.providers`
