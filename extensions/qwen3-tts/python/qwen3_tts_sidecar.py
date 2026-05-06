#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import tempfile
import threading
import traceback
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path

RUNTIME = "mlx-audio"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8011
DEFAULT_HEALTH_PATH = "/health"
DEFAULT_SYNTH_PATH = "/synthesize"
DEFAULT_TELEPHONY_PATH = "/synthesize-telephony"
CACHE_ROOT = Path(
    os.environ.get(
        "CRAWCLAW_QWEN3_TTS_HOME",
        os.path.expanduser("~/.cache/crawclaw/qwen3-tts"),
    )
)
MODELS_DIR = CACHE_ROOT / "models"

MODEL_ALIASES = {
    "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice": "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-4bit",
    "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice": "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
    "Qwen/Qwen3-TTS-12Hz-1.7B-Base": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit",
    "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign": "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit",
}

MODEL_CACHE: dict[str, object] = {}
MODEL_LOCK = threading.Lock()


def ensure_models_dir() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)


def normalize_language(value: object) -> str:
    if not isinstance(value, str):
        return "auto"
    trimmed = value.strip()
    if not trimmed or trimmed.lower() == "auto":
        return "auto"
    return trimmed


def normalize_repo_id(model: object) -> str:
    if isinstance(model, str):
        trimmed = model.strip()
        if trimmed in MODEL_ALIASES:
            return MODEL_ALIASES[trimmed]
        if trimmed.startswith("mlx-community/"):
            return trimmed
    return MODEL_ALIASES["Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"]


def ensure_local_model(repo_id: str) -> Path:
    ensure_models_dir()
    model_name = repo_id.split("/", 1)[1]
    model_dir = MODELS_DIR / model_name
    if model_dir.exists() and any(model_dir.iterdir()):
        return model_dir

    from huggingface_hub import snapshot_download

    snapshot_download(repo_id=repo_id, local_dir=str(model_dir))
    return model_dir


def load_model(model: object):
    repo_id = normalize_repo_id(model)
    with MODEL_LOCK:
        cached = MODEL_CACHE.get(repo_id)
        if cached is not None:
            return cached

        from mlx_audio.tts.utils import load_model as mlx_load_model

        model_dir = ensure_local_model(repo_id)
        loaded = mlx_load_model(str(model_dir))
        MODEL_CACHE[repo_id] = loaded
        return loaded


def pcm16_bytes_from_audio(audio) -> bytes:
    import numpy as np

    arr = np.asarray(audio, dtype=np.float32)
    if arr.ndim == 2:
        if arr.shape[0] in (1, 2) and arr.shape[1] > arr.shape[0]:
            arr = arr.mean(axis=0)
        else:
            arr = arr.mean(axis=1)
    arr = np.clip(arr, -1.0, 1.0)
    arr = (arr * 32767.0).astype(np.int16)
    return arr.tobytes()


def wav_bytes_from_pcm(pcm_bytes: bytes, sample_rate: int) -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_bytes)
    return buffer.getvalue()


