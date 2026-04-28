---
read_when:
  - 你想统一显示 tools、skills、workflow 的执行过程
  - 你想让 Browser client 与外部渠道共享同一套过程展示语义
summary: 执行过程可见性系统总方案：统一事件、意图识别、投影器、渠道降级与前端开关
title: 执行过程可见性系统
---

# 执行过程可见性系统

本文定义 CrawClaw 的统一执行过程可见性系统（Execution Visibility System）。目标不是只给 Browser client 加一个“显示工具过程”的开关，而是建立一套跨 UI、跨渠道、跨能力类型的一致语义层，让 tools、skills、workflow、system status、artifact delivery 都能通过同一套策略被投影、节流、降级并展示。

## 目标

系统应同时满足：

- `Browser client` 可以完整展示执行过程。
- 外部渠道也可以按自身承载能力展示执行摘要。
- 用户有统一的全局、渠道级、会话级开关。
- 新增 tool、skill、workflow 时不需要为每个渠道重复写文案。
- 不依赖 LLM 在线推断，不把内部 JSON/payload 原样暴露给用户。

## 核心问题

当前系统里已经存在多种“过程展示”能力：

- `Browser client` 有 `Action Feed`、`tool cards`、`inspect timeline`。
- 部分渠道支持 tool result 投递、draft stream、editable draft stream、card stream。
- ACP projector 已能把部分工具过程投影成用户可见文本。

但这些能力仍然分散：

- UI 和渠道走不同语义。
- 有些地方显示 tool 明细，有些地方只显示最终结果。
- workflow 尚未被作为一等可见对象处理。
- 新工具和新 skills 容易退化成技术味很重的内部名称。

因此需要统一：

1. 执行事件模型
2. 意图识别
3. 可见性模式
4. 文案模板
5. 渠道能力降级

## 系统范围

统一纳入可见性系统的事件类型：

- `tool`
- `skill`
- `workflow`
- `system`
- `artifact`
- `reasoning`

系统对外支持三层展示：

- `off`
- `summary`
- `verbose`
- `full`

其中：

- `summary` 面向普通用户和大多数外部渠道。
- `verbose` 面向高承载渠道和高级用户。
- `full` 面向 Browser client 和少数高信息密度表面。

## 架构总览

系统分为 6 层：

1. 事件采集层
2. 语义归一层
3. 意图识别层
4. 可见性策略层
5. 投影器层
6. 渲染适配层

### 1. 事件采集层

从以下来源收集执行事件：

- agent runtime
- tool lifecycle
- skill lifecycle
- workflow execution
- system lifecycle
- artifact delivery

### 2. 语义归一层

统一生成标准化 `ExecutionEvent`，供后续所有模块消费，而不是各处直接处理原始事件。

### 3. 意图识别层

识别当前执行阶段属于哪种用户可理解的动作语义，如：

- 搜索
- 读取
- 分析
- 发送
- 生成
- 等待批准

### 4. 可见性策略层

决定：

- 当前事件是否可见
- 对哪个 surface 可见
- 以哪个 mode 可见

### 5. 投影器层

把底层事件压缩成用户可见的条目：

- `summary`
- `verbose`
- `full`

### 6. 渲染适配层

按 surface 能力渲染：

- UI tool cards / action feed
- Slack/Discord/Telegram 的编辑中消息
- Feishu 的 card stream
- Teams 的 streaminfo
- WhatsApp/LINE/iMessage 的轻量摘要或仅最终结果

## 统一事件模型

建议统一为：

```ts
type ExecutionEventKind = "tool" | "skill" | "workflow" | "system" | "artifact" | "reasoning";

type ExecutionEventPhase = "start" | "update" | "end" | "error" | "waiting";

type ExecutionIntent =
  | "search"
  | "read"
  | "browse"
  | "write"
  | "analyze"
  | "transform"
  | "send"
  | "generate"
  | "schedule"
  | "execute"
  | "fetch"
  | "sync"
  | "auth"
  | "wait_approval"
  | "deliver"
  | "unknown";

type WorkflowExecutionMeta = {
  workflowId?: string;
  workflowName?: string;
  executionId?: string;
  stepId?: string;
  stepName?: string;
  stepType?: string;
  branchId?: string;
  waitingReason?: string;
};

type ExecutionEvent = {
  id: string;
  runId: string;
  sessionKey?: string;
  ts: number;

  kind: ExecutionEventKind;
  phase: ExecutionEventPhase;

  sourceName?: string;
  sourceType?: "tool" | "skill" | "workflow" | "agent" | "system";

  intent?: ExecutionIntent;
  object?: string;

  message?: string;
  detail?: string;

  toolCallId?: string;
  replaceKey?: string;
  terminal?: boolean;
  error?: string;

  workflow?: WorkflowExecutionMeta;
  meta?: Record<string, unknown>;
};
```

