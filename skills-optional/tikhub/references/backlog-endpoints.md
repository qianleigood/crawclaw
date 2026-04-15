# TikHub Skill 待验证 / 待扩展接口清单

最后更新：2026-03-21

说明：
- 这里记录的是 **文档存在**、但当前尚未稳定纳入“已验证能力层”的接口。
- 原因可能包括：
  - 需要真实业务参数（如 comment_id / content_id / ghid）
  - 当前 demo 参数不可复用
  - 接口偶发 400 / 422
  - 需要二次串联别的接口拿前置 ID

## TikTok

### 已封装但待进一步验证
- `hashtag-detail`
  - `hashtag-search` 已通，但 `hashtag-detail` 对同批返回的 `cid` 未稳定通过
- `comment-replies`
  - 需要先拿到存在回复的真实 `comment_id`

### 文档存在但尚未封装
- Live / webcast 相关
  - `fetch_live_search_result`
  - `fetch_live_room_info`
  - `fetch_live_room_product_list`
- 商品 / 店铺相关
  - `fetch_product_detail_v2/v3/v4`
  - `fetch_shop_home`
  - `fetch_shop_product_list`
- 创作者 / analytics / ads 相关
  - 适合后续做“商业研究 / 选品 / 广告分析”能力层

## 小红书

### 已封装但待进一步验证
- `sub-comments`
  - 需要先拿到合适的一级评论 ID

### 文档存在但尚未封装
- `app_v2/search_notes`
- `app_v2/search_users`
- `app_v2/search_products`
- `app_v2/get_creator_inspiration_feed`
- `web_v2/fetch_follower_list`
- `web_v2/fetch_following_list`
- `web_v2/fetch_feed_notes*`
- `web/get_note_comment_replies`

## 微信公众号

### 已封装但待进一步验证
- `article-read-count`
  - 需要调用方提供真实 `comment_id`

### 文档存在但尚未封装/未纳入主命令层
- `fetch_mp_article_comment_reply_list`
  - 需要 `comment_id + content_id`
- `fetch_mp_related_articles`
  - 本轮 demo 调用返回 400
- `fetch_mp_article_url`
  - 输入是 `sogou_url`，不是普通 mp 链接；适用面较窄

## 微信视频号

### 已封装但当前不稳定
- `search-latest`
  - 本轮对同一 wrapper 出现过成功和 400 两种结果，暂不归入稳定能力层
- `search-users`
  - 本轮 demo 参数返回 400
- `hot-words`
  - 本轮直接调用返回 400

### 文档存在但尚未封装
- `fetch_default_search`
- `fetch_search_ordinary`
- `fetch_home_page`
- `fetch_live_history`

## 抖音

### 文档存在但尚未封装
- 直播榜 / 创作者相关的更细分接口
- 电商 / 商品搜索 / 商品详情家族接口
- 更细的直播流、音乐、话题二级能力

## 后续建议

如果继续扩，建议按这个顺序：
1. **微信视频号**：把 `search-users` / `hot-words` 这类不稳接口重新找一组真实可用参数验证
2. **微信公众号**：补 `comment_reply_list` 串联链（评论列表 -> content_id/comment_id -> 回复）
3. **TikTok**：补 live / product / shop 三组高业务价值接口
4. **小红书**：补 `app_v2` 搜索系与 follower/following
