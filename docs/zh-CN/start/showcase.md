---
read_when:
  - 寻找真实的 CrawClaw 使用示例
  - 更新社区项目亮点
summary: 由 CrawClaw 驱动的社区项目和集成
title: 展示
x-i18n:
  generated_at: "2026-06-12T06:01:40Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 8bd6578b9620ccf7c03d8d1665af8041a4b85d7283f0178d6163de06df20aa9d
  source_path: start/showcase.md
  workflow: 15
---

# 展示

来自社区的真实项目。看看人们用 CrawClaw 构建了什么。

<Info>
**想被展示？** 在 [Discord](https://discord.gg/qkhbAGHRBT) 或 [在 X 上 @crawclaw](https://x.com/crawclaw) 分享你的项目。
</Info>

## 🎥 CrawClaw 实战演示

VelvetShark 的完整设置教程（28 分钟）。

<div
  style={{
    position: "relative",
    paddingBottom: "56.25%",
    height: 0,
    overflow: "hidden",
    borderRadius: 16,
  }}
>
  <iframe
    src="https://www.youtube-nocookie.com/embed/SaWSPZoPX34"
    title="CrawClaw: The self-hosted AI that Siri should have been (Full setup)"
    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
    frameBorder="0"
    loading="lazy"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowFullScreen
  />
</div>

[在 YouTube 上观看](https://www.youtube.com/watch?v=SaWSPZoPX34)

<div
  style={{
    position: "relative",
    paddingBottom: "56.25%",
    height: 0,
    overflow: "hidden",
    borderRadius: 16,
  }}
>
  <iframe
    src="https://www.youtube-nocookie.com/embed/mMSKQvlmFuQ"
    title="CrawClaw showcase video"
    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
    frameBorder="0"
    loading="lazy"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowFullScreen
  />
</div>

[在 YouTube 上观看](https://www.youtube.com/watch?v=mMSKQvlmFuQ)

<div
  style={{
    position: "relative",
    paddingBottom: "56.25%",
    height: 0,
    overflow: "hidden",
    borderRadius: 16,
  }}
>
  <iframe
    src="https://www.youtube-nocookie.com/embed/5kkIJNUGFho"
    title="CrawClaw community showcase"
    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
    frameBorder="0"
    loading="lazy"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowFullScreen
  />
</div>

[在 YouTube 上观看](https://www.youtube.com/watch?v=5kkIJNUGFho)

## 🆕 QQBot 新鲜事

<CardGroup cols={2}>

<Card title="PR 审核反馈" icon="code-pull-request" href="https://x.com/i/status/2010878524543131691">
  **@bangnokia** • `review` `github`

OpenCode 完成更改 → 打开 PR → CrawClaw 审核 diff 并回复轻微建议以及明确的合并裁决，包括需要先应用的关键修复。
</Card>

<Card title="几分钟内构建酒窖 Skill" icon="wine-glass" href="https://x.com/i/status/2010916352454791216">
  **@prades_maxime** • `skills` `local` `csv`

向"Robby"(@crawclaw) 请求一个本地酒窖 Skill。它请求 CSV 导出样本 + 存储位置，然后快速构建/测试 Skill（示例中有 962 瓶酒）。

  <img src="/assets/showcase/wine-cellar-skill.jpg" alt="CrawClaw building a local wine cellar skill from CSV" />
</Card>

<Card title="Tesco 购物自动驾驶" icon="cart-shopping" href="https://x.com/i/status/2009724862470689131">
  **@marchattonhere** • `automation` `browser` `shopping`

每周餐食计划 → 常购商品 → 预约配送时段 → 确认订单。无需 API，仅浏览器控制。

  <img src="/assets/showcase/tesco-shop.jpg" alt="Tesco shop automation via chat" />
</Card>

<Card title="SNAG 截图转 Markdown" icon="scissors" href="https://github.com/am-will/snag">
  **@am-will** • `devtools` `screenshots` `markdown`

热键截取屏幕区域 → Gemini 视觉 → 即时 Markdown 到剪贴板。

  <img src="/assets/showcase/snag.png" alt="SNAG screenshot-to-markdown tool" />
</Card>

<Card title="飞书语音笔记（papla.media）" icon="microphone" href="https://papla.media/docs">
  **社区** • `voice` `tts` `feishu`

包装 papla.media TTS 并将结果作为飞书语音笔记发送（无烦人的自动播放）。

  <img src="/assets/showcase/papla-tts.jpg" alt="Feishu voice note output from TTS" />
</Card>

<Card title="CodexMonitor" icon="eye" href="https://clawhub.ai/odrobnik/codexmonitor">
  **@odrobnik** • `devtools` `codex` `brew`

Homebrew 安装的辅助工具，用于列出/检查/监视本地 OpenAI Codex 会话（CLI + VS Code）。

  <img src="/assets/showcase/codexmonitor.png" alt="CodexMonitor on ClawHub" />
</Card>

<Card title="Bambu 3D 打印机控制" icon="print" href="https://clawhub.ai/tobiasbischoff/bambu-cli">
  **@tobiasbischoff** • `hardware` `3d-printing` `skill`

控制和排除 BambuLab 打印机的故障：状态、任务、相机、AMS、校准等。

  <img src="/assets/showcase/bambu-cli.png" alt="Bambu CLI skill on ClawHub" />
</Card>

<Card title="维也纳交通（Wiener Linien）" icon="train" href="https://clawhub.ai/hjanuschka/wienerlinien">
  **@hjanuschka** • `travel` `transport` `skill`

维也纳公共交通的实时发车、 disruption、电梯状态和路线规划。

  <img src="/assets/showcase/wienerlinien.png" alt="Wiener Linien skill on ClawHub" />
</Card>

<Card title="ParentPay 学校餐食" icon="utensils" href="#">
  **@George5562** • `automation` `browser` `parenting`

通过 ParentPay 自动化英国学校餐食预订。使用鼠标坐标进行可靠的表格单元格点击。
</Card>

<Card title="R2 上传（发送我的文件）" icon="cloud-arrow-up" href="https://clawhub.ai/skills/r2-upload">
  **@julianengel** • `files` `r2` `presigned-urls`

上传到 Cloudflare R2/S3 并生成安全预签名下载链接。非常适合远程 CrawClaw 实例。
</Card>

<Card title="Oura Ring 健康助手" icon="heart-pulse" href="#">
  **@AS** • `health` `oura` `calendar`

个人 AI 健康助手，整合 Oura ring 数据与日历、预约和健身房计划。

  <img src="/assets/showcase/oura-health.png" alt="Oura ring health assistant" />
</Card>
<Card title="Kev 的梦之队（14+ 智能体）" icon="robot" href="https://github.com/adam91holt/orchestrated-ai-articles">
  **@adam91holt** • `multi-agent` `orchestration` `architecture` `manifesto`

</Card>

<Card title="Linear CLI" icon="terminal" href="https://github.com/Finesssee/linear-cli">
  **@NessZerra** • `devtools` `linear` `cli` `issues`

Linear 的 CLI，可与智能体工作流集成（Claude Code、CrawClaw）。在终端管理 issue、项目和工作流。第一个外部 PR 已合并！
</Card>

<Card title="Beeper CLI" icon="message" href="https://github.com/blqke/beepcli">
  **@jules** • `messaging` `beeper` `cli` `automation`

通过 Beeper Desktop 读取、发送和归档消息。使用 Beeper 本地 MCP API，智能体可以在一个地方管理你所有的聊天（Weixin、Weixin 等）。
</Card>

</CardGroup>

## 🤖 自动化与工作流

<CardGroup cols={2}>

<Card title="Winix 空气净化器控制" icon="wind" href="https://x.com/antonplex/status/2010518442471006253">
  **@antonplex** • `automation` `hardware` `air-quality`

Claude Code 发现并确认了净化器控制，然后 CrawClaw 接管管理房间空气质量。

  <img src="/assets/showcase/winix-air-purifier.jpg" alt="Winix air purifier control via CrawClaw" />
</Card>

<Card title="天空相机美照" icon="camera" href="https://x.com/feishugaining/status/2010523120604746151">
  **@feishugaining** • `automation` `camera` `skill` `images`

由屋顶相机触发：当天空看起来很美时让 CrawClaw 拍摄一张照片 —— 它设计了一个 Skill 并拍摄了照片。

  <img src="/assets/showcase/roof-camera-sky.jpg" alt="Roof camera sky snapshot captured by CrawClaw" />
</Card>

<Card title="可视化早间简报场景" icon="robot" href="https://x.com/buddyhadry/status/2010005331925954739">
  **@buddyhadry** • `automation` `briefing` `images` `feishu`

定时提示每天早上通过 CrawClaw persona 生成一个"场景"图像（天气、任务、日期、最喜欢的帖子/语录）。
</Card>

<Card title="壁球场地预订" icon="calendar-check" href="https://github.com/joshp123/padel-cli">
  **@joshp123** • `automation` `booking` `cli`
  
  Playtomic 可用性检查器 + 预订 CLI。再也不会错过空场了。
  
  <img src="/assets/showcase/padel-screenshot.jpg" alt="padel-cli screenshot" />
</Card>

<Card title="会计 intake" icon="file-invoice-dollar">
  **社区** • `automation` `email` `pdf`
  
  从邮件收集 PDF，为税务顾问准备文件。每月会计自动化。
</Card>

<Card title="沙发土豆开发模式" icon="couch" href="https://davekiss.com">
  **@davekiss** • `feishu` `website` `migration` `astro`

在观看 Netflix 的同时通过飞书重建了整个个人网站 —— Notion → Astro，迁移了 18 篇文章，DNS 到 Cloudflare。无需打开笔记本电脑。
</Card>

<Card title="求职智能体" icon="briefcase">
  **@attol8** • `automation` `api` `skill`

搜索职位列表，根据简历关键词匹配，返回相关机会和链接。使用 JSearch API 在 30 分钟内构建。
</Card>

<Card title="Jira Skill 构建器" icon="diagram-project" href="https://x.com/jdrhyne/status/2008336434827002232">
  **@jdrhyne** • `automation` `jira` `skill` `devtools`

CrawClaw 连接到 Jira，然后动态生成一个新的 Skill（在 ClawHub 上存在之前）。
</Card>

<Card title="通过飞书使用 Todoist Skill" icon="list-check" href="https://x.com/iamsubhrajyoti/status/2009949389884920153">
  **@iamsubhrajyoti** • `automation` `todoist` `skill` `feishu`

自动化 Todoist 任务，并在飞书聊天中直接让 CrawClaw 生成 Skill。
</Card>

<Card title="TradingView 分析" icon="chart-line">
  **@bheem1798** • `finance` `browser` `automation`

通过浏览器自动化登录 TradingView，截图图表，按需进行技术分析。无需 API —— 仅浏览器控制。
</Card>

<Card title="钉钉自动客服" icon="ddingtalk">
  **@henrymascot** • `ddingtalk` `automation` `support`

监视公司钉钉频道，有帮助地回复，并将通知转发到飞书。在部署的应用中自主修复了一个生产 bug，无需被要求。
</Card>

</CardGroup>

## 🧠 体验与记忆

<CardGroup cols={2}>

<Card title="学中文" icon="language" href="https://github.com/joshp123/xuezh">
  **@joshp123** • `learning` `voice` `skill`
  
  通过 CrawClaw 的中文学习引擎，提供发音反馈和学习流程。
  
  <img src="/assets/showcase/xuezh-pronunciation.jpeg" alt="xuezh pronunciation feedback" />
</Card>

<Card title="Weixin 记忆库" icon="vault">
  **社区** • `memory` `transcription` `indexing`
  
  摄入完整的 Weixin 导出，转录 1000+ 语音笔记，与 git 日志交叉检查，输出链接的 markdown 报告。
</Card>

<Card title="Karakeep 语义搜索" icon="magnifying-glass" href="https://github.com/jamesbrooksco/karakeep-semantic-search">
  **@jamesbrooksco** • `search` `vector` `bookmarks`
  
  使用 Qdrant + OpenAI/Ollama 嵌入为 Karakeep 书签添加向量搜索。
</Card>

<Card title="Inside-Out-2 记忆" icon="brain">
  **社区** • `memory` `beliefs` `self-model`
  
  独立的记忆管理器，将会话文件转化为记忆 → 信念 → 不断演变的自我模型。
</Card>

</CardGroup>

## 🎙️ 语音与电话

<CardGroup cols={2}>

<Card title="Clawdia 电话桥接" icon="phone" href="https://github.com/alejandroOPI/clawdia-bridge">
  **@alejandroOPI** • `voice` `vapi` `bridge`
  
  Vapi 语音助手 ↔ CrawClaw HTTP 桥接。与你的智能体进行近乎实时的电话通话。
</Card>

<Card title="OpenRouter 转录" icon="microphone" href="https://clawhub.ai/obviyus/openrouter-transcribe">
  **@obviyus** • `transcription` `multilingual` `skill`

通过 OpenRouter（Gemini 等）进行多语言音频转录。在 ClawHub 上可用。
</Card>

</CardGroup>

## 🏗️ 基础设施与部署

<CardGroup cols={2}>

<Card title="Home Assistant 插件" icon="home" href="https://github.com/ngutman/crawclaw-ha-addon">
  **@ngutman** • `homeassistant` `raspberry-pi`
  
  在 Home Assistant OS 上运行 CrawClaw Gateway，支持 SSH 隧道和持久状态。
</Card>

<Card title="Home Assistant Skill" icon="toggle-on" href="https://clawhub.ai/skills/homeassistant">
  **ClawHub** • `homeassistant` `skill` `automation`
  
  通过自然语言控制和自动化 Home Assistant 设备。
</Card>

<Card title="Nix 打包" icon="snowflake" href="https://github.com/crawclaw/nix-crawclaw">
  **@crawclaw** • `nix` `packaging` `deployment`
  
  包含所有依赖的 Nix 化 CrawClaw 配置，用于可复现的部署。
</Card>

<Card title="CalDAV 日历" icon="calendar" href="https://clawhub.ai/skills/caldav-calendar">
  **ClawHub** • `calendar` `caldav` `skill`
  
  使用 khal/vdirsyncer 的日历 Skill。自托管日历集成。
</Card>

</CardGroup>

## 🏠 家庭与硬件

<CardGroup cols={2}>

<Card title="GoHome 自动化" icon="house-feishu" href="https://github.com/joshp123/gohome">
  **@joshp123** • `home` `nix` `grafana`
  
  以 CrawClaw 为界面的 Nix 原生家庭自动化，加上漂亮的 Grafana 仪表板。
  
  <img src="/assets/showcase/gohome-grafana.png" alt="GoHome Grafana dashboard" />
</Card>

<Card title="Roborock 扫地机器人" icon="robot" href="https://github.com/joshp123/gohome/tree/main/plugins/roborock">
  **@joshp123** • `vacuum` `iot` `plugin`
  
  通过自然对话控制你的 Roborock 扫地机器人。
  
  <img src="/assets/showcase/roborock-screenshot.jpg" alt="Roborock status" />
</Card>

</CardGroup>

## 🌟 社区项目

<CardGroup cols={2}>

<Card title="StarSwap 市场" icon="star" href="https://star-swap.com/">
  **社区** • `marketplace` `astronomy` `webapp`
  
  完整的天文设备市场。基于/围绕 CrawClaw 生态系统构建。
</Card>

</CardGroup>

---

## 提交你的项目

有东西要分享吗？我们很乐意展示！

<Steps>
  <Step title="分享它">
    在 [Discord](https://discord.gg/qkhbAGHRBT) 或 [发推 @crawclaw](https://x.com/crawclaw) 上发布
  </Step>
  <Step title="包含详情">
    告诉我们它的功能，附上仓库/演示链接，如果有截图也分享
  </Step>
  <Step title="获得展示">
    我们会把出色的项目添加到这个页面
  </Step>
</Steps>
