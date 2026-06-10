---
read_when:
  - 安装或配置插件
  - 了解插件发现和加载规则
  - 使用 Codex/Claude 兼容插件包
sidebarTitle: Install and Configure
summary: 安装、配置和管理 CrawClaw 插件
title: 插件
x-i18n:
  generated_at: "2026-06-10T19:37:12Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 4707251e754d9ae5af63788d3e1cd8af6d2cebd6901da5477dfdc40eabceaed5
  source_path: tools/plugin.md
  workflow: 15
---

# 插件

插件为 CrawClaw 扩展新能力：渠道、模型提供商、工具、Skills、语音、图像生成等。有些插件是 **核心插件**（随 CrawClaw 发布），有些是 **外部插件**（由社区发布到 npm）。

## 快速开始

<Steps>
  <Step title="查看已加载插件">
    打开 Desktop 插件视图，调用 Gateway RPC `plugins.list`，或启用 `commands.plugins: true` 并发送 `/plugins list`。
  </Step>

  <Step title="安装插件">
    使用 Desktop 安装对话框，调用 Gateway RPC `plugins.install`，或在启用 `commands.plugins` 后发送 `/plugin install <spec>`。
  </Step>

  <Step title="配置并重载">
    大多数插件启用和配置更改通过 Gateway 实时重配置生效。仅在安装、本机服务或主机运行时更改需要新进程时才重启 Gateway。

    然后在配置文件的 `plugins.entries.\<id\>.config` 下配置插件。

  </Step>
</Steps>

如果你更喜欢原生聊天控制，请启用 `commands.plugins: true` 并使用：

```text
/plugin install clawhub:@org/plugin-name
/plugin show plugin-name
/plugin enable plugin-name
```

安装路径使用与 CLI 相同的解析器：本地路径/归档、显式
`clawhub:<pkg>`，或裸包规范（优先 ClawHub，然后 npm 回退）。

## 插件类型

CrawClaw 识别两种插件格式：

| 格式       | 工作方式                                              | 示例                                                   |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------ |
| **Native** | `crawclaw.plugin.json` + runtime module；在进程内执行 | 官方插件、社区 npm 包                                  |
| **Bundle** | Codex/Claude/Cursor 兼容布局；映射到 CrawClaw 功能    | `.codex-plugin/`、`.claude-plugin/`、`.cursor-plugin/` |

两者都会显示在 CrawClaw Desktop 或本地 Gateway API 下。请参阅 [插件包](/plugins/bundles) 以了解更多包详情。

如果你正在编写原生插件，请从 [构建插件](/plugins/building-plugins)
和 [插件 SDK 概览](/plugins/sdk-overview) 开始。

## 官方插件

### 核心（随 CrawClaw 附带）

<AccordionGroup>
  <Accordion title="模型提供商（默认启用）">
    `anthropic`, `byteplus`, `cloudflare-ai-gateway`, `github-copilot`, `google`,
    `huggingface`, `kilocode`, `kimi-coding`, `minimax`, `mistral`, `modelstudio`,
    `moonshot`, `nvidia`, `openai`, `opencode`, `opencode-go`, `openrouter`,
    `qianfan`, `synthetic`, `together`, `venice`,
    `vercel-ai-gateway`, `volcengine`, `xiaomi`, `zai`
  </Accordion>

  <Accordion title="语音提供商（默认启用）">
    `qwen3-tts`
  </Accordion>

  <Accordion title="其他">
    - `copilot-proxy` — VS Code Copilot Proxy 桥接（默认为禁用）
  </Accordion>
</AccordionGroup>

寻找第三方插件？请参阅 [社区插件](/plugins/community)。

## 配置

```json5
{
  plugins: {
    enabled: true,
    allow: ["trusted-plugin"],
    deny: ["untrusted-plugin"],
    load: { paths: ["~/Projects/oss/crawclaw-plugin"] },
    entries: {
      "trusted-plugin": { enabled: true, config: {} },
    },
  },
}
```

| 字段             | 描述                            |
| ---------------- | ------------------------------- |
| `enabled`        | 总开关（默认 `true`）           |
| `allow`          | 插件允许列表（可选）            |
| `deny`           | 插件拒绝列表（可选；deny 优先） |
| `load.paths`     | 额外插件文件或目录              |
| `slots`          | 独占插槽选择器（例如 `memory`） |
| `entries.\<id\>` | 单个插件的启用开关和配置        |

