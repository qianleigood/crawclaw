# Python Legacy / Fallback

## 目录
- 什么时候回退 Python
- Python 运行约定
- 常用 Python 命令
- 登录二维码说明

## 什么时候回退 Python

优先使用 Node + Puppeteer。只有在这些情况回退 Python：
- `search-feeds` 需要筛选器交互（`sort-by` / `note-type` / `publish-time` / `search-scope` / `location`）
- 需要使用尚未迁移到 Node 的历史细节流程
- 需要对照旧链路排障

## Python 运行约定

- 统一通过 `./run-python.sh` 执行。
- `./run-python.sh` 会优先使用 `python3.12`，自动创建/复用 `.venv312`。
- 不要直接写 `python scripts/...`，避免落到系统 Python 3.9。
- 参数顺序必须是：**全局参数在子命令前，子命令参数在子命令后**。

示例：

```bash
./run-python.sh scripts/cdp_publish.py --reuse-existing-tab search-feeds --keyword "春招"
```

## 常用 Python 命令

### 启动 / 测试浏览器

```bash
./run-python.sh scripts/chrome_launcher.py
./run-python.sh scripts/chrome_launcher.py --port 9223
./run-python.sh scripts/chrome_launcher.py --headless
./run-python.sh scripts/chrome_launcher.py --restart
./run-python.sh scripts/chrome_launcher.py --kill
```

### 登录检查 / 搜索 / 详情

```bash
./run-python.sh scripts/cdp_publish.py check-login
./run-python.sh scripts/cdp_publish.py search-feeds --keyword "春招"
./run-python.sh scripts/cdp_publish.py get-feed-detail --feed-id FEED_ID --xsec-token XSEC_TOKEN
```

### 图文 / 视频发布

```bash
./run-python.sh scripts/publish_pipeline.py --title-file title.txt --content-file content.txt --images /abs/p1.jpg /abs/p2.jpg
./run-python.sh scripts/publish_pipeline.py --title-file title.txt --content-file content.txt --video /abs/demo.mp4
./run-python.sh scripts/publish_pipeline.py --title-file title.txt --content-file content.txt --video-url "https://example.com/demo.mp4"
```

### 评论 / 数据 / 通知 / 主页笔记

```bash
./run-python.sh scripts/cdp_publish.py post-comment-to-feed --feed-id FEED_ID --xsec-token XSEC_TOKEN --content "评论内容"
./run-python.sh scripts/cdp_publish.py reply-to-comment --comment-author "作者名" --comment-text "片段" --content "回复内容"
./run-python.sh scripts/cdp_publish.py content-data --csv-file /abs/content.csv
./run-python.sh scripts/cdp_publish.py get-notification-mentions
./run-python.sh scripts/cdp_publish.py my-profile-feeds
```

## 登录二维码说明

Python 版仍可通过飞书发送登录二维码：

```bash
./run-python.sh scripts/cdp_publish.py login \
  --send-feishu-qr \
  --receive-id ou_xxx \
  --receive-id-type open_id
```

说明：
- creator 域会先点二维码入口再截图。
- home 域会直接截可视区，不先点击。
- 发送后走被动等待登录成功，不再主动刷新页面。
