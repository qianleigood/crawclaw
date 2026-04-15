# Qwen3-TTS Apple Silicon 备注

## 目录

- 默认模型
- 当前确认状态
- 实测数据
- 内置 speaker
- 语音克隆说明
- `af_heart` 排查结论
- 已知 warning

## 默认模型

- `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit`
- `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit`
- `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit`

## 当前确认状态

- Apple Silicon + MLX + `mlx_audio` 可跑通
- `0.6B-CustomVoice`：普通中文合成可用
- `0.6B-Base`：参考音频克隆可用
- `1.7B-VoiceDesign-4bit`：文字描述设计音色可用
- `bash scripts/setup_env.sh` 可在 Python 3.12 下成功创建 `.venv` 并安装依赖
- 模型与输出放在 skill 目录外缓存，避免打包进 skill

## 实测数据

### 0.6B-CustomVoice 首轮验证

- 条件：中文 instruction + `speaker=serena`
- 输出时长：7.68s
- 处理时间：6.72s
- 实时因子：1.14x
- 峰值内存：5.53GB

### 0.6B-CustomVoice 2026-03-22 回归

命令：

```bash
python scripts/qwen3_tts.py synth \
  --text '今天先做一次本地 Qwen3 TTS 技能回归测试。' \
  --speaker serena \
  --instruction '用自然、清晰、平稳的中文女声朗读。' \
  --output-name regression-20260322
```

结果：

- 输出文件：`~/.cache/crawclaw/qwen3-tts-apple-silicon/outputs/regression-20260322/audio_000.wav`
- 输出时长：4.56s
- 处理时间：1.82s
- 实时因子：2.51x
- 峰值内存：5.00GB

### 0.6B-Base / clone 2026-03-22 回归

命令：

```bash
python scripts/qwen3_tts.py clone \
  --text '这条语音用于验证参考音频克隆链路是否可用。' \
  --ref-audio ~/.cache/crawclaw/qwen3-tts-apple-silicon/outputs/regression-20260322/audio_000.wav \
  --ref-text '今天先做一次本地 Qwen3 TTS 技能回归测试。' \
  --output-name clone-regression-20260322
```

结果：

- 输出文件：`~/.cache/crawclaw/qwen3-tts-apple-silicon/outputs/clone-regression-20260322/audio_000.wav`
- 输出时长：4.48s
- 处理时间：3.21s
- 实时因子：1.40x
- 峰值内存：6.23GB
- 命令总耗时（脚本统计）：39.45s

### 1.7B-VoiceDesign-4bit 2026-03-22 首次验证

命令：

```bash
python scripts/qwen3_tts.py voice-design \
  --text '今天测试一下音色设计能力。' \
  --instruction '一个自然、温和、清晰的中文女声，成熟一些，语速平稳，适合讲解和说明。' \
  --output-name voice-design-20260322 \
  --file-prefix designed
```

结果：

- 首次运行先下载 14 个模型文件
- 输出文件：`~/.cache/crawclaw/qwen3-tts-apple-silicon/outputs/voice-design-20260322/designed_000.wav`
- 模型加载时间：1.04s
- 生成耗时（脚本统计）：0.96s
- 功能验证：通过

## 内置 speaker

- `serena`
- `vivian`
- `uncle_fu`
- `ryan`
- `aiden`
- `ono_anna`
- `sohee`
- `eric`
- `dylan`

## 语音克隆说明

- `clone` 默认使用 Base 模型
- 参考音频优先 5-10 秒、干净、无背景音乐、单人说话
- `ref_text` 尽量提供准确转写，不要省略
- 如果参考音频不是 wav，先尝试直接交给底层；不稳定时再先转 wav

## `af_heart` 排查结论

已确认早前 `clone` 日志里的 `Voice: af_heart` 来自：

- `mlx_audio.tts.generate.generate_audio()` 的默认参数 `voice='af_heart'`
- 该包装层会无条件打印 `Voice: {voice}`

但对 Qwen3 Base 的参考音频克隆，真实路径是：

- `model.generate(text=..., ref_audio=..., ref_text=...)`
- 当 `tts_model_type == "base"` 且同时提供 `ref_audio + ref_text` 时，走 ICL 分支 `_generate_icl(...)`
- 该分支不使用 speaker，因此 `af_heart` 不是实际生效音色，只是误导性日志

当前技能脚本已将 `clone` 改为直接调用底层 `model.generate(...)`，不再经过这层包装。

## 已知 warning

当前运行会见到以下 warning，但本轮实测均不阻塞生成：

- tokenizer regex warning（提示 `fix_mistral_regex=True`）
- model type warning（`qwen3_tts` checkpoint/model type 提示）

后续若要把这条链路作为更稳定的长期主线，可继续评估：

- 是否能在上游加载参数里显式修正 tokenizer regex
- 是否需要固定 `mlx-audio` 提交版本，避免未来日志或行为漂移
