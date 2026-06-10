---
read_when:
  - 添加智能体控制的浏览器自动化
  - 调试 CrawClaw 干扰你本地 Chrome 的原因
  - 在本地客户端中实现浏览器设置和生命周期
summary: 由 Rust 原生 agent-browser 运行时支持的集成浏览器自动化工具
title: 浏览器（CrawClaw 托管）
x-i18n:
  generated_at: "2026-06-10T19:17:33Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 2702769d84ca212076398255fd4888ad23d2b5b27f33fb2975c7f907e112d266
  source_path: tools/browser.md
  workflow: 15
---

# 浏览器（CrawClaw 托管）

CrawClaw 可以运行一个由智能体通过 Rust 原生 `browser` 工具控制的浏览器会话，该工具由托管的 `agent-browser` CLI 支持。默认情况下，它与你的个人浏览器隔离。

入门视图：

- 将其视为一个**独立的、仅供智能体使用的浏览器**。
- `crawclaw` 配置不会影响你的个人浏览器配置。
- 智能体可以在安全环境中**打开标签页、读取页面、点击和输入**。
- 浏览器执行由 Rust 原生插件注册表管理。

## 你将获得的功能

- 一个名为 **crawclaw** 的独立浏览器配置（默认橙色强调色）。
- 确定性的标签页控制（列表/打开/聚焦/关闭）。
- 智能体操作（点击/输入/拖拽/选择）、快照、截图、PDF。
- 可选的多配置支持（`crawclaw`、`work`、`remote` 等）。

此浏览器**不是**你的日常浏览器。它是一个用于智能体自动化和验证的安全隔离界面。

## 快速开始

使用智能体 `browser` 工具。通过 [`/tools/invoke`](/gateway/tools-invoke-http-api) 直接调用时，将以下对象放在 `args` 下：

```json
{ "action": "status", "profile": "crawclaw" }
```

```json
{ "action": "open", "profile": "crawclaw", "url": "https://example.com" }
```

```json
{ "action": "snapshot", "profile": "crawclaw", "interactive": true }
```

如果收到“浏览器已禁用”，请在配置中启用它（见下文）并重启 Gateway。

