#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def _url_with_params(url, params):
    if not params:
        return url
    query = urlencode({key: value for key, value in params.items() if value is not None})
    if not query:
        return url
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}{query}"


def _request(url, *, method="GET", headers=None, payload=None, params=None, timeout=60):
    body = None
    request_headers = dict(headers or {})
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")

    request = Request(
        _url_with_params(url, params),
        data=body,
        headers=request_headers,
        method=method,
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace").strip()
        suffix = f": {detail}" if detail else ""
        raise SystemExit(f"HTTP {exc.code} for {url}{suffix}") from exc
    except URLError as exc:
        raise SystemExit(f"Request failed for {url}: {exc.reason}") from exc


def request_json(url, *, method="GET", headers=None, payload=None, params=None, timeout=60):
    raw = _request(
        url,
        method=method,
        headers=headers,
        payload=payload,
        params=params,
        timeout=timeout,
    )
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON response from {url}: {exc}") from exc


def download_bytes(url, *, headers=None, params=None, timeout=60):
    return _request(url, headers=headers, params=params, timeout=timeout)
