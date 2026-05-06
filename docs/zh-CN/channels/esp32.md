---
read_when:
  - 设置 ESP32-S3-BOX-3 桌面助手
  - 调试 ESP32 MQTT 或 UDP 配对
summary: ESP32-S3-BOX-3 MQTT 与 UDP 桌面助手设置
title: ESP32
x-i18n:
  generated_at: "2026-05-06T12:28:01Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 35d580ac2dc8525c3ba7d7ec0d8d955fe260e00910322bae75006df7b33e0570
  source_path: channels/esp32.md
  workflow: 15
---

# ESP32

状态：针对 ESP32-S3-BOX-3 桌面助手的实验性捆绑插件。使用 CLI 或渠道前，需启用 `plugins.entries.esp32.enabled: true`。

ESP32 渠道使用小智兼容的分流传输：

- MQTT 作为控制平面，用于配对、设备状态、短显示文本、表情状态和设备工具。
- UDP 作为音频平面，用于加密的 Opus 帧。
- ESP32 仅连接 CrawClaw。CrawClaw 拥有主智能体、渲染模型、Qwen-TTS、权限和配对。

## 硬件目标

v1 目标为 **ESP32-S3-BOX-3**。其他 ESP32-S3 板卡可共用部分协议，但捆绑渠道假设为 BOX-3 级别的显示器、麦克风、扬声器、按钮和 PSRAM。

## 最小配置

启用插件并使用托管 MQTT broker：

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

`advertisedHost` 应可从同一局域网或 tailnet 上的 ESP32-S3-BOX-3 访问。除非固件在相同主机上运行，否则不要使用 `localhost`。

## 配对

启用 `plugins.entries.esp32.enabled: true` 后，启动一个短期配对会话：

```bash
crawclaw esp32 pair start --name desk
```

命令输出：

- MQTT 主机和端口
- MQTT 用户名，格式为 `pair:<id>`
- 一次性配对码
- 过期时间

在 ESP32-S3-BOX-3 设置页面，输入 CrawClaw 主机、MQTT 端口、MQTT 用户名和配对码。设备通过配对 MQTT 主题提交其设备 ID、指纹、能力、显示/音频支持和工具列表。

批准待处理设备请求：

```bash
crawclaw devices approve <requestId>
```

批准后，CrawClaw 通过临时配对主题发回每设备 MQTT 凭证和 UDP 会话参数。固件将其存储在 NVS 中。如果设备被吊销，旧 MQTT 令牌将被拒绝，设备必须重新配对。

## 回复渲染

主智能体仍会将完整答案写入 CrawClaw 会话。ESP32 渠道渲染单独的简短设备回复：

- `spokenText`：发送到 Qwen-TTS 并在设备上播放的简短文本。
- `displayText`：在 BOX-3 显示屏上显示的简短文本。
- `affect`：通过 MQTT 发送的结构化表情状态。

渲染器模型通过 `renderer.model` 独立配置。它在无工具且超时时限较短的情况下运行。如果失败或返回无效 JSON，CrawClaw 将回退到确定性压缩。

算法硬门控始终会在任何内容到达 ESP32 语音路径之前剥离代码块、日志、JSON、本地路径和长列表。

## 表情状态

CrawClaw 将表情作为结构化 MQTT 数据发送，而不是让固件从文本推断情绪。支持的状态包括：

`neutral`、`listening`、`thinking`、`speaking`、`success`、`apologetic`、`concerned`、`confirming`、`error`、`muted`、`offline`。

设备在配对或 `hello` 期间报告支持的表达、LED 和提示音 ID。CrawClaw 应仅发送设备声明的 ID。

## TTS

渠道使用渠道 ID `esp32` 请求 TTS，因此 speech-core 选择 `voice-note` 目标并首先向 `qwen3-tts` 请求 Opus。如果提供商返回非 Opus 格式，CrawClaw 会在 UDP 传输之前将其转码为 Opus。

## 设备工具

ESP32 通过 MQTT 暴露 MCP 风格的设备工具：

- `tools/list` 报告工具名称和风险级别。
- `tools/call` 由 CrawClaw 发送到设备。
- `tools/result` 返回结果。

面向智能体的工具为 `esp32_call_tool(deviceId, toolName, args)`。默认情况下，低风险工具系列被列入白名单：

- display
- LED
- audio
- volume 和 mute
- sensor reads

GPIO、继电器、舵机和门锁等高风险工具系列会被拒绝，除非未来明确允许审批路径。

## 协议说明

默认 MQTT 主题使用 `crawclaw/esp32` 前缀：

- `crawclaw/esp32/pair/<pairId>/hello`
- `crawclaw/esp32/pair/<pairId>/wait`
- `crawclaw/esp32/pair/<pairId>/status`
- `crawclaw/esp32/devices/<deviceId>/hello`
- `crawclaw/esp32/devices/<deviceId>/input/text`
- `crawclaw/esp32/devices/<deviceId>/tools/list`
- `crawclaw/esp32/devices/<deviceId>/tools/result`
- `crawclaw/esp32/devices/<deviceId>/command`

UDP 音频帧使用每设备会话密钥和每帧随机数进行 AES-CTR 加密。

## 故障排除

- 如果配对始终不出现，确认 ESP32 可访问 `advertisedHost:broker.port`。
- 如果批准成功但设备无法重连，吊销并重新配对以轮换凭证。
- 如果文本显示但音频静音，确认 Qwen-TTS 已配置且 `ffmpeg` 已安装用于非 Opus 回退转换。
- 如果设备工具失败，检查 `tools.allowlist` 和设备报告的风险级别。
