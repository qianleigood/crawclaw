---
summary: "Run an ESP32-S3-BOX-3 as a CrawClaw desktop voice assistant"
read_when:
  - Pairing or flashing an ESP32-S3-BOX-3 assistant
  - Debugging CrawClaw ESP32 MQTT and UDP voice traffic
title: "ESP32 Desktop Assistant"
---

# ESP32 desktop assistant

CrawClaw can use an ESP32-S3-BOX-3 as a first-party desktop voice assistant.
The device owns wake word detection, button input, microphone capture, display
state, and speaker playback. The desktop Gateway owns pairing, agent selection,
model calls, tool approval, STT, TTS, and execution results.

The V1 firmware wrapper lives in `firmware/esp32-assistant` and pins
`78/xiaozhi-esp32` at `v2.2.6`. The tracked CrawClaw files only contain the
ESP32-S3-BOX-3 profile and helper scripts. The upstream firmware checkout stays
local under `firmware/esp32-assistant/upstream`.

## Transport

The assistant uses Wi-Fi after flashing:

- MQTT control topics:
  `crawclaw/esp32/{deviceId}/hello`,
  `crawclaw/esp32/{deviceId}/event`,
  `crawclaw/esp32/{deviceId}/state`,
  `crawclaw/esp32/{deviceId}/command`
- UDP audio frames with Opus payloads
- Gateway OTA and config endpoint: `/api/esp32/ota`

Pairing tokens and device credentials stay local. Public status and logs must
not include raw tokens.

## Gateway config

Enable the ESP32 plugin and expose a LAN address that the board can reach:

```json
{
  "plugins": {
    "entries": {
      "esp32": {
        "enabled": true,
        "config": {
          "broker": {
            "mode": "managed",
            "bindHost": "0.0.0.0",
            "port": 1883,
            "advertisedHost": "<gateway-lan-ip>"
          },
          "udp": {
            "bindHost": "0.0.0.0",
            "port": 1884,
            "advertisedHost": "<gateway-lan-ip>"
          }
        }
      }
    }
  }
}
```

Use the same LAN host in the firmware local override:

```ini
CONFIG_OTA_URL="http://<gateway-lan-ip>:18789/api/esp32/ota"
```

Do not point the device at `127.0.0.1`; on the ESP32 that means the board
itself.

## Build and flash

Use ESP-IDF 5.5.2 for the pinned XiaoZhi `v2.2.6` baseline. ESP-IDF 6.0.x
does not satisfy the upstream component constraints.

```bash
cp firmware/esp32-assistant/profiles/esp-box-3/sdkconfig.local.example \
  firmware/esp32-assistant/profiles/esp-box-3/sdkconfig.local

firmware/esp32-assistant/scripts/build.sh
firmware/esp32-assistant/scripts/flash.sh /dev/cu.usbmodem1301
```

The script runs `idf.py set-target esp32s3` and builds the pinned XiaoZhi
firmware with the CrawClaw ESP32-S3-BOX-3 profile.

## Pairing and agent selection

The desktop device management surface uses the existing ESP32 Gateway RPCs:

- `esp32.status.get`
- `esp32.pairing.start`
- `esp32.pairing.request.approve`
- `esp32.pairing.request.reject`
- `esp32.devices.list`
- `esp32.devices.get`
- `esp32.devices.revoke`
- `esp32.devices.command.send`

To switch the active agent for one device, send `agent.switch` with
`params.agentId`. The Gateway stores `activeAgentId` for that device and sends
subsequent ESP32 utterances through that agent. Tool approval remains inherited
from the selected agent; pairing only identifies who is speaking.

## Validation

Use the scoped Gateway test while working on this surface:

```bash
cargo test -p crawclaw-gateway esp32
```

Before landing Gateway, desktop, or firmware build-boundary changes, run the
normal repo gates:

```bash
pnpm check
pnpm test
pnpm build
```

Hardware validation should prove the USB-free loop: press or wake the device,
speak, receive a CrawClaw agent reply, display the answer, and play audio over
the ESP32 speaker.
