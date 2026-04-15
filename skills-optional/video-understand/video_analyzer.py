#!/usr/bin/env python3
"""视频理解工具。

流程：本地视频 → 检查上传缓存 → 上传文件 API → 调用视频理解 API → 返回分析结果。

当前约定：
- 上传缓存位于 runtime/upload_cache.json
- 兼容读取旧根目录 upload_cache.json，并在首次读取时自动迁移
"""

import os
import json
import requests
import hashlib
from pathlib import Path
from datetime import datetime

# 加载配置
SCRIPT_DIR = Path(__file__).parent
CONFIG_FILE = SCRIPT_DIR / "config.json"
RUNTIME_DIR = SCRIPT_DIR / "runtime"
RUNTIME_DIR.mkdir(exist_ok=True)
CACHE_FILE = RUNTIME_DIR / "upload_cache.json"
LEGACY_CACHE_FILE = SCRIPT_DIR / "upload_cache.json"
ENV_FILE = SCRIPT_DIR / ".env"


def load_dotenv_file(env_file: Path) -> None:
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


load_dotenv_file(ENV_FILE)

with open(CONFIG_FILE, "r", encoding="utf-8") as f:
    raw_config = json.load(f)


def resolve_env(value: str) -> str:
    if not isinstance(value, str):
        return value
    if value.startswith("${") and value.endswith("}"):
        env_name = value[2:-1]
        return os.environ.get(env_name, "")
    return value


config = {k: resolve_env(v) for k, v in raw_config.items()}

API_KEY = config.get("api_key", "")
API_URL = config.get("api_url", "https://api.whatai.cc/v1/chat/completions")
UPLOAD_API_URL = "https://api.whatai.cc/v1/files"
MODEL = config.get("model", "gemini-3-flash-preview-nothinking")
DEFAULT_QUESTION = config.get("default_question", "这个视频讲了什么？")
STREAM = bool(config.get("stream", False))
MAX_UPLOAD_SIZE_MB = 20


# ============================================================================
# 上传缓存管理
# ============================================================================

