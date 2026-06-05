---
read_when:
  - 添加智能体控制的浏览器自动化
  - 调试为什么 CrawClaw 在干扰你自己的 Chrome
  - 在本地客户端中实现浏览器设置和生命周期
summary: 由 Rust 原生 agent-browser 运行时支持的集成浏览器自动化工具
title: 浏览器（CrawClaw 托管）
x-i18n:
  generated_at: "2026-06-05T14:50:52Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: fd8bbaf62db6decbec0692af732a2e0af4e13e566d16be273593249cc8da5a4d
  source_path: tools/browser.md
  workflow: 15
---

# 浏览器（CrawClaw 托管）

CrawClaw 可以运行由 Rust 原生 `browser` 工具控制的浏览器会话，由托管的 `agent-browser` CLI 支持。默认情况下，它与你的个人浏览器保持隔离。

初学者视角：

- 把它想象成一个**独立的、仅供智能体使用的浏览器**。
- `crawclaw` 配置**不会**触及你的个人浏览器配置。
- 智能体可以**打开标签页、读取页面、点击和输入**，安全无虞。
- 浏览器执行由 Rust 原生插件注册表拥有。

## 你将获得

- 一个名为 **crawclaw** 的独立浏览器配置（默认橙色强调色）。
- 确定性的标签页控制（列出/打开/聚焦/关闭）。
- 智能体操作（点击/输入/拖动/选择）、快照、截图、PDF。
- 可选的多配置支持（`crawclaw`、`work`、`remote` 等）。

这个浏览器**不是**你的日常浏览器。它是智能体自动化和验证的安全隔离表面。

## 快速开始

使用智能体 `browser` 工具。当通过 [`/tools/invoke`](/gateway/tools-invoke-http-api) 直接调用时，将以下对象放在 `args` 下：

```json
{ "action": "status", "profile": "crawclaw" }
```

```json
{ "action": "open", "profile": "crawclaw", "url": "https://example.com" }
```

```json
{ "action": "snapshot", "profile": "crawclaw", "interactive": true }
```

如果你收到"浏览器已禁用"，在配置中启用它（见下文）并重启 Gateway。

