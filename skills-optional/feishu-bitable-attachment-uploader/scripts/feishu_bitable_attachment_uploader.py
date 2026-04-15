#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
import random
from pathlib import Path
from typing import Any

BASE_URL = "https://open.feishu.cn/open-apis"
SIMPLE_UPLOAD_LIMIT = 20 * 1024 * 1024
DEFAULT_APPEND_BATCH_SIZE = 10
RETRYABLE_FEISHU_CODES = {1254002, 1254607}


class FeishuError(RuntimeError):
    pass


def parse_feishu_error_code(text: str) -> int | None:
    import re
    match = re.search(r'code=(\d+)', text) or re.search(r'"code"\s*:\s*(\d+)', text) or re.search(r"'code':\s*(\d+)", text)
    return int(match.group(1)) if match else None


def is_retryable_error(exc: Exception) -> bool:
    if isinstance(exc, urllib.error.HTTPError) and exc.code in {408, 409, 425, 429, 500, 502, 503, 504}:
        return True
    code = parse_feishu_error_code(str(exc))
    return code in RETRYABLE_FEISHU_CODES


def backoff_sleep(attempt: int, *, base: float = 0.8, cap: float = 12.0) -> None:
    delay = min(cap, base * (2 ** max(0, attempt - 1))) + random.uniform(0, 0.6)
    time.sleep(delay)


