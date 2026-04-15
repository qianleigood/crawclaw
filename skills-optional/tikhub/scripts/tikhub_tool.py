#!/usr/bin/env python3
"""
TikHub Multi-Platform Tool
通过 TikHub 直接 API 调用抖音、小红书、TikTok 数据
"""

import os
import sys
import json
import urllib.request
import urllib.error
import ssl
import re
from pathlib import Path
from typing import Dict, Any, Optional, List
from urllib.parse import urlencode

# 禁用 SSL 证书验证（解决 macOS 证书问题）
ssl._create_default_https_context = ssl._create_unverified_context

# TikHub API 配置（优先从环境变量读取，其次从配置文件读取）
API_BASE_URL = os.environ.get("TIKHUB_API_URL", "https://api.tikhub.io")
DEFAULT_API_KEY = os.environ.get("TIKHUB_API_KEY", "")

# 如果没有环境变量，尝试从配置文件读取
if not DEFAULT_API_KEY:
    _config_paths = [
        Path.home() / ".crawclaw" / "skills" / "xhs-auto-import" / "config" / "tikhub.json",
        Path.home() / ".tikhub",
        Path("/etc/tikhub/config.json"),
    ]
    
    for _config_path in _config_paths:
        if _config_path.exists():
            try:
                with open(_config_path, 'r') as f:
                    _config = json.load(f)
                    DEFAULT_API_KEY = _config.get("api_key", "")
                    API_BASE_URL = _config.get("api_url", API_BASE_URL)
                    break
            except Exception:
                pass

# 如果仍然没有 API Key，则视为未配置：TikHub 仅作为备份链路，不再回退到内置测试 key
if not DEFAULT_API_KEY:
    print("ℹ️  TikHub API Key 未配置；TikHub 备份链路当前不可用", file=sys.stderr)

# 默认请求头
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

# 小红书 Cookie 配置（与 xhs-auto-import 共享）
XHS_COOKIE_FILE = Path(__file__).parent.parent.parent.parent / 'workspace' / 'content_import' / 'XHS-Downloader' / '.env'
XHS_COOKIE: Optional[str] = None

def load_xhs_cookie() -> Optional[str]:
    """加载小红书 Cookie"""
    global XHS_COOKIE
    if XHS_COOKIE is not None:
        return XHS_COOKIE
    
    try:
        if XHS_COOKIE_FILE.exists():
            content = XHS_COOKIE_FILE.read_text(encoding='utf-8')
            for line in content.strip().split('\n'):
                if line.startswith('cookie='):
                    XHS_COOKIE = line.split('=', 1)[1].strip()
                    return XHS_COOKIE
    except Exception:
        pass
    return None


def call_api(endpoint: str, params: Any = None, method: str = "GET", api_key: Optional[str] = None) -> Dict[str, Any]:
    """
    直接调用 TikHub API
    
    Args:
        endpoint: API 端点路径，如 /api/v1/douyin/web/fetch_one_video
        params: 请求参数
        method: HTTP 方法 (GET/POST)
        api_key: TikHub API Key
    
    Returns:
        API 响应结果
    """
    key = api_key or DEFAULT_API_KEY
    if not key:
        raise RuntimeError("TikHub API Key 未配置；当前仅允许将 TikHub 作为备份链路显式启用")
    url = f"{API_BASE_URL}{endpoint}"
    
    headers = {
        **DEFAULT_HEADERS,
        "Authorization": f"Bearer {key}",
    }
    
    try:
        if method == "GET":
            if params:
                url += "?" + urlencode(params)
            req = urllib.request.Request(url, headers=headers)
        else:  # POST
            headers["Content-Type"] = "application/json"
            data = json.dumps(params).encode('utf-8') if params else None
            req = urllib.request.Request(url, data=data, headers=headers, method='POST')
        
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))
            return result
            
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        try:
            error_json = json.loads(error_body)
            return {"error": error_json, "status_code": e.code}
        except:
            return {"error": {"message": error_body}, "status_code": e.code}
            
    except Exception as e:
        return {"error": {"message": str(e)}}


# ==================== 抖音 API ====================

def douyin_fetch_video(aweme_id: str) -> Dict[str, Any]:
    """获取单个视频数据"""
    return call_api("/api/v1/douyin/web/fetch_one_video", {"aweme_id": aweme_id})


def douyin_fetch_video_by_url(share_url: str) -> Dict[str, Any]:
    """根据分享链接获取视频"""
    return call_api("/api/v1/douyin/web/fetch_one_video_by_share_url", {"share_url": share_url})


def douyin_user_profile(sec_user_id: str) -> Dict[str, Any]:
    """获取用户信息"""
    return call_api("/api/v1/douyin/web/handler_user_profile", {"sec_user_id": sec_user_id})


def douyin_user_videos(sec_user_id: str, max_cursor: int = 0, count: int = 20) -> Dict[str, Any]:
    """获取用户作品列表"""
    return call_api("/api/v1/douyin/web/fetch_user_post_videos", {
        "sec_user_id": sec_user_id,
        "max_cursor": max_cursor,
        "count": count
    })


def douyin_search_videos(keyword: str, offset: int = 0, count: int = 20) -> Dict[str, Any]:
    """搜索视频（Search API v2）"""
    return call_api("/api/v1/douyin/search/fetch_video_search_v2", {
        "keyword": keyword,
        "offset": offset,
        "count": count
    })


def douyin_search_videos_app(keyword: str, page: int = 1, sort_type: str = "_0", publish_time: str = "_0", filter_duration: str = "_0", search_id: str = "") -> Dict[str, Any]:
    """搜索视频（App V3 V2）"""
    params = {
        "keyword": keyword,
        "page": page,
        "sort_type": sort_type,
        "publish_time": publish_time,
        "filter_duration": filter_duration,
    }
    if search_id:
        params["search_id"] = search_id
    return call_api("/api/v1/douyin/app/v3/fetch_video_search_result_v2", params)


def douyin_video_comments(aweme_id: str, cursor: int = 0, count: int = 20) -> Dict[str, Any]:
    """获取视频评论（Web）"""
    return call_api("/api/v1/douyin/web/fetch_video_comments", {
        "aweme_id": aweme_id,
        "cursor": cursor,
        "count": count
    })


def douyin_video_comments_app(aweme_id: str, cursor: int = 0, count: int = 20) -> Dict[str, Any]:
    """获取视频评论（App V3）"""
    return call_api("/api/v1/douyin/app/v3/fetch_video_comments", {
        "aweme_id": aweme_id,
        "cursor": cursor,
        "count": count
    })


