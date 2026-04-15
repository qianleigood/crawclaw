# RedBookSkills

自动发布内容到小红书（Xiaohongshu/RED）的命令行工具，也支持仅启动测试浏览器（不发布）。
通过 Chrome DevTools Protocol (CDP) 实现自动化发布，支持多账号管理、无头模式运行、自动搜索素材与内容数据抓取等功能。

## 功能特性
- **自动化发布**：自动填写标题、正文、上传图片
- **话题标签自动写入**：识别正文最后一行 `#标签`，然后逐渐写入
- **多账号支持**：支持管理多个小红书账号，各账号 Cookie 隔离，并可为账号绑定默认 CDP 端口
- **无头模式**：支持后台运行，无需显示浏览器窗口
- **远程 CDP 支持**：可通过 `--host` / `--port` 连接远程 Chrome 调试端口
- **图片下载**：支持从 URL 自动下载图片，自动添加 Referer 绕过防盗链
- **登录检测**：自动检测登录状态，未登录时支持发二维码截图到飞书辅助扫码
- **登录状态缓存**：`check_login/check_home_login` 默认本地缓存 12 小时，减少重复跳转校验
- **登录二维码分流**：creator 域采用“加载完成 → 点二维码入口 → 截图发飞书”；home 域采用“加载完成 → 直接截可视区发飞书，不点击”
- **被动登录等待**：二维码发出后不再主动刷新/跳转二维码页，避免把登录二维码刷失效
- **端口-账号硬护栏**：当指定端口已被占用时，会检查现有 Chrome 实例的 `--user-data-dir` 是否匹配目标账号；不匹配则拒绝继续，避免串号
- **内容检索与详情读取**：支持搜索笔记并获取指定笔记详情（含评论数据）
- **笔记评论**：支持按 `feed_id + xsec_token` 对指定笔记发表一级评论
- **通知评论抓取**：支持在 `/notification` 页面抓取 `you/mentions` 接口返回
- **内容数据看板抓取**：支持抓取“笔记基础信息”表（曝光/观看/点赞等）并导出 CSV

## 安装

### 环境要求

- Python 3.12（默认通过 `python3.12` 创建和运行本地虚拟环境）
- Google Chrome 浏览器
- Windows 操作系统（目前仅测试 Windows；本次已在 macOS 上验证到浏览器拉起与登录检测链路）

### 默认运行方式

本仓库默认通过根目录下的 `./run-python.sh` 运行：

- 优先使用 `python3.12`
- 首次运行自动创建/复用 `.venv312`
- 依赖按 `requirements.txt` 自动同步
- 避免误用系统 `python3.9` 导致 `X | None` 语法报错

### 手动预热依赖（可选）

```bash
./run-python.sh --version
```

## 快速开始

### 1. 首次登录

多账号建议：为每个账号绑定固定端口，例如 `brand-a -> 9222`、`brand-b -> 9223`。这样每个账号可各自复用自己的 Chrome profile 与调试端口，降低串号风险。

可用命令：

```bash
./run-python.sh scripts/account_manager.py add brand-a --alias "品牌A" --port 9222
./run-python.sh scripts/account_manager.py add brand-b --alias "品牌B" --port 9223
./run-python.sh scripts/account_manager.py list
./run-python.sh scripts/account_manager.py set-port brand-b 9224
```

### 多账号使用手册

#### 1) 推荐命名与端口规划

建议把账号名直接设计成稳定标识，例如：

- `brand-a`
- `brand-b`
- `personal-main`
- `store-cn-01`

推荐固定端口映射：

- `brand-a -> 9222`
- `brand-b -> 9223`
- `brand-c -> 9224`
- `personal-main -> 9225`

原则：**一个账号一个 profile，一个账号一个固定端口。** 不要多个账号共用同一个 profile，也不要长期混用同一个端口。

#### 2) 初始化账号

```bash
./run-python.sh scripts/account_manager.py add brand-a --alias "品牌A" --port 9222
./run-python.sh scripts/account_manager.py add brand-b --alias "品牌B" --port 9223
./run-python.sh scripts/account_manager.py list
```

如需修改端口：

```bash
./run-python.sh scripts/account_manager.py set-port brand-b 9224
```

查看单账号信息：

```bash
./run-python.sh scripts/account_manager.py info brand-a
```

#### 3) 启动各自账号实例

```bash
./run-python.sh scripts/chrome_launcher.py --account brand-a
./run-python.sh scripts/chrome_launcher.py --account brand-b
```

如果没有显式传 `--port`，脚本会自动使用账号的首选端口。

如需手工指定端口，也可以：

```bash
./run-python.sh scripts/chrome_launcher.py --account brand-a --port 9222
```

