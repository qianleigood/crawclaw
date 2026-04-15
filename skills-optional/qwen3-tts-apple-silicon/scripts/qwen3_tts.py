#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
CACHE_ROOT = Path(os.environ.get("CRAWCLAW_QWEN3_TTS_HOME", os.path.expanduser("~/.cache/crawclaw/qwen3-tts-apple-silicon")))
MODELS_DIR = CACHE_ROOT / "models"
OUTPUTS_DIR = CACHE_ROOT / "outputs"
DEFAULT_SYNTH_MODEL = "Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit"
DEFAULT_CLONE_MODEL = "Qwen3-TTS-12Hz-0.6B-Base-8bit"
DEFAULT_VOICE_DESIGN_MODEL = "Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit"
DEFAULT_SPEAKER = "serena"
SPEAKERS = [
    "serena",
    "vivian",
    "uncle_fu",
    "ryan",
    "aiden",
    "ono_anna",
    "sohee",
    "eric",
    "dylan",
]


def ensure_dirs() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)


def collect_audio_files(output_dir: Path, audio_format: str = "wav") -> list[str]:
    return [str(p) for p in sorted(output_dir.glob(f"*.{audio_format}"))]


def write_audio_file(audio, sample_rate: int, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio, sample_rate)


def repo_id_for(model_name: str) -> str:
    return f"mlx-community/{model_name}"


def local_model_path(model_name: str) -> Path:
    return MODELS_DIR / model_name


def ensure_model(model_name: str) -> Path:
    path = local_model_path(model_name)
    if path.exists() and any(path.glob("*.safetensors")):
        return path
    print(f"[INFO] 本地未找到模型，开始下载: {model_name}", file=sys.stderr)
    from huggingface_hub import snapshot_download

    snapshot_download(repo_id=repo_id_for(model_name), local_dir=str(path))
    return path


def load_model(model_name: str):
    from mlx_audio.tts.utils import load_model as _load_model

    model_path = ensure_model(model_name)
    started = time.time()
    model = _load_model(str(model_path))
    print(json.dumps({"event": "model_loaded", "model": model_name, "seconds": round(time.time() - started, 2)}, ensure_ascii=False))
    return model


def cmd_list_speakers(_: argparse.Namespace) -> int:
    print("\n".join(SPEAKERS))
    return 0


def cmd_synth(args: argparse.Namespace) -> int:
    from mlx_audio.tts.generate import generate_audio

    ensure_dirs()
    speaker = args.speaker or DEFAULT_SPEAKER
    if speaker not in SPEAKERS:
        raise SystemExit(f"不支持的 speaker: {speaker}；可选: {', '.join(SPEAKERS)}")
    model = load_model(args.model)
    output_dir = OUTPUTS_DIR / (args.output_name or "synth")
    output_dir.mkdir(parents=True, exist_ok=True)
    file_prefix = args.file_prefix or "audio"
    started = time.time()
    generate_audio(
        model=model,
        text=args.text,
        voice=speaker,
        lang_code=args.lang,
        instruct=args.instruction,
        speed=args.speed,
        output_path=str(output_dir),
        file_prefix=file_prefix,
        verbose=not args.quiet,
    )
    print(json.dumps({
        "event": "synth_done",
        "output_dir": str(output_dir),
        "audio_files": collect_audio_files(output_dir),
        "seconds": round(time.time() - started, 2),
        "speaker": speaker,
        "lang": args.lang,
        "model": args.model,
    }, ensure_ascii=False))
    return 0


def _print_result_stats(result, quiet: bool) -> None:
    if quiet:
        return
    print("==========")
    print(f"Duration:              {result.audio_duration}")
    print(f"Samples/sec:           {result.audio_samples['samples-per-sec']:.1f}")
    print(f"Prompt:                {result.token_count} tokens, {result.prompt['tokens-per-sec']:.1f} tokens-per-sec")
    print(f"Audio:                 {result.audio_samples['samples']} samples, {result.audio_samples['samples-per-sec']:.1f} samples-per-sec")
    print(f"Real-time factor:      {result.real_time_factor:.2f}x")
    print(f"Processing time:       {result.processing_time_seconds:.2f}s")
    print(f"Peak memory usage:     {result.peak_memory_usage:.2f}GB")