def douyin_user_like_videos(sec_user_id: str, max_cursor: int = 0, counts: int = 20) -> Dict[str, Any]:
    """获取用户喜欢作品（App V3）"""
    return call_api("/api/v1/douyin/app/v3/fetch_user_like_videos", {
        "sec_user_id": sec_user_id,
        "max_cursor": max_cursor,
        "counts": counts,
    })


def douyin_hot_search() -> Dict[str, Any]:
    """获取热榜 - GET"""
    return call_api("/api/v1/douyin/web/fetch_hot_search_result", method="GET")


def douyin_live_videos_by_room_id(room_id: str) -> Dict[str, Any]:
    """获取直播流数据"""
    return call_api("/api/v1/douyin/web/fetch_user_live_videos_by_room_id_v2", {"room_id": room_id})


def douyin_fetch_multi_videos(*aweme_ids: str, version: str = "v2") -> Dict[str, Any]:
    """批量获取抖音视频详情（App V3）"""
    if len(aweme_ids) == 1 and isinstance(aweme_ids[0], list):
        aweme_ids = tuple(aweme_ids[0])
    clean_ids = [str(x).strip() for x in aweme_ids if str(x).strip()]
    if not clean_ids:
        return {"error": {"message": "缺少 aweme_id 列表"}}
    endpoint = "/api/v1/douyin/app/v3/fetch_multi_video_v2" if version == "v2" else "/api/v1/douyin/web/fetch_multi_video"
    return call_api(endpoint, clean_ids, method="POST")


def douyin_get_all_sec_user_ids(*urls: str) -> Dict[str, Any]:
    """批量提取抖音 sec_user_id"""
    clean_urls = [str(x).strip() for x in urls if str(x).strip()]
    if not clean_urls:
        return {"error": {"message": "缺少用户主页链接列表"}}
    return call_api("/api/v1/douyin/web/get_all_sec_user_id", clean_urls, method="POST")


def douyin_music_hot_search(chart_type: str = "hot", cursor: str = "0") -> Dict[str, Any]:
    """获取抖音音乐热榜"""
    return call_api("/api/v1/douyin/app/v3/fetch_music_hot_search_list", {"chart_type": chart_type, "cursor": cursor})


def douyin_brand_hot_search() -> Dict[str, Any]:
    """获取抖音品牌热榜分类"""
    return call_api("/api/v1/douyin/app/v3/fetch_brand_hot_search_list")


def douyin_fetch_multi_video_statistics(*aweme_ids: str) -> Dict[str, Any]:
    """批量获取抖音视频统计数据"""
    clean_ids = [str(x).strip() for x in aweme_ids if str(x).strip()]
    if not clean_ids:
        return {"error": {"message": "缺少 aweme_id 列表"}}
    return call_api("/api/v1/douyin/app/v3/fetch_multi_video_statistics", {"aweme_ids": ",".join(clean_ids)})


def douyin_fetch_multi_video_high_quality_play_url(*aweme_ids: str) -> Dict[str, Any]:
    """批量获取抖音最高画质播放链接"""
    clean_ids = [str(x).strip() for x in aweme_ids if str(x).strip()]
    if not clean_ids:
        return {"error": {"message": "缺少 aweme_id 列表"}}
    return call_api("/api/v1/douyin/app/v3/fetch_multi_video_high_quality_play_url", {"aweme_ids": ",".join(clean_ids)}, method="POST")


def douyin_video_danmaku(item_id: str, duration: int, start_time: int = 0, end_time: Optional[int] = None) -> Dict[str, Any]:
    """获取单个视频弹幕数据"""
    if end_time is None:
        end_time = max(int(duration) - 1, 0)
    return call_api("/api/v1/douyin/web/fetch_one_video_danmaku", {
        "item_id": item_id,
        "duration": int(duration),
        "start_time": int(start_time),
        "end_time": int(end_time),
    })


# ==================== 小红书 API ====================

def xhs_get_note_info(note_id: str, xsec_token: Optional[str] = None) -> Dict[str, Any]:
    """获取笔记信息（支持 Cookie，xsec_token 可选）
    
    根据 TikHub 官方文档：
    - App 系列接口最稳定（优先使用）
    - Web v2 接口修复速度快
    """
    cookie = load_xhs_cookie()
    params = {"note_id": note_id}
    if xsec_token:
        params["xsec_token"] = xsec_token
    if cookie:
        params["cookie"] = cookie
    
    # 优先使用 App 接口（最稳定）
    return call_api("/api/v1/xiaohongshu/app/get_note_info", params)


def xhs_get_note_info_by_url(share_url: str) -> Dict[str, Any]:
    """根据分享链接获取笔记信息（支持 Cookie）"""
    # 先提取 note_id 和 xsec_token
    extract = xhs_get_note_id_and_token(share_url)
    if "error" in extract:
        return extract
    data = extract.get("data", {})
    note_id = data.get("note_id")
    xsec_token = data.get("xsec_token")
    if not note_id or not xsec_token:
        return {"error": {"message": "无法提取 note_id 或 xsec_token"}}
    return xhs_get_note_info(note_id, xsec_token)


def xhs_get_note_id_and_token(share_url: str) -> Dict[str, Any]:
    """从分享链接提取 note_id 和 xsec_token（支持 Cookie）- 使用 Web 接口"""
    cookie = load_xhs_cookie()
    params = {"share_text": share_url}
    if cookie:
        params["cookie"] = cookie
    # 提取接口只有 Web 版本
    return call_api("/api/v1/xiaohongshu/web/get_note_id_and_xsec_token", params)


def xhs_user_info(user_id: str) -> Dict[str, Any]:
    """获取用户信息（支持 Cookie）- 优先使用 App 接口"""
    cookie = load_xhs_cookie()
    params = {"user_id": user_id}
    if cookie:
        params["cookie"] = cookie
    return call_api("/api/v1/xiaohongshu/app/get_user_info", params)


def xhs_user_notes(user_id: str, cursor: int = 0, count: int = 20) -> Dict[str, Any]:
    """获取用户笔记列表（支持 Cookie）- 优先使用 App 接口，失败时回退 Web v2"""
    cookie = load_xhs_cookie()
    params = {"user_id": user_id, "cursor": cursor, "count": count}
    if cookie:
        params["cookie"] = cookie
    result = call_api("/api/v1/xiaohongshu/app/get_user_notes", params)
    if isinstance(result, dict) and result.get("error"):
        fallback_params = {"user_id": user_id}
        if cursor:
            fallback_params["lastCursor"] = str(cursor)
        return call_api("/api/v1/xiaohongshu/web/get_user_notes_v2", fallback_params)
    return result


