# TikHub API 端点列表

TikHub 直接 API 调用端点。

## 接口优先级（根据 TikHub 官方文档）

**小红书接口稳定性排序：**
1. ✅ **App 系列** - 最稳定（优先使用）
2. ⚡ **Web v2 系列** - 修复速度快
3. ⚠️ **旧版 Web** - 可能不稳定

## 使用方法

```bash
python3 scripts/tikhub_tool.py <platform> <command> [args...]
```

## ✅ 已验证可用的 API

### 抖音 (Douyin)

| 命令 | API 端点 | 方法 | 说明 |
|------|---------|------|------|
| `hot-search` | `/api/v1/douyin/web/fetch_hot_search_result` | GET | 获取热榜 ✅ |

### TikTok

| 命令 | API 端点 | 方法 | 说明 |
|------|---------|------|------|
| `trending` | `/api/v1/tiktok/web/fetch_trending_post` | GET | 获取趋势视频 ✅ |
| `trending-words` | `/api/v1/tiktok/web/fetch_trending_searchwords` | GET | 获取趋势搜索词 ✅ |

---

## 📋 完整 API 列表

### 抖音 API (247 个)

**视频相关:**
- `/api/v1/douyin/web/fetch_one_video` - 获取单个视频 (GET)
- `/api/v1/douyin/web/fetch_one_video_v2` - 获取单个视频 V2 (GET)
- `/api/v1/douyin/web/fetch_one_video_by_share_url` - 根据分享链接获取视频 (GET)
- `/api/v1/douyin/web/fetch_video_high_quality_play_url` - 获取高清播放链接 (GET)
- `/api/v1/douyin/web/fetch_multi_video` - 批量获取视频 (POST)
- `/api/v1/douyin/web/fetch_one_video_danmaku` - 获取弹幕 (GET)

**用户相关:**
- `/api/v1/douyin/web/handler_user_profile` - 获取用户信息 (GET)
- `/api/v1/douyin/web/fetch_user_post_videos` - 获取用户作品 (GET)
- `/api/v1/douyin/web/fetch_user_like_videos` - 获取用户喜欢 (GET)
- `/api/v1/douyin/web/fetch_user_collection_videos` - 获取用户收藏 (GET)
- `/api/v1/douyin/web/fetch_user_collects` - 获取收藏夹 (GET)
- `/api/v1/douyin/web/fetch_user_mix_videos` - 获取合辑 (GET)

**搜索:**
- `/api/v1/douyin/search/fetch_video_search_v2` - 搜索视频 (POST)

**评论:**
- `/api/v1/douyin/web/fetch_video_comments` - 获取视频评论 (GET)

**直播:**
- `/api/v1/douyin/web/fetch_user_live_videos_by_room_id_v2` - 获取直播流 (GET)
- `/api/v1/douyin/web/fetch_live_gift_ranking` - 直播间送礼排行 (GET)

**热榜:**
- `/api/v1/douyin/web/fetch_hot_search_result` - 热榜 (GET) ✅

**其他:**
- `/api/v1/douyin/web/fetch_home_feed` - 首页推荐 (GET)
- `/api/v1/douyin/web/fetch_related_posts` - 相关推荐 (GET)

---

### 小红书 API (50 个)

#### ✅ App 接口（优先使用 - 最稳定）

**笔记相关:**
- `/api/v1/xiaohongshu/app/get_note_info` - 获取笔记信息 (POST) ✅ 推荐
- `/api/v1/xiaohongshu/app/get_note_info_v2` - 获取笔记信息 V2 (POST)
- `/api/v1/xiaohongshu/app/get_video_note_info` - 获取视频笔记 (POST)

**用户相关:**
- `/api/v1/xiaohongshu/app/get_user_info` - 获取用户信息 (POST) ✅ 推荐
- `/api/v1/xiaohongshu/app/get_user_notes` - 获取用户笔记 (POST) ✅ 推荐

**搜索:**
- `/api/v1/xiaohongshu/app/search_notes` - 搜索笔记 (POST) ✅ 推荐
- `/api/v1/xiaohongshu/app/search_notes_v2` - 搜索笔记 V2 (POST)
- `/api/v1/xiaohongshu/app/search_users` - 搜索用户 (POST) ✅ 推荐

**评论:**
- `/api/v1/xiaohongshu/app/get_note_comments` - 获取笔记评论 (POST) ✅ 推荐
- `/api/v1/xiaohongshu/app/get_sub_comments` - 获取子评论 (POST)

**其他:**
- `/api/v1/xiaohongshu/app/get_notes_by_topic` - 按话题获取笔记 (POST)
- `/api/v1/xiaohongshu/app/extract_share_info` - 提取分享链接信息 (POST)
- `/api/v1/xiaohongshu/app/get_product_detail` - 获取商品详情 (POST)
- `/api/v1/xiaohongshu/app/search_products` - 搜索商品 (POST)

#### ⚡ Web v2 接口（修复速度快）

**笔记相关:**
- `/api/v1/xiaohongshu/web/get_note_info_v7` - 获取笔记信息 V7 (GET)
- `/api/v1/xiaohongshu/web/get_note_id_and_xsec_token` - 提取 note_id 和 xsec_token (GET)

**用户相关:**
- `/api/v1/xiaohongshu/web/get_user_info_v2` - 获取用户信息 V2 (GET)
- `/api/v1/xiaohongshu/web/get_user_notes_v2` - 获取用户笔记 V2 (GET)