如果智能体表示浏览器工具不可用，请跳转到[缺少浏览器工具](/tools/browser#missing-browser-tool)。

## 原生工具控制

默认的 `browser` 工具现在由捆绑的 Rust 原生插件注册表注册。保持 `browser.enabled=true` 和 `browser.provider=agent-browser`（或不设置 provider）以使用托管运行时：

```json5
{
  browser: {
    enabled: true,
    provider: "agent-browser",
  },
}
```

本地新手引导为新配置保留 `coding` 工具配置。原生的 `browser` 工具是该配置的一部分，因此当浏览器配置启用时，默认 `main` 智能体可以使用它。

## agent-browser 执行引擎

CrawClaw 现在通过 Rust 原生调度运行 `browser` 工具。处理程序启动托管的原生 `agent-browser` 二进制文件并输出 JSON，然后将响应映射回 CrawClaw 工具内容。desktop 运行时将此二进制文件暂存到 `runtimes/browser/bin/agent-browser` 下；它不嵌入 Node 运行时或旧的包包装器。

当前范围：

- `host` 是支持的本地执行目标。
- `node` 浏览器代理路由不再支持。
- 遗留的仅 `targetId` 工作流有意不再适配。

当前支持的操作：

- `status`
- `open`
- `navigate`
- `focus`
- `close`
- `snapshot`
- `screenshot`
- `pdf`
- `tabs`
- `console`
- `upload`
- `dialog`
- `act` 通用子集（`click`、`dblclick`、`type`、`press`、`hover`、`drag`、`select`、`wait`、`evaluate`、`resize`、`close`）

浏览器配置更改在调用时由原生运行时读取。

## 缺少浏览器工具

如果智能体报告缺少浏览器工具，请首先检查 `tools.catalog`/`tools.effective`。在当前版本中，该工具应出现在 `native-plugin` 下，`pluginId: "browser"`。

典型症状：

- 智能体报告浏览器工具不可用或缺失。

如果旧示例显示 CrawClaw Desktop 或本地 Gateway API，请改用当前的 `browser` 工具。在当前 CrawClaw 版本中，独立浏览器 CLI 不再注册。

## 配置

浏览器设置位于 `~/.crawclaw/crawclaw.json`。

```json5
{
  browser: {
    enabled: true, // 默认: true
    evaluateEnabled: true,
    ssrfPolicy: {
      dangerouslyAllowPrivateNetwork: true, // 默认信任网络模式
      // allowPrivateNetwork: true, // 遗留别名
      // hostnameAllowlist: ["*.example.com", "example.com"],
      // allowedHostnames: ["localhost"],
    },
    defaultProfile: "crawclaw",
    color: "#FF4500",
    headless: false,
    profiles: {
      crawclaw: { color: "#FF4500" },
      work: { color: "#0066CC" },
    },
  },
}
```

注意：

- 浏览器导航/打开标签页在导航前受 SSRF 保护，并在导航后最终 `http(s)` URL 上尽最大努力重新检查。
- `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork` 默认为 `true`（信任网络模式）。设为 `false` 以进行严格的仅公共浏览。
- `browser.ssrfPolicy.allowPrivateNetwork` 作为遗留别名继续支持以保持兼容性。
- `color` + 每个配置的 `color` 为浏览器 UI 着色，以便你看到哪个配置处于活动状态。
- 默认配置是 `crawclaw`。
- 当原生运行时明确可用时，原生运行时可以启动 `agent-browser` CLI。

## 运行时模型

- **本地控制（默认）：** Rust 原生处理程序按需启动托管的 `agent-browser` CLI。
- **配置：** `profile` 选择传递给 `agent-browser` 的浏览器配置；`user` 映射到默认用户浏览器配置。
- **运行时安装：** 如果托管的 `agent-browser` 二进制文件缺失，运行 CrawClaw Desktop 或本地 Gateway API。

## 安全

关键概念：

- 浏览器输出被视为不受信任的页面内容。
- 快照输出在到达智能体之前被包装在外部内容边界中。
- 保持所有配置的浏览器可执行文件或配置路径为本地且可信。

## 配置（多浏览器）

CrawClaw 支持多个命名配置（路由配置）。配置可以是：

- **crawclaw 托管**：通过 `agent-browser` 路由的专用托管浏览器配置
- **user**：明确请求时的默认用户浏览器配置

默认值：

- 如果缺失，将自动创建 `crawclaw` 配置。
- 删除配置会将其本地数据目录移至废纸篓。

智能体工具使用 `profile` 参数。

注意：

- 此路径比隔离的 `crawclaw` 配置风险更高，因为它可以在你已登录的浏览器会话中操作。
- 远程 CDP 和 node 代理路由不属于原生浏览器运行时。

## 隔离保证

- **专用用户数据目录**：从不接触你的个人浏览器配置。
- **专用端口**：避免 `9222` 以防止与开发工作流冲突。
- **确定性标签页控制**：通过 `targetId` 定位标签页，而非“最后一个标签页”。

## 浏览器选择

在本地启动时，CrawClaw 按以下顺序选择第一个可用的：

1. Chrome
2. Brave
3. Edge
4. Chromium
5. Chrome Canary

你可以使用 `browser.executablePath` 覆盖。

平台：

- macOS：检查 `/Applications` 和 `~/Applications`。
- Linux：查找 `google-chrome`、`brave`、`microsoft-edge`、`chromium` 等。
- Windows：检查常见安装位置。

## 工作原理（内部）

高层流程：

- Rust 原生插件注册表声明 `browser` 工具和 `browser-agent-browser-runtime` 服务。
- 原生浏览器处理程序将 CrawClaw 工具参数映射到 `agent-browser` CLI 参数并请求 JSON 输出。
- 快照输出作为外部不受信任的内容进行包装。
- 截图输出作为图像内容返回，而不仅仅是文件系统路径。

此设计使智能体保持在稳定、确定性的接口上，同时让你将浏览器自动化保持在单一控制平面上。

## 智能体工具快速参考

`browser` 工具接受顶级 `action` 加上可选的 `profile`、`target`、`node`、`targetId` 和特定于操作的字段。通过 [`/tools/invoke`](/gateway/tools-invoke-http-api) 调用时，将相同的对象作为 `args` 传递。

基础操作：

- 状态：`{ "action": "status" }`
- 启动：`{ "action": "start" }`
- 停止：`{ "action": "stop" }`
- 配置：`{ "action": "profiles" }`
- 标签页：`{ "action": "tabs" }`
- 打开：`{ "action": "open", "url": "https://example.com" }`
- 聚焦：`{ "action": "focus", "targetId": "abcd1234" }`
- 关闭：`{ "action": "close", "targetId": "abcd1234" }`

检查：

- 截图：`{ "action": "screenshot", "fullPage": true }`
- 元素截图：`{ "action": "screenshot", "ref": "e12" }`
- AI 快照：`{ "action": "snapshot", "snapshotFormat": "ai" }`
- 角色快照：`{ "action": "snapshot", "interactive": true, "compact": true, "depth": 6 }`
- 作用域快照：`{ "action": "snapshot", "selector": "#main", "interactive": true }`
- 帧快照：`{ "action": "snapshot", "frame": "iframe#main", "interactive": true }`
- 控制台：`{ "action": "console", "level": "error" }`
- PDF：`{ "action": "pdf" }`

操作：

- 导航：`{ "action": "navigate", "url": "https://example.com" }`
- 调整大小：`{ "action": "act", "kind": "resize", "width": 1280, "height": 720 }`
- 点击：`{ "action": "act", "kind": "click", "ref": "e12" }`
- 输入：`{ "action": "act", "kind": "type", "ref": "e12", "text": "hello", "submit": true }`
- 按键：`{ "action": "act", "kind": "press", "key": "Enter" }`
- 悬停：`{ "action": "act", "kind": "hover", "ref": "e12" }`
- 拖拽：`{ "action": "act", "kind": "drag", "startRef": "e10", "endRef": "e11" }`
- 选择：`{ "action": "act", "kind": "select", "ref": "e9", "values": ["OptionA", "OptionB"] }`
- 上传：`{ "action": "upload", "paths": ["/tmp/crawclaw/uploads/file.pdf"] }`
- 文件输入上传：`{ "action": "upload", "inputRef": "e12", "paths": ["/tmp/crawclaw/uploads/file.pdf"] }`
- 对话框：`{ "action": "dialog", "accept": true }`
- 等待：`{ "action": "act", "kind": "wait", "selector": "#main", "timeoutMs": 15000 }`
- 执行：`{ "action": "act", "kind": "evaluate", "ref": "e7", "fn": "(el) => el.textContent" }`

状态和网络：

- Cookies：`{ "action": "cookies" }`
- 本地存储：`{ "action": "storage", "storageKind": "local" }`
- 会话存储：`{ "action": "storage", "storageKind": "session" }`
- 网络请求：`{ "action": "network", "pattern": "api" }`
- 下载：`{ "action": "download", "filename": "report.pdf" }`

迁移注意：旧的独立浏览器 CLI 示例没有当前等效项。从智能体会话使用 `browser` 工具或通过 Gateway [工具调用 API](/gateway/tools-invoke-http-api) 调用它。

注意：

- `upload` 和 `dialog` 是**预热**调用；在触发选择器/对话框的点击/按键之前运行它们。
- 下载和跟踪输出路径被限制在 CrawClaw 临时根目录：
  - 跟踪：`/tmp/crawclaw`（后备：`${os.tmpdir()}/crawclaw`）
  - 下载：`/tmp/crawclaw/downloads`（后备：`${os.tmpdir()}/crawclaw/downloads`）
- 上传路径被限制在 CrawClaw 临时上传根目录：
  - 上传：`/tmp/crawclaw/uploads`（后备：`${os.tmpdir()}/crawclaw/uploads`）
- `upload` 也可以使用 `inputRef` 或 `element` 直接设置文件输入。
- `snapshot`：
  - `snapshotFormat: "ai"`（安装 Playwright 时的默认设置）：返回带数字引用的 AI 快照（`aria-ref="<n>"`）。
  - `snapshotFormat: "aria"`：返回可访问性树（无引用；仅用于检查）。
  - `mode: "efficient"`：紧凑角色快照预设（interactive + compact + depth + 更低的 maxChars）。
  - 配置默认值：设置 `browser.snapshotDefaults.mode: "efficient"` 以在调用方未传递模式时使用高效快照（参见 [Gateway 配置](/gateway/configuration-reference#browser)）。
  - 角色快照字段（`interactive`、`compact`、`depth`、`selector`）强制使用带引用的基于角色的快照，如 `ref=e12`。
  - `frame: "<iframe selector>"` 将角色快照作用域限定为 iframe（与角色引用如 `e12` 配对）。
  - `interactive: true` 输出一个扁平的、易于选择的交互元素列表（最适合驱动操作）。
  - `labels: true` 添加带叠加引用标签的视口截图。
- `click`/`type`/etc 需要来自 `snapshot` 的 `ref`（数字 `12` 或角色引用 `e12`）。
  CSS 选择器有意不支持操作。

## 快照和引用

CrawClaw 支持两种“快照”样式：

- **AI 快照（数字引用）**：`{ "action": "snapshot", "snapshotFormat": "ai" }`
  - 输出：包含数字引用的文本快照。
  - 操作：`{ "action": "act", "kind": "click", "ref": "12" }` 和 `{ "action": "act", "kind": "type", "ref": "23", "text": "hello" }`。
  - 内部通过 Playwright 的 `aria-ref` 解析引用。

- **角色快照（角色引用如 `e12`）**：`{ "action": "snapshot", "interactive": true }`（可选带有 `compact`、`depth`、`selector` 或 `frame`）
  - 输出：带有 `[ref=e12]` 的基于角色的列表/树（以及可选的 `[nth=1]`）。
  - 操作：`{ "action": "act", "kind": "click", "ref": "e12" }`。
  - 内部通过 `getByRole(...)`（加上重复项的 `nth()`）解析引用。
  - 添加 `"labels": true` 以包含带叠加 `e12` 标签的视口截图。

引用行为：

- 引用在导航之间**不稳定**；如果某些操作失败，请重新运行 `snapshot` 并使用新的引用。
- 如果角色快照是用 `--frame` 拍摄的，角色引用将限定在该 iframe 中，直到下一次角色快照。

## 等待增强

你可以等待的不仅是时间/文本：

- 等待 URL（Playwright 支持 glob）：
  - `{ "action": "act", "kind": "wait", "url": "**/dash" }`
- 等待加载状态：
  - `{ "action": "act", "kind": "wait", "loadState": "networkidle" }`
- 等待 JS 谓词：
  - `{ "action": "act", "kind": "wait", "fn": "window.ready===true" }`
- 等待选择器变为可见：
  - `{ "action": "act", "kind": "wait", "selector": "#main" }`

这些可以组合：

```json
{
  "action": "act",
  "kind": "wait",
  "selector": "#main",
  "url": "**/dash",
  "loadState": "networkidle",
  "fn": "window.ready===true",
  "timeoutMs": 15000
}
```

## 调试工作流

当操作失败时（例如“不可见”、“严格模式违规”、“被遮挡”）：

1. 运行 `{ "action": "snapshot", "interactive": true }`。
2. 使用 `{ "action": "act", "kind": "click", "ref": "<ref>" }` 或 `{ "action": "act", "kind": "type", "ref": "<ref>", "text": "..." }`。
3. 如果页面行为异常，检查 `{ "action": "console", "level": "error" }` 和 `{ "action": "network", "pattern": "api" }`。

## 结构化输出

智能体工具调用和 `/tools/invoke` 响应已经是结构化 JSON。有用的直接调用包括：

```json
{ "action": "status" }
```

```json
{ "action": "snapshot", "interactive": true }
```

```json
{ "action": "network", "pattern": "api" }
```

```json
{ "action": "cookies" }
```

JSON 中的角色快照包含 `refs` 加上一个小型 `stats` 块（行数/字符数/引用数/交互数），以便工具可以推断有效载荷大小和密度。

## 状态和环境旋钮

这些对于“使网站表现如 X”工作流很有用：

- Cookies：`cookies`、`cookies set`、`cookies clear`
- 存储：`storage local|session get|set|clear`
- 离线：`set offline on|off`
- 请求头：`set headers --headers-json '{"X-Debug":"1"}'`（遗留的 `set headers --json '{"X-Debug":"1"}'` 仍然支持）
- HTTP 基本认证：`set credentials user pass`（或 `--clear`）
- 地理位置：`set geo <lat> <lon> --origin "https://example.com"`（或 `--clear`）
- 媒体：`set media dark|light|no-preference|none`
- 时区/区域设置：`set timezone ...`、`set locale ...`
- 设备/视口：
  - `set device "iPhone 14"`（Playwright 设备预设）
  - `set viewport 1280 720`

## 安全与隐私

- 浏览器自动化在 Gateway 认证边界后运行；使用 CrawClaw Desktop 或本地 Gateway API 进行操作员控制。
- `browser` 工具的 evaluate 操作和带 `fn` 的 `wait` 调用在页面上下文中执行任意 JavaScript。提示注入可以操纵此行为。如果不需要，请使用 `browser.evaluateEnabled=false` 禁用它。
- 有关登录和反机器人说明（X/Twitter 等），请参见[浏览器登录 + X/Twitter 发布](/tools/browser-login)。
- 保持 Gateway 私密（local loopback 或仅 tailnet）。
- 浏览器自动化可以在已登录的会话中操作；保持托管配置私密。

严格模式示例（默认阻止私有/内部目标）：

```json5
{
  browser: {
    ssrfPolicy: {
      dangerouslyAllowPrivateNetwork: false,
      hostnameAllowlist: ["*.example.com", "example.com"],
      allowedHostnames: ["localhost"], // 可选的精确允许
    },
  },
}
```

## 故障排除

对于 Linux 特定问题（尤其是 snap Chromium），请参见[浏览器故障排除](/tools/browser-linux-troubleshooting)。

## 智能体工具 + 控制工作原理

智能体获得**一个用于浏览器自动化的工具**：

- `browser` — 状态/启动/停止/标签页/打开/聚焦/关闭/快照/截图/导航/操作

映射方式：

- `browser snapshot` 返回稳定的 UI 树（AI 或 ARIA）。
- `browser act` 使用快照 `ref` ID 进行点击/输入/拖拽/选择。
- `browser screenshot` 捕获像素（全页或元素）。
- `browser` 接受：
  - `profile` 选择命名浏览器配置（`crawclaw`、`user` 或其他配置的配置文件）。
  - `target`（`host`）选择 Gateway 主机浏览器。

这使智能体保持确定性并避免脆弱的选择器。

## 相关

- [工具概览](/tools) — 所有可用的智能体工具
- [安全](/gateway/security) — 浏览器控制风险和加固