def xhs_search_notes(keyword: str, page: int = 1, page_size: int = 20) -> Dict[str, Any]:
    """搜索笔记（支持 Cookie）- 优先使用 App 接口"""
    cookie = load_xhs_cookie()
    params = {"keyword": keyword, "page": page, "page_size": page_size}
    if cookie:
        params["cookie"] = cookie
    return call_api("/api/v1/xiaohongshu/app/search_notes", params, method="POST")


def xhs_note_comments(note_id: str, cursor: int | str | dict = 0, count: int = 20) -> Dict[str, Any]:
    """获取笔记评论（支持 Cookie）- 优先使用 App 接口，失败时回退 Web v2"""
    cookie = load_xhs_cookie()
    params: Dict[str, Any] = {"note_id": note_id, "count": count}
    if cursor not in (None, 0, "", "0"):
        params["cursor"] = cursor
    if cookie:
        params["cookie"] = cookie
    result = call_api("/api/v1/xiaohongshu/app/get_note_comments", params, method="POST")
    if isinstance(result, dict) and result.get("error"):
        fallback_params: Dict[str, Any] = {"note_id": note_id}
        if cursor not in (None, 0, "", "0"):
            fallback_params["cursor"] = cursor if isinstance(cursor, str) else json.dumps(cursor, ensure_ascii=False)
        return call_api("/api/v1/xiaohongshu/web_v2/fetch_note_comments", fallback_params)
    return result


def xhs_hot_list() -> Dict[str, Any]:
    """获取热榜（支持 Cookie）- 优先使用 App 接口"""
    cookie = load_xhs_cookie()
    params = {}
    if cookie:
        params["cookie"] = cookie
    # App 接口没有热榜，使用 Web v2 接口
    return call_api("/api/v1/xiaohongshu/web/v2/fetch_hot_list", params)


def xhs_search_users(keyword: str, page: int = 1, page_size: int = 20) -> Dict[str, Any]:
    """搜索用户（支持 Cookie）- 优先使用 App 接口"""
    cookie = load_xhs_cookie()
    params = {"keyword": keyword, "page": page, "page_size": page_size}
    if cookie:
        params["cookie"] = cookie
    return call_api("/api/v1/xiaohongshu/app/search_users", params, method="POST")


def xhs_extract_user_id_and_token(share_link: str) -> Dict[str, Any]:
    """从用户分享链接提取 user_id 和 xsec_token"""
    return call_api("/api/v1/xiaohongshu/app/get_user_id_and_xsec_token", {"share_link": share_link})


def xhs_topic_info(page_id: str, source: str = "normal", note_id: str = "") -> Dict[str, Any]:
    """获取话题详情"""
    params = {"page_id": page_id, "source": source}
    if note_id:
        params["note_id"] = note_id
    return call_api("/api/v1/xiaohongshu/app_v2/get_topic_info", params)


def xhs_topic_feed(page_id: str, sort: str = "trend") -> Dict[str, Any]:
    """获取话题笔记列表"""
    return call_api("/api/v1/xiaohongshu/app_v2/get_topic_feed", {"page_id": page_id, "sort": sort})


def xhs_search_products(keyword: str, page: int = 1, sort: str = "") -> Dict[str, Any]:
    """搜索商品"""
    params = {"keyword": keyword, "page": page}
    if sort:
        params["sort"] = sort
    return call_api("/api/v1/xiaohongshu/app/search_products", params)


def xhs_product_detail(sku_id: str) -> Dict[str, Any]:
    """获取商品详情"""
    return call_api("/api/v1/xiaohongshu/app/get_product_detail", {"sku_id": sku_id})


def xhs_sub_comments(note_id: str, comment_id: str, start: str = "") -> Dict[str, Any]:
    """获取子评论"""
    params = {"note_id": note_id, "comment_id": comment_id}
    if start:
        params["start"] = start
    cookie = load_xhs_cookie()
    if cookie:
        params["cookie"] = cookie
    return call_api("/api/v1/xiaohongshu/app/get_sub_comments", params, method="POST")


# ==================== TikTok API ====================

def extract_tiktok_video_id(url: str) -> Optional[str]:
    """从 TikTok URL 提取视频 ID"""
    match = re.search(r'/video/(\d+)', url)
    if match:
        return match.group(1)
    return None


def extract_tiktok_username(value: str) -> str:
    """从用户名、@handle 或主页 URL 中提取 TikTok 用户名"""
    value = (value or "").strip()
    match = re.search(r'tiktok\.com/@([^/?#]+)', value)
    if match:
        return match.group(1)
    if value.startswith('@'):
        return value[1:]
    return value


def normalize_tiktok_profile_url(value: str) -> str:
    """标准化 TikTok 用户主页 URL"""
    value = (value or "").strip()
    if value.startswith('http://') or value.startswith('https://'):
        return value
    username = extract_tiktok_username(value)
    return f"https://www.tiktok.com/@{username}"


def is_tiktok_sec_user_id(value: str) -> bool:
    """判断是否为 TikTok sec_user_id / secUid"""
    value = (value or "").strip()
    return value.startswith("MS4w")


def _extract_api_data(result: Dict[str, Any]) -> Any:
    """从 TikHub 响应中提取 data 字段"""
    if not isinstance(result, dict):
        return None
    return result.get("data")


def tiktok_get_sec_user_id(user_or_url: str) -> Dict[str, Any]:
    """提取用户 sec_user_id/secUid"""
    if is_tiktok_sec_user_id(user_or_url):
        return {"code": 200, "data": user_or_url, "message": "sec_user_id provided directly"}
    profile_url = normalize_tiktok_profile_url(user_or_url)
    return call_api("/api/v1/tiktok/web/get_sec_user_id", {"url": profile_url})


def tiktok_get_unique_id(user_or_url: str) -> Dict[str, Any]:
    """提取用户 unique_id（用户名）"""
    if not user_or_url:
        return {"error": {"message": "缺少 TikTok 用户标识"}}
    if not (user_or_url.startswith('http://') or user_or_url.startswith('https://')) and not is_tiktok_sec_user_id(user_or_url):
        return {"code": 200, "data": extract_tiktok_username(user_or_url), "message": "unique_id provided directly"}
    if is_tiktok_sec_user_id(user_or_url):
        profile = call_api("/api/v1/tiktok/web/fetch_user_profile", {"secUid": user_or_url})
        unique_id = (((profile.get("data") or {}).get("userInfo") or {}).get("user") or {}).get("uniqueId")
        if unique_id:
            return {"code": 200, "data": unique_id, "message": "resolved from profile"}
        return profile
    profile_url = normalize_tiktok_profile_url(user_or_url)
    return call_api("/api/v1/tiktok/web/get_unique_id", {"url": profile_url})