class FeishuBitableAttachmentUploader:
    def __init__(self, app_id: str, app_secret: str, *, timeout: int = 180, verbose: bool = False):
        self.app_id = app_id
        self.app_secret = app_secret
        self.timeout = timeout
        self.verbose = verbose
        self._token: str | None = None

    def _log(self, message: str) -> None:
        if self.verbose:
            print(message, file=sys.stderr)

    def _request(
        self,
        method: str,
        path: str,
        *,
        data: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        raw_data: bytes | None = None,
        expected_codes: tuple[int | None, ...] = (0,),
        retries: int = 5,
    ) -> dict[str, Any]:
        url = f"{BASE_URL}{path}"
        req_headers = dict(headers or {})
        if self._token and "Authorization" not in req_headers:
            req_headers["Authorization"] = f"Bearer {self._token}"
        if data is not None and raw_data is None and "Content-Type" not in req_headers:
            req_headers["Content-Type"] = "application/json; charset=utf-8"

        body = raw_data if raw_data is not None else (json.dumps(data).encode("utf-8") if data is not None else None)
        last_exc: Exception | None = None
        for attempt in range(1, retries + 1):
            req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                details = exc.read().decode("utf-8", errors="replace")
                err = FeishuError(f"HTTP {exc.code} {method} {path}: {details}")
                last_exc = err
                if attempt >= retries or not is_retryable_error(err):
                    raise err from exc
                backoff_sleep(attempt)
                continue
            except Exception as exc:
                err = FeishuError(f"请求失败 {method} {path}: {exc}")
                last_exc = err
                if attempt >= retries or not is_retryable_error(err):
                    raise err from exc
                backoff_sleep(attempt)
                continue

            code = payload.get("code")
            if expected_codes and code not in expected_codes:
                err = FeishuError(f"飞书接口失败 {method} {path}: code={code}, msg={payload.get('msg')}, payload={payload}")
                last_exc = err
                if attempt >= retries or not is_retryable_error(err):
                    raise err
                backoff_sleep(attempt)
                continue
            return payload
        if last_exc is not None:
            raise last_exc
        raise FeishuError(f"请求失败 {method} {path}: unexpected state")

    def get_token(self) -> str:
        if self._token:
            return self._token
        payload = self._request(
            "POST",
            "/auth/v3/tenant_access_token/internal",
            data={"app_id": self.app_id, "app_secret": self.app_secret},
            headers={"Content-Type": "application/json; charset=utf-8"},
            expected_codes=(0,),
        )
        token = payload.get("tenant_access_token")
        if not token:
            raise FeishuError(f"获取 tenant_access_token 失败: {payload}")
        self._token = token
        return token

    def _build_multipart_body(self, fields: dict[str, str], file_field: str, file_name: str, file_bytes: bytes) -> tuple[bytes, str]:
        boundary = f"----CrawClaw{uuid.uuid4().hex}"
        chunks: list[bytes] = []
        for key, value in fields.items():
            chunks.append(f"--{boundary}\r\n".encode())
            chunks.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
            chunks.append(str(value).encode("utf-8"))
            chunks.append(b"\r\n")

        mime_type = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(
            (
                f'Content-Disposition: form-data; name="{file_field}"; filename="{file_name}"\r\n'
                f"Content-Type: {mime_type}\r\n\r\n"
            ).encode()
        )
        chunks.append(file_bytes)
        chunks.append(b"\r\n")
        chunks.append(f"--{boundary}--\r\n".encode())
        return b"".join(chunks), boundary

    def _extract_file_token(self, payload: dict[str, Any]) -> str:
        data = payload.get("data") or {}
        token = data.get("file_token") or data.get("token") or payload.get("file_token")
        if not token:
            raise FeishuError(f"上传成功但未返回 file_token: {payload}")
        return token

    def upload_file(self, app_token: str, file_path: Path, *, upload_name: str | None = None) -> str:
        self.get_token()
        file_name = upload_name or file_path.name
        file_size = file_path.stat().st_size
        if file_size <= SIMPLE_UPLOAD_LIMIT:
            return self._upload_file_simple(app_token, file_path, file_name)
        return self._upload_file_multipart(app_token, file_path, file_name)

    def _upload_file_simple(self, app_token: str, file_path: Path, file_name: str) -> str:
        self._log(f"simple upload: {file_name}")
        body, boundary = self._build_multipart_body(
            {
                "file_name": file_name,
                "parent_type": "bitable_file",
                "parent_node": app_token,
                "size": str(file_path.stat().st_size),
            },
            "file",
            file_name,
            file_path.read_bytes(),
        )
        payload = self._request(
            "POST",
            "/drive/v1/medias/upload_all",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            raw_data=body,
        )
        return self._extract_file_token(payload)

    def _upload_file_multipart(self, app_token: str, file_path: Path, file_name: str) -> str:
        file_size = file_path.stat().st_size
        self._log(f"multipart upload: {file_name} ({file_size} bytes)")
        prepare = self._request(
            "POST",
            "/drive/v1/medias/upload_prepare",
            data={
                "file_name": file_name,
                "parent_type": "bitable_file",
                "parent_node": app_token,
                "size": file_size,
            },
        )
        info = prepare.get("data") or {}
        upload_id = info.get("upload_id")
        block_size = int(info.get("block_size") or 4 * 1024 * 1024)
        block_num = int(info.get("block_num") or ((file_size + block_size - 1) // block_size))
        if not upload_id:
            raise FeishuError(f"upload_prepare 未返回 upload_id: {prepare}")

        with file_path.open("rb") as fh:
            for seq in range(block_num):
                chunk = fh.read(block_size)
                if not chunk:
                    break
                fields = {
                    "upload_id": upload_id,
                    "seq": str(seq),
                    "size": str(len(chunk)),
                }
                body, boundary = self._build_multipart_body(fields, "file", "part.bin", chunk)
                self._request(
                    "POST",
                    "/drive/v1/medias/upload_part",
                    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
                    raw_data=body,
                    expected_codes=(0, None),
                )

        finish = self._request(
            "POST",
            "/drive/v1/medias/upload_finish",
            data={"upload_id": upload_id, "block_num": block_num},
        )
        return self._extract_file_token(finish)

    def get_record(self, app_token: str, table_id: str, record_id: str) -> dict[str, Any]:
        self.get_token()
        payload = self._request("GET", f"/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}")
        record = (payload.get("data") or {}).get("record")
        if not record:
            raise FeishuError(f"读取记录失败: {payload}")
        return record

    def search_record(self, app_token: str, table_id: str, *, field_name: str, field_value: str) -> dict[str, Any] | None:
        self.get_token()
        safe_value = field_value.replace('\\', '\\\\').replace('"', '\\"')
        filter_expr = f'CurrentValue.[{field_name}] = "{safe_value}"'
        path = f"/bitable/v1/apps/{app_token}/tables/{table_id}/records/search"
        payload = self._request("POST", path, data={"filter": filter_expr, "page_size": 1})
        items = (payload.get("data") or {}).get("items") or []
        return items[0] if items else None

    def create_record(self, app_token: str, table_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        self.get_token()
        payload = self._request("POST", f"/bitable/v1/apps/{app_token}/tables/{table_id}/records", data={"fields": fields})
        record = (payload.get("data") or {}).get("record")
        if not record:
            raise FeishuError(f"创建记录失败: {payload}")
        return record

    def update_record(self, app_token: str, table_id: str, record_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        self.get_token()
        payload = self._request(
            "PUT",
            f"/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}",
            data={"fields": fields},
        )
        record = (payload.get("data") or {}).get("record")
        if not record:
            raise FeishuError(f"更新记录失败: {payload}")
        return record


def parse_json_arg(raw: str | None, *, name: str) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise FeishuError(f"{name} 不是合法 JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise FeishuError(f"{name} 必须是 JSON object")
    return value


def guess_attachment_type(file_path: Path) -> str:
    return mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"


def build_attachment_item(file_token: str, file_path: Path, *, upload_name: str | None = None) -> dict[str, Any]:
    item: dict[str, Any] = {
        "file_token": file_token,
        "name": upload_name or file_path.name,
    }
    mime = guess_attachment_type(file_path)
    if mime:
        item["type"] = mime
    return item


def chunked(items: list[Any], size: int) -> list[list[Any]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def load_file_specs(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for raw in paths:
        path = Path(raw).expanduser().resolve()
        if not path.exists():
            raise FeishuError(f"附件不存在: {path}")
        if not path.is_file():
            raise FeishuError(f"附件不是文件: {path}")
        files.append(path)
    return files


def resolve_record_id(
    client: FeishuBitableAttachmentUploader,
    *,
    app_token: str,
    table_id: str,
    record_id: str | None,
    search_field: str | None,
    search_value: str | None,
) -> str | None:
    if record_id:
        return record_id
    if search_field and search_value is not None:
        record = client.search_record(app_token, table_id, field_name=search_field, field_value=search_value)
        if record:
            return record.get("record_id")
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload attachments into a Feishu Bitable record with automatic multipart support.")
    parser.add_argument("--app-token", required=True, help="Bitable app token / base token")
    parser.add_argument("--table-id", required=True, help="Bitable table id")
    parser.add_argument("--attachment-field", required=True, help="Attachment field name in the table")
    parser.add_argument("--file", action="append", required=True, help="Local file path; repeat for multiple attachments")
    parser.add_argument("--record-id", help="Existing record id to update")
    parser.add_argument("--search-field", help="Search an existing record by field name when record_id is unknown")
    parser.add_argument("--search-value", help="Search value used with --search-field")
    parser.add_argument("--create-if-missing", action="store_true", help="Create a record if search misses and no record_id is given")
    parser.add_argument("--fields-json", help="Extra fields JSON object for create/update")
    parser.add_argument("--create-fields-json", help="Fields JSON object used only when creating a record")
    parser.add_argument("--replace-attachments", action="store_true", help="Replace attachment field instead of append mode")
    parser.add_argument("--append-batch-size", type=int, default=DEFAULT_APPEND_BATCH_SIZE, help="How many attachment items to append per record update")
    parser.add_argument("--sleep-ms", type=int, default=300, help="Sleep between attachment update batches to be gentler on the API")
    parser.add_argument("--timeout", type=int, default=180, help="HTTP timeout seconds")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--output", choices=["json", "pretty"], default="json")
    args = parser.parse_args()

    app_id = os.getenv("FEISHU_APP_ID")
    app_secret = os.getenv("FEISHU_APP_SECRET")
    if not app_id or not app_secret:
        raise FeishuError("缺少环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET")
    if args.append_batch_size <= 0:
        raise FeishuError("--append-batch-size 必须大于 0")

    files = load_file_specs(args.file)
    fields_json = parse_json_arg(args.fields_json, name="fields-json")
    create_fields_json = parse_json_arg(args.create_fields_json, name="create-fields-json")

    client = FeishuBitableAttachmentUploader(app_id, app_secret, timeout=args.timeout, verbose=args.verbose)
    record_id = resolve_record_id(
        client,
        app_token=args.app_token,
        table_id=args.table_id,
        record_id=args.record_id,
        search_field=args.search_field,
        search_value=args.search_value,
    )

    created = False
    if not record_id:
        if not args.create_if_missing:
            raise FeishuError("未找到记录。请提供 --record-id，或使用 --search-field/--search-value 配合 --create-if-missing")
        initial_fields = dict(create_fields_json)
        initial_fields.update(fields_json)
        initial_fields.setdefault(args.attachment_field, [])
        record = client.create_record(args.app_token, args.table_id, initial_fields)
        record_id = record["record_id"]
        created = True

    uploaded_items: list[dict[str, Any]] = []
    upload_results: list[dict[str, Any]] = []
    for file_path in files:
        file_token = client.upload_file(args.app_token, file_path)
        item = build_attachment_item(file_token, file_path)
        uploaded_items.append(item)
        upload_results.append(
            {
                "path": str(file_path),
                "name": item["name"],
                "size": file_path.stat().st_size,
                "file_token": file_token,
                "mime": item.get("type"),
                "multipart": file_path.stat().st_size > SIMPLE_UPLOAD_LIMIT,
            }
        )

    batch_updates: list[dict[str, Any]] = []
    if args.replace_attachments:
        final_fields = dict(fields_json)
        final_fields[args.attachment_field] = uploaded_items
        client.update_record(args.app_token, args.table_id, record_id, final_fields)
        batch_updates.append({"mode": "replace", "batch_size": len(uploaded_items)})
    else:
        record = client.get_record(args.app_token, args.table_id, record_id)
        existing_fields = record.get("fields") or {}
        existing_attachments = existing_fields.get(args.attachment_field) or []
        if not isinstance(existing_attachments, list):
            raise FeishuError(f"附件字段 {args.attachment_field} 不是列表，当前值: {existing_attachments}")

        batches = chunked(uploaded_items, args.append_batch_size)
        for index, batch in enumerate(batches, start=1):
            merged = existing_attachments + batch
            payload_fields = {args.attachment_field: merged}
            if index == 1 and fields_json:
                payload_fields.update(fields_json)
            client.update_record(args.app_token, args.table_id, record_id, payload_fields)
            existing_attachments = merged
            batch_updates.append({"mode": "append", "index": index, "batch_size": len(batch), "field_count_after": len(existing_attachments)})
            if args.sleep_ms > 0 and index < len(batches):
                time.sleep(args.sleep_ms / 1000)

    result = {
        "ok": True,
        "created": created,
        "record_id": record_id,
        "app_token": args.app_token,
        "table_id": args.table_id,
        "attachment_field": args.attachment_field,
        "uploaded_count": len(uploaded_items),
        "replace_attachments": args.replace_attachments,
        "batch_updates": batch_updates,
        "uploads": upload_results,
    }

    if args.output == "pretty":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except FeishuError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