def load_cache() -> dict:
    """加载上传缓存。优先读 runtime/，兼容旧根目录缓存并自动迁移。"""
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}

    if LEGACY_CACHE_FILE.exists():
        try:
            with open(LEGACY_CACHE_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            save_cache(data)
            try:
                LEGACY_CACHE_FILE.unlink()
            except Exception:
                pass
            return data
        except Exception:
            return {}
    return {}


def save_cache(cache: dict):
    """保存上传缓存"""
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def get_file_hash(file_path: str) -> str:
    """计算文件哈希值（用于判断文件是否变化）"""
    hash_md5 = hashlib.md5()
    try:
        # 获取文件大小和修改时间
        stat = os.stat(file_path)
        hash_md5.update(f"{file_path}:{stat.st_size}:{stat.st_mtime}".encode())
        return hash_md5.hexdigest()
    except Exception as e:
        print(f"⚠️  计算文件哈希失败：{e}")
        return None


def get_cached_url(file_path: str) -> str:
    """
    从缓存获取上传 URL
    
    Args:
        file_path: 本地文件路径
    
    Returns:
        缓存的 URL，如果不存在或已过期则返回 None
    """
    cache = load_cache()
    file_hash = get_file_hash(file_path)
    
    if not file_hash:
        return None
    
    # 检查缓存
    if file_path in cache:
        cached_entry = cache[file_path]
        cached_hash = cached_entry.get('hash')
        cached_url = cached_entry.get('url')
        cached_at = cached_entry.get('cached_at', '')
        
        # 验证文件是否变化（哈希值匹配）
        if cached_hash == file_hash and cached_url:
            print(f"♻️  使用缓存 URL：{os.path.basename(file_path)} (上传于 {cached_at})")
            return cached_url
        else:
            print(f"🔄 文件已变化，重新上传：{os.path.basename(file_path)}")
    
    return None


def cache_upload_url(file_path: str, url: str):
    """
    缓存上传 URL
    
    Args:
        file_path: 本地文件路径
        url: 上传后的 URL
    """
    cache = load_cache()
    file_hash = get_file_hash(file_path)
    
    cache[file_path] = {
        'url': url,
        'hash': file_hash,
        'cached_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'file_size': os.path.getsize(file_path)
    }
    
    save_cache(cache)
    print(f"💾 已缓存上传 URL：{os.path.basename(file_path)}")


def upload_file(local_path: str, use_cache: bool = True) -> str:
    """
    上传视频到文件 API（带缓存）
    
    Args:
        local_path: 本地文件路径
        use_cache: 是否使用缓存（默认 True）
    
    Returns:
        上传后的 URL
    """
    # 1. 先检查缓存
    if use_cache:
        cached_url = get_cached_url(local_path)
        if cached_url:
            return cached_url
    
    print(f"📤 上传视频：{os.path.basename(local_path)}")

    if not API_KEY:
        print("⚠️  缺少 VIDEO_UNDERSTAND_API_KEY")
        return None
    
    # 2. 检查文件大小（默认最大 20MB）
    file_size = os.path.getsize(local_path)
    max_upload_size_bytes = MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if file_size > max_upload_size_bytes:
        print(f"⚠️  文件太大 ({file_size / 1024 / 1024:.1f}MB > {MAX_UPLOAD_SIZE_MB}MB)")
        return None
    
    headers = {
        "Authorization": f"Bearer {API_KEY}"
    }
    
    try:
        with open(local_path, 'rb') as f:
            files = {
                'file': (os.path.basename(local_path), f, 'video/mp4')
            }
            
            response = requests.post(
                UPLOAD_API_URL,
                headers=headers,
                files=files,
                timeout=60
            )
            response.raise_for_status()
            
            result = response.json()
            file_url = result.get('url')
            
            if file_url:
                print(f"✅ 上传成功：{file_url[:60]}...")
                # 3. 缓存 URL
                if use_cache:
                    cache_upload_url(local_path, file_url)
                return file_url
            else:
                print(f"⚠️  上传成功但未返回 URL")
                return None
                
    except Exception as e:
        print(f"⚠️  上传失败：{e}")
        return None


def analyze_video(video_url: str, question: str = None) -> str:
    """
    调用视频理解 API 分析视频
    
    Args:
        video_url: 视频 URL（上传后的公开链接）
        question: 分析问题
    
    Returns:
        分析结果文本
    """
    if question is None:
        question = DEFAULT_QUESTION
    
    if not API_KEY:
        return "分析失败：缺少 VIDEO_UNDERSTAND_API_KEY"

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": question},
                    {"type": "image_url", "image_url": {"url": video_url}}
                ]
            }
        ],
        "stream": STREAM
    }
    
    try:
        print(f"🤖 分析视频...")
        response = requests.post(API_URL, headers=headers, json=payload, timeout=300)
        response.raise_for_status()
        result = response.json()
        
        content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
        print(f"✅ 分析完成，内容长度：{len(content)}")
        return content
        
    except Exception as e:
        print(f"❌ API 调用失败：{e}")
        return f"分析失败：{e}"


def process_video(video_source: str, question: str = None) -> str:
    """
    完整流程：支持本地文件或 URL
    
    Args:
        video_source: 本地文件路径 或 视频 URL
        question: 分析问题
    
    Returns:
        分析结果
    """
    # 判断是本地文件还是 URL
    if os.path.exists(video_source) or video_source.startswith('file://'):
        # 本地文件，先上传
        local_path = video_source.replace('file://', '')
        print(f"📁 本地文件：{local_path}")
        
        video_url = upload_file(local_path)
        if not video_url:
            return "上传失败，无法分析"
    else:
        # 已经是 URL
        video_url = video_source
        print(f"🔗 使用 URL：{video_url[:60]}...")
    
    # 调用视频理解 API
    return analyze_video(video_url, question)


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="视频理解工具")
    parser.add_argument("video", help="视频文件路径或 URL")
    parser.add_argument("-q", "--question", default=DEFAULT_QUESTION, help="分析问题")
    args = parser.parse_args()
    
    result = process_video(args.video, args.question)
    print("\n" + "="*60)
    print("分析结果：")
    print("="*60)
    print(result)