def tiktok_get_user_ids_by_username(username: str) -> Dict[str, Any]:
    """使用 App V3 根据用户名获取 user_id / sec_user_id"""
    return call_api(
        "/api/v1/tiktok/app/v3/get_user_id_and_sec_user_id_by_username",
        {"username": extract_tiktok_username(username)},
    )


def tiktok_get_all_sec_user_ids(*users_or_urls: str) -> Dict[str, Any]:
    """批量提取用户 sec_user_id/secUid"""
    urls = [normalize_tiktok_profile_url(x) for x in users_or_urls if str(x).strip()]
    if not urls:
        return {"error": {"message": "缺少用户主页链接列表"}}
    return call_api("/api/v1/tiktok/web/get_all_sec_user_id", urls, method="POST")


def tiktok_get_all_unique_ids(*users_or_urls: str) -> Dict[str, Any]:
    """批量提取用户 unique_id"""
    urls = [normalize_tiktok_profile_url(x) for x in users_or_urls if str(x).strip()]
    if not urls:
        return {"error": {"message": "缺少用户主页链接列表"}}
    return call_api("/api/v1/tiktok/web/get_all_unique_id", urls, method="POST")


def resolve_tiktok_user_id(user_or_url: str) -> Optional[str]:
    """尽量稳定地解析 TikTok user_id"""
    username = extract_tiktok_username(user_or_url)
    if username:
        ids_result = tiktok_get_user_ids_by_username(username)
        user_id = (_extract_api_data(ids_result) or {}).get("user_id") if isinstance(_extract_api_data(ids_result), dict) else None
        if user_id is not None:
            return str(user_id)
    profile = tiktok_user_profile(user_or_url)
    data = profile.get("data") or {}
    user = data.get("user") or ((data.get("userInfo") or {}).get("user") or {})
    candidate = user.get("user_id") or user.get("uid") or user.get("id")
    return str(candidate) if candidate not in (None, "") else None


def resolve_tiktok_sec_user_id(user_or_url: str) -> Optional[str]:
    """尽量稳定地解析 sec_user_id，优先走 App V3"""
    if is_tiktok_sec_user_id(user_or_url):
        return user_or_url

    username = extract_tiktok_username(user_or_url)
    if username:
        ids_result = tiktok_get_user_ids_by_username(username)
        sec_user_id = (_extract_api_data(ids_result) or {}).get("sec_user_id") if isinstance(_extract_api_data(ids_result), dict) else None
        if sec_user_id:
            return sec_user_id

    sec_result = tiktok_get_sec_user_id(user_or_url)
    sec_user_id = _extract_api_data(sec_result)
    if isinstance(sec_user_id, str) and sec_user_id:
        return sec_user_id

    profile = call_api("/api/v1/tiktok/web/fetch_user_profile", {"uniqueId": username}) if username else {}
    return (((profile.get("data") or {}).get("userInfo") or {}).get("user") or {}).get("secUid")


def tiktok_fetch_post(aweme_id: str, region: str = "US") -> Dict[str, Any]:
    """获取视频详情（优先使用 App V3）"""
    result = call_api("/api/v1/tiktok/app/v3/fetch_one_video_v3", {"aweme_id": aweme_id, "region": region})
    if isinstance(result, dict) and result.get("error"):
        return call_api("/api/v1/tiktok/web/fetch_post_detail_v2", {"itemId": aweme_id})
    return result


def tiktok_fetch_post_by_url(video_url: str) -> Dict[str, Any]:
    """根据链接获取视频详情（优先使用 App V3）"""
    result = call_api("/api/v1/tiktok/app/v3/fetch_one_video_by_share_url_v2", {"share_url": video_url})
    if isinstance(result, dict) and result.get("error"):
        aweme_id = extract_tiktok_video_id(video_url)
        if not aweme_id:
            return {"error": {"message": "无法从链接提取视频 ID"}}
        return tiktok_fetch_post(aweme_id)
    return result


def tiktok_fetch_multi_videos(*aweme_ids: str, version: str = "v2") -> Dict[str, Any]:
    """批量获取视频详情（App V3）"""
    if len(aweme_ids) == 1 and isinstance(aweme_ids[0], list):
        aweme_ids = tuple(aweme_ids[0])
    clean_ids = [str(x).strip() for x in aweme_ids if str(x).strip()]
    if not clean_ids:
        return {"error": {"message": "缺少 aweme_id 列表"}}

    if version == "v1":
        endpoint = "/api/v1/tiktok/app/v3/fetch_multi_video"
        max_size = 10
    else:
        endpoint = "/api/v1/tiktok/app/v3/fetch_multi_video_v2"
        max_size = 25

    if len(clean_ids) > max_size:
        return {"error": {"message": f"{version} 最多支持 {max_size} 个 aweme_id，本次提供了 {len(clean_ids)} 个"}}

    return call_api(endpoint, clean_ids, method="POST")


def tiktok_user_profile(user: str) -> Dict[str, Any]:
    """获取用户信息（优先使用 App V3，自动解析 sec_user_id）"""
    sec_user_id = resolve_tiktok_sec_user_id(user)
    params = {"sec_user_id": sec_user_id} if sec_user_id else {"unique_id": extract_tiktok_username(user)}
    result = call_api("/api/v1/tiktok/app/v3/handler_user_profile", params)
    if isinstance(result, dict) and result.get("error"):
        fallback = {"secUid": sec_user_id} if sec_user_id else {"uniqueId": extract_tiktok_username(user)}
        return call_api("/api/v1/tiktok/web/fetch_user_profile", fallback)
    return result


def tiktok_user_posts(user: str, max_cursor: int = 0, count: int = 20, sort_type: int = 0) -> Dict[str, Any]:
    """获取用户作品列表（优先使用 App V3 V3，自动解析 sec_user_id）"""
    sec_user_id = resolve_tiktok_sec_user_id(user)
    params = {
        "max_cursor": max_cursor,
        "count": count,
        "sort_type": sort_type,
    }
    if sec_user_id:
        params["sec_user_id"] = sec_user_id
    else:
        params["unique_id"] = extract_tiktok_username(user)

    for endpoint in [
        "/api/v1/tiktok/app/v3/fetch_user_post_videos_v3",
        "/api/v1/tiktok/app/v3/fetch_user_post_videos_v2",
        "/api/v1/tiktok/app/v3/fetch_user_post_videos",
    ]:
        result = call_api(endpoint, params)
        if not (isinstance(result, dict) and result.get("error")):
            return result

    web_params = {
        "cursor": max_cursor,
        "count": count,
        "coverFormat": 2,
        "post_item_list_request_type": sort_type,
    }
    if sec_user_id:
        web_params["secUid"] = sec_user_id
    else:
        web_params["secUid"] = resolve_tiktok_sec_user_id(user)
    return call_api("/api/v1/tiktok/web/fetch_user_post", web_params)