#### 4) 登录指定账号

```bash
./run-python.sh scripts/cdp_publish.py --account brand-a login
./run-python.sh scripts/cdp_publish.py --account brand-b login
```

如果某账号未登录，需要发飞书二维码时：

```bash
./run-python.sh scripts/cdp_publish.py --account brand-a search-feeds \
  --keyword "测试" \
  --send-feishu-qr \
  --receive-id ou_xxx \
  --receive-id-type open_id
```

#### 5) 用指定账号发布

```bash
./run-python.sh scripts/publish_pipeline.py --account brand-a \
  --title "标题A" \
  --content "正文A" \
  --image-urls "https://example.com/a.jpg"

./run-python.sh scripts/publish_pipeline.py --account brand-b \
  --title "标题B" \
  --content "正文B" \
  --image-urls "https://example.com/b.jpg"
```

#### 6) 护栏与排障

- 如果端口已被其他 Chrome 实例占用，脚本会检查该实例的 `--user-data-dir` 是否与目标账号一致。
- **一致**：允许继续复用。
- **不一致**：直接拒绝继续，避免串号。
- 如果你显式传了 `--port`，且它和账号首选端口不一致，脚本会给出 warning；建议修正为账号的固定端口。

排障建议：

1. 先跑 `account_manager.py list`，确认账号和端口映射。
2. 再跑 `chrome_launcher.py --account <name>`，确认该账号实例能正常起来。
3. 若报端口冲突，优先检查是不是另一个账号占着同一端口。
4. 若要彻底重来，可先 kill 对应端口实例，再重启目标账号实例。

```bash
./run-python.sh scripts/cdp_publish.py login
```

多账号建议为每个账号绑定固定端口，例如：

```bash
./run-python.sh scripts/account_manager.py add brand-a --alias 品牌A --port 9222
./run-python.sh scripts/account_manager.py add brand-b --alias 品牌B --port 9223
./run-python.sh scripts/account_manager.py set-port brand-c 9224
```

在弹出的 Chrome 窗口中扫码登录小红书。

### 2. 启动/测试浏览器（不发布）

```bash
# 启动测试浏览器（有窗口，推荐）
./run-python.sh scripts/chrome_launcher.py

# 无头启动测试浏览器
./run-python.sh scripts/chrome_launcher.py --headless

# 检查当前登录状态
./run-python.sh scripts/cdp_publish.py check-login

# 可选：优先复用已有标签页（减少有窗口模式下切到前台）
./run-python.sh scripts/cdp_publish.py check-login --reuse-existing-tab

# 连接远程 CDP（Chrome 在另一台机器）
./run-python.sh scripts/cdp_publish.py --host 10.0.0.12 --port 9222 check-login

# 重启测试浏览器
./run-python.sh scripts/chrome_launcher.py --restart

# 关闭测试浏览器
./run-python.sh scripts/chrome_launcher.py --kill
```

### 3. 发布内容

```bash
# 无头模式（推荐）
./run-python.sh scripts/publish_pipeline.py --headless \
    --title "文章标题" \
    --content "文章正文" \
    --image-urls "https://example.com/image.jpg"

# 有窗口模式（可预览）
./run-python.sh scripts/publish_pipeline.py \
    --title "文章标题" \
    --content "文章正文" \
    --image-urls "https://example.com/image.jpg"

# 可选：优先复用已有标签页（减少有窗口模式下切到前台）
./run-python.sh scripts/publish_pipeline.py --reuse-existing-tab \
    --title "文章标题" \
    --content "文章正文" \
    --image-urls "https://example.com/image.jpg"

# 连接远程 CDP 并发布（远程 Chrome 需已开启调试端口）
./run-python.sh scripts/publish_pipeline.py --host 10.0.0.12 --port 9222 \
    --title "文章标题" \
    --content "文章正文" \
    --image-urls "https://example.com/image.jpg"

# 从文件读取内容
./run-python.sh scripts/publish_pipeline.py --headless \
    --title-file title.txt \
    --content-file content.txt \
    --image-urls "https://example.com/image.jpg"

# 正文最后一行可放话题标签（最多 10 个）
# 例如 content.txt 最后一行：
# #春招 #26届 #校招 #求职 #找工作

# 使用本地图片
./run-python.sh scripts/publish_pipeline.py --headless \
    --title "文章标题" \
    --content "文章正文" \
    --images "C:\path\to\image.jpg"

```

### 4. 多账号管理