## 可见性模式

### `off`

- 不显示执行过程
- 只保留最终结果

### `summary`

- 面向普通用户
- 只显示阶段性摘要
- 强聚合、强节流、强去重

### `verbose`

- 面向高承载渠道和高级用户
- 允许显示工具名、步骤名
- 仍然不直出内部 payload

### `full`

- 尽可能显示完整 lifecycle
- 适合 Browser client
- 渠道侧默认不启用

## 配置模型

建议引入统一配置：

```ts
type ExecutionVisibilityMode = "off" | "summary" | "verbose" | "full";

type SurfaceVisibilityConfig = {
  mode: ExecutionVisibilityMode;
  enabled?: boolean;
};

type ChannelVisibilityConfig = {
  default: SurfaceVisibilityConfig;
  overrides?: Record<string, SurfaceVisibilityConfig>;
};

type ExecutionVisibilityConfig = {
  enabled?: boolean;
  sessionOverride?: boolean;
  surfaces?: {
    browserClients?: SurfaceVisibilityConfig;
    channels?: ChannelVisibilityConfig;
  };
};
```

示例：

```json
{
  "executionVisibility": {
    "enabled": true,
    "sessionOverride": true,
    "surfaces": {
      "browserClients": {
        "mode": "full"
      },
      "channels": {
        "default": {
          "mode": "summary"
        },
        "overrides": {
          "slack": { "mode": "verbose" },
          "discord": { "mode": "summary" },
          "telegram": { "mode": "summary" },
          "feishu": { "mode": "summary" },
          "msteams": { "mode": "summary" },
          "whatsapp": { "mode": "off" },
          "line": { "mode": "off" },
          "imessage": { "mode": "off" }
        }
      }
    }
  }
}
```

## 渠道能力矩阵

配置只是“想怎么展示”，真正能否展示还要看渠道能力。

```ts
type ExecutionVisibilityCapability = {
  supportsSummary: boolean;
  supportsVerbose: boolean;
  supportsFull: boolean;
  supportsMessageEdit: boolean;
  supportsStreaming: boolean;
  supportsCardSurface: boolean;
  supportsThreadedUpdates: boolean;
  maxUpdateFrequencyMs?: number;
  maxVisibleItemsPerRun?: number;
};
```

默认建议：

- `browserClients`: `full`
- `slack`: `verbose`
- `discord`: `summary`
- `telegram`: `summary`
- `matrix`: `summary`
- `feishu`: `summary`
- `msteams`: `summary`
- `googlechat`: `summary`
- `mattermost`: `summary`
- `signal`: `summary` 或 `off`
- `whatsapp`: `off`
- `line`: `off`
- `imessage`: `off`

规则：

- 用户配置高于默认模式，但不能突破渠道能力上限。
- 若用户为某渠道选择 `full`，但能力矩阵只支持 `summary`，则自动降级。

## Workflow 作为一等对象

workflow 必须单独考虑，不能只被折叠成 `execute`。

原因：

- workflow 是多步骤、可等待、可恢复、可分支的执行单元
- 用户更关心 workflow“当前走到哪一步”而不是内部每个子 tool

### Workflow 展示规则

#### summary

- 显示 workflow 名
- 显示当前步骤
- 显示等待/恢复/完成/失败
- 默认收拢子 tool

示例：

- `正在运行「日报生成」工作流`
- `当前步骤：搜索资料`
- `当前步骤：整理摘要`
- `工作流等待批准后继续`
- `「日报生成」工作流已完成`

#### verbose

- 显示 workflow 步骤
- 可附带关键子 tool 摘要