def tiktok_user_posts_all(user: str, count: int = 20, sort_type: int = 0, max_pages: int = 20) -> Dict[str, Any]:
    """分页拉取用户全部作品（优先 App V3）"""
    all_items: List[Dict[str, Any]] = []
    max_cursor = 0
    pages = 0
    last_page: Dict[str, Any] = {}

    while pages < max_pages:
        page = tiktok_user_posts(user, max_cursor=max_cursor, count=count, sort_type=sort_type)
        if isinstance(page, dict) and page.get("error"):
            return page if pages == 0 else {
                "code": 200,
                "message": "partial_success",
                "data": {
                    "aweme_list": all_items,
                    "pages": pages,
                    "last_success_max_cursor": max_cursor,
                    "last_page": last_page.get("data"),
                    "error": page.get("error"),
                },
            }

        data = page.get("data") or {}
        items = data.get("aweme_list") or []
        all_items.extend(items)
        pages += 1
        last_page = page

        has_more = data.get("has_more")
        next_cursor = data.get("max_cursor")
        if not has_more or next_cursor in (None, max_cursor):
            break
        max_cursor = next_cursor

    return {
        "code": 200,
        "message": "success",
        "data": {
            "aweme_list": all_items,
            "pages": pages,
            "has_more": bool((last_page.get("data") or {}).get("has_more")),
            "max_cursor": (last_page.get("data") or {}).get("max_cursor"),
        },
    }


def tiktok_search_videos(keyword: str, offset: int = 0, count: int = 20, search_id: str = "", cookie: str = "") -> Dict[str, Any]:
    """搜索视频（Web）"""
    params = {
        "keyword": keyword,
        "offset": offset,
        "count": count,
    }
    if search_id:
        params["search_id"] = search_id
    if cookie:
        params["cookie"] = cookie
    return call_api("/api/v1/tiktok/web/fetch_search_video", params)


def tiktok_search_videos_app(keyword: str, offset: int = 0, count: int = 20, sort_type: int = 0, publish_time: int = 0, region: str = "US") -> Dict[str, Any]:
    """搜索视频（App V3）"""
    return call_api("/api/v1/tiktok/app/v3/fetch_video_search_result", {
        "keyword": keyword,
        "offset": offset,
        "count": count,
        "sort_type": sort_type,
        "publish_time": publish_time,
        "region": region,
    })


def tiktok_search_users(keyword: str, cursor: int = 0, search_id: str = "", cookie: str = "") -> Dict[str, Any]:
    """搜索用户（Web）"""
    params = {
        "keyword": keyword,
        "cursor": cursor,
    }
    if search_id:
        params["search_id"] = search_id
    if cookie:
        params["cookie"] = cookie
    return call_api("/api/v1/tiktok/web/fetch_search_user", params)


def tiktok_post_comments(aweme_id: str, cursor: int = 0, count: int = 20, current_region: str = "") -> Dict[str, Any]:
    """获取视频评论（Web）"""
    params = {
        "aweme_id": aweme_id,
        "cursor": cursor,
        "count": count,
    }
    if current_region:
        params["current_region"] = current_region
    return call_api("/api/v1/tiktok/web/fetch_post_comment", params)


def tiktok_post_comments_app(aweme_id: str, cursor: int = 0, count: int = 20) -> Dict[str, Any]:
    """获取视频评论（App V3）"""
    return call_api("/api/v1/tiktok/app/v3/fetch_video_comments", {
        "aweme_id": aweme_id,
        "cursor": cursor,
        "count": count,
    })


def tiktok_user_like_videos(user: str, max_cursor: int = 0, counts: int = 20) -> Dict[str, Any]:
    """获取用户喜欢作品列表（App V3）"""
    sec_user_id = resolve_tiktok_sec_user_id(user)
    if not sec_user_id:
        return {"error": {"message": f"无法解析用户 sec_user_id: {user}"}}
    return call_api("/api/v1/tiktok/app/v3/fetch_user_like_videos", {
        "sec_user_id": sec_user_id,
        "max_cursor": max_cursor,
        "counts": counts,
    })


def tiktok_user_repost_videos(user: str, offset: int = 0, count: int = 21) -> Dict[str, Any]:
    """获取用户转发作品列表（App V3）"""
    user_id = resolve_tiktok_user_id(user)
    if not user_id:
        return {"error": {"message": f"无法解析用户 user_id: {user}"}}
    return call_api("/api/v1/tiktok/app/v3/fetch_user_repost_videos", {
        "user_id": int(user_id),
        "offset": offset,
        "count": count,
    })


def tiktok_music_chart(scene: int = 0, cursor: int = 0, count: int = 50) -> Dict[str, Any]:
    """获取音乐排行榜（App V3）"""
    return call_api("/api/v1/tiktok/app/v3/fetch_music_chart_list", {
        "scene": scene,
        "cursor": cursor,
        "count": count,
    })


def tiktok_music_search(keyword: str, offset: int = 0, count: int = 20, filter_by: int = 0, sort_type: int = 0, region: str = "US") -> Dict[str, Any]:
    """搜索音乐（App V3）"""
    return call_api("/api/v1/tiktok/app/v3/fetch_music_search_result", {
        "keyword": keyword,
        "offset": offset,
        "count": count,
        "filter_by": filter_by,
        "sort_type": sort_type,
        "region": region,
    })


def tiktok_music_detail(music_id: str) -> Dict[str, Any]:
    """获取音乐详情（App V3）"""
    return call_api("/api/v1/tiktok/app/v3/fetch_music_detail", {"music_id": music_id})


def tiktok_music_videos(music_id: str, cursor: int = 0, count: int = 10) -> Dict[str, Any]:
    """获取音乐关联视频列表（App V3）"""
    return call_api("/api/v1/tiktok/app/v3/fetch_music_video_list", {
        "music_id": music_id,
        "cursor": cursor,
        "count": count,
    })


def tiktok_hashtag_search(keyword: str, offset: int = 0, count: int = 20) -> Dict[str, Any]:
    """搜索话题（App V3）"""
    return call_api("/api/v1/tiktok/app/v3/fetch_hashtag_search_result", {
        "keyword": keyword,
        "offset": offset,
        "count": count,
    })