```bash
# 列出所有账号
./run-python.sh scripts/cdp_publish.py list-accounts

# 添加新账号
./run-python.sh scripts/cdp_publish.py add-account myaccount --alias "我的账号"

# 登录指定账号
./run-python.sh scripts/cdp_publish.py --account myaccount login

# 使用指定账号发布
./run-python.sh scripts/publish_pipeline.py --account myaccount --headless \
    --title "标题" --content "正文" --image-urls "URL"

# 设置默认账号
./run-python.sh scripts/cdp_publish.py set-default-account myaccount

# 切换账号（清除当前登录，重新扫码）
./run-python.sh scripts/cdp_publish.py switch-account
```

### 5. 搜索内容、查看笔记详情与评论通知抓取

```bash
# 搜索笔记（可选筛选）
./run-python.sh scripts/cdp_publish.py search-feeds --keyword "春招"
./run-python.sh scripts/cdp_publish.py search-feeds --keyword "春招" --sort-by 最新 --note-type 图文

# 获取笔记详情（feed_id 与 xsec_token 可从搜索结果中获取）
./run-python.sh scripts/cdp_publish.py get-feed-detail \
    --feed-id 67abc1234def567890123456 \
    --xsec-token YOUR_XSEC_TOKEN

# 给笔记发表评论（一级评论）
./run-python.sh scripts/cdp_publish.py post-comment-to-feed \
    --feed-id 67abc1234def567890123456 \
    --xsec-token YOUR_XSEC_TOKEN \
    --content "写得很实用，感谢分享！"

# 抓取“评论和@”通知接口（you/mentions）
./run-python.sh scripts/cdp_publish.py get-notification-mentions
```

说明：`search-feeds` 会先在搜索框输入关键词，抓取下拉推荐词（`recommended_keywords`），再回车拉取 feed 列表。

### 6. 获取内容数据表（content_data）

```bash
# 抓取“笔记基础信息”数据表
./run-python.sh scripts/cdp_publish.py content-data

# 下划线别名
./run-python.sh scripts/cdp_publish.py content_data

# 导出 CSV
./run-python.sh scripts/cdp_publish.py content-data --csv-file "/abs/path/content_data.csv"
```

## 命令参考

### 话题标签（publish_pipeline.py）

- 从正文中提取规则：若“最后一个非空行”全部由 `#标签` 组成，则提取为话题标签并从正文移除。
- 标签输入策略：逐个输入 `#标签`，等待 `3` 秒，再发送 `Enter` 进行确认。
- 建议数量：`1-10` 个标签；超过平台限制时请手动精简。
- 示例（正文最后一行）：`#春招 #26届 #校招 #春招规划 #面试`

### publish_pipeline.py

统一发布入口，一条命令完成全部流程。

```bash
./run-python.sh scripts/publish_pipeline.py [选项]

选项:
  --title TEXT           文章标题
  --title-file FILE      从文件读取标题
  --content TEXT         文章正文
  --content-file FILE    从文件读取正文
  --image-urls URL...    图片 URL 列表
  --images FILE...       本地图片文件列表
  --host HOST            CDP 主机地址（默认 127.0.0.1）
  --port PORT            CDP 端口（默认 9222）
  --headless             无头模式（无浏览器窗口）
  --reuse-existing-tab   优先复用已有标签页（默认关闭）
  --account NAME         指定账号
  --auto-publish         自动点击发布（跳过确认）
```

说明：启用 `--reuse-existing-tab` 后，发布流程仍会自动导航到发布页，因此会刷新到目标页面再继续执行。
说明：当 `--host` 非 `127.0.0.1/localhost` 时为远程模式，会跳过本地 `chrome_launcher.py` 的自动启动/重启逻辑，请确保远程 CDP 地址可达。

### cdp_publish.py

底层发布控制，支持分步操作。