def cmd_clone(args: argparse.Namespace) -> int:
    ensure_dirs()
    model = load_model(args.model)
    output_dir = OUTPUTS_DIR / (args.output_name or "clone")
    output_dir.mkdir(parents=True, exist_ok=True)
    file_prefix = args.file_prefix or "audio"
    started = time.time()

    print(f"[INFO] 使用参考音频克隆链路（Qwen3 Base / ICL）")
    print(f"[INFO] Text: {args.text}")
    print(f"[INFO] Ref audio: {args.ref_audio}")
    print(f"[INFO] Language: {args.lang}")
    print(f"[INFO] Speed: {args.speed}x")

    for i, result in enumerate(model.generate(
        text=args.text,
        ref_audio=args.ref_audio,
        ref_text=args.ref_text,
        lang_code=args.lang,
        speed=args.speed,
        verbose=not args.quiet,
    )):
        file_path = output_dir / f"{file_prefix}_{i:03d}.wav"
        write_audio_file(result.audio, result.sample_rate, file_path)
        print(f"✅ Audio successfully generated and saving as: {file_path}")
        _print_result_stats(result, args.quiet)

    print(json.dumps({
        "event": "clone_done",
        "output_dir": str(output_dir),
        "audio_files": collect_audio_files(output_dir),
        "seconds": round(time.time() - started, 2),
        "lang": args.lang,
        "model": args.model,
        "ref_audio": args.ref_audio,
    }, ensure_ascii=False))
    return 0


def cmd_voice_design(args: argparse.Namespace) -> int:
    ensure_dirs()
    model = load_model(args.model)
    output_dir = OUTPUTS_DIR / (args.output_name or "voice-design")
    output_dir.mkdir(parents=True, exist_ok=True)
    file_prefix = args.file_prefix or "audio"
    started = time.time()

    print("[INFO] 使用 VoiceDesign 链路")
    print(f"[INFO] Text: {args.text}")
    print(f"[INFO] Instruction: {args.instruction}")
    print(f"[INFO] Language: {args.lang}")

    for i, result in enumerate(model.generate(
        text=args.text,
        instruct=args.instruction,
        lang_code=args.lang,
        speed=args.speed,
        verbose=not args.quiet,
    )):
        file_path = output_dir / f"{file_prefix}_{i:03d}.wav"
        write_audio_file(result.audio, result.sample_rate, file_path)
        print(f"✅ Audio successfully generated and saving as: {file_path}")
        _print_result_stats(result, args.quiet)

    print(json.dumps({
        "event": "voice_design_done",
        "output_dir": str(output_dir),
        "audio_files": collect_audio_files(output_dir),
        "seconds": round(time.time() - started, 2),
        "lang": args.lang,
        "model": args.model,
        "instruction": args.instruction,
    }, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Qwen3-TTS Apple Silicon CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("list-speakers", help="列出当前预置 speaker")
    p.set_defaults(func=cmd_list_speakers)

    p = sub.add_parser("synth", help="普通文本转语音")
    p.add_argument("--text", required=True)
    p.add_argument("--speaker", default=DEFAULT_SPEAKER)
    p.add_argument("--instruction", default="用自然、清晰、平稳的中文声音朗读。")
    p.add_argument("--lang", default="zh")
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--model", default=DEFAULT_SYNTH_MODEL)
    p.add_argument("--output-name")
    p.add_argument("--file-prefix", default="audio")
    p.add_argument("--quiet", action="store_true")
    p.set_defaults(func=cmd_synth)

    p = sub.add_parser("clone", help="参考音频语音克隆")
    p.add_argument("--text", required=True)
    p.add_argument("--ref-audio", required=True)
    p.add_argument("--ref-text", required=True)
    p.add_argument("--lang", default="zh")
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--model", default=DEFAULT_CLONE_MODEL)
    p.add_argument("--output-name")
    p.add_argument("--file-prefix", default="audio")
    p.add_argument("--quiet", action="store_true")
    p.set_defaults(func=cmd_clone)

    p = sub.add_parser("voice-design", help="根据文字描述设计音色并生成语音")
    p.add_argument("--text", required=True)
    p.add_argument("--instruction", required=True)
    p.add_argument("--lang", default="zh")
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--model", default=DEFAULT_VOICE_DESIGN_MODEL)
    p.add_argument("--output-name")
    p.add_argument("--file-prefix", default="audio")
    p.add_argument("--quiet", action="store_true")
    p.set_defaults(func=cmd_voice_design)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
