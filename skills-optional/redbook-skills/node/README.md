# xiaohongshuskills Node migration skeleton

这是 `xiaohongshuskills` 的 Node + Puppeteer-first 执行层骨架。

当前目标：
- 保留现有 Python 控制面（账号 / profile / 端口 / Chrome 生命周期）
- 用 Puppeteer attach 已存在的 Chrome CDP 实例
- 先落地低风险读链路：`check-login` / `search-feeds` / `get-feed-detail`

## 用法

在 skill 根目录执行：

```bash
./run-puppeteer.sh check-login --account zenbliss
./run-puppeteer.sh search-feeds --account zenbliss --keyword 春招
./run-puppeteer.sh get-feed-detail --account zenbliss --feed-id 67abc1234def567890123456 --xsec-token XSEC_TOKEN
```

## 当前边界

- 已兼容：`accounts.json`、`login_status_cache.json`、基础 stdout markers
- 已支持：creator/home 登录检查、搜索推荐词抓取、搜索结果抓取、详情读取
- 暂未迁移：评论、通知、内容数据、图文/视频发布、二维码截图
- 暂未迁移：搜索筛选器（sort/note_type/publish_time/search_scope/location）交互应用

- Node 临时页默认在命令结束后自动关闭；如需保留页面调试，可传 `--keep-page-open`。

- 当前 Node 版已支持**图文 + 本地视频 + `--video-url`** 的 `fill / publish / click-publish`；远程视频会先下载到临时文件，再复用本地视频上传链路。
- 当前 Node 版默认策略：**读命令临时页自动关闭；登录/发布页默认保留**。如需强制保留临时页，可传 `--keep-page-open`。
- Node 图文 `fill/publish` 已支持：**正文最后一行 `#标签1 #标签2` 自动抽取并执行话题选择**。
- Node 图文 `publish/click-publish` 已补充**发布成功轮询判定**：优先读成功链接，再回退到 note id / 成功文案检测。
- Node 视频链路已实测跑通 **local video fill**：上传视频、等待处理、填写标题/正文、末行 `#标签` 话题选择。
- Node 视频链路已实测跑通 **`--video-url` fill**：远程下载 → 本地临时文件 → 上传视频 → 等待处理 → 填标题/正文 → 末行话题选择。
- Node 侧已新增 `--interaction-mode safe|normal|fast`：统一控制点击前停顿、鼠标移动、输入节奏、行间停顿等 human-action 参数；当前高风险动作（图文/视频填充、发布按钮、评论回复）已接入。
- `safe` 档已完成 smoke：图文 `fill` 成功、评论 `reply-to-comment --dry-run` 成功。
- Node 侧已新增 **risk guard v1**：按 `account + actionType` 记录最近一次高风险动作，并在 `tmp/risk_guard_state.json` 中维护状态；当前对 `publish / comment / fill` 生效最小间隔控制。
- 连续高风险动作会输出 `RISK_GUARD_WAIT:` 并主动等待，而不是立刻硬打。
- Node 侧已在发布/评论链路加入风控信号检测：命中“请求太频繁 / 验证码 / 安全验证 / captcha”等文本或选择器时，会以 `RISK_SIGNAL_DETECTED` 中止。
- Node 侧 production guard 已补到 **配额级别**：当前默认 publish 按 24h 窗口限额、comment 按 1h 窗口限额；超额会直接抛 `RISK_QUOTA_EXCEEDED`。
- 若同一账号同类高风险动作连续报错达到阈值，risk guard 会自动把本次动作的 `interaction-mode` **降到 `safe`**，并输出 `RISK_GUARD_MODE_OVERRIDE`。
- 若最近一次同类动作命中过 `RISK_SIGNAL_DETECTED`，会进入冷却时间，期间直接抛 `RISK_COOLDOWN_ACTIVE`，不继续硬打。