#### full

- 显示 workflow timeline
- 显示步骤与子 tools 的层级

### Workflow 优先级规则

当事件处于 workflow 上下文中：

- `summary` 默认展示 workflow 和当前 step
- 普通子 tool 不单独向渠道冒泡
- `full` 模式下才完整展开内部 child events

## Summary 设计

`summary` 不是 full 的缩略版，而是单独一层面向用户的执行摘要。

### 设计目标

- 告诉用户系统正在工作
- 告诉用户当前阶段
- 告诉用户为什么还没完成
- 不暴露内部技术噪音
- 不刷屏

### 建议阶段

- `preparing`
- `retrieving`
- `calling`
- `processing`
- `delivering`
- `waiting`
- `error`

### 文案原则

- 用动词开头
- 一条只说一件事
- 尽量带对象
- 不暴露内部字段名

示例：

- `正在搜索网页资料`
- `正在读取本地文件`
- `正在整理分析结果`
- `正在发送到 Slack`
- `等待批准后继续`

### 聚合规则

不要逐条直出底层事件，要做阶段合并。

例如内部事件：

- `web.search start/update/end`
- `read_file start/end`
- `summarize start/end`

对外 summary：

- `正在搜索资料`
- `正在读取文件`
- `正在整理最终答案`

### 更新频率

- 首条反馈：300ms 到 1200ms
- 正常更新：1.5s 到 3s 一次
- 每个 run 对外最多：
  - 普通渠道：3 条
  - 高承载渠道：5 条

## 渲染策略

### Browser client

- `summary`: 轻量 action feed
- `verbose`: 展示更多阶段和能力名
- `full`: tool cards + action feed + detail sidebar + inspect timeline

### Slack / Discord / Telegram / Matrix

- 默认 `summary`
- 高级用户可开 `verbose`
- 支持编辑时采用“单条执行中消息持续更新”
- 否则采用“阶段追加”

### Feishu

- 默认 `summary`
- 使用 card stream 展示当前阶段

### Teams

- 默认 `summary`
- 使用 streaminfo / typing surface 展示阶段性状态

### WhatsApp / LINE / iMessage

- 默认 `off`
- 最多 very light summary
- 推荐采用“最终汇总型”而不是中间过程流

## 前端交互建议

统一提供三个入口：

### 1. 会话级开关

聊天页顶部切换：

- `仅显示回复`
- `显示执行摘要`
- `显示详细过程`

### 2. 全局默认

设置页：

- `默认执行过程可见性`

### 3. 渠道默认

渠道设置页：

- `此渠道是否显示执行过程`
- `显示模式`
- `当前渠道能力上限`

## 工程落点建议

建议新增模块：

- `src/execution-visibility/types.ts`
- `src/execution-visibility/intent.ts`
- `src/execution-visibility/projector.ts`
- `src/execution-visibility/coalescer.ts`
- `src/execution-visibility/capabilities.ts`
- `src/execution-visibility/policy.ts`
- `src/execution-visibility/renderers/*`

与现有代码对接：

- `sendToolResult`
- ACP projector
- `onToolResult`
- `onPartialReply`
- workflow runtime
- UI tool stream

## 建议实施顺序

### Phase 1

- 建立统一 `ExecutionEvent`
- 建立统一 `ExecutionIntent`

### Phase 2

- 打通 `summary`
- UI 先接
- Slack / Telegram / Feishu / Teams 先接

### Phase 3

- 增加统一可见性配置
- 增加会话级和渠道级开关

### Phase 4

- 打通 `verbose` / `full`
- 完成 workflow 专属 timeline 和 child collapse 规则

## 结论

这套系统的目标不是“给前端加个显示工具过程的按钮”，而是统一：

- 事件模型
- 意图识别
- 可见性策略
- 文案模板
- 渠道降级渲染

这样做之后：

- UI 与渠道不再各搞一套
- 新工具和新 skills 可以自然接入
- workflow 可以作为真正的一等执行对象被用户理解
- 渠道展示可控、稳定、低噪音

下一步建议结合 [执行过程意图识别与健壮模板 PRD](/concepts/execution-visibility-prd) 继续实现意图识别、模板系统与测试用例。
