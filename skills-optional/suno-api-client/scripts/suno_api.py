#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_BASE_URL = os.getenv("SUNO_API_BASE_URL", "http://localhost:3001").rstrip("/")
DEFAULT_TIMEOUT = float(os.getenv("SUNO_API_TIMEOUT", "120"))
SONG_PAGE_URL_BASE = os.getenv("SUNO_SONG_PAGE_URL_BASE", "https://suno.com/song").rstrip("/")


def _clean_payload(payload):
    return {k: v for k, v in payload.items() if v is not None}


def _request(method: str, path: str, *, payload=None, cookie=None, timeout=DEFAULT_TIMEOUT):
    url = f"{DEFAULT_BASE_URL}{path}"
    headers = {"Accept": "application/json"}
    data = None
    if payload is not None:
        data = json.dumps(_clean_payload(payload), ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if cookie:
        headers["Cookie"] = cookie

    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                parsed = body
            return resp.status, parsed
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = body
        return e.code, parsed
    except urllib.error.URLError as e:
        return 0, {"error": "url_error", "reason": str(e.reason), "url": url}


def _dump(status, data):
    print(json.dumps({"status": status, "data": data}, ensure_ascii=False, indent=2))


def _slugify(value: str) -> str:
    value = (value or "").strip()
    value = re.sub(r"[\\/:*?\"<>|]+", "-", value)
    value = re.sub(r"\s+", "-", value)
    value = re.sub(r"-+", "-", value)
    return value.strip("-._") or "untitled"


def _song_page_url(song_id: str) -> str:
    return f"{SONG_PAGE_URL_BASE}/{song_id}"


def _is_preview(item: dict) -> bool:
    if item.get("type") == "preview":
        return True
    model_name = (item.get("model_name") or "").lower()
    return model_name == "chirp-fenix"


def _filter_items(data, only_gen: bool = False):
    if not only_gen or not isinstance(data, list):
        return data
    return [item for item in data if not _is_preview(item)]


def _enrich_items(data, include_page_url: bool = False):
    if not include_page_url:
        return data
    if isinstance(data, list):
        return [_enrich_items(item, include_page_url=True) for item in data]
    if isinstance(data, dict):
        enriched = dict(data)
        if enriched.get("id"):
            enriched["page_url"] = _song_page_url(enriched["id"])
        return enriched
    return data


def _download_file(url: str, output_path: Path, timeout: float):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(resp.read())


def _download_items(data, download_dir: str | None, timeout: float):
    if not download_dir or not isinstance(data, list):
        return data

    base = Path(download_dir).expanduser()
    result = []
    for index, item in enumerate(data, start=1):
        if not isinstance(item, dict):
            result.append(item)
            continue

        enriched = dict(item)
        audio_url = enriched.get("audio_url")
        if not audio_url:
            enriched["download_status"] = "skipped:no_audio_url"
            result.append(enriched)
            continue

        title = _slugify(enriched.get("title") or enriched.get("id") or f"song-{index}")
        song_id = enriched.get("id") or f"song-{index}"
        filename = f"{title}-{song_id}.mp3"
        output_path = base / filename
        try:
            _download_file(audio_url, output_path, timeout)
            enriched["download_status"] = "downloaded"
            enriched["downloaded_audio_path"] = str(output_path)
        except Exception as e:
            enriched["download_status"] = "error"
            enriched["download_error"] = repr(e)
        result.append(enriched)
    return result


def _filter_fields_item(item, field_names: list[str]):
    if not isinstance(item, dict):
        return item
    return {name: item[name] for name in field_names if name in item}


def _filter_fields(data, fields: str | None):
    if not fields:
        return data
    field_names = [field.strip() for field in fields.split(",") if field.strip()]
    if not field_names:
        return data
    if isinstance(data, list):
        return [_filter_fields_item(item, field_names) for item in data]
    return _filter_fields_item(data, field_names)


def _post_process(data, args):
    data = _filter_items(data, only_gen=getattr(args, "only_gen", False))
    data = _enrich_items(data, include_page_url=getattr(args, "include_page_url", False))
    data = _download_items(data, getattr(args, "download_dir", None), getattr(args, "timeout", DEFAULT_TIMEOUT))
    data = _filter_fields(data, getattr(args, "fields", None))
    return data


def _effective_timeout(args):
    wait_audio_timeout = getattr(args, "wait_audio_timeout", None)
    if getattr(args, "wait_audio", False) and wait_audio_timeout:
        return wait_audio_timeout
    return getattr(args, "timeout", DEFAULT_TIMEOUT)


def _add_result_options(parser, *, allow_download=False, allow_wait_audio_timeout=False):
    parser.add_argument("--only-gen", action="store_true", help="Exclude preview/fenix results when the API returns mixed candidates")
    parser.add_argument("--include-page-url", action="store_true", help="Append Suno song page URLs to each result item")
    parser.add_argument("--fields", help="Comma-separated result fields to keep, e.g. id,status,audio_url,page_url")
    if allow_download:
        parser.add_argument("--download-dir", help="Download returned audio files into this directory when audio_url is available")
    if allow_wait_audio_timeout:
        parser.add_argument("--wait-audio-timeout", type=float, help="Override HTTP timeout when --wait-audio is enabled")


def cmd_get_limit(args):
    status, data = _request("GET", "/api/get_limit", cookie=args.cookie, timeout=args.timeout)
    _dump(status, data)


def cmd_generate(args):
    payload = {
        "prompt": args.prompt,
        "make_instrumental": args.make_instrumental,
        "wait_audio": args.wait_audio,
    }
    if args.model:
        payload["model"] = args.model
    timeout = _effective_timeout(args)
    status, data = _request("POST", "/api/generate", payload=payload, cookie=args.cookie, timeout=timeout)
    _dump(status, _post_process(data, args))


def cmd_custom_generate(args):
    payload = {
        "prompt": args.prompt,
        "tags": args.tags,
        "title": args.title,
        "make_instrumental": args.make_instrumental,
        "wait_audio": args.wait_audio,
        "negative_tags": args.negative_tags,
    }
    if args.model:
        payload["model"] = args.model
    timeout = _effective_timeout(args)
    status, data = _request("POST", "/api/custom_generate", payload=payload, cookie=args.cookie, timeout=timeout)
    _dump(status, _post_process(data, args))


def cmd_generate_lyrics(args):
    payload = {"prompt": args.prompt}
    status, data = _request("POST", "/api/generate_lyrics", payload=payload, cookie=args.cookie, timeout=args.timeout)
    _dump(status, data)


def cmd_get(args):
    query = []
    if args.ids:
        query.append(("ids", args.ids))
    if args.page:
        query.append(("page", str(args.page)))
    path = "/api/get"
    if query:
        path += "?" + urllib.parse.urlencode(query)
    status, data = _request("GET", path, cookie=args.cookie, timeout=args.timeout)
    _dump(status, _post_process(data, args))


def cmd_clip(args):
    path = "/api/clip?" + urllib.parse.urlencode({"id": args.id})
    status, data = _request("GET", path, cookie=args.cookie, timeout=args.timeout)
    _dump(status, _post_process(data, args))


def cmd_persona(args):
    query = [("id", args.id)]
    if args.page is not None:
        query.append(("page", str(args.page)))
    path = "/api/persona?" + urllib.parse.urlencode(query)
    status, data = _request("GET", path, cookie=args.cookie, timeout=args.timeout)
    _dump(status, data)


def cmd_extend_audio(args):
    payload = {
        "audio_id": args.audio_id,
        "prompt": args.prompt,
        "continue_at": args.continue_at,
        "tags": args.tags,
        "negative_tags": args.negative_tags,
        "title": args.title,
        "wait_audio": args.wait_audio,
    }
    if args.model:
        payload["model"] = args.model
    timeout = _effective_timeout(args)
    status, data = _request("POST", "/api/extend_audio", payload=payload, cookie=args.cookie, timeout=timeout)
    _dump(status, _post_process(data, args))


def cmd_concat(args):
    payload = {"clip_id": args.clip_id}
    status, data = _request("POST", "/api/concat", payload=payload, cookie=args.cookie, timeout=args.timeout)
    _dump(status, _post_process(data, args))


def cmd_generate_stems(args):
    payload = {"audio_id": args.audio_id}
    status, data = _request("POST", "/api/generate_stems", payload=payload, cookie=args.cookie, timeout=args.timeout)
    _dump(status, _post_process(data, args))


def cmd_get_aligned_lyrics(args):
    path = "/api/get_aligned_lyrics?" + urllib.parse.urlencode({"id": args.id})
    status, data = _request("GET", path, cookie=args.cookie, timeout=args.timeout)
    _dump(status, data)


def build_parser():
    p = argparse.ArgumentParser(description="Client for a locally deployed gcui-art/suno-api service")
    p.add_argument("--cookie", help="Override SUNO_COOKIE for this request only")
    p.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="HTTP timeout in seconds")

    sub = p.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("get-limit", help="Check quota / health")
    sp.set_defaults(func=cmd_get_limit)

    sp = sub.add_parser("generate", help="POST /api/generate")
    sp.add_argument("--prompt", required=True)
    sp.add_argument("--make-instrumental", action="store_true")
    sp.add_argument("--wait-audio", action="store_true")
    sp.add_argument("--model")
    _add_result_options(sp, allow_download=True, allow_wait_audio_timeout=True)
    sp.set_defaults(func=cmd_generate)

    sp = sub.add_parser("custom-generate", help="POST /api/custom_generate")
    sp.add_argument("--prompt", required=True)
    sp.add_argument("--tags", default="")
    sp.add_argument("--title", default="")
    sp.add_argument("--negative-tags", default="")
    sp.add_argument("--make-instrumental", action="store_true")
    sp.add_argument("--wait-audio", action="store_true")
    sp.add_argument("--model")
    _add_result_options(sp, allow_download=True, allow_wait_audio_timeout=True)
    sp.set_defaults(func=cmd_custom_generate)

    sp = sub.add_parser("generate-lyrics", help="POST /api/generate_lyrics")
    sp.add_argument("--prompt", required=True)
    sp.set_defaults(func=cmd_generate_lyrics)

    sp = sub.add_parser("get", help="GET /api/get")
    sp.add_argument("--ids", help="Comma-separated song ids")
    sp.add_argument("--page", type=int)
    _add_result_options(sp, allow_download=True)
    sp.set_defaults(func=cmd_get)

    sp = sub.add_parser("clip", help="GET /api/clip")
    sp.add_argument("--id", required=True, help="Clip id")
    _add_result_options(sp, allow_download=True)
    sp.set_defaults(func=cmd_clip)

    sp = sub.add_parser("persona", help="GET /api/persona")
    sp.add_argument("--id", required=True, help="Persona id")
    sp.add_argument("--page", type=int)
    sp.set_defaults(func=cmd_persona)

    sp = sub.add_parser("extend-audio", help="POST /api/extend_audio")
    sp.add_argument("--audio-id", required=True)
    sp.add_argument("--prompt", default="")
    sp.add_argument("--continue-at", type=int)
    sp.add_argument("--tags", default="")
    sp.add_argument("--negative-tags", default="")
    sp.add_argument("--title", default="")
    sp.add_argument("--wait-audio", action="store_true")
    sp.add_argument("--model")
    _add_result_options(sp, allow_download=True, allow_wait_audio_timeout=True)
    sp.set_defaults(func=cmd_extend_audio)

    sp = sub.add_parser("concat", help="POST /api/concat")
    sp.add_argument("--clip-id", required=True)
    _add_result_options(sp, allow_download=True)
    sp.set_defaults(func=cmd_concat)

    sp = sub.add_parser("generate-stems", help="POST /api/generate_stems")
    sp.add_argument("--audio-id", required=True)
    _add_result_options(sp, allow_download=True)
    sp.set_defaults(func=cmd_generate_stems)

    sp = sub.add_parser("get-aligned-lyrics", help="GET /api/get_aligned_lyrics")
    sp.add_argument("--id", required=True, help="Song id")
    sp.set_defaults(func=cmd_get_aligned_lyrics)

    return p


def main():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
