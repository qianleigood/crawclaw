#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

import mlx_whisper


def main() -> int:
    parser = argparse.ArgumentParser(description="MLX Whisper 转写")
    parser.add_argument("input", help="音频或视频文件路径")
    parser.add_argument("model", nargs="?", default="mlx-community/whisper-turbo", help="模型仓库")
    parser.add_argument("--output-format", choices=["txt", "json"], default="txt", help="输出格式")
    parser.add_argument("--output", help="输出文件路径；不传则打印到 stdout")
    parser.add_argument("--language", default="zh", help="语言，默认 zh")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.exists():
        print(f"文件不存在: {input_path}")
        return 1

    result = mlx_whisper.transcribe(
        str(input_path),
        path_or_hf_repo=args.model,
        verbose=False,
        language=args.language,
    )

    if args.output_format == "json":
        payload = json.dumps(result or {}, ensure_ascii=False, indent=2)
    else:
        payload = ((result or {}).get("text", "") or "").strip()

    if args.output:
        output_path = Path(args.output).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(payload, encoding="utf-8")
        print(str(output_path))
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