```bash
# 检查登录状态
./run-python.sh scripts/cdp_publish.py check-login
./run-python.sh scripts/cdp_publish.py check-login --reuse-existing-tab
./run-python.sh scripts/cdp_publish.py --host 10.0.0.12 --port 9222 check-login

# 填写表单（不发布）
./run-python.sh scripts/cdp_publish.py fill --title "标题" --content "正文" --images img.jpg
./run-python.sh scripts/cdp_publish.py fill --title "标题" --content "正文" --images img.jpg --reuse-existing-tab
./run-python.sh scripts/cdp_publish.py --host 10.0.0.12 --port 9222 fill --title "标题" --content "正文" --images img.jpg

# 点击发布按钮
./run-python.sh scripts/cdp_publish.py click-publish

# 搜索笔记（支持下划线别名：search_feeds）
./run-python.sh scripts/cdp_publish.py search-feeds --keyword "春招"
./run-python.sh scripts/cdp_publish.py search-feeds --keyword "春招" --sort-by 最新 --note-type 图文

# 获取笔记详情（支持下划线别名：get_feed_detail）
./run-python.sh scripts/cdp_publish.py get-feed-detail --feed-id FEED_ID --xsec-token XSEC_TOKEN

# 发表评论（支持下划线别名：post_comment_to_feed）
./run-python.sh scripts/cdp_publish.py post-comment-to-feed --feed-id FEED_ID --xsec-token XSEC_TOKEN --content "评论内容"

# 回复指定评论（支持下划线别名：reply_to_comment）
./run-python.sh scripts/cdp_publish.py reply-to-comment \
  --comment-author "用户名片段" \
  --comment-text "通知文案片段" \
  --content "回复内容" \
  --dry-run

# 去掉 --dry-run 即真实发送
./run-python.sh scripts/cdp_publish.py reply-to-comment \
  --comment-author "用户名片段" \
  --comment-text "通知文案片段" \
  --content "回复内容"

# 如通知页定位失败，可补 feed-id/xsec-token 走详情页回退
./run-python.sh scripts/cdp_publish.py reply-to-comment \
  --feed-id FEED_ID \
  --xsec-token XSEC_TOKEN \
  --comment-author "用户名片段" \
  --comment-text "评论内容片段" \
  --content "回复内容" \
  --dry-run

# 抓取通知评论接口（支持下划线别名：get_notification_mentions）
./run-python.sh scripts/cdp_publish.py get-notification-mentions

# 获取内容数据表（支持下划线别名：content_data）
./run-python.sh scripts/cdp_publish.py content-data
./run-python.sh scripts/cdp_publish.py content-data --csv-file "/abs/path/content_data.csv"

# 账号管理
./run-python.sh scripts/cdp_publish.py login
./run-python.sh scripts/cdp_publish.py list-accounts
./run-python.sh scripts/cdp_publish.py add-account NAME [--alias ALIAS]
./run-python.sh scripts/cdp_publish.py remove-account NAME [--delete-profile]
./run-python.sh scripts/cdp_publish.py set-default-account NAME
./run-python.sh scripts/cdp_publish.py switch-account
```

说明：`search-feeds`、`get-feed-detail`、`post-comment-to-feed`、`reply-to-comment` 与 `get-notification-mentions` 会校验 `xiaohongshu.com` 主页登录态（非创作者中心登录态）。
说明：登录态检查默认启用本地缓存（12 小时，仅缓存“已登录”结果），到期后自动重新走网页校验。
说明：`search-feeds` 输出新增 `recommended_keywords_count` 与 `recommended_keywords` 字段，表示输入关键词后回车前的下拉推荐词。
说明：`content-data` 会校验创作者中心登录态，并抓取 `statistics/data-analysis` 页面中的笔记基础信息表。
说明：`reply-to-comment` 当前优先走通知页直回复；已完成真实发送验证。若通知页定位失败，可补 `feed_id` / `xsec_token` 回退到详情页定位回复。
说明：`post-comment-to-feed` 已完成真实发送验证，可用于一级评论。

### chrome_launcher.py

Chrome 浏览器管理。

```bash
# 启动 Chrome
./run-python.sh scripts/chrome_launcher.py
./run-python.sh scripts/chrome_launcher.py --headless

# 重启 Chrome
./run-python.sh scripts/chrome_launcher.py --restart

# 关闭 Chrome
./run-python.sh scripts/chrome_launcher.py --kill
```

## 支持各种 Skill 工具

本项目可作为 Claude Code、OpenCode 等支持 Skill 的工具使用，只需将项目复制到 `.claude/skills/post-to-xhs/` 目录，并添加 `SKILL.md` 文件即可。

如需作为 Skill 使用，请直接参考本目录下的 `SKILL.md` 并按 Skill 目录规范放置到目标工具的 skills 目录中。

## 注意事项

1. **仅供学习研究**：请遵守小红书平台规则，不要用于违规内容发布
2. **登录安全**：Cookie 存储在本地 Chrome Profile 中，请勿泄露
3. **选择器更新**：如果小红书页面结构变化导致发布失败，需要更新 `cdp_publish.py` 中的选择器
4. feed 的图片类型
- WB_PRV：预览图（preview），通常更轻、更快，适合列表卡片。
  - WB_DFT：默认图（default），通常用于详情展示，质量/尺寸更完整。

## RoadMap
- [x] 支持更多账号管理功能
- [x] 支持发布功能
- [x] 增加后台笔记获取功能
- [x] 支持自动评论
- [x] 支持素材检索功能
- [x] 增加更多错误处理机制


## 许可证

MIT License

## 致谢
灵感来自：[Post-to-xhs](https://github.com/Angiin/Post-to-xhs)