配置更改通过 Gateway 实时重配置生效。原生插件描述符从 Rust 运行时重新读取；CrawClaw 在桌面重配置期间不再启动 TypeScript 插件服务。

<Accordion title="插件状态：disabled、missing 和 invalid">
  - **已禁用**：插件存在但启用规则将其关闭。配置已保留。
  - **缺失**：配置引用了 discovery 未找到的插件 ID。
  - **无效**：插件存在，但其配置与声明的 schema 不匹配。
</Accordion>

## 发现和优先级

CrawClaw 按以下顺序扫描插件（以先匹配者为准）：

<Steps>
  <Step title="配置路径">
    `plugins.load.paths` — 显式文件或目录路径。
  </Step>

  <Step title="工作区插件根目录">
    位于 `\<workspace\>/.crawclaw/<plugin-root>/` 下、且包含
    `crawclaw.plugin.json` 的 manifest 根目录。
  </Step>

  <Step title="全局插件根目录">
    位于 `~/.crawclaw/<plugin-root>/` 下、且包含 `crawclaw.plugin.json` 的
    manifest 根目录。
  </Step>

  <Step title="捆绑插件">
    随 CrawClaw 附带。许多默认启用（模型提供商、语音）。其他需要显式启用。
  </Step>
</Steps>

### 启用规则

- `plugins.enabled: false` 禁用所有插件
- `plugins.deny` 始终优先于 allow
- `plugins.entries.\<id\>.enabled: false` 禁用该插件
- 工作区来源的插件是 **默认为禁用** （必须显式启用）
- 捆绑插件遵循内置的默认启用设置，除非被覆盖
- 独占插槽可以为该插槽强制启用所选插件

## 插件插槽（独占类别）

某些类别是独占的（一次只能有一个处于活动状态）：

```json5
{
  plugins: {
    slots: {
      memory: "none",
    },
  },
}
```

| 插槽     | 控制内容                 | 默认值 |
| -------- | ------------------------ | ------ |
| `memory` | 独占 memory 插件选择路径 | `none` |

## Gateway API 参考

Gateway RPC 暴露的接口 `plugins.list`、 `plugins.install`、
`plugins.update`和 `plugins.uninstall`。Desktop 将安装流程封装为
`POST /api/desktop/plugins/install`，接受 `source` 加上可选的
`link` 或 `pin` 标志并转发至 `plugins.install`。

`--dangerously-force-unsafe-install` 是针对内置危险代码扫描器误报的紧急覆盖。它允许安装继续绕过内置的 `critical` 发现，但仍然不会绕过插件
`before_install` 政策阻止或扫描失败阻止。

此 CLI 标志仅适用于插件安装。Gateway 支持的 Skill 依赖项安装使用匹配的
`dangerouslyForceUnsafeInstall` 请求覆盖；而 CrawClaw Desktop 或本地
Gateway API 仍然是独立的 ClawHub Skill 下载/安装流程。

请参阅 [Gateway API 参考](/tools/plugin) 了解详情。

## 插件 API 概览

插件发现来源 `crawclaw.plugin.json` 和 Rust 原生描述符。
包元数据保持声明性和非执行性；生产运行时行为不通过 TypeScript 回调运行。

常见能力接口：

| 方法                              | 注册内容         |
| --------------------------------- | ---------------- |
| Rust native speech descriptor     | 文本转语音 / STT |
| Rust native media descriptor      | 图像/音频分析    |
| Rust native web-search descriptor | Web 搜索         |

模型提供商、工具、命令、Gateway 方法、服务、HTTP 处理器和类型化生命周期钩子不再是 TypeScript 插件 API 接口。使用 `models.providers`；运行时功能由 Rust 拥有。

## 相关

- [构建插件](/plugins/building-plugins) — 创建你自己的插件
- [插件包](/plugins/bundles) — 旧版包迁移说明
- [插件清单](/plugins/manifest) — 清单 schema
- [插件内部机制](/plugins/architecture) — 能力模型和加载管道
- [社区插件](/plugins/community) — 第三方列表
