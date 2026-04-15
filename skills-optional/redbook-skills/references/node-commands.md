# Node Commands

## 目录
- 登录与二维码
- 读取类命令
- 发布类命令
- 评论类命令
- 推荐运行档位

## 登录与二维码

```bash
./run-puppeteer.sh login
./run-puppeteer.sh login --send-feishu-qr --receive-id ou_xxx --receive-id-type open_id
./run-puppeteer.sh home-login --send-feishu-qr --receive-id ou_xxx --receive-id-type open_id
./run-puppeteer.sh re-login --send-feishu-qr --receive-id ou_xxx --receive-id-type open_id
./run-puppeteer.sh switch-account --account brand-a --send-feishu-qr --receive-id ou_xxx --receive-id-type open_id
```

说明：
- `login` / `re-login` / `switch-account` 走 creator 域。
- `home-login` 走主页登录弹层。
- 登录/发布类页面默认保留，不自动关闭。

## 读取类命令

```bash
./run-puppeteer.sh check-login
./run-puppeteer.sh check-login --scope home
./run-puppeteer.sh search-feeds --keyword "春招"
./run-puppeteer.sh get-feed-detail --feed-id FEED_ID --xsec-token XSEC_TOKEN
./run-puppeteer.sh my-profile-feeds
./run-puppeteer.sh content-data --page-num 1 --page-size 10
./run-puppeteer.sh content-data --page-num 1 --page-size 10 --csv-file /abs/content.csv
./run-puppeteer.sh get-notification-mentions
```

说明：
- `search-feeds` 当前未迁移筛选器交互（`sort-by` / `note-type` / `publish-time` / `search-scope` / `location`），复杂筛选时回退 Python。
- 读取类命令默认自动关闭新开的临时页。

## 发布类命令

### 图文

```bash
./run-puppeteer.sh --interaction-mode safe fill --title "标题" --content-file content.txt --images /abs/p1.jpg /abs/p2.jpg
./run-puppeteer.sh --interaction-mode safe publish --title "标题" --content-file content.txt --images /abs/p1.jpg /abs/p2.jpg
./run-puppeteer.sh --interaction-mode safe click-publish
```

### 本地视频

```bash
./run-puppeteer.sh --interaction-mode safe fill --title "标题" --content-file content.txt --video /abs/demo.mp4
./run-puppeteer.sh --interaction-mode safe publish --title "标题" --content-file content.txt --video /abs/demo.mp4
```

### 远程视频 URL

```bash
./run-puppeteer.sh --interaction-mode safe fill --title "标题" --content-file content.txt --video-url "https://example.com/demo.mp4"
./run-puppeteer.sh --interaction-mode safe publish --title "标题" --content-file content.txt --video-url "https://example.com/demo.mp4"
```

说明：
- `--video-url` 会先下载到本地临时文件，再复用本地视频上传链路。
- 图文/视频都支持“正文最后一行 `#标签1 #标签2`”自动话题选择。
- `publish` / `click-publish` 已补充发布成功轮询判定。

## 评论类命令

```bash
./run-puppeteer.sh --interaction-mode safe post-comment-to-feed --feed-id FEED_ID --xsec-token XSEC_TOKEN --content "评论内容"
./run-puppeteer.sh --interaction-mode safe reply-to-comment --comment-author "作者名" --comment-text "评论片段" --content "回复内容" --dry-run
./run-puppeteer.sh --interaction-mode safe reply-to-comment --comment-author "作者名" --comment-text "评论片段" --content "回复内容"
```

说明：
- `reply-to-comment` 优先走通知页定位目标回复入口。
- 建议先 `--dry-run` 验证定位，再执行真实回复。
- 评论类动作对风控更敏感，默认用 `safe`。

## 推荐运行档位

- 读取类：`normal`
- 发布类：`safe`
- 评论类：`safe`
- `fast` 只用于联调/测试，不建议生产高频使用。
