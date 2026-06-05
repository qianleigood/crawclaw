---
read_when:
  - 调整思考、快速模式或详细指令解析及默认值
summary: /think、/fast、/verbose 的指令语法及推理可见性
title: 思考级别
x-i18n:
  generated_at: "2026-06-05T15:01:22Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: f0baa8090dada67240ee7fd90a170ce84b3746c4022a482dcade8055281bb1f5
  source_path: tools/thinking.md
  workflow: 15
---

# 思考级别（/think 指令）

## 功能说明

- 任意入站消息中的内联指令：`/t <级别>`、`/think:<级别>` 或 `/thinking <级别>`。
- 级别（别名）：`off | minimal | low | medium | high | xhigh | adaptive`
  - minimal → “think”
  - low → “think hard”
  - medium → “think harder”
  - high → “ultrathink”（最大预算）
  - xhigh → “ultrathink+”（仅限 GPT-5.2 + Codex 型号）
  - adaptive → 提供商管理的自适应推理预算（支持 Anthropic Claude 4.6 模型系列）
  - `x-high`、`x_high`、`extra-high`、`extra high` 和 `extra_high` 映射到 `xhigh`。
  - `highest`、`max` 映射到 `high`。
- 提供商说明：
  - Anthropic Claude 4.6 型号在未设置显式思考级别时默认为 `adaptive`。
  - Z.AI（`zai/*`）仅支持二元思考（`on`/`off`）。任何非 `off` 级别均视为 `on`（映射到 `low`）。
  - Moonshot（`moonshot/*`）将 `/think off` 映射为 `thinking: { type: "disabled" }`，任何非 `off` 级别映射为 `thinking: { type: "enabled" }`。启用思考时，Moonshot 仅接受 `tool_choice` `auto|none`；CrawClaw 将不兼容的值规范化为 `auto`。

## 解析顺序

1. 消息上的内联指令（仅适用于该消息）。
2. 会话覆盖（通过发送仅包含指令的消息设置）。
3. 智能体默认设置（config 中 `agents.list[].thinkingDefault`）。
4. 全局默认设置（config 中 `agents.defaults.thinkingDefault`）。
5. 回退：Anthropic Claude 4.6 型号为 `adaptive`，其他支持推理的型号为 `low`，否则为 `off`。

## 设置会话默认值

- 发送**仅包含**指令的消息（允许空白），例如 `/think:medium` 或 `/t high`。
- 该设置适用于当前会话（默认按发送者区分）；可通过 `/think:off` 或会话空闲重置清除。
- 系统会发送确认回复（`Thinking level set to high.` / `Thinking disabled.`）。如果级别无效（例如 `/thinking big`），命令将被拒绝并给出提示，会话状态保持不变。
- 发送 `/think`（或 `/think:`）不带参数以查看当前思考级别。

## 智能体应用

- **Rust 智能体运行时**：解析后的级别会传递给活动的智能体运行。

## 快速模式（/fast）

- 级别：`on|off`。
- 仅包含指令的消息会切换会话快速模式覆盖，并回复 `Fast mode enabled.` / `Fast mode disabled.`。
- 发送 `/fast`（或 `/fast status`）不带模式以查看当前有效的快速模式状态。
- CrawClaw 按以下顺序解析快速模式：
  1. 内联/仅指令 `/fast on|off`
  2. 会话覆盖
  3. 智能体默认设置（`agents.list[].fastModeDefault`）
  4. 按型号配置：`agents.defaults.models["<provider>/<model>"].params.fastMode`
  5. 回退：`off`
- 对于 `openai/*`，快速模式通过在支持的 Responses 请求上发送 `service_tier=priority` 来映射到 OpenAI 优先级处理。
- 对于 `openai-codex/*`，快速模式在 Codex Responses 上发送相同的 `service_tier=priority` 标志。CrawClaw 在两个认证路径之间保持一个共享的 `/fast` 切换。
- 对于直接公开的 `anthropic/*` 请求，包括发送到 `api.anthropic.com` 的 OAuth 认证流量，快速模式映射到 Anthropic 服务层：`/fast on` 设置 `service_tier=auto`，`/fast off` 设置 `service_tier=standard_only`。
- 当两者都设置时，显式 Anthropic `serviceTier` / `service_tier` 型号参数会覆盖快速模式默认值。CrawClaw 仍会跳过对非 Anthropic 代理基础 URL 的 Anthropic 服务层注入。

## 详细指令（/verbose 或 /v）

- 级别：`on`（最小）| `full` | `off`（默认）。
- 仅包含指令的消息会切换会话详细模式并回复 `Verbose logging enabled.` / `Verbose logging disabled.`；无效级别返回提示而不更改状态。
- `/verbose off` 存储显式会话覆盖；通过会话 UI 选择 `inherit` 来清除。
- 内联指令仅影响该消息；否则应用会话/全局默认值。
- 配置回退默认值为 `off`，但新手引导预设可能写入不同的显式 `agents.defaults.verboseDefault` 到 `crawclaw.json`。例如，默认的 `balanced` 呈现预设会写入 `on`。
- 发送 `/verbose`（或 `/verbose:`）不带参数以查看当前详细级别。
- 当详细模式开启时，发出结构化工具结果的 Rust 智能体运行会将每个工具调用作为自己的仅元数据消息发回，消息前缀为 `<emoji> <tool-name>: <arg>`（当可用时，包含路径/命令）。这些工具摘要会在每个工具启动时立即发送（单独的气泡），而非流式增量。
- 工具失败摘要在正常模式下仍可见，但原始错误详情后缀在 verbose 为 `on` 之前隐藏。
- 当 verbose 为 `full` 时，工具输出也会在完成后转发（单独气泡，截断到安全长度）。如果在运行进行中切换 `/verbose on|full|off`，后续工具气泡将遵循新设置。

## 推理可见性（/reasoning）

- 级别：`on|off|stream`。
- 仅包含指令的消息会切换是否在回复中显示思考块。
- 启用后，推理作为**单独消息**发送，前缀为 `Reasoning:`。
- `stream`（仅限飞书）：在回复生成时将推理流式传输到飞书草稿气泡，然后发送最终答案（不含推理）。
- 别名：`/reason`。
- 发送 `/reasoning`（或 `/reasoning:`）不带参数以查看当前推理级别。
- 解析顺序：内联指令、会话覆盖、智能体默认设置（`agents.list[].reasoningDefault`）、回退（`off`）。

## 相关内容

- 高级模式文档位于[高级模式](/tools/elevated)。

## 遗留心跳兼容性

遗留心跳式运行仍可使用配置的心跳提示和推理传递选项以保持兼容性。新的定时自动化应使用[定时任务](/automation/cron-jobs)而非心跳提示。

## Web 聊天 UI

- Web 聊天思考选择器在页面加载时反映入站会话存储/config 中存储的会话级别。
- 选择其他级别仅适用于下一条消息（`thinkingOnce`）；发送后，选择器恢复为存储的会话级别。
- 要更改会话默认值，请发送 `/think:<level>` 指令（如前所述）；下次重新加载后选择器将反映该设置。