def tiktok_hashtag_detail(ch_id: str) -> Dict[str, Any]:
    """获取话题详情（App V3）"""
    return call_api("/api/v1/tiktok/app/v3/fetch_hashtag_detail", {"ch_id": ch_id})


def tiktok_hashtag_videos(ch_id: str, cursor: int = 0, count: int = 10) -> Dict[str, Any]:
    """获取话题视频列表（App V3）"""
    return call_api("/api/v1/tiktok/app/v3/fetch_hashtag_video_list", {
        "ch_id": ch_id,
        "cursor": cursor,
        "count": count,
    })


def tiktok_comment_replies(item_id: str, comment_id: str, cursor: int = 0, count: int = 20) -> Dict[str, Any]:
    """获取评论回复（App V3）"""
    return call_api("/api/v1/tiktok/app/v3/fetch_video_comment_replies", {
        "item_id": item_id,
        "comment_id": comment_id,
        "cursor": cursor,
        "count": count,
    })


def tiktok_search_keyword_suggest(keyword: str) -> Dict[str, Any]:
    """获取搜索关键词建议（Web）"""
    return call_api("/api/v1/tiktok/web/fetch_search_keyword_suggest", {"keyword": keyword})


def tiktok_trending_posts(region: str = "US") -> Dict[str, Any]:
    """获取趋势视频"""
    return call_api("/api/v1/tiktok/web/fetch_trending_post", {"region": region})


def tiktok_trending_searchwords(region: str = "US") -> Dict[str, Any]:
    """获取趋势搜索词"""
    return call_api("/api/v1/tiktok/web/fetch_trending_searchwords", {"region": region})


def tiktok_user_followers(user: str, count: int = 30, max_cursor: int = 0, min_cursor: int = 0) -> Dict[str, Any]:
    """获取粉丝列表（自动解析 sec_user_id）"""
    sec_user_id = resolve_tiktok_sec_user_id(user)
    if not sec_user_id:
        return {"error": {"message": f"无法解析用户 sec_user_id: {user}"}}
    return call_api("/api/v1/tiktok/web/fetch_user_fans", {
        "secUid": sec_user_id,
        "count": count,
        "maxCursor": max_cursor,
        "minCursor": min_cursor,
    })


def tiktok_user_following(user: str, count: int = 30, max_cursor: int = 0, min_cursor: int = 0) -> Dict[str, Any]:
    """获取关注列表（自动解析 sec_user_id）"""
    sec_user_id = resolve_tiktok_sec_user_id(user)
    if not sec_user_id:
        return {"error": {"message": f"无法解析用户 sec_user_id: {user}"}}
    return call_api("/api/v1/tiktok/web/fetch_user_follow", {
        "secUid": sec_user_id,
        "count": count,
        "maxCursor": max_cursor,
        "minCursor": min_cursor,
    })


# ==================== 微信公众号 API ====================

def wechat_mp_article_detail_json(url: str) -> Dict[str, Any]:
    """获取公众号文章详情 JSON"""
    return call_api("/api/v1/wechat_mp/web/fetch_mp_article_detail_json", {"url": url})


def wechat_mp_article_detail_html(url: str) -> Dict[str, Any]:
    """获取公众号文章详情 HTML"""
    return call_api("/api/v1/wechat_mp/web/fetch_mp_article_detail_html", {"url": url})


def wechat_mp_article_comment_list(url: str, comment_id: str = "", buffer: str = "") -> Dict[str, Any]:
    """获取公众号文章评论列表"""
    params = {"url": url}
    if comment_id:
        params["comment_id"] = comment_id
    if buffer:
        params["buffer"] = buffer
    return call_api("/api/v1/wechat_mp/web/fetch_mp_article_comment_list", params)


def wechat_mp_article_list(ghid: str, offset: str = "") -> Dict[str, Any]:
    """获取公众号文章列表"""
    params = {"ghid": ghid}
    if offset:
        params["offset"] = offset
    return call_api("/api/v1/wechat_mp/web/fetch_mp_article_list", params)


def wechat_mp_article_url_conversion(url: str) -> Dict[str, Any]:
    """公众号长链接转短链接"""
    return call_api("/api/v1/wechat_mp/web/fetch_mp_article_url_conversion", {"url": url})


def wechat_mp_article_read_count(url: str, comment_id: str) -> Dict[str, Any]:
    """获取公众号文章阅读量"""
    return call_api("/api/v1/wechat_mp/web/fetch_mp_article_read_count", {"url": url, "comment_id": comment_id})


# ==================== 微信视频号 API ====================

def wechat_channels_video_detail(id: str = "", exportId: str = "") -> Dict[str, Any]:
    """获取视频号视频详情"""
    params: Dict[str, Any] = {}
    if id:
        params["id"] = id
    if exportId:
        params["exportId"] = exportId
    return call_api("/api/v1/wechat_channels/fetch_video_detail", params)


def wechat_channels_comments(id: str, lastBuffer: str = "", comment_id: str = "") -> Dict[str, Any]:
    """获取视频号评论/子评论"""
    params = {"id": id}
    if lastBuffer:
        params["lastBuffer"] = lastBuffer
    if comment_id:
        params["comment_id"] = comment_id
    return call_api("/api/v1/wechat_channels/fetch_comments", params, method="POST")


def wechat_channels_search_latest(keywords: str) -> Dict[str, Any]:
    """搜索视频号最新视频"""
    return call_api("/api/v1/wechat_channels/fetch_search_latest", {"keywords": keywords})


def wechat_channels_user_search(keywords: str, page: int = 1) -> Dict[str, Any]:
    """搜索视频号用户"""
    return call_api("/api/v1/wechat_channels/fetch_user_search", {"keywords": keywords, "page": page})


def wechat_channels_hot_words() -> Dict[str, Any]:
    """获取视频号热门话题"""
    return call_api("/api/v1/wechat_channels/fetch_hot_words")


# ==================== 工具列表 ====================

