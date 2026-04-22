#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from html import unescape
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


_WINDOWS_DLL_DIRECTORY_HANDLES = []


def configure_windows_venv_dll_dirs() -> None:
    if sys.platform != "win32" or not hasattr(os, "add_dll_directory"):
        return
    for candidate in (sys.prefix, os.path.join(sys.prefix, "Scripts")):
        if os.path.isdir(candidate):
            _WINDOWS_DLL_DIRECTORY_HANDLES.append(os.add_dll_directory(candidate))


configure_windows_venv_dll_dirs()

try:
    from scrapling.fetchers import DynamicFetcher, Fetcher, StealthyFetcher  # type: ignore

    SCRAPLING_AVAILABLE = True
except Exception:
    DynamicFetcher = Fetcher = StealthyFetcher = None  # type: ignore
    SCRAPLING_AVAILABLE = False

DEFAULT_TIMEOUT_SECONDS = 30
DEFAULT_MAX_CHARS = 50_000


def normalize_string(value: Any) -> str | None:
    if isinstance(value, str):
        value = value.strip()
        if value:
            return value
    return None


def normalize_string_array(value: Any) -> list[str] | None:
    if not isinstance(value, list):
        return None
    result = [entry.strip() for entry in value if isinstance(entry, str) and entry.strip()]
    return result or None


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\r", "\n")).strip()


def truncate_text(value: str, max_chars: int) -> tuple[str, bool]:
    if max_chars <= 0:
        return "", True
    if len(value) <= max_chars:
        return value, False
    return value[:max_chars], True


def safe_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("url must use http or https")
    if not parsed.netloc:
        raise ValueError("url must include a host")
    return value


