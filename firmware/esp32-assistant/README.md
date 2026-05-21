---
summary: "Pinned XiaoZhi firmware wrapper for the CrawClaw ESP32-S3-BOX-3 desktop assistant"
---

# CrawClaw ESP32 assistant firmware

This directory wraps the ESP32-S3-BOX-3 support from `78/xiaozhi-esp32` and pins
the upstream source instead of vendoring a full firmware tree into the CrawClaw
repo.

V1 target:

- Board: ESP32-S3-BOX-3
- Upstream firmware base: `78/xiaozhi-esp32` `v2.2.6`
- Transport: Wi-Fi MQTT plus UDP audio
- Gateway OTA/config endpoint: `/api/esp32/ota`
- Device responsibilities: wake word, button press, microphone capture, display
  state, and speaker playback
- CrawClaw Gateway responsibilities: pairing, active agent routing, STT/TTS,
  model calls, tool approval, and response rendering

## Configure

Create a local SDK config override with the LAN address of the CrawClaw desktop
Gateway:

```bash
cp profiles/esp-box-3/sdkconfig.local.example profiles/esp-box-3/sdkconfig.local
```

Edit `profiles/esp-box-3/sdkconfig.local` and replace `<gateway-lan-ip>` with
the IP address reachable from the ESP32:

```ini
CONFIG_OTA_URL="http://<gateway-lan-ip>:18789/api/esp32/ota"
```

Do not use `127.0.0.1` for the device. On the ESP32 that points back to the
board itself, not the Mac.

## Build

Use ESP-IDF 5.5.2 for the pinned XiaoZhi `v2.2.6` baseline. ESP-IDF 6.0.x
does not satisfy the upstream component constraints.

With ESP-IDF in your shell:

```bash
firmware/esp32-assistant/scripts/build.sh
```

The build script fetches the pinned upstream into
`firmware/esp32-assistant/upstream/xiaozhi-esp32`, sets `esp32s3`, and builds
with the ESP32-S3-BOX-3 profile.

## Flash

```bash
firmware/esp32-assistant/scripts/flash.sh /dev/cu.usbmodem1301
```

USB is only needed for flashing and serial logs. After flashing, use Wi-Fi for
pairing and assistant traffic.

## Local files

- `profiles/esp-box-3/sdkconfig.defaults` keeps tracked CrawClaw defaults.
- `profiles/esp-box-3/sdkconfig.local` is ignored and should hold host-specific
  Wi-Fi or Gateway URL overrides.
- `upstream/` is ignored so the repo only stores the pinned wrapper and profile.
