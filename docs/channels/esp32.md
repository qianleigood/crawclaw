---
summary: "ESP32-S3-BOX-3 MQTT and UDP desktop assistant setup"
read_when:
  - Setting up an ESP32-S3-BOX-3 desktop assistant
  - Debugging ESP32 MQTT or UDP pairing
title: "ESP32"
---

# ESP32

Status: experimental bundled plugin for ESP32-S3-BOX-3 desktop assistants.

The ESP32 channel uses a XiaoZhi-compatible split transport:

- MQTT is the control plane for pairing, device state, short display text, affect state, and device tools.
- UDP is the audio plane for encrypted Opus frames.
- The ESP32 connects only to CrawClaw. CrawClaw owns the main agent, renderer model, Qwen-TTS, permissions, and pairing.

## Hardware target

The v1 target is **ESP32-S3-BOX-3**. Other ESP32-S3 boards can share parts of the protocol, but the bundled channel assumes the BOX-3 class of display, microphone, speaker, buttons, and PSRAM.

## Minimal config

Enable the plugin and use the managed MQTT broker:

```json5
{
  plugins: {
    entries: {
      esp32: {
        enabled: true,
        config: {
          broker: {
            mode: "managed",
            bindHost: "0.0.0.0",
            port: 1883,
            advertisedHost: "gateway-host.local",
          },
          udp: {
            bindHost: "0.0.0.0",
            port: 1884,
            advertisedHost: "gateway-host.local",
          },
          renderer: {
            model: "openai/gpt-5.4-mini",
            timeoutMs: 8000,
            maxSpokenChars: 40,
            maxDisplayChars: 72,
          },
          tts: {
            provider: "qwen3-tts",
            target: "voice-note",
          },
          tools: {
            allowlist: ["display.*", "led.*", "audio.*", "volume.*", "mute.*", "sensor.*"],
            highRiskRequiresApproval: true,
          },
        },
      },
    },
  },
}
```

`advertisedHost` should be reachable from the ESP32-S3-BOX-3 on the same LAN or tailnet. Do not use `localhost` unless the firmware runs on the same host.

## Pairing

Start a short-lived pairing session:

```bash
crawclaw esp32 pair start --name desk
```

The command prints:

- MQTT host and port
- MQTT username in the form `pair:<id>`
- one-time pair code
- expiration time

On the ESP32-S3-BOX-3 setup page, enter the CrawClaw host, MQTT port, MQTT username, and pair code. The device submits its device id, fingerprint, capabilities, display/audio support, and tool list over the pairing MQTT topic.

Approve the pending device request:

```bash
crawclaw devices approve <requestId>
```

After approval, CrawClaw sends per-device MQTT credentials and UDP session parameters back over the temporary pairing topic. The firmware stores them in NVS. If the device is revoked, the old MQTT token is rejected and the device must pair again.

## Reply rendering

The main agent still writes the complete answer into the CrawClaw session. The ESP32 channel renders a separate short device reply:

- `spokenText`: short text sent to Qwen-TTS and played on the device.
- `displayText`: short text shown on the BOX-3 display.
- `affect`: structured expression state sent over MQTT.

The renderer model is configured independently via `renderer.model`. It runs without tools and with a short timeout. If it fails or returns invalid JSON, CrawClaw falls back to deterministic compression.

The algorithmic hard gate always strips code blocks, logs, JSON, local paths, and long lists before anything reaches the ESP32 voice path.

## Affect state

CrawClaw sends affect as structured MQTT data instead of asking firmware to infer emotion from text. Supported states are:

`neutral`, `listening`, `thinking`, `speaking`, `success`, `apologetic`, `concerned`, `confirming`, `error`, `muted`, `offline`.

The device reports supported expression, LED, and chime ids during pairing or `hello`. CrawClaw should only send ids the device declared.

## TTS

The channel requests TTS with channel id `esp32`, so speech-core selects the `voice-note` target and asks `qwen3-tts` for Opus first. If the provider returns a non-Opus format, CrawClaw transcodes it to Opus before UDP delivery.

## Device tools

The ESP32 exposes MCP-style device tools over MQTT:

- `tools/list` reports tool names and risk levels.
- `tools/call` is sent by CrawClaw to the device.
- `tools/result` returns the result.

The agent-facing tool is `esp32_call_tool(deviceId, toolName, args)`. By default, low-risk tool families are allowlisted:

- display
- LED
- audio
- volume and mute
- sensor reads

High-risk tool families such as GPIO, relay, servo, and door locks are rejected unless a future approval path explicitly allows them.

## Protocol notes

Default MQTT topics use the `crawclaw/esp32` prefix:

- `crawclaw/esp32/pair/<pairId>/hello`
- `crawclaw/esp32/pair/<pairId>/wait`
- `crawclaw/esp32/pair/<pairId>/status`
- `crawclaw/esp32/devices/<deviceId>/hello`
- `crawclaw/esp32/devices/<deviceId>/input/text`
- `crawclaw/esp32/devices/<deviceId>/tools/list`
- `crawclaw/esp32/devices/<deviceId>/tools/result`
- `crawclaw/esp32/devices/<deviceId>/command`

UDP audio frames are AES-CTR encrypted with a per-device session key and per-frame nonce.

## Troubleshooting

- If pairing never appears, confirm the ESP32 can reach `advertisedHost:broker.port`.
- If approval succeeds but the device cannot reconnect, revoke and pair again to rotate credentials.
- If text appears but audio is silent, confirm Qwen-TTS is configured and `ffmpeg` is installed for non-Opus fallback conversion.
- If device tools fail, check `tools.allowlist` and the device-reported risk level.
