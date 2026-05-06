#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import threading
import traceback
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path

RUNTIME = "qwen-tts"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8013
DEFAULT_HEALTH_PATH = "/health"
DEFAULT_SYNTH_PATH = "/synthesize"
DEFAULT_TELEPHONY_PATH = "/synthesize-telephony"
MODEL_CACHE: dict[str, object] = {}
MODEL_LOCK = threading.Lock()

MODEL_ALIASES = {
    "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
    "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    "Qwen/Qwen3-TTS-12Hz-1.7B-Base": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
}

VOICE_ALIASES = {
    "serena": "Serena",
    "vivian": "Vivian",
    "uncle_fu": "Uncle_Fu",
    "ryan": "Ryan",
    "aiden": "Aiden",
    "ono_anna": "Ono_Anna",
    "sohee": "Sohee",
    "eric": "Eric",
    "dylan": "Dylan",
}


def normalize_language(value: object) -> str:
    if not isinstance(value, str):
        return "Auto"
    trimmed = value.strip()
    if not trimmed:
        return "Auto"
    if trimmed.lower() == "auto":
        return "Auto"
    return trimmed


def normalize_model(value: object, fallback: str) -> str:
    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed in MODEL_ALIASES:
            return MODEL_ALIASES[trimmed]
        if trimmed.startswith("Qwen/Qwen3-TTS-12Hz-"):
            return trimmed
        if Path(trimmed).exists():
            return trimmed
    return MODEL_ALIASES[fallback]


def normalize_voice(value: object) -> str:
    if not isinstance(value, str):
        return "Vivian"
    trimmed = value.strip()
    return VOICE_ALIASES.get(trimmed.lower(), trimmed or "Vivian")


def resolve_torch_dtype(torch, device: str):
    raw = os.environ.get("CRAWCLAW_QWEN3_TTS_TORCH_DTYPE", "auto").strip().lower()
    if raw == "float16":
        return torch.float16
    if raw == "float32":
        return torch.float32
    if raw == "bfloat16":
        return torch.bfloat16
    return torch.bfloat16 if device.startswith("cuda") else torch.float32


def resolve_device(torch) -> str:
    override = os.environ.get("CRAWCLAW_QWEN3_TTS_DEVICE", "").strip()
    if override:
        return override
    return "cuda:0" if torch.cuda.is_available() else "cpu"


def resolve_attention(device: str) -> str:
    override = os.environ.get("CRAWCLAW_QWEN3_TTS_ATTN", "").strip()
    if override:
        return override
    return "flash_attention_2" if device.startswith("cuda") else "sdpa"


def load_model(model: object, fallback: str):
    model_id = normalize_model(model, fallback)
    with MODEL_LOCK:
        cached = MODEL_CACHE.get(model_id)
        if cached is not None:
            return cached

        import torch
        from qwen_tts import Qwen3TTSModel

        device = resolve_device(torch)
        loaded = Qwen3TTSModel.from_pretrained(
            model_id,
            device_map=device,
            dtype=resolve_torch_dtype(torch, device),
            attn_implementation=resolve_attention(device),
        )
        MODEL_CACHE[model_id] = loaded
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


def convert_audio_for_response(audio, sample_rate: int, response_format: str) -> tuple[bytes, str, str, int]:
    pcm_bytes = pcm16_bytes_from_audio(audio)
    if response_format == "pcm":
        return pcm_bytes, "pcm", ".pcm", sample_rate
    return wav_bytes_from_pcm(pcm_bytes, sample_rate), "wav", ".wav", sample_rate


def synthesize_preset(payload: dict[str, object]) -> tuple[bytes, str, str, int]:
    model = load_model(
        payload.get("model"),
        "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    )
    wavs, sample_rate = model.generate_custom_voice(
        text=str(payload.get("text") or ""),
        language=normalize_language(payload.get("language")),
        speaker=normalize_voice(payload.get("voice")),
        instruct=str(payload.get("instructions") or ""),
    )
    if not wavs:
        raise RuntimeError("Qwen3-TTS preset synthesis produced no audio")
    return convert_audio_for_response(
        wavs[0],
        int(sample_rate),
        str(payload.get("responseFormat") or "wav").lower(),
    )


def synthesize_clone(payload: dict[str, object]) -> tuple[bytes, str, str, int]:
    model = load_model(payload.get("model"), "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
    wavs, sample_rate = model.generate_voice_clone(
        text=str(payload.get("text") or ""),
        language=normalize_language(payload.get("language")),
        ref_audio=str(payload.get("refAudio") or ""),
        ref_text=str(payload.get("refText") or ""),
    )
    if not wavs:
        raise RuntimeError("Qwen3-TTS clone synthesis produced no audio")
    return convert_audio_for_response(
        wavs[0],
        int(sample_rate),
        str(payload.get("responseFormat") or "wav").lower(),
    )


def synthesize_design(payload: dict[str, object]) -> tuple[bytes, str, str, int]:
    model = load_model(payload.get("model"), "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign")
    wavs, sample_rate = model.generate_voice_design(
        text=str(payload.get("text") or ""),
        language=normalize_language(payload.get("language")),
        instruct=str(payload.get("prompt") or payload.get("instructions") or ""),
    )
    if not wavs:
        raise RuntimeError("Qwen3-TTS voice design synthesis produced no audio")
    return convert_audio_for_response(
        wavs[0],
        int(sample_rate),
        str(payload.get("responseFormat") or "wav").lower(),
    )


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
            self._send_json(200, {"ready": True, "runtime": RUNTIME})
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
        print(f"[qwen3-tts-python-sidecar] {fmt % args}", flush=True)


def normalize_path(value: str) -> str:
    return value if value.startswith("/") else f"/{value}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="CrawClaw Qwen3-TTS Python sidecar")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--health-path", default=DEFAULT_HEALTH_PATH)
    parser.add_argument("--synthesize-path", default=DEFAULT_SYNTH_PATH)
    parser.add_argument("--telephony-path", default=DEFAULT_TELEPHONY_PATH)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    Handler.health_path = normalize_path(args.health_path)
    Handler.synthesize_path = normalize_path(args.synthesize_path)
    Handler.telephony_path = normalize_path(args.telephony_path)

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