如果智能体说浏览器工具不可用，请跳转到[缺失的浏览器工具](/tools/browser#missing-browser-tool)。

## 原生工具控制

默认的 `browser` 工具现在由捆绑的 Rust 原生插件注册表注册。保持 `browser.enabled=true` 和 `browser.provider=agent-browser`（或保持提供商未设置）以使用托管运行时：

```json5
{
  browser: {
    enabled: true,
    provider: "agent-browser",
  },
}
```

本地新手引导为新配置保留 `coding` 工具配置。原生的 `browser` 工具是该配置的一部分，因此当浏览器配置启用时，它对默认的 `main` 智能体可用。

## agent-browser 执行引擎

CrawClaw 现在通过 Rust 原生调度运行 `browser` 工具。处理程序生成托管的原生 `agent-browser` 二进制文件，输出 JSON 并将响应映射回 CrawClaw 工具内容。桌面运行时将此二进制文件暂存在 `runtimes/browser/bin/agent-browser` 下；它不嵌入 Node 运行时或旧包包装器。

当前范围：

- `host` 是支持的本地执行目标。
- `node` 浏览器代理路由不再支持。
- 旧的仅 `targetId` 工作流有意不再适配。

当前操作覆盖：

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
- `act` 公共子集（`click`、`dblclick`、`type`、`press`、`hover`、`drag`、`select`、`wait`、`evaluate`、`resize`、`close`）

浏览器配置更改在调用时由原生运行时读取。

## 缺失的浏览器工具

如果智能体报告浏览器工具缺失，首先检查 `tools.catalog`/`tools.effective`。在当前构建中，该工具应出现在 `native-plugin` 下，`pluginId: "browser"`。

典型症状：

- 智能体报告浏览器工具不可用或缺失。

如果旧示例显示 CrawClaw Desktop 或本地 Gateway API，请改用当前的 `browser` 工具。在当前 CrawClaw 构建中，独立浏览器 CLI 不再注册。

## 配置

- `crawclaw`：托管的隔离浏览器，由 `agent-browser` 支持。
- 其他命名配置：传递给 `agent-browser` 的逻辑浏览器标签。

对于智能体浏览器工具调用：

- 默认：使用隔离的 `crawclaw` 浏览器。
- `profile` 是当你想要特定浏览器模式时的显式覆盖。

如果你想默认使用托管模式，设置 `browser.defaultProfile: "crawclaw"`。

## 配置

浏览器设置位于 `~/.crawclaw/crawclaw.json`。

```json5
{
  browser: {
    enabled: true, // 默认：true
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

注意事项：

- 浏览器导航/打开标签页在导航前受 SSRF 保护，并在导航后最终 `http(s)` URL 上尽力重新检查。
- `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork` 默认为 `true`（信任网络模型）。将其设置为 `false` 以进行严格的仅公共浏览。
- `browser.ssrfPolicy.allowPrivateNetwork` 仍作为遗留别名受支持以保持兼容性。
- `color` + 每个配置的 `color` 为浏览器 UI 添加颜色，以便你可以看到哪个配置处于活动状态。
- 默认配置是 `crawclaw`。
- 当原生运行时明确可用时，原生运行时可以启动 `agent-browser` CLI。

## 运行时模型

- **本地控制（默认）：** Rust 原生处理程序按需启动托管的 `agent-browser` CLI。
- **配置：** `profile` 选择传递给 `agent-browser` 的浏览器配置；`user` 映射到默认用户浏览器配置。
- **运行时安装：** 如果托管的 `agent-browser` 二进制文件缺失，运行 CrawClaw Desktop 或本地 Gateway API。

## 安全

关键理念：

- 浏览器输出被视为不可信的页面内容。
- 快照输出在到达智能体之前用外部内容边界包装。
- 保持任何配置的浏览器可执行文件或配置路径本地且可信。

## 配置（多浏览器）

CrawClaw 支持多个命名配置（路由配置）。配置可以是：

- **crawclaw 托管**：通过 `agent-browser` 路由的专用托管浏览器配置
- **user**：在明确请求时的默认用户浏览器配置

默认值：

- `crawclaw` 配置在缺失时自动创建。
- 删除配置将其本地数据目录移至垃圾桶。

智能体工具使用 `profile` 参数。

注意事项：

- 此路径比隔离的 `crawclaw` 配置风险更高，因为它可以在你已登录的浏览器会话中操作。
- 远程 CDP 和节点代理路由不是原生浏览器运行时的一部分。

## 隔离保证

- **专用用户数据目录**：永不触及你的个人浏览器配置。
- **专用端口**：避免 `9222` 以防止与开发工作流冲突。
- **确定性标签页控制**：通过 `targetId` 定位标签页，而非"最后一个标签页"。

## 浏览器选择

在本地启动时，CrawClaw 按以下顺序选择第一个可用的：

1. Chrome
2. Brave
3. Edge
4. Chromium
5. Chrome Canary

你可以用 `browser.executablePath` 覆盖。

平台：

- macOS：检查 `/Applications` 和 `~/Applications`。
- Linux：查找 `google-chrome`、`brave`、`microsoft-edge`、`chromium` 等。
- Windows：检查常见安装位置。

## 工作原理（内部）

高级流程：

- Rust 原生插件注册表声明 `browser` 工具和 `browser-agent-browser-runtime` 服务。
- 原生浏览器处理程序将 CrawClaw 工具参数映射到 `agent-browser` CLI 参数并请求 JSON 输出。
- 快照输出作为外部不可信内容包装。
- 截图输出作为图像内容返回，而不仅仅是文件系统路径。

此设计将智能体保持在稳定、确定性的接口上，同时让你在一个控制平面上保持浏览器自动化。

## 智能体工具快速参考

`browser` 工具接受顶级 `action` 加上可选的 `profile`、`target`、`node`、`targetId` 和操作特定字段。当通过 [`/tools/invoke`](/gateway/tools-invoke-http-api) 调用时，将相同对象作为 `args` 传递。

基础：

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
- 框架快照：`{ "action": "snapshot", "frame": "iframe#main", "interactive": true }`
- 控制台：`{ "action": "console", "level": "error" }`
- PDF：`{ "action": "pdf" }`

操作：

- 导航：`{ "action": "navigate", "url": "https://example.com" }`
- 调整大小：`{ "action": "act", "kind": "resize", "width": 1280, "height": 720 }`
- 点击：`{ "action": "act", "kind": "click", "ref": "e12" }`
- 输入：`{ "action": "act", "kind": "type", "ref": "e12", "text": "hello", "submit": true }`
- 按键：`{ "action": "act", "kind": "press", "key": "Enter" }`
- 悬停：`{ "action": "act", "kind": "hover", "ref": "e12" }`
- 拖动：`{ "action": "act", "kind": "drag", "startRef": "e10", "endRef": "e11" }`
- 选择：`{ "action": "act", "kind": "select", "ref": "e9", "values": ["OptionA", "OptionB"] }`
- 上传：`{ "action": "upload", "paths": ["/tmp/crawclaw/uploads/file.pdf"] }`
- 文件输入上传：`{ "action": "upload", "inputRef": "e12", "paths": ["/tmp/crawclaw/uploads/file.pdf"] }`
- 对话框：`{ "action": "dialog", "accept": true }`
- 等待：`{ "action": "act", "kind": "wait", "selector": "#main", "timeoutMs": 15000 }`
- 执行：`{ "action": "act", "kind": "evaluate", "ref": "e7", "fn": "(el) => el.textContent" }`

状态和网络：

- Cookie：`{ "action": "cookies" }`
- 本地存储：`{ "action": "storage", "storageKind": "local" }`
- 会话存储：`{ "action": "storage", "storageKind": "session" }`
- 网络请求：`{ "action": "network", "pattern": "api" }`
- 下载：`{ "action": "download", "filename": "report.pdf" }`

迁移说明：旧的 CrawClaw Desktop 或本地 Gateway API 示例没有当前独立 CLI 等效物。请从智能体会话使用 `browser` 工具或通过 Gateway [工具调用 API](/gateway/tools-invoke-http-api) 调用它。

注意事项：

- `upload` 和 `dialog` 是**武装**调用；在触发选择器/对话框的点击/按键之前运行它们。
- 下载和跟踪输出路径限制为 CrawClaw 临时根目录：
  - 跟踪：`/tmp/crawclaw`（后备：`${os.tmpdir()}/crawclaw`）
  - 下载：`/tmp/crawclaw/downloads`（后备：`${os.tmpdir()}/crawclaw/downloads`）
- 上传路径限制为 CrawClaw 临时上传根目录：
  - 上传：`/tmp/crawclaw/uploads`（后备：`${os.tmpdir()}/crawclaw/uploads`）
- `upload` 还可以使用 `inputRef` 或 `element` 直接设置文件输入。
- `snapshot`：
  - `snapshotFormat: "ai"`（安装 Playwright 时的默认）：返回带有数字引用的 AI 快照（`aria-ref="<n>"`）。
  - `snapshotFormat: "aria"`：返回可访问性树（无引用；仅检查）。
  - `mode: "efficient"`：紧凑角色快照预设（interactive + compact + depth + lower maxChars）。
  - 配置默认值：设置 `browser.snapshotDefaults.mode: "efficient"` 以在调用方未传递模式时使用高效快照（参见 [Gateway 配置](/gateway/configuration-reference#browser)）。
  - 角色快照字段（`interactive`、`compact`、`depth`、`selector`）强制进行基于角色的快照，带有 `ref=e12` 等引用。
  - `frame: "<iframe selector>"` 将角色快照作用域限定为 iframe（与角色引用如 `e12` 配对）。
  - `interactive: true` 输出平面、易于选择的交互元素列表（最适合驱动操作）。
  - `labels: true` 添加带有叠加引用标签的视口截图。
- `click`/`type`/etc 需要来自 `snapshot` 的 `ref`（数字 `12` 或角色引用 `e12`）。
  CSS 选择器有意不支持操作。

## 快照和引用

CrawClaw 支持两种"快照"样式：

- **AI 快照（数字引用）**：`{ "action": "snapshot", "snapshotFormat": "ai" }`
  - 输出：包含数字引用的文本快照。
  - 操作：`{ "action": "act", "kind": "click", "ref": "12" }` 和 `{ "action": "act", "kind": "type", "ref": "23", "text": "hello" }`。
  - 在内部，通过 Playwright 的 `aria-ref` 解析引用。

- **角色快照（角色引用如 `e12`）**：`{ "action": "snapshot", "interactive": true }`（可选带 `compact`、`depth`、`selector` 或 `frame`）
  - 输出：带有 `[ref=e12]`（和可选 `[nth=1]`）的基于角色的列表/树。
  - 操作：`{ "action": "act", "kind": "click", "ref": "e12" }`。
  - 在内部，通过 `getByRole(...)` 解析引用（对于重复项加上 `nth()`）。
  - 添加 `"labels": true` 以包含带有叠加 `e12` 标签的视口截图。

引用行为：

- 引用在导航之间**不稳定**；如果失败，重新运行 `snapshot` 并使用新的引用。
- 如果角色快照是用 `--frame` 拍摄的，角色引用在该 iframe 的作用域内直到下一个角色快照。

## 等待增强

你可以等待的不仅是时间和文本：

- 等待 URL（Playwright 支持 glob）：
  - `{ "action": "act", "kind": "wait", "url": "**/dash" }`
- 等待加载状态：
  - `{ "action": "act", "kind": "wait", "loadState": "networkidle" }`
- 等待 JS 谓词：
  - `{ "action": "act", "kind": "wait", "fn": "window.ready===true" }`
- 等待选择器变得可见：
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

当操作失败时（例如"不可见"、"严格模式违规"、"被覆盖"）：

1. 运行 `{ "action": "snapshot", "interactive": true }`。
2. 使用 `{ "action": "act", "kind": "click", "ref": "<ref>" }` 或 `{ "action": "act", "kind": "type", "ref": "<ref>", "text": "..." }`。
3. 如果页面行为奇怪，检查 `{ "action": "console", "level": "error" }` 和 `{ "action": "network", "pattern": "api" }`。

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

JSON 中的角色快照包括 `refs` 加一个小型 `stats` 块（行数/字符数/引用数/交互数），以便工具可以推理负载大小和密度。

## 状态和环境旋钮

这些对"让网站表现得像 X"工作流很有用：

- Cookie：`cookies`、`cookies set`、`cookies clear`
- 存储：`storage local|session get|set|clear`
- 离线：`set offline on|off`
- Headers：`set headers --headers-json '{"X-Debug":"1"}'`（遗留 `set headers --json '{"X-Debug":"1"}'` 仍受支持）
- HTTP 基本认证：`set credentials user pass`（或 `--clear`）
- 地理位置：`set geo <lat> <lon> --origin "https://example.com"`（或 `--clear`）
- 媒体：`set media dark|light|no-preference|none`
- 时区/区域：`set timezone ...`、`set locale ...`
- 设备/视口：
  - `set device "iPhone 14"`（Playwright 设备预设）
  - `set viewport 1280 720`

## 安全和隐私

- CrawClaw Desktop 或本地 Gateway API。
- `browser` 工具 evaluate 操作和带 `fn` 的 `wait` 调用
  在页面上下文中执行任意 JavaScript。提示注入可以引导它。
  如果你不需要它，用 `browser.evaluateEnabled=false` 禁用它。
- 关于登录和反机器人说明（X/Twitter 等），请参见[浏览器登录 + X/Twitter 发布](/tools/browser-login)。
- 保持 Gateway 私密（local loopback 或仅限 tailnet）。
- 浏览器自动化可以在已登录会话中操作；保持托管配置私密。

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

关于特定于 Linux 的问题（尤其是 snap Chromium），请参见
[浏览器故障排除](/tools/browser-linux-troubleshooting)。

## 智能体工具 + 控制如何工作

智能体获得**一个工具**用于浏览器自动化：

- `browser` — status/start/stop/tabs/open/focus/close/snapshot/screenshot/navigate/act

映射方式：

- `browser snapshot` 返回稳定的 UI 树（AI 或 ARIA）。
- `browser act` 使用快照 `ref` ID 进行点击/输入/拖动/选择。
- `browser screenshot` 捕获像素（全页或元素）。
- `browser` 接受：
  - `profile` 选择命名浏览器配置（`crawclaw`、`user` 或其他配置的配置文件）。
  - `target`（`host`）选择 Gateway 主机浏览器。

这保持智能体确定性并避免脆弱的选择器。

## 相关

- [工具概览](/tools) — 所有可用的智能体工具
- [安全](/gateway/security) — 浏览器控制风险和加固