def convert_wav_for_response(wav_path: Path, response_format: str) -> tuple[bytes, str, str, int]:
    import numpy as np

    with wave.open(str(wav_path), "rb") as wav_file:
        sample_rate = wav_file.getframerate()
        sample_width = wav_file.getsampwidth()
        channels = wav_file.getnchannels()
        frames = wav_file.readframes(wav_file.getnframes())

    if sample_width == 1:
        pcm = np.frombuffer(frames, dtype=np.uint8).astype(np.float32)
        pcm = (pcm - 128.0) / 128.0
    elif sample_width == 2:
        pcm = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32767.0
    else:
        raise RuntimeError(f"Unsupported wav sample width: {sample_width}")

    if channels > 1:
        pcm = pcm.reshape(-1, channels).mean(axis=1)

    pcm = np.clip(pcm, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype(np.int16).tobytes()

    if response_format == "pcm":
        return pcm, "pcm", ".pcm", sample_rate

    with wav_path.open("rb") as handle:
        return handle.read(), "wav", ".wav", sample_rate


def synthesize_preset(payload: dict[str, object]) -> tuple[bytes, str, str, int]:
    from mlx_audio.tts.generate import generate_audio

    model = load_model(payload.get("model"))
    response_format = str(payload.get("responseFormat") or "wav").lower()
    with tempfile.TemporaryDirectory(prefix="crawclaw-qwen3-tts-") as temp_dir:
        temp_path = Path(temp_dir)
        generate_audio(
            model=model,
            text=str(payload.get("text") or ""),
            voice=str(payload.get("voice") or "vivian"),
            lang_code=normalize_language(payload.get("language")),
            instruct=str(payload.get("instructions") or ""),
            speed=float(payload.get("speed") or 1.0),
            output_path=str(temp_path),
            file_prefix="audio",
            verbose=False,
        )
        audio_files = sorted(temp_path.glob("*.wav"))
        if not audio_files:
            raise RuntimeError("Qwen3-TTS preset synthesis produced no audio files")
        return convert_wav_for_response(audio_files[0], response_format)


def _read_first_result(generator) -> tuple[bytes, int]:
    for result in generator:
        return pcm16_bytes_from_audio(result.audio), int(result.sample_rate)
    raise RuntimeError("Qwen3-TTS generator returned no audio")


def synthesize_clone(payload: dict[str, object]) -> tuple[bytes, str, str, int]:
    model = load_model(payload.get("model"))
    pcm_bytes, sample_rate = _read_first_result(
        model.generate(
            text=str(payload.get("text") or ""),
            ref_audio=str(payload.get("refAudio") or ""),
            ref_text=str(payload.get("refText") or ""),
            lang_code=normalize_language(payload.get("language")),
            speed=float(payload.get("speed") or 1.0),
            verbose=False,
        )
    )
    if str(payload.get("responseFormat") or "wav").lower() == "pcm":
        return pcm_bytes, "pcm", ".pcm", sample_rate
    return wav_bytes_from_pcm(pcm_bytes, sample_rate), "wav", ".wav", sample_rate


def synthesize_design(payload: dict[str, object]) -> tuple[bytes, str, str, int]:
    model = load_model(payload.get("model"))
    pcm_bytes, sample_rate = _read_first_result(
        model.generate(
            text=str(payload.get("text") or ""),
            instruct=str(payload.get("prompt") or ""),
            lang_code=normalize_language(payload.get("language")),
            speed=float(payload.get("speed") or 1.0),
            verbose=False,
        )
    )
    if str(payload.get("responseFormat") or "wav").lower() == "pcm":
        return pcm_bytes, "pcm", ".pcm", sample_rate
    return wav_bytes_from_pcm(pcm_bytes, sample_rate), "wav", ".wav", sample_rate


def synthesize(payload: dict[str, object]) -> dict[str, object]:
    task = str(payload.get("task") or "preset")
    if task == "clone":
        audio_bytes, output_format, file_extension, sample_rate = synthesize_clone(payload)
    elif task == "design":
        audio_bytes, output_format, file_extension, sample_rate = synthesize_design(payload)
    else:
        audio_bytes, output_format, file_extension, sample_rate = synthesize_preset(payload)

    return {
        "audioBase64": base64.b64encode(audio_bytes).decode("ascii"),
        "outputFormat": output_format,
        "fileExtension": file_extension,
        "voiceCompatible": False,
        "sampleRate": sample_rate,
        "runtime": RUNTIME,
    }


class Handler(BaseHTTPRequestHandler):
    health_path = DEFAULT_HEALTH_PATH
    synthesize_path = DEFAULT_SYNTH_PATH
    telephony_path = DEFAULT_TELEPHONY_PATH

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict[str, object]:
        raw_length = self.headers.get("Content-Length")
        length = int(raw_length or "0")
        body = self.rfile.read(length)
        payload = json.loads(body.decode("utf-8")) if body else {}
        if not isinstance(payload, dict):
            raise ValueError("JSON body must be an object")
        return payload

    def do_GET(self) -> None:
        if self.path == self.health_path:
            self._send_json(
                200,
                {
                    "ready": True,
                    "runtime": RUNTIME,
                    "cachedModels": sorted(MODEL_CACHE.keys()),
                },
            )
            return
        self._send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        try:
            payload = self._read_json_body()
            if self.path == self.synthesize_path:
                self._send_json(200, synthesize(payload))
                return
            if self.path == self.telephony_path:
                payload["responseFormat"] = "pcm"
                self._send_json(200, synthesize(payload))
                return
            self._send_json(404, {"error": "not_found"})
        except Exception as exc:
            self._send_json(
                500,
                {
                    "error": str(exc),
                    "runtime": RUNTIME,
                    "traceback": traceback.format_exc(limit=5),
                },
            )

    def log_message(self, fmt: str, *args) -> None:
        print(f"[qwen3-tts-sidecar] {fmt % args}", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="CrawClaw Qwen3-TTS MLX sidecar")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--health-path", default=DEFAULT_HEALTH_PATH)
    parser.add_argument("--synthesize-path", default=DEFAULT_SYNTH_PATH)
    parser.add_argument("--telephony-path", default=DEFAULT_TELEPHONY_PATH)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    Handler.health_path = args.health_path if args.health_path.startswith("/") else f"/{args.health_path}"
    Handler.synthesize_path = (
        args.synthesize_path if args.synthesize_path.startswith("/") else f"/{args.synthesize_path}"
    )
    Handler.telephony_path = (
        args.telephony_path if args.telephony_path.startswith("/") else f"/{args.telephony_path}"
    )

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(
        json.dumps(
            {
                "event": "listening",
                "host": args.host,
                "port": args.port,
                "runtime": RUNTIME,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
