#!/usr/bin/env python3
import argparse
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import requests


FEISHU_TOKEN_URL = (
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
)
FEISHU_UPLOAD_FILE_URL = "https://open.feishu.cn/open-apis/im/v1/files"
FEISHU_UPLOAD_IMAGE_URL = "https://open.feishu.cn/open-apis/im/v1/images"
FEISHU_SEND_MSG_URL = "https://open.feishu.cn/open-apis/im/v1/messages"
CRAWCLAW_CONFIG = Path.home() / ".crawclaw" / "crawclaw.json"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}


def _strip_trailing_commas(raw: str) -> str:
    """Make relaxed JSON-with-trailing-commas parseable by the stdlib parser."""
    return re.sub(r",(\s*[}\]])", r"\1", raw)


def load_crawclaw_config() -> Dict[str, Any]:
    if not CRAWCLAW_CONFIG.exists():
        raise FileNotFoundError(f"CrawClaw config not found: {CRAWCLAW_CONFIG}")
    raw = CRAWCLAW_CONFIG.read_text(encoding="utf-8")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return json.loads(_strip_trailing_commas(raw))


def resolve_agent_id(config: Dict[str, Any]) -> str:
    cwd = Path.cwd().resolve()
    best_match = (0, None)
    for agent in config.get("agents", {}).get("list", []):
        workspace = agent.get("workspace")
        agent_id = agent.get("id")
        if not workspace or not agent_id:
            continue
        workspace_path = Path(workspace).resolve()
        if str(cwd).startswith(str(workspace_path)):
            match_len = len(str(workspace_path))
            if match_len > best_match[0]:
                best_match = (match_len, agent_id)
    if best_match[1]:
        return best_match[1]
    raise RuntimeError("Unable to resolve agent id from workspace path")


def resolve_feishu_account(
    config: Dict[str, Any], agent_id: Optional[str] = None
) -> Tuple[str, str]:
    feishu_config = config.get("channels", {}).get("feishu", {})

    # Fallback for the common single-account schema used by local CrawClaw setups.
    direct_app_id = feishu_config.get("appId")
    direct_app_secret = feishu_config.get("appSecret")
    if direct_app_id and direct_app_secret:
        return direct_app_id, direct_app_secret

    if not agent_id:
        raise RuntimeError("Unable to resolve Feishu account: missing agent id")

    bindings = config.get("bindings", [])
    account_id = None
    for binding in bindings:
        if binding.get("agentId") == agent_id:
            account_id = binding.get("match", {}).get("accountId")
            if account_id:
                break
    if not account_id:
        raise RuntimeError(f"No Feishu account binding for agent: {agent_id}")

    accounts = feishu_config.get("accounts", {})
    account = accounts.get(account_id)
    if not account:
        raise RuntimeError(f"Feishu account not found: {account_id}")
    app_id = account.get("appId")
    app_secret = account.get("appSecret")
    if not app_id or not app_secret:
        raise RuntimeError(f"Missing appId/appSecret for account: {account_id}")
    return app_id, app_secret


def get_tenant_access_token(app_id: str, app_secret: str) -> str:
    resp = requests.post(
        FEISHU_TOKEN_URL,
        json={"app_id": app_id, "app_secret": app_secret},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Get token failed: {data}")
    return data["tenant_access_token"]


def upload_file(token: str, file_path: Path, file_type: str) -> str:
    headers = {"Authorization": f"Bearer {token}"}
    with file_path.open("rb") as f:
        files = {"file": (file_path.name, f)}
        data = {
            "file_type": file_type,
            "file_name": file_path.name,
        }
        resp = requests.post(
            FEISHU_UPLOAD_FILE_URL,
            headers=headers,
            data=data,
            files=files,
            timeout=30,
        )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Upload file failed: {data}")
    return data["data"]["file_key"]


def upload_image(token: str, file_path: Path) -> str:
    headers = {"Authorization": f"Bearer {token}"}
    with file_path.open("rb") as f:
        files = {"image": (file_path.name, f)}
        data = {"image_type": "message"}
        resp = requests.post(
            FEISHU_UPLOAD_IMAGE_URL,
            headers=headers,
            data=data,
            files=files,
            timeout=30,
        )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Upload image failed: {data}")
    return data["data"]["image_key"]


def send_message(
    token: str,
    receive_id: str,
    receive_id_type: str,
    msg_type: str,
    content: Dict[str, Any],
) -> Dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json; charset=utf-8",
    }
    params = {"receive_id_type": receive_id_type}
    payload = {
        "receive_id": receive_id,
        "msg_type": msg_type,
        "content": json.dumps(content, ensure_ascii=False),
    }
    resp = requests.post(
        FEISHU_SEND_MSG_URL,
        headers=headers,
        params=params,
        json=payload,
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Send message failed: {data}")
    return data


def infer_receive_id_type(receive_id: str, explicit: Optional[str]) -> str:
    if explicit:
        return explicit
    if receive_id.startswith("oc_"):
        return "chat_id"
    if receive_id.startswith("ou_"):
        return "open_id"
    if receive_id.startswith("on_"):
        return "user_id"
    return "chat_id"


def infer_message_type(file_path: Path, explicit: Optional[str]) -> str:
    if explicit:
        return explicit
    return "image" if file_path.suffix.lower() in IMAGE_SUFFIXES else "file"


def resolve_receive_id(cli_value: Optional[str]) -> str:
    if cli_value:
        return cli_value
    env_value = (
        os.getenv("CRAWCLAW_CHAT_ID")
        or os.getenv("CRAWCLAW_RECEIVE_ID")
        or os.getenv("FEISHU_CHAT_ID")
    )
    if env_value:
        return env_value
    raise RuntimeError(
        "Missing receive_id. Provide --receive-id or set CRAWCLAW_CHAT_ID."
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload local file/image to Feishu and send it")
    parser.add_argument("--file", required=True, help="Local file path")
    parser.add_argument("--receive-id", default=None, help="chat_id / open_id / user_id")
    parser.add_argument(
        "--receive-id-type",
        default=None,
        help="chat_id / open_id / user_id (auto-detect if omitted)",
    )
    parser.add_argument(
        "--message-type",
        choices=["file", "image"],
        default=None,
        help="Send as file or image (default: auto infer from extension)",
    )
    parser.add_argument(
        "--file-type",
        default="stream",
        help="file_type for file upload, default stream",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    file_path = Path(args.file).expanduser().resolve()
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    config = load_crawclaw_config()
    try:
        agent_id = resolve_agent_id(config)
    except RuntimeError:
        agent_id = None
    app_id, app_secret = resolve_feishu_account(config, agent_id)

    receive_id = resolve_receive_id(args.receive_id)
    receive_id_type = infer_receive_id_type(receive_id, args.receive_id_type)
    message_type = infer_message_type(file_path, args.message_type)

    token = get_tenant_access_token(app_id, app_secret)
    if message_type == "image":
        image_key = upload_image(token, file_path)
        result = send_message(
            token,
            receive_id,
            receive_id_type,
            "image",
            {"image_key": image_key},
        )
        print(f"IMAGE_UPLOADED: {image_key}")
    else:
        file_key = upload_file(token, file_path, args.file_type)
        result = send_message(
            token,
            receive_id,
            receive_id_type,
            "file",
            {"file_key": file_key},
        )
        print(f"FILE_UPLOADED: {file_key}")

    print(f"RESULT_JSON: {json.dumps(result, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
