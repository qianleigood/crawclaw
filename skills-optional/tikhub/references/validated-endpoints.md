# TikHub Skill 已验证接口清单

最后一次集中回归：2026-03-21

说明：
- “已验证”表示已在本地通过 `scripts/tikhub_tool.py` 或直接调用 `call_api()` 做过真实 smoke test，返回 `code=200`。
- 这份清单强调 **当前 skill 已封装且实测可用** 的能力，不追求覆盖 TikHub 全量接口。

## 抖音（已验证）

### 内容 / 视频
- `video-by-url`
- `video-by-id`
- `video-batch`
- `video-batch-stats`
- `video-batch-hq`
- `comments-app`
- `danmaku`

### 用户 / 账号
- `get-secuid-batch`
- `user-info`
- `user-videos`
- `user-likes`

### 搜索 / 榜单
- `search`
- `search-app`
- `hot-search`
- `hot-search-music`
- `hot-search-brand`

## 小红书（已验证）

### 笔记 / 用户
- `note-by-url`
- `note-by-id`
- `extract-token`
- `extract-user`
- `user-info`
- `user-notes`
- `search`
- `search-users`
- `comments`
- `hot-list`

### 话题 / 商品
- `topic-info`
- `topic-feed`
- `search-products`
- `product-detail`

## TikTok（已验证）

### 内容 / 视频
- `video-by-url`
- `video-by-id`
- `video-batch`
- `user-videos`
- `user-videos-all`
- `comments-app`

### 用户 / 账号
- `get-secuid`
- `get-secuid-batch`
- `get-uniqueid`
- `get-uniqueid-batch`
- `user-ids`
- `user-info`
- `user-likes`
- `user-reposts`
- `followers`
- `following`

### 搜索 / 发现
- `search`
- `search-app`
- `search-users`
- `search-suggest`
- `trending`
- `trending-words`

### 音乐 / 话题
- `music-chart`
- `music-search`
- `music-detail`
- `music-videos`
- `hashtag-search`
- `hashtag-videos`

## 微信公众号（已验证）

### 文章
- `article-json`
- `article-html`
- `article-comments`
- `article-list`
- `article-short-url`

### 指标
- `article-read-count`（wrapper 已封装，但需要调用方提供 `comment_id`；本轮未单独实测）

## 微信视频号（已验证）

### 内容
- `video-detail`
- `comments`

## 备注

### 小红书 fallback
以下 wrapper 已做“App 优先 + Web fallback”：
- `user-notes`
- `comments`

### TikTok 关键实现修正
- `user-info` 已按官方参数修正为 `uniqueId / secUid`
- `user-videos` 已切到 `App V3 fetch_user_post_videos_v3` 优先
- `video-batch` 已对接 `fetch_multi_video_v2`

### 微信相关现状
- 公众号文章详情、评论、列表、长短链转换当前可直接复用
- 视频号 `video-detail / comments / search-latest` 可作为第一批稳定能力
