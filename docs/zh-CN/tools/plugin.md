---
read_when:
  - 安装或配置插件
  - 了解插件发现和加载规则
  - 使用 Codex/Claude 兼容的插件 Bundle
sidebarTitle: Install and Configure
summary: 安装、配置和管理 CrawClaw 插件
title: 插件
x-i18n:
  generated_at: "2026-06-10T17:02:05Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: b2572014a89125901cc4b711e8a373426fc95ac55ef6f2889a56197dac8701e3
  source_path: tools/plugin.md
  workflow: 15
---

# 插件

插件为 CrawClaw 扩展新能力：渠道、模型提供商、工具、Skills、语音、图像生成等。部分插件是**核心**的（随 CrawClaw 附带），部分是**外部**的（由社区发布在 npm 上）。

## 快速开始

<Steps>
  <Step title="查看已加载的插件">
    使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。
  </Step>

  <Step title="安装插件">
    使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。

  </Step>

  <Step title="重启 Gateway 网关">
    使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。

    然后在配置文件的 `plugins.entries.<id>.config` 下进行配置。

  </Step>
</Steps>

如果你偏好原生聊天控制，启用 `commands.plugins: true` 并使用：

```text
/plugin install clawhub:@org/plugin-name
/plugin show plugin-name
/plugin enable plugin-name
```

安装路径使用与 CLI 相同的解析器：本地路径/归档包、明确的 `clawhub:<pkg>`，或裸包规范（优先从 ClawHub，然后回退到 npm）。

## 插件类型

CrawClaw 支持两种插件格式：

| 格式       | 工作方式                                           | 示例                                                   |
| ---------- | -------------------------------------------------- | ------------------------------------------------------ |
| **原生**   | `crawclaw.plugin.json` + 运行时模块；在进程内执行  | 官方插件、社区 npm 包                                  |
| **Bundle** | Codex/Claude/Cursor 兼容布局；映射到 CrawClaw 功能 | `.codex-plugin/`、`.claude-plugin/`、`.cursor-plugin/` |

两者都会显示在 CrawClaw Desktop 或本地 Gateway API 下。详见 [Plugin Bundles](/plugins/bundles)。

如果你要编写原生插件，请从[构建插件](/plugins/building-plugins)和[插件 SDK 概览](/plugins/sdk-overview)开始。

## 官方插件

### 核心（随 CrawClaw 附带）

<AccordionGroup>
  <Accordion title="模型提供商（默认启用）">
    `anthropic`、`byteplus`、`cloudflare-ai-gateway`、`github-copilot`、`google`、
    `huggingface`、`kilocode`、`kimi-coding`、`minimax`、`mistral`、`modelstudio`、
    `moonshot`、`nvidia`、`openai`、`opencode`、`opencode-go`、`openrouter`、
    `qianfan`、`synthetic`、`together`、`venice`、
    `vercel-ai-gateway`、`volcengine`、`xiaomi`、`zai`
  </Accordion>

  <Accordion title="语音提供商（默认启用）">
    `qwen3-tts`
  </Accordion>

  <Accordion title="其他">
    - `copilot-proxy` — VS Code Copilot Proxy 桥接（默认禁用）
  </Accordion>
</AccordionGroup>

在寻找第三方插件？参见[社区插件](/plugins/community)。

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

| 字段           | 描述                            |
| -------------- | ------------------------------- |
| `enabled`      | 主开关（默认：`true`）          |
| `allow`        | 插件白名单（可选）              |
| `deny`         | 插件黑名单（可选；拒绝优先）    |
| `load.paths`   | 额外的插件文件/目录             |
| `slots`        | 独占插槽选择器（例如 `memory`） |
| `entries.<id>` | 每个插件的开关 + 配置           |

配置变更通过 Gateway 网关热重载生效。原生插件描述符从 Rust 运行时重新读取；CrawClaw 在桌面重新配置期间不再启动 TypeScript 插件服务。

<Accordion title="插件状态：禁用 vs 缺失 vs 无效">
  - **禁用**：插件存在但启用规则将其关闭。配置已保留。
  - **缺失**：配置引用了发现未找到的插件 ID。
  - **无效**：插件存在但其配置与声明的 schema 不匹配。
</Accordion>

## 发现与优先级

CrawClaw 按此顺序扫描插件（优先匹配）：

<Steps>
  <Step title="配置路径">
    `plugins.load.paths` — 明确的文件或目录路径。
  </Step>

  <Step title="工作区插件根目录">
    `\<workspace\>/.crawclaw/<plugin-root>/` 下的清单根目录，包含
    `crawclaw.plugin.json`。
  </Step>

  <Step title="全局插件根目录">
    `~/.crawclaw/<plugin-root>/` 下的清单根目录，包含
    `crawclaw.plugin.json`。
  </Step>

  <Step title="捆绑插件">
    随 CrawClaw 附带。许多默认启用（模型提供商、语音）。
    其他需要显式启用。
  </Step>
</Steps>

### 启用规则

- `plugins.enabled: false` 禁用所有插件
- `plugins.deny` 始终优先于 allow
- `plugins.entries.<id>.enabled: false` 禁用该插件
- 工作区来源的插件**默认禁用**（必须显式启用）
- 捆绑插件遵循内置的默认启用集合（除非被覆盖）
- 独占插槽可以强制为该插槽选中插件

## 插件插槽（独占类别）

某些类别是独占的（同一时间只有一个生效）：

```json5
{
  plugins: {
    slots: {
      memory: "none",
    },
  },
}
```

| 插槽     | 控制内容                 | 默认   |
| -------- | ------------------------ | ------ |
| `memory` | 独占 memory 插件选择路径 | `none` |

## Gateway API 参考

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。

`--dangerously-force-unsafe-install` 是一个紧急覆盖选项，用于处理内置危险代码扫描器的误报。它允许安装继续绕过内置的 `critical` 级别发现，但仍不会绕过插件 `before_install` 策略阻止或扫描失败阻止。

此 CLI 标志仅适用于插件安装。Gateway 支持的 Skill 依赖安装使用匹配的 `dangerouslyForceUnsafeInstall` 请求覆盖选项，而 CrawClaw Desktop 或本地 Gateway API 则是独立的 ClawHub Skill 下载/安装流程。

参见 [Gateway API 参考](/tools/plugin)了解详情。

## 插件 API 概览

插件从 `crawclaw.plugin.json` 和 Rust 原生描述符中发现。包元数据保持声明性和非执行性；生产运行时行为不通过 TypeScript 回调运行。

常见能力接口：

| 方法                    | 注册内容         |
| ----------------------- | ---------------- |
| Rust 原生语音描述符     | 文本转语音 / STT |
| Rust 原生媒体描述符     | 图像/音频分析    |
| Rust 原生网络搜索描述符 | 网络搜索         |

模型提供商、工具、命令、Gateway 方法、服务、HTTP 处理器和类型化生命周期钩子不再是 TypeScript 插件 API 接口。使用 `models.providers` 配置自定义 LLM 提供商；运行时能力由 Rust 拥有。

## 相关

- [构建插件](/plugins/building-plugins) — 创建你自己的插件
- [插件 Bundle](/plugins/bundles) — 旧版 Bundle 迁移说明
- [插件清单](/plugins/manifest) — 清单 schema
- [插件架构](/plugins/architecture) — 能力模型和加载管道
- [社区插件](/plugins/community) — 第三方列表