def as_bool(value: Any, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    return fallback


def as_int(value: Any, fallback: int) -> int:
    if isinstance(value, bool):
        return fallback
    if isinstance(value, (int, float)):
        try:
            parsed = int(value)
        except Exception:
            return fallback
        return parsed if parsed > 0 else fallback
    return fallback


def split_sentences(value: str) -> list[str]:
    normalized = normalize_whitespace(value)
    if not normalized:
        return []
    return [part.strip() for part in re.split(r"(?<=[.!?。！？])\s+", normalized) if part.strip()]


def split_paragraphs(value: str) -> list[str]:
    normalized = value.replace("\r", "\n")
    return [part.strip() for part in re.split(r"\n{2,}", normalized) if part.strip()]


def derive_summary(text: str) -> str | None:
    paragraphs = split_paragraphs(text)
    if paragraphs:
      summary, _ = truncate_text(" ".join(paragraphs[:1]), 420)
      return summary or None
    sentences = split_sentences(text)
    if sentences:
        summary, _ = truncate_text(" ".join(sentences[:2]), 420)
        return summary or None
    return None


def derive_key_points(text: str) -> list[str]:
    points: list[str] = []
    for candidate in [*split_paragraphs(text), *split_sentences(text)]:
        normalized = normalize_whitespace(candidate)
        if not normalized or normalized in points:
            continue
        points.append(normalized)
        if len(points) >= 3:
            break
    return points


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._title: list[str] = []
        self._text: list[str] = []
        self._headings: list[str] = []
        self._current_heading: list[str] = []
        self._capture_title = False
        self._capture_heading = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self._capture_title = True
        if tag in {"p", "div", "section", "article", "li", "br", "hr"}:
            self._text.append("\n")
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._capture_heading = True
            self._current_heading = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._capture_title = False
        if tag in {"p", "div", "section", "article", "li"}:
            self._text.append("\n")
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._capture_heading = False
            heading = normalize_whitespace("".join(self._current_heading))
            if heading:
                self._headings.append(heading)
            self._current_heading = []

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if not text:
            return
        if self._capture_title:
            self._title.append(text)
        elif self._capture_heading:
            self._current_heading.append(text)
            self._text.append(f"{text}\n")
        else:
            self._text.append(f"{text} ")

    @property
    def title(self) -> str | None:
        value = normalize_whitespace("".join(self._title))
        return value or None

    @property
    def headings(self) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for value in self._headings:
            normalized = normalize_whitespace(value)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            result.append(normalized)
            if len(result) >= 6:
                break
        return result

    @property
    def text(self) -> str:
        return normalize_whitespace("".join(self._text))


def extract_html(page_html: str) -> dict[str, Any]:
    parser = TextExtractor()
    parser.feed(page_html)
    parser.close()
    return {
        "title": parser.title,
        "text": parser.text,
        "headings": parser.headings,
    }


def fetch_http(url: str, timeout_seconds: int) -> tuple[str, str, int, str]:
    request = Request(
        url,
        headers={
            "Accept": "text/html, text/markdown, text/plain;q=0.9, */*;q=0.1",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
    )
    with urlopen(request, timeout=timeout_seconds) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or "utf-8"
        body = raw.decode(charset, errors="replace")
        content_type = response.headers.get_content_type()
        status = int(getattr(response, "status", 200))
        final_url = str(getattr(response, "url", url))
        return body, content_type, status, final_url


def detect_blocked(*, html: str | None, text: str | None) -> bool:
    haystacks = [value for value in [html, text] if value]
    patterns = [
        r"captcha",
        r"robot check",
        r"access denied",
        r"forbidden",
        r"temporarily unavailable",
        r"verify you are human",
    ]
    for haystack in haystacks:
        normalized = haystack.lower()
        if any(re.search(pattern, normalized) for pattern in patterns):
            return True
    return False


def normalize_fetcher_output(value: Any) -> tuple[str | None, str | None, dict[str, Any]]:
    html = None
    text = None
    metadata: dict[str, Any] = {}
    if value is None:
        return html, text, metadata
    if isinstance(value, str):
        html = value
        return html, text, metadata
    if isinstance(value, dict):
        html = normalize_string(value.get("html")) or normalize_string(value.get("source")) or normalize_string(value.get("content"))
        text = normalize_string(value.get("text")) or normalize_string(value.get("markdown"))
        meta = value.get("metadata")
        if isinstance(meta, dict):
            metadata.update(meta)
        for key in ("title", "finalUrl", "url", "engine", "source"):
            candidate = normalize_string(value.get(key))
            if candidate is not None:
                metadata.setdefault(key, candidate)
        return html, text, metadata
    for attr in ("html", "source", "content", "raw_html", "body"):
        candidate = getattr(value, attr, None)
        if isinstance(candidate, str) and candidate.strip():
            html = candidate
            break
    for attr in ("text", "markdown"):
        candidate = getattr(value, attr, None)
        if isinstance(candidate, str) and candidate.strip():
            text = candidate
            break
    metadata_value = getattr(value, "metadata", None)
    if isinstance(metadata_value, dict):
        metadata.update(metadata_value)
    for key in ("title", "finalUrl", "url", "engine", "source"):
        candidate = getattr(value, key, None)
        if isinstance(candidate, str) and candidate.strip():
            metadata.setdefault(key, candidate.strip())
    return html, text, metadata


def call_fetch_method(
    method: Any,
    *,
    url: str,
    timeout_seconds: int,
    wait_until: str | None,
    wait_for: str | None,
    session_id: str | None,
) -> Any:
    attempts = [
        {"url": url, "timeout": timeout_seconds, "wait_until": wait_until, "wait_for": wait_for, "session_id": session_id},
        {"url": url, "timeout_seconds": timeout_seconds, "waitUntil": wait_until, "waitFor": wait_for, "sessionId": session_id},
        {"url": url},
        {},
    ]
    for kwargs in attempts:
        clean_kwargs = {key: value for key, value in kwargs.items() if value is not None}
        try:
            return method(url, **clean_kwargs)
        except TypeError:
            try:
                if clean_kwargs:
                    return method(**clean_kwargs)
                return method()
            except TypeError:
                continue
    raise TypeError("Scrapling fetcher method did not accept any supported call signature")


def fetch_scrapling(
    *,
    url: str,
    render: str,
    timeout_seconds: int,
    wait_until: str | None,
    wait_for: str | None,
    session_id: str | None,
) -> dict[str, Any] | None:
    if not SCRAPLING_AVAILABLE:
        return None
    fetcher_cls = {
        "never": Fetcher,
        "stealth": StealthyFetcher,
        "dynamic": DynamicFetcher,
        "auto": Fetcher,
    }.get(render, Fetcher)
    if fetcher_cls is None:
        return None
    try:
        fetcher = fetcher_cls()
    except Exception:
        return None
    page = None
    for method_name in ("get", "fetch", "request"):
        method = getattr(fetcher, method_name, None)
        if callable(method):
            try:
                page = call_fetch_method(
                    method,
                    url=url,
                    timeout_seconds=timeout_seconds,
                    wait_until=wait_until,
                    wait_for=wait_for,
                    session_id=session_id,
                )
                break
            except Exception:
                return None
    if page is None:
        return None
    html, text, metadata = normalize_fetcher_output(page)
    return {
        "html": html,
        "text": text,
        "metadata": metadata,
        "fetcher": f"scrapling:{fetcher_cls.__name__.lower()}",
        "rendered": render in {"stealth", "dynamic"},
        "usedFallback": False,
    }


def unavailable_response(message: str, *, url: str | None = None, details: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": "unavailable",
        "provider": "scrapling",
        "code": "SCRAPLING_FETCH_UNAVAILABLE",
        "message": message,
        "details": details or {},
    }
    if url:
        payload["details"]["url"] = url
    return payload


def error_response(message: str, *, url: str | None = None, details: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": "error",
        "provider": "scrapling",
        "code": "SCRAPLING_FETCH_ERROR",
        "message": message,
        "details": details or {},
    }
    if url:
        payload["details"]["url"] = url
    return payload


def build_fetch_response(payload: dict[str, Any]) -> dict[str, Any]:
    start = time.time()
    request = payload.get("request") if isinstance(payload.get("request"), dict) else {}
    url = normalize_string(payload.get("url")) or normalize_string(request.get("url")) or ""
    if not url:
        raise ValueError("url is required")
    safe_url(url)

    detail = normalize_string(payload.get("detail")) or normalize_string(request.get("detail")) or "brief"
    output = normalize_string(payload.get("output")) or normalize_string(request.get("output")) or "markdown"
    render = normalize_string(payload.get("render")) or normalize_string(request.get("render")) or "auto"
    extract_mode = normalize_string(payload.get("extractMode")) or normalize_string(request.get("extractMode")) or "markdown"
    extract = normalize_string(payload.get("extract")) or normalize_string(request.get("extract")) or "readable"
    main_content_only = as_bool(
        payload.get("mainContentOnly")
        if "mainContentOnly" in payload
        else request.get("mainContentOnly", True),
        True,
    )
    timeout_seconds = as_int(payload.get("timeoutSeconds") or request.get("timeoutSeconds"), DEFAULT_TIMEOUT_SECONDS)
    max_chars = as_int(payload.get("maxChars") or request.get("maxChars"), DEFAULT_MAX_CHARS)
    wait_until = normalize_string(payload.get("waitUntil")) or normalize_string(request.get("waitUntil"))
    wait_for = normalize_string(payload.get("waitFor")) or normalize_string(request.get("waitFor"))
    session_id = normalize_string(payload.get("sessionId")) or normalize_string(request.get("sessionId"))

    if render in {"stealth", "dynamic"} and not SCRAPLING_AVAILABLE:
        return unavailable_response(
            "Scrapling package is not installed for stealth/dynamic rendering.",
            url=url,
            details={
                "render": render,
                "scraplingAvailable": SCRAPLING_AVAILABLE,
            },
        )

    fetched_html = None
    fetched_text = None
    content_type = None
    status_code = 200
    final_url = url
    engine = "urllib"
    metadata: dict[str, Any] = {}

    scrapling_payload = fetch_scrapling(
        url=url,
        render=render,
        timeout_seconds=timeout_seconds,
        wait_until=wait_until,
        wait_for=wait_for,
        session_id=session_id,
    )
    if scrapling_payload is not None:
        engine = "scrapling"
        fetched_html = scrapling_payload.get("html")
        fetched_text = scrapling_payload.get("text")
        metadata.update(scrapling_payload.get("metadata") or {})
        metadata["fetcher"] = scrapling_payload.get("fetcher")
        metadata["rendered"] = scrapling_payload.get("rendered")
        metadata["usedFallback"] = scrapling_payload.get("usedFallback")

    if not fetched_html and not fetched_text:
        try:
            fetched_html, content_type, status_code, final_url = fetch_http(url, timeout_seconds)
            engine = "urllib"
        except HTTPError as error:
            body = error.read().decode(error.headers.get_content_charset() or "utf-8", errors="replace")
            return error_response(
                f"HTTP error {error.code}",
                url=url,
                details={
                    "error": body or error.reason,
                    "finalUrl": url,
                    "statusCode": error.code,
                    "scraplingAvailable": SCRAPLING_AVAILABLE,
                },
            )
        except (URLError, TimeoutError, ValueError) as error:
            return unavailable_response(
                str(error) or "Scrapling sidecar fetch unavailable.",
                url=url,
                details={
                    "error": str(error) or "unknown",
                    "service": "urllib",
                    "scraplingAvailable": SCRAPLING_AVAILABLE,
                },
            )

    if not fetched_text and fetched_html:
        extracted = extract_html(fetched_html)
        fetched_text = extracted["text"]
        if not metadata.get("title"):
            metadata["title"] = extracted["title"]
        metadata.setdefault("headings", extracted["headings"])

    if not fetched_html and fetched_text and output == "html":
        fetched_html = fetched_text

    text = normalize_whitespace(fetched_text or "")
    html = fetched_html
    title = normalize_string(metadata.get("title"))
    summary = derive_summary(text)
    key_points = derive_key_points(text)
    headings = normalize_string_array(metadata.get("headings")) or []
    preview_source = text if text else (html or "")
    preview, preview_truncated = truncate_text(normalize_whitespace(preview_source), min(max_chars, 2_000))
    selected_output = html if output == "html" and html else text
    content, truncated = truncate_text(selected_output, max_chars)
    elapsed_ms = int((time.time() - start) * 1000)
    blocked_detected = detect_blocked(html=html, text=text)
    rendered = render in {"stealth", "dynamic"} or as_bool(metadata.get("rendered"), False)

    if detail == "brief":
        content_output = preview or content
    elif detail == "standard":
        content_output = content
    else:
        content_output = selected_output

    return {
        "status": "ok",
        "provider": "scrapling",
        "fetcher": metadata.get("fetcher") or f"scrapling-sidecar:{engine}",
        "rendered": rendered,
        "usedFallback": engine != "scrapling",
        "blockedDetected": blocked_detected,
        "url": url,
        "finalUrl": final_url,
        "statusCode": status_code,
        "contentType": content_type or ("text/html" if html else "text/plain"),
        "title": title,
        "summary": summary,
        "keyPoints": key_points,
        "headings": headings,
        "contentPreview": preview,
        "html": html if output == "html" else None,
        "content": content_output,
        "text": text,
        "metadata": {
            **metadata,
            "detail": detail,
            "output": output,
            "extractMode": extract_mode,
            "extract": extract,
            "mainContentOnly": main_content_only,
            "scraplingAvailable": SCRAPLING_AVAILABLE,
            "engine": engine,
            "blockedDetected": blocked_detected,
            "previewTruncated": preview_truncated,
        },
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "tookMs": elapsed_ms,
        "warning": "Scrapling package unavailable; using urllib fallback." if engine == "urllib" and not SCRAPLING_AVAILABLE else None,
        "truncated": truncated,
        "length": len(content),
        "rawLength": len(text),
        "wrappedLength": len(content),
    }


class ScraplingSidecarHandler(BaseHTTPRequestHandler):
    server_version = "ScraplingSidecar/phase2"

    def _write_json(self, status_code: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=True, default=str).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == self.server.health_path.rstrip("/"):
            self._write_json(
                200,
                {
                    "status": "ok",
                    "provider": "scrapling",
                    "ready": True,
                    "scraplingAvailable": SCRAPLING_AVAILABLE,
                },
            )
            return
        self._write_json(404, {"status": "error", "message": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != self.server.fetch_path.rstrip("/"):
            self._write_json(404, {"status": "error", "message": "not found"})
            return
        content_length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception as error:
            self._write_json(400, {"status": "error", "message": f"invalid json: {error}"})
            return
        try:
            response = build_fetch_response(payload)
            if response.get("status") == "unavailable":
                self._write_json(503, response)
                return
            if response.get("status") == "error":
                self._write_json(500, response)
                return
            self._write_json(200, response)
        except Exception as error:
            self._write_json(
                500,
                {
                    "status": "error",
                    "provider": "scrapling",
                    "code": "SCRAPLING_FETCH_ERROR",
                    "message": str(error),
                },
            )

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        sys.stderr.write(f"[scrapling-sidecar] {format % args}\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="CrawClaw Scrapling sidecar")
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--healthcheck-path", "--health-path", dest="health_path", default="/health")
    parser.add_argument("--fetch-path", default="/fetch")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), ScraplingSidecarHandler)
    server.health_path = args.health_path  # type: ignore[attr-defined]
    server.fetch_path = args.fetch_path  # type: ignore[attr-defined]
    sys.stderr.write(
        json.dumps(
            {
                "status": "starting",
                "provider": "scrapling",
                "host": args.host,
                "port": args.port,
                "healthPath": args.health_path,
                "fetchPath": args.fetch_path,
                "scraplingAvailable": SCRAPLING_AVAILABLE,
            }
        )
        + "\n"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