API_TOOLS = {
    "douyin": {
        "video-by-url": {"func": douyin_fetch_video_by_url, "args": ["url"], "desc": "根据分享链接获取视频"},
        "video-by-id": {"func": douyin_fetch_video, "args": ["aweme_id"], "desc": "根据视频 ID 获取视频"},
        "video-batch": {"func": douyin_fetch_multi_videos, "args": ["aweme_id ..."], "desc": "批量获取视频（App V3 V2）"},
        "video-batch-stats": {"func": douyin_fetch_multi_video_statistics, "args": ["aweme_id ..."], "desc": "批量获取视频统计数据"},
        "video-batch-hq": {"func": douyin_fetch_multi_video_high_quality_play_url, "args": ["aweme_id ..."], "desc": "批量获取最高画质播放链接"},
        "get-secuid-batch": {"func": douyin_get_all_sec_user_ids, "args": ["url ..."], "desc": "批量提取 sec_user_id"},
        "user-info": {"func": douyin_user_profile, "args": ["sec_user_id"], "desc": "获取用户信息"},
        "user-videos": {"func": douyin_user_videos, "args": ["sec_user_id"], "desc": "获取用户作品列表"},
        "user-likes": {"func": douyin_user_like_videos, "args": ["sec_user_id"], "desc": "获取用户喜欢作品（App V3）"},
        "search": {"func": douyin_search_videos, "args": ["keyword"], "desc": "搜索视频（Search API v2）"},
        "search-app": {"func": douyin_search_videos_app, "args": ["keyword"], "desc": "搜索视频（App V3 V2）"},
        "comments": {"func": douyin_video_comments, "args": ["aweme_id"], "desc": "获取视频评论（Web）"},
        "comments-app": {"func": douyin_video_comments_app, "args": ["aweme_id"], "desc": "获取视频评论（App V3）"},
        "danmaku": {"func": douyin_video_danmaku, "args": ["item_id", "duration"], "desc": "获取视频弹幕（可额外传 start_time end_time）"},
        "hot-search": {"func": douyin_hot_search, "args": [], "desc": "获取热榜"},
        "hot-search-music": {"func": douyin_music_hot_search, "args": [], "desc": "获取音乐热榜"},
        "hot-search-brand": {"func": douyin_brand_hot_search, "args": [], "desc": "获取品牌热榜分类"},
        "live": {"func": douyin_live_videos_by_room_id, "args": ["room_id"], "desc": "获取直播流"},
    },
    "xhs": {
        "note-by-url": {"func": xhs_get_note_info_by_url, "args": ["url"], "desc": "根据分享链接获取笔记"},
        "note-by-id": {"func": xhs_get_note_info, "args": ["note_id"], "desc": "根据 ID 获取笔记 (xsec_token 可选)"},
        "extract-token": {"func": xhs_get_note_id_and_token, "args": ["url"], "desc": "从链接提取 note_id 和 xsec_token"},
        "extract-user": {"func": xhs_extract_user_id_and_token, "args": ["share_link"], "desc": "从分享链接提取 user_id 和 xsec_token"},
        "user-info": {"func": xhs_user_info, "args": ["user_id"], "desc": "获取用户信息"},
        "user-notes": {"func": xhs_user_notes, "args": ["user_id"], "desc": "获取用户笔记列表"},
        "topic-info": {"func": xhs_topic_info, "args": ["page_id"], "desc": "获取话题详情"},
        "topic-feed": {"func": xhs_topic_feed, "args": ["page_id"], "desc": "获取话题笔记列表"},
        "search": {"func": xhs_search_notes, "args": ["keyword"], "desc": "搜索笔记"},
        "search-users": {"func": xhs_search_users, "args": ["keyword"], "desc": "搜索用户"},
        "search-products": {"func": xhs_search_products, "args": ["keyword"], "desc": "搜索商品"},
        "product-detail": {"func": xhs_product_detail, "args": ["sku_id"], "desc": "获取商品详情"},
        "comments": {"func": xhs_note_comments, "args": ["note_id"], "desc": "获取笔记评论"},
        "sub-comments": {"func": xhs_sub_comments, "args": ["note_id", "comment_id"], "desc": "获取子评论"},
        "hot-list": {"func": xhs_hot_list, "args": [], "desc": "获取热榜"},
    },
    "tiktok": {
        "video-by-url": {"func": tiktok_fetch_post_by_url, "args": ["url"], "desc": "根据链接获取视频（App V3）"},
        "video-by-id": {"func": tiktok_fetch_post, "args": ["aweme_id"], "desc": "根据视频 ID 获取视频（App V3）"},
        "video-batch": {"func": tiktok_fetch_multi_videos, "args": ["aweme_id ..."], "desc": "批量获取视频（App V3 V2，最多 25 个）"},
        "video-batch-v1": {"func": lambda *args: tiktok_fetch_multi_videos(list(args), version="v1"), "args": ["aweme_id ..."], "desc": "批量获取视频（App V3 V1，最多 10 个）"},
        "music-chart": {"func": tiktok_music_chart, "args": [], "desc": "获取音乐排行榜（App V3）"},
        "music-search": {"func": tiktok_music_search, "args": ["keyword"], "desc": "搜索音乐（App V3）"},
        "music-detail": {"func": tiktok_music_detail, "args": ["music_id"], "desc": "获取音乐详情（App V3）"},
        "music-videos": {"func": tiktok_music_videos, "args": ["music_id"], "desc": "获取音乐关联视频（App V3）"},
        "hashtag-search": {"func": tiktok_hashtag_search, "args": ["keyword"], "desc": "搜索话题（App V3）"},
        "hashtag-detail": {"func": tiktok_hashtag_detail, "args": ["ch_id"], "desc": "获取话题详情（App V3）"},
        "hashtag-videos": {"func": tiktok_hashtag_videos, "args": ["ch_id"], "desc": "获取话题视频列表（App V3）"},
        "search-suggest": {"func": tiktok_search_keyword_suggest, "args": ["keyword"], "desc": "获取搜索建议（Web）"},
        "get-secuid": {"func": tiktok_get_sec_user_id, "args": ["user_or_url"], "desc": "提取 sec_user_id/secUid"},
        "get-secuid-batch": {"func": tiktok_get_all_sec_user_ids, "args": ["user_or_url ..."], "desc": "批量提取 sec_user_id/secUid"},
        "get-uniqueid": {"func": tiktok_get_unique_id, "args": ["user_or_url"], "desc": "提取 unique_id（用户名）"},
        "get-uniqueid-batch": {"func": tiktok_get_all_unique_ids, "args": ["user_or_url ..."], "desc": "批量提取 unique_id（用户名）"},
        "user-ids": {"func": tiktok_get_user_ids_by_username, "args": ["username"], "desc": "获取 user_id / sec_user_id（App V3）"},
        "user-info": {"func": tiktok_user_profile, "args": ["user_or_url"], "desc": "获取用户信息（自动解析 sec_user_id）"},
        "user-videos": {"func": tiktok_user_posts, "args": ["user_or_url"], "desc": "获取用户作品列表（App V3）"},
        "user-videos-all": {"func": tiktok_user_posts_all, "args": ["user_or_url"], "desc": "分页拉取用户全部作品（App V3）"},
        "user-likes": {"func": tiktok_user_like_videos, "args": ["user_or_url"], "desc": "获取用户喜欢作品（App V3）"},
        "user-reposts": {"func": tiktok_user_repost_videos, "args": ["user_or_url"], "desc": "获取用户转发作品（App V3）"},
        "search": {"func": tiktok_search_videos, "args": ["keyword"], "desc": "搜索视频（Web）"},
        "search-app": {"func": tiktok_search_videos_app, "args": ["keyword"], "desc": "搜索视频（App V3）"},
        "search-users": {"func": tiktok_search_users, "args": ["keyword"], "desc": "搜索用户（Web）"},
        "comments": {"func": tiktok_post_comments, "args": ["aweme_id"], "desc": "获取视频评论（Web）"},
        "comments-app": {"func": tiktok_post_comments_app, "args": ["aweme_id"], "desc": "获取视频评论（App V3）"},
        "comment-replies": {"func": tiktok_comment_replies, "args": ["item_id", "comment_id"], "desc": "获取评论回复（App V3）"},
        "trending": {"func": tiktok_trending_posts, "args": [], "desc": "获取趋势视频"},
        "trending-words": {"func": tiktok_trending_searchwords, "args": [], "desc": "获取趋势搜索词"},
        "followers": {"func": tiktok_user_followers, "args": ["user_or_url"], "desc": "获取粉丝列表（自动解析 sec_user_id）"},
        "following": {"func": tiktok_user_following, "args": ["user_or_url"], "desc": "获取关注列表（自动解析 sec_user_id）"},
    },
    "wechat-mp": {
        "article-json": {"func": wechat_mp_article_detail_json, "args": ["url"], "desc": "获取公众号文章详情 JSON"},
        "article-html": {"func": wechat_mp_article_detail_html, "args": ["url"], "desc": "获取公众号文章详情 HTML"},
        "article-comments": {"func": wechat_mp_article_comment_list, "args": ["url"], "desc": "获取公众号文章评论列表"},
        "article-list": {"func": wechat_mp_article_list, "args": ["ghid"], "desc": "获取公众号文章列表"},
        "article-short-url": {"func": wechat_mp_article_url_conversion, "args": ["url"], "desc": "将公众号长链接转短链接"},
        "article-read-count": {"func": wechat_mp_article_read_count, "args": ["url", "comment_id"], "desc": "获取公众号文章阅读量"},
    },
    "wechat-channels": {
        "video-detail": {"func": wechat_channels_video_detail, "args": ["id"], "desc": "获取视频号视频详情"},
        "comments": {"func": wechat_channels_comments, "args": ["id"], "desc": "获取视频号评论"},
        "search-latest": {"func": wechat_channels_search_latest, "args": ["keywords"], "desc": "搜索最新视频"},
        "search-users": {"func": wechat_channels_user_search, "args": ["keywords"], "desc": "搜索视频号用户"},
        "hot-words": {"func": wechat_channels_hot_words, "args": [], "desc": "获取视频号热门话题"},
    },
}