**搜索:**
- `/api/v1/xiaohongshu/web/search_notes_v3` - 搜索笔记 V3 (POST)
- `/api/v1/xiaohongshu/web/search_users` - 搜索用户 (POST)

**评论:**
- `/api/v1/xiaohongshu/web/get_note_comments` - 获取笔记评论 (GET)

**热榜:**
- `/api/v1/xiaohongshu/web/v2/fetch_hot_list` - 热榜 (GET)

**其他:**
- `/api/v1/xiaohongshu/web/v2/fetch_feed_notes_v2` - 获取推荐笔记 (POST) 稳定
- `/api/v1/xiaohongshu/web/v2_fetch_note_image` - 获取笔记图片 (GET)
- `/api/v1/xiaohongshu/web/v2/fetch_user_info` - 获取用户信息 (GET)
- `/api/v1/xiaohongshu/web/v2/fetch_follower_list` - 获取粉丝列表 (GET)
- `/api/v1/xiaohongshu/web/v2/fetch_product_list` - 获取商品列表 (GET)

---

### TikTok API (38 个)

**视频相关:**
- `/api/v1/tiktok/web/fetch_post_detail` - 获取视频详情 (GET)
- `/api/v1/tiktok/web/fetch_post_detail_v2` - 获取视频详情 V2 (GET)
- `/api/v1/tiktok/web/fetch_explore_post` - 探索页视频 (GET)
- `/api/v1/tiktok/web/fetch_trending_post` - 趋势视频 (GET) ✅
- `/api/v1/tiktok/web/fetch_trending_searchwords` - 趋势搜索词 (GET) ✅

**用户相关:**
- `/api/v1/tiktok/web/fetch_user_profile` - 用户信息 (GET)
- `/api/v1/tiktok/web/fetch_user_post` - 用户作品 (GET)
- `/api/v1/tiktok/web/fetch_user_repost` - 用户转发 (GET)
- `/api/v1/tiktok/web/fetch_user_like` - 用户点赞 (GET)
- `/api/v1/tiktok/web/fetch_user_collect` - 用户收藏 (GET)
- `/api/v1/tiktok/web/fetch_user_play_list` - 播放列表 (GET)
- `/api/v1/tiktok/web/fetch_user_mix` - 合辑 (GET)
- `/api/v1/tiktok/web/fetch_user_fans` - 粉丝列表 (GET)
- `/api/v1/tiktok/web/fetch_user_follow` - 关注列表 (GET)
- `/api/v1/tiktok/web/fetch_user_live_detail` - 直播详情 (GET)

**搜索:**
- `/api/v1/tiktok/web/fetch_search_video` - 搜索视频 (POST)
- `/api/v1/tiktok/web/fetch_general_search` - 综合搜索 (POST)
- `/api/v1/tiktok/web/fetch_search_keyword_suggest` - 搜索建议 (GET)
- `/api/v1/tiktok/web/fetch_search_user` - 搜索用户 (POST)
- `/api/v1/tiktok/web/fetch_search_live` - 搜索直播 (POST)
- `/api/v1/tiktok/web/fetch_search_photo` - 搜索图片 (POST)

**评论:**
- `/api/v1/tiktok/web/fetch_post_comment` - 视频评论 (GET)
- `/api/v1/tiktok/web/fetch_post_comment_reply` - 评论回复 (GET)

**其他:**
- `/api/v1/tiktok/web/fetch_home_feed` - 首页推荐 (GET)
- `/api/v1/tiktok/web/fetch_tag_detail` - 标签详情 (GET)
- `/api/v1/tiktok/web/fetch_tag_post` - 标签作品 (GET)

**工具:**
- `/api/v1/tiktok/web/generate_real_msToken` - 生成 msToken (GET)
- `/api/v1/tiktok/web/encrypt_strData` - 加密数据 (POST)
- `/api/v1/tiktok/web/decrypt_strData` - 解密数据 (POST)
- `/api/v1/tiktok/web/generate_fingerprint` - 生成指纹 (GET)
- `/api/v1/tiktok/web/generate_webid` - 生成 webid (GET)
- `/api/v1/tiktok/web/generate_ttwid` - 生成 ttwid (GET)
- `/api/v1/tiktok/web/generate_xbogus` - 生成 X-Bogus (GET)
- `/api/v1/tiktok/web/generate_xgnarly` - 生成 X-Gnarly (GET)

---

## HTTP 方法规则

根据 API 文档 URL 判断：
- URL 以 `_get` 结尾 → **GET** 请求
- URL 以 `_post` 结尾 → **POST** 请求
- 无后缀 → 通常 GET，需测试

## 注意事项

1. **API Key**: 所有请求需要 `Authorization: Bearer <key>` 头
2. **GET 请求**: 参数通过 URL 查询字符串传递
3. **POST 请求**: 参数通过 JSON 请求体传递，需设置 `Content-Type: application/json`
4. **缓存**: 成功请求会返回 `cache_url`，24 小时内访问不重复计费
5. **额度**: 部分接口可能需要更高套餐

## 测试命令

```bash
# 抖音热榜
python3 scripts/tikhub_tool.py douyin hot-search

# TikTok 趋势
python3 scripts/tikhub_tool.py tiktok trending

# TikTok 趋势搜索词
python3 scripts/tikhub_tool.py tiktok trending-words
```
