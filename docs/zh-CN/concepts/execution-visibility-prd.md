---
read_when:
  - 你想实现执行过程的 summary、verbose、full 语义层
  - 你想为新 tools、skills、workflow 设计健壮的意图识别与模板系统
summary: PRD：执行过程可见性系统中的意图识别、健壮模板、workflow 规则与回退策略
title: 执行过程意图识别与健壮模板 PRD
---

# 执行过程意图识别与健壮模板 PRD

本文是 CrawClaw 执行过程可见性系统的研发 PRD，聚焦两件事：

1. 意图识别
2. 健壮模板体系

目标不是只让系统“能出一条摘要”，而是建立一套稳定、可解释、可扩展的语义层，让 tools、skills、workflow 的执行过程都可以被统一投影到 `summary / verbose / full`。

## 背景

当前系统已经具备：

- UI `Action Feed` / tool cards / inspect timeline
- 多渠道 tool result / tool summary / draft stream / card stream
- ACP projector 的初步过程投影能力

但缺少统一的“语义识别 + 文案模板”系统，导致：

- UI 和渠道的摘要逻辑不一致
- 新工具和新 skills 容易退化为内部技术名
- workflow 在用户视角下不够可理解
- 若只靠工具名硬编码模板，维护性很差
- 若依赖 LLM 在线推断，稳定性和可审计性不足

## 目标

### 主要目标

- 让所有 execution event 都能归类为用户可理解的动作意图
- 对新 tools / skills / workflows 提供稳定回退
- 对声明了元数据的能力提供高质量摘要
- 让 workflow 作为一等对象参与过程展示
- 让 UI 和渠道共享同一套语义层
- 不依赖 LLM 在线生成摘要

### 成功标准

- 新增未做适配的 tool，也能输出不难看的摘要
- 新增带 `summary meta` 的 tool，能自动输出高质量摘要
- workflow 在 `summary` 中默认显示当前步骤
- waiting / approval / error 都有稳定文案
- 同一事件在相同上下文下文案稳定

## 非目标

- 不做 LLM 在线意图推断
- 不追求每个工具都有完全定制文案
- 不在本期统一所有 UI 组件样式
- 不要求所有渠道支持 `full`
- 不向渠道直出 raw JSON / payload / stack trace

## 设计原则

- 显式优于猜测
- 规则优于模型
- 语义先于渲染
- 健壮优于完美
- 聚合优于直通
- workflow 优先于其子 tools

## 统一意图模型

```ts
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
```

说明：

- `search`: 搜索、检索
- `read`: 读取文档/文件/记录
- `browse`: 访问页面、浏览导航
- `write`: 写入、保存、修改
- `analyze`: 分析、整理、总结、推断
- `transform`: 转换、提取、格式化、编译
- `send`: 发送消息、通知、提交
- `generate`: 生成图片、音频、文本、卡片
- `schedule`: 编排、计划、定时
- `execute`: 执行命令、运行脚本、触发动作
- `fetch`: 拉取远程内容、下载资源
- `sync`: 同步外部状态或数据
- `auth`: 登录、授权、认证、配对
- `wait_approval`: 等待批准/等待输入/等待人工确认
- `deliver`: 最终交付、落盘、发送产物
- `unknown`: 无法可靠识别

## Workflow 作为一等对象

workflow 不是普通 tool，必须单独建模。

```ts
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
```

规则：

- workflow 事件仍映射到统一 `ExecutionIntent`
- 但模板生成时允许优先使用 workflow 元数据
- `summary` 默认展示 workflow 和 current step，而不是展开其内部所有 child tools

## 意图识别输入与输出

```ts
type ToolCapabilityFamily =
  | "web"
  | "file"
  | "message"
  | "image"
  | "audio"
  | "workflow"
  | "auth"
  | "exec"
  | "memory"
  | "browser"
  | "calendar"
  | "unknown";

type IntentResolutionInput = {
  kind: "tool" | "skill" | "workflow" | "system" | "artifact" | "reasoning";
  phase: "start" | "update" | "end" | "error" | "waiting";

  sourceName?: string;
  sourceType?: "tool" | "skill" | "workflow" | "agent" | "system";

  declaredIntent?: ExecutionIntent;
  family?: ToolCapabilityFamily;
  skillFamily?: string;

  object?: string;
  payload?: Record<string, unknown>;
  workflow?: WorkflowExecutionMeta;
};

type IntentResolutionResult = {
  intent: ExecutionIntent;
  confidence: "high" | "medium" | "low";
  source: "declared" | "family" | "heuristic" | "context" | "fallback";
};
```