def print_result(result: Dict[str, Any]):
    """打印结果"""
    print(json.dumps(result, ensure_ascii=False, indent=2))


def main():
    """命令行入口"""
    if len(sys.argv) < 2:
        print("TikHub 多平台查询工具 - 支持抖音、小红书、TikTok、微信公众号、微信视频号")
        print("")
        print("Usage: python3 tikhub_tool.py <platform> <command> [args...]")
        print("")
        print("Platforms:")
        platform_labels = {
            "douyin": "抖音",
            "xhs": "小红书",
            "tiktok": "TikTok",
            "wechat-mp": "微信公众号",
            "wechat-channels": "微信视频号",
        }
        for key in API_TOOLS:
            print(f"  {key:16} - {platform_labels.get(key, key)} ({len(API_TOOLS[key])} commands)")
        print("")
        for key in API_TOOLS:
            print(f"{platform_labels.get(key, key)} 命令:")
            for cmd, info in API_TOOLS[key].items():
                args = " ".join(f"<{a}>" for a in info["args"])
                print(f"  {cmd:18} {args:30} - {info['desc']}")
            print("")
        print("Examples:")
        print('  python3 tikhub_tool.py douyin video-by-url "https://v.douyin.com/xxx"')
        print('  python3 tikhub_tool.py xhs note-by-url "https://www.xiaohongshu.com/explore/xxx"')
        print('  python3 tikhub_tool.py tiktok trending')
        print('  python3 tikhub_tool.py wechat-mp article-json "https://mp.weixin.qq.com/s/xxx"')
        print('  python3 tikhub_tool.py wechat-channels search-latest "美食"')
        sys.exit(0)
    
    platform = sys.argv[1].lower()
    
    if platform not in API_TOOLS:
        print(f"Error: Unknown platform: {platform}")
        print(f"Supported platforms: {', '.join(API_TOOLS.keys())}")
        sys.exit(1)
    
    if len(sys.argv) < 3:
        print(f"Error: Missing command for platform: {platform}")
        print(f"Run 'python3 tikhub_tool.py {platform}' for available commands")
        sys.exit(1)
    
    command = sys.argv[2]
    
    if command not in API_TOOLS[platform]:
        print(f"Error: Unknown command: {command}")
        print(f"Available commands for {platform}: {', '.join(API_TOOLS[platform].keys())}")
        sys.exit(1)
    
    tool_info = API_TOOLS[platform][command]
    func = tool_info["func"]
    expected_args = tool_info["args"]
    
    # 收集参数
    provided_args = sys.argv[3:]
    
    # 特殊处理：小红书的 note-by-id 的 xsec_token 是可选的
    if platform == "xhs" and command == "note-by-id":
        if len(provided_args) < 1:
            print(f"Error: Missing note_id")
            sys.exit(1)
        # xsec_token 可选
        if len(provided_args) == 1:
            result = func(provided_args[0])
        else:
            result = func(provided_args[0], provided_args[1])
        print_result(result)
        return
    
    # 其他命令的正常参数检查
    if len(provided_args) < len(expected_args):
        print(f"Error: Missing arguments. Expected: {', '.join(expected_args)}")
        print(f"Provided: {len(provided_args)}")
        sys.exit(1)
    
    # 调用函数
    try:
        result = func(*provided_args)
        print_result(result)
    except Exception as e:
        print(json.dumps({"error": {"message": str(e)}}, ensure_ascii=False, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
