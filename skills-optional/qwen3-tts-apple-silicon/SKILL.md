---
name: qwen3-tts-apple-silicon
description: Local Qwen3-TTS on Apple Silicon using MLX. Use when generating Chinese speech, testing Qwen3-TTS voices, selecting built-in speakers, applying style instructions, cloning a voice from reference audio, or designing a new voice from text descriptions on this Mac. Best for local/offline TTS, Apple Silicon/MLX validation, prompt-to-speech generation, and reusable dubbing workflows.
---

# Qwen3-TTS Apple Silicon

在这台 Apple Silicon Mac 上，优先通过 `scripts/qwen3_tts.py` 使用本地 Qwen3-TTS。

## 选择哪条链路

- 用 `synth`：已知 speaker + instruction 的普通合成
- 用 `clone`：给参考音频 + 准确转写，做语音克隆
- 用 `voice-design`：只给文字描述，直接设计新音色
- 用 `list-speakers`：查看当前预置 speaker

## 快速开始

```bash
cd /Users/qianleilei/.crawclaw/workspace/skills/qwen3-tts-apple-silicon
bash scripts/setup_env.sh
python scripts/qwen3_tts.py list-speakers
```

普通合成：

```bash
python scripts/qwen3_tts.py synth \
  --text "今天我们先验证一条更稳妥的本地配音方案。" \
  --speaker serena \
  --instruction "用自然、清晰、平稳的中文女声朗读。" \
  --file-prefix demo
```

语音克隆：

```bash
python scripts/qwen3_tts.py clone \
  --text "这是一条用于验证参考音频克隆效果的中文句子。" \
  --ref-audio /absolute/path/to/ref.wav \
  --ref-text "这是一条用于验证参考音频克隆效果的中文句子。" \
  --file-prefix clone_demo
```

音色设计：

```bash
python scripts/qwen3_tts.py voice-design \
  --text "今天测试一下音色设计能力。" \
  --instruction "一个自然、温和、清晰的中文女声，成熟一些，语速平稳，适合讲解和说明。" \
  --file-prefix designed
```

## 默认策略

- `synth` 默认模型：`mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit`
- `clone` 默认模型：`mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit`
- `voice-design` 默认模型：`mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit`
- 默认语言：`zh`
- 默认 speaker：`serena`
- 默认输出目录：`~/.cache/crawclaw/qwen3-tts-apple-silicon/outputs/`
- 先用 0.6B 验证链路；只有需要 VoiceDesign 时再拉起 1.7B

## 注意事项

- 不要依赖 `mlx_audio` 的通用默认参数；对普通合成显式传 `speaker` 与 `lang=zh`
- `clone` 已绕过 `generate_audio()` 包装层，避免误导性的 `Voice: af_heart` 日志
- 参考音频优先 5-10 秒、单人、安静、无混响，且 `ref_text` 尽量准确
- 首次运行可能下载模型；未配置 Hugging Face token 时会更慢
- 命令末尾会输出 JSON，包含 `output_dir` 与 `audio_files`
- 三条主命令都支持 `--file-prefix`

## 资源

- `scripts/setup_env.sh`：创建 `.venv` 并安装依赖
- `scripts/qwen3_tts.py`：统一 CLI，支持 `list-speakers` / `synth` / `clone` / `voice-design`
- `references/notes.md`：实测数据、模型说明、`af_heart` 排查结论、warning 记录
