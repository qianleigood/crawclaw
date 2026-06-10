---
summary: "将 ESP32-S3-BOX-3 作为 CrawClaw desktop voice assistant 运行"
read_when:
  - 配对或刷写 ESP32-S3-BOX-3 assistant
  - 调试 CrawClaw ESP32 MQTT 和 UDP voice traffic
title: "ESP32 Desktop Assistant"
x-i18n:
  generated_at: "2026-06-10T12:15:35Z"
  model: codex
  provider: openai
  source_hash: f56c71bf0504c9076f9cf230cff40acc71d12975b0d16a25823595d40e1b96fa
  source_path: gateway/esp32-desktop-assistant.md
  workflow: 15
---

# ESP32 desktop assistant

CrawClaw 可以使用 ESP32-S3-BOX-3 作为 first-party desktop voice assistant。设备负责 wake word detection、button input、microphone capture、display state 和 speaker playback。desktop Gateway 负责 pairing、agent selection、model calls、tool approval、STT、TTS 和 execution results。

V1 firmware wrapper 位于 `firmware/esp32-assistant`，并 pin `78/xiaozhi-esp32` 到 `v2.2.6`。tracked CrawClaw files 只包含 ESP32-S3-BOX-3 profile 和 helper scripts。upstream firmware checkout 保持在本地 `firmware/esp32-assistant/upstream` 下。

## Transport

刷写后，assistant 使用 Wi-Fi：

- MQTT control topics:
  `crawclaw/esp32/{deviceId}/hello`,
  `crawclaw/esp32/{deviceId}/event`,
  `crawclaw/esp32/{deviceId}/state`,
  `crawclaw/esp32/{deviceId}/command`
- 带 Opus payloads 的 UDP audio frames
- Gateway OTA 和 config endpoint: `/api/esp32/ota`

Pairing tokens 和 device credentials 保持本地。Public status 和 logs 不能包含 raw tokens。

## Gateway config

启用 ESP32 plugin，并暴露 board 可以访问的 LAN address：

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

在 firmware local override 中使用同一个 LAN host：

```ini
CONFIG_OTA_URL="http://<gateway-lan-ip>:18789/api/esp32/ota"
```

不要把设备指向 `127.0.0.1`；在 ESP32 上，这表示 board 自己。

## Build and flash

针对 pinned XiaoZhi `v2.2.6` baseline 使用 ESP-IDF 5.5.2。ESP-IDF 6.0.x 不满足 upstream component constraints。

```bash
cp firmware/esp32-assistant/profiles/esp-box-3/sdkconfig.local.example \
  firmware/esp32-assistant/profiles/esp-box-3/sdkconfig.local

firmware/esp32-assistant/scripts/build.sh
firmware/esp32-assistant/scripts/flash.sh /dev/cu.usbmodem1301
```

脚本会运行 `idf.py set-target esp32s3`，并使用 CrawClaw ESP32-S3-BOX-3 profile 构建 pinned XiaoZhi firmware。

## Pairing and agent selection

Desktop device management surface 使用现有 ESP32 Gateway RPCs：

- `esp32.status.get`
- `esp32.pairing.start`
- `esp32.pairing.request.approve`
- `esp32.pairing.request.reject`
- `esp32.devices.list`
- `esp32.devices.get`
- `esp32.devices.revoke`
- `esp32.devices.command.send`

要为单个 device 切换 active agent，发送带有 `params.agentId` 的 `agent.switch`。Gateway 会为该 device 存储 `activeAgentId`，并把后续 ESP32 utterances 发送给该 agent。Tool approval 仍继承自选中的 agent；pairing 只识别是谁在说话。

## Validation

在处理这个 surface 时使用 scoped Gateway test：

```bash
cargo test -p crawclaw-gateway esp32
```

在 landing Gateway、desktop 或 firmware build-boundary changes 之前，运行标准 repo gates：

```bash
pnpm check
pnpm test
pnpm build
```

Hardware validation 应证明 USB-free loop：按下或唤醒设备，说话，收到 CrawClaw agent reply，显示答案，并通过 ESP32 speaker 播放音频。