## 意图识别优先级

### 1. 显式声明层

如果 tool / skill / workflow 提供：

- `summary.intent`

则直接采用。

优先级最高。

### 2. 上下文修正层

若事件本身就是明确状态，则直接修正：

- waiting + approval -> `wait_approval`
- auth/login/pairing -> `auth`
- artifact/final handoff -> `deliver`

### 3. family 映射层

根据 family 进行中等级别推断：

- `web` -> `search` 或 `browse`
- `file` -> `read` 或 `write`
- `message` -> `send`
- `image` -> `generate` 或 `transform`
- `audio` -> `generate` 或 `transform`
- `workflow` -> `execute`
- `auth` -> `auth`
- `exec` -> `execute`
- `memory` -> `read` 或 `analyze`
- `browser` -> `browse`
- `calendar` -> `schedule`

### 4. 名称启发式层

弱规则匹配：

- `search|lookup|find|query` -> `search`
- `read|open|load|view|inspect` -> `read`
- `browse|navigate|visit|page` -> `browse`
- `write|save|update|edit|patch` -> `write`
- `analyze|summarize|reason|classify|rank` -> `analyze`
- `transform|parse|extract|convert|compile|render` -> `transform`
- `send|post|reply|notify|publish` -> `send`
- `generate|draw|image|tts|audio|create` -> `generate`
- `schedule|cron|plan` -> `schedule`
- `exec|run|shell|bash|command` -> `execute`
- `fetch|download|pull` -> `fetch`
- `sync|refresh` -> `sync`
- `auth|login|oauth|token|pair` -> `auth`

### 5. 回退层

若以上都无法可靠判断：

- => `unknown`

这是一条合法路径，不是异常路径。

## Workflow 下的识别规则

如果事件位于 workflow 上下文：

### summary

- 默认以 workflow + current step 为主
- 子 tool 不默认冒泡

### verbose

- 可以带 step 的动作语义
- 关键 tool 可作为步骤附注

### full

- 完整显示 workflow > step > tool 层级

## 新 tools / skills / workflow 的接入规范

推荐声明：

```ts
type SummaryMeta = {
  intent?: ExecutionIntent;
  object?: string;
  hints?: SummaryHints;
};
```

最低建议：

- `intent`
- `object`

规范：

- 未声明不阻塞运行
- 开发环境输出 warning
- CI 可做 non-blocking lint

---

# 模板系统设计

## 1. 目标

模板系统必须满足：

- 支持 `summary / verbose / full`
- 支持 tool / skill / workflow / system / artifact
- 支持新能力优雅退化
- 适配渠道安全输出
- 不依赖每个工具都写死模板

## 2. 模板体系结构

模板由三层组成：

1. 通用模板
2. 增强模板
3. 专属覆写

优先级：

- 专属覆写 > 增强模板 > 通用模板 > fallback

## 3. SummaryHints

```ts
type SummaryHints = {
  object?: string;
  targetLabel?: string;

  textStart?: string;
  textUpdate?: string;
  textEnd?: string;
  textError?: string;
  textWaiting?: string;
};
```

说明：

- `object`: “网页资料”“本地文件”“Slack 消息”“Notion 页面”
- `targetLabel`: “产品群”“日报频道”“用户身份”
- `textStart/textUpdate/textEnd`: 完全自定义文案

## 4. Summary 模式通用模板

### `search`

- start/update: `正在搜索{objectOrDefault}`
- end: `已完成{objectOrDefault}搜索`
- 默认 object: `资料`

### `read`

- start/update: `正在读取{objectOrDefault}`
- end: `已完成{objectOrDefault}读取`
- 默认 object: `内容`

### `browse`

