---
name: openai-whisper
description: Use when transcribing local audio or video on Apple Silicon without an API key, especially when MLX Whisper should be the default general-purpose local speech-to-text path.
metadata:
  {
    "crawclaw":
      {
        "emoji": "🎙️",
        "os": ["darwin"],
        "arch": ["arm64"],
        "requires": { "bins": ["python3"] },
        "install":
          [
            {
              "id": "brew-python",
              "kind": "brew",
              "formula": "python@3.12",
              "bins": ["python3"],
              "os": ["darwin"],
              "label": "Install Python (brew)",
            },
          ],
      },
  }
---

# MLX Whisper (Apple Silicon)

在 Apple Silicon（如 M2 Pro）上，优先将 `mlx-whisper` 视为默认的通用本地转写方案。

## 当前定位

- 通用主方案：默认本地音频/视频转写入口
- 平台特化：优先适配这台 Apple Silicon Mac
- 非短视频专用封装：如果只是要小红书/短视频链路里的窄场景包装，可再考虑更窄的专用 skill

## 运行方式

推荐通过技能目录下的 `run.sh` 调用：

```bash
./run.sh /path/to/audio-or-video.mp4
./run.sh /path/to/audio.m4a mlx-community/whisper-small
./run.sh /path/to/audio.m4a mlx-community/whisper-turbo --output-format json --output ./result.json
```

默认模型：

- `mlx-community/whisper-turbo`

可选模型：

- `mlx-community/whisper-base`
- `mlx-community/whisper-small`

## 输出

- 默认输出：纯文本（stdout）
- `--output-format txt`：输出纯文本
- `--output-format json`：输出完整 JSON
- `--output /path/file`：写入文件而不是打印到终端

## 文件

- `run.sh`：使用项目安装期准备的 `~/.crawclaw/runtimes/skill-openai-whisper/venv`
  执行转写；可用 `CRAWCLAW_OPENAI_WHISPER_VENV` 覆盖 venv 路径
- `transcribe_mlx.py`：最小 MLX Whisper 调用入口

## 注意事项

- `run.sh` 会先检查 macOS Apple Silicon；其他平台请不要使用这个 skill
- 如果 runtime 缺失，重新运行项目安装，或执行 `crawclaw runtimes repair`
- 首次运行会下载模型到本地缓存，速度取决于网络
- 视频文件可直接输入；底层会处理音频解码
- 推荐默认使用 `whisper-turbo`，在 M2 Pro 上通常速度和效果更均衡
- 如果只是追求更轻量，可以改用 `whisper-base`

## 子代理执行策略

- **默认执行模式**：优先使用子代理独立执行；主会话负责接单、补齐必要上下文、控制范围，并在最后整合结果回报给用户。
- **适合交给子代理的任务**：预计超过 30 秒的处理、多步骤流水线、多文件/多产物生成、批处理、审计、转写、总结、离线分析。
- **主会话保留职责**：只在必要时追问关键缺口、确认边界、挑选最终结果，并把输出改写成面向用户的完成答复。
- **不建议默认交给子代理的情况**：一次性极短任务、需要高频来回确认的对话、强依赖当前聊天即时上下文的动作。
- **回报节点**：默认只保留“已受理 / 已开始 / 已完成 / 已失败”四类关键节点，避免刷屏。