- start/update: `正在访问{objectOrDefault}`
- end: `已完成{objectOrDefault}访问`
- 默认 object: `页面`

### `write`

- start/update: `正在写入{objectOrDefault}`
- end: `已完成{objectOrDefault}更新`
- 默认 object: `内容`

### `analyze`

- start/update: `正在分析{objectOrDefault}`
- end: `已完成{objectOrDefault}分析`
- 默认 object: `结果`

### `transform`

- start/update: `正在处理{objectOrDefault}`
- end: `已完成{objectOrDefault}处理`
- 默认 object: `内容`

### `send`

- start/update: `正在发送{objectOrDefault}`
- 若存在 targetLabel:
  - `正在发送{objectOrDefault}到{targetLabel}`
- end: `已完成发送`
- 默认 object: `结果`

### `generate`

- start/update: `正在生成{objectOrDefault}`
- end: `已完成{objectOrDefault}生成`
- 默认 object: `内容`

### `schedule`

- start/update: `正在安排{objectOrDefault}`
- end: `已完成安排`
- 默认 object: `任务`

### `execute`

- start/update: `正在执行{objectOrDefault}`
- end: `已完成执行`
- 默认 object: `任务`

### `fetch`

- start/update: `正在获取{objectOrDefault}`
- end: `已完成获取`
- 默认 object: `远程内容`

### `sync`

- start/update: `正在同步{objectOrDefault}`
- end: `已完成同步`
- 默认 object: `数据`

### `auth`

- start/update: `正在完成{objectOrDefault}认证`
- waiting: `等待完成{objectOrDefault}认证`
- end: `已完成认证`
- 默认 object: `身份`

### `wait_approval`

- waiting: `等待批准后继续`
- 若有 object:
  - `等待{object}批准后继续`

### `deliver`

- start/update: `正在交付{objectOrDefault}`
- end: `已完成交付`
- 默认 object: `结果`

### `unknown`

- start/update: `正在处理请求`
- waiting: `正在等待继续条件`
- end: `已完成处理`

## 5. Workflow 模板

workflow 必须有独立模板。

### summary

- start: `正在运行「{workflowNameOrDefault}」工作流`
- update:
  - 有 stepName -> `当前步骤：{stepName}`
  - 无 stepName -> `工作流正在执行中`
- waiting:
  - 有 waitingReason -> `工作流等待{waitingReason}后继续`
  - 无 waitingReason -> `工作流等待继续条件`
- end: `「{workflowNameOrDefault}」工作流已完成`
- error:
  - 有 stepName -> `工作流在“{stepName}”步骤遇到问题`
  - 无 stepName -> `工作流执行失败`

### verbose

- `正在运行工作流：{workflowName}`
- `工作流步骤：{stepName}`
- `工作流等待输入`
- `工作流已恢复执行`

### full

- 使用结构化对象，不要求仅靠一句自然语言承载全部信息

## 6. Verbose 模式规则

verbose 可以适度暴露能力名，但仍应保持人类可读。

规则：

- 优先 object
- 无 object 时，若 `sourceName` 可读，可使用泛化名称
- 不直接暴露内部 phase、payload 名

示例：

- `正在调用网页搜索工具`
- `正在读取飞书文档`
- `正在运行“日报生成”工作流`

## 7. Full 模式规则

full 更适合结构化展示：

```ts
type FullVisibleItem = {
  title: string;
  subtitle?: string;
  detail?: string;
  phase: "start" | "update" | "end" | "error" | "waiting";
  intent: ExecutionIntent;
  sourceName?: string;
  workflowStepName?: string;
};
```

UI 可渲染为：

- phase badge
- title
- subtitle
- detail panel

渠道默认不使用 full 直出。

## 8. 健壮性要求

### 无元数据不崩

没有 `summary meta` 时：

- family -> intent
- heuristic -> intent
- fallback -> `unknown`

### 名称不可读不外露

若 `sourceName` 为内部实现名：

- summary 与 verbose 默认不原样外露

### 缺字段安全退化

模板不得假设一定存在：

- object
- targetLabel
- workflowName
- stepName
- waitingReason

### phase 缺失时

- 按 `update` 处理

### unknown 必须有稳定模板

- `正在处理请求`
- `已完成处理`

### 渠道安全输出

禁止默认把以下内容放进普通渠道模板：

- stack trace
- raw JSON
- token
- 完整内部路径
- 原始 tool payload

### i18n 参数化

所有模板必须支持参数化，不允许把字符串拼接逻辑散落在各处。

推荐：

- `正在搜索{object}`
- `当前步骤：{stepName}`
- `等待{reason}后继续`

## 9. 模板渲染接口

```ts
type RenderMode = "summary" | "verbose" | "full";

type RenderContext = {
  mode: RenderMode;
  surface: "controlUi" | "channel";
  channel?: string;
};

type RenderInput = {
  intent: ExecutionIntent;
  phase: "start" | "update" | "end" | "error" | "waiting";
  sourceName?: string;
  object?: string;
  targetLabel?: string;
  workflow?: WorkflowExecutionMeta;
  hints?: SummaryHints;
};

function renderExecutionText(input: RenderInput, ctx: RenderContext): string;
```

规则：

1. 优先 `hints.textXxx`
2. 其次 workflow 专属模板
3. 其次 intent 通用模板
4. 最后 fallback

## 10. 示例

### 新 web tool，无元数据

工具名：`brave_lookup_plus`

识别：

- declaredIntent: 无
- family: `web`
- => `search`

summary：

- `正在搜索资料`

verbose：

- `正在调用网页搜索工具`

### 文件工具，有元数据

```ts
summary: {
  intent: "read",
  object: "飞书文档"
}
```

summary：

- `正在读取飞书文档`

### 发送工具，有 target

```ts
summary: {
  intent: "send",
  object: "Slack 消息",
  targetLabel: "产品群"
}
```

summary：

- `正在发送 Slack 消息到产品群`

### 工作流

workflowName: `日报生成`
stepName: `搜索资料`

summary：

- `正在运行「日报生成」工作流`
- `当前步骤：搜索资料`

### 审批等待

phase = `waiting`
intent = `wait_approval`

summary：

- `等待批准后继续`

## 11. 实施建议

建议新增：

- `src/execution-visibility/intents.ts`
- `src/execution-visibility/intent-resolver.ts`
- `src/execution-visibility/template-types.ts`
- `src/execution-visibility/template-renderer.ts`
- `src/execution-visibility/workflow-renderer.ts`
- `src/execution-visibility/fallbacks.ts`

接入点：

- tool result delivery
- ACP projector
- workflow runtime
- UI tool stream
- 渠道 renderer

迁移顺序：

1. 统一 intent resolver
2. 统一 summary renderer
3. ACP projector 接新模板层
4. UI / channel 共享渲染结果

## 12. 验收标准

### 功能验收

- 未声明元数据的新 tool 可以输出通用摘要
- 声明元数据的新 tool 输出更具体摘要
- workflow 默认显示 workflow 和 current step
- waiting / approval / error 有稳定文案
- 渠道 summary 不出现内部 event 名称

### 质量验收

- 同一事件渲染稳定
- 缺字段不报错
- unknown intent 有可接受输出
- i18n 参数化覆盖全部通用模板

## 13. 风险与缓解

### family 归类不准

- 使用显式声明优先
- family 仅作 fallback

### 名称启发式误判

- 启发式优先级低
- 不确定则退回 `unknown`

### workflow 与 child tools 重复展示

- summary 默认 workflow 优先
- child tools 收拢

### 各 surface 自己拼文案导致分裂

- 所有 surface 必须消费统一 renderer 结果

### 模板过多难维护

- 保持“通用模板 + 增强参数 + 可选覆写”

## 14. 结论

这套方案的核心是：

- 意图识别不是在线 AI 猜测，而是“显式声明优先 + 规则回退”的稳定系统
- 模板不是每个工具死写一套，而是“通用模板 + 增强参数 + 可选覆写”的健壮系统
- workflow 必须作为一等上下文处理
- `unknown` 必须是一条健壮路径，而不是失败路径
- UI 和渠道必须共享同一套语义层

建议在落地实现时同时参考 [执行过程可见性系统](/concepts/execution-visibility-system) 作为上层总方案文档。
