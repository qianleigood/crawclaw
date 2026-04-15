# CrawClaw n8n 工作流架构方案

## 目标

- CrawClaw 先像真人一样完成一次真实任务。
- 用户显式要求“做成工作流”后，CrawClaw 再把本次成功路径蒸馏成工作流。
- 落地后的工作流统一运行在 `n8n` 上。
- 后续用户既可以显式指定运行某个工作流，也可以让主 agent 在受控条件下动态调用工作流。
- 工作流执行过程对用户可见、可管理、可恢复、可取消。

## 非目标

- 不再扩展 CrawClaw 自己的 `Task Flow` 成第二套完整 workflow engine。
- 不让 `n8n` 直接运行 CrawClaw `skill`。
- 不让普通主会话 agent 直接承接 n8n 的复杂回调执行。
- 不做隐式自动 workflow 化；必须由用户显式触发。

## 核心结论

- `n8n` 是唯一 workflow 执行引擎。
- CrawClaw 是工作流的控制面、设计面和回流面。
- CrawClaw 当前 `Task Flow` 只保留为 broker / 状态桥接层，不再承担主业务编排。
- 高智能步骤通过 `CrawClaw Agent Node` 回调 CrawClaw 的专用 `workflow-step-agent` 执行。
- 当前 workflow engine 已支持两档拓扑：
  - `linear_v1`
  - `branch_v2`
- `branch_v2` 当前已支持：
  - 条件分支
  - 显式 `fan_out`
  - 分支跳过状态投影
  - `fan_in` 汇合 helper
  - `fan_out` 的基础失败策略
    - `fail_fast`
    - `continue`
  - `fan_out` 的宽度上限约束
    - `maxActiveBranches`
  - `fan_out` step 的基础重试编译
    - `retryOnFail`
    - `maxTries`
    - `waitBetweenTriesMs`
  - `crawclaw_agent` 分支失败后的基础补偿
    - `compensation.mode = crawclaw_agent`
- `branch_v2` 的显式输入约定已经固定：
  - `workflow.run inputs` 会被送进 n8n webhook
  - 稳定命名空间是 `workflowInput`
  - 条件表达式应优先写成 `$workflowInput.someField`
  - 同一份输入会在顶层镜像一份，仅用于兼容旧草图，不建议再依赖
- `branch_v2` 当前仍未支持：
  - 图形化分支编辑
  - 更高保真的原生 n8n 分支节点生成
  - 低于实际分支宽度的 staged fan-out 调度
  - service/native 分支失败后的自动补偿
  - 更细的部分成功回收策略

## 当前实现状态

当前代码已经落地并可用的能力：

- `workflowize` 已能创建本地 `workflow spec` 和 registry entry。
- `workflow` 已支持：
  - `list`
  - `describe`
  - `match`
  - `deploy`
  - `run`
  - `status`
  - `runs`
  - `resume`
  - `cancel`
  - `versions`
  - `diff`
  - `update`
  - `republish`
  - `rollback`
  - `enable`
  - `disable`
  - `archive`
  - `unarchive`
  - `delete`
- `crawclaw_agent` step 已编译成真实 n8n callback HTTP 节点。
- `workflow-step-agent` 已通过 Gateway method 和 HTTP endpoint 接到真实执行链。
- UI 管理面已落地：
  - workflow 列表 / 详情
  - recent runs / execution timeline
  - waiting / resume
  - `Version Rail`
  - `Change Summary`
  - `Spec Workbench`
  - archive / delete
- 版本管理已落地：
  - spec snapshots
  - deployment history
  - diff / update / republish / rollback

当前还明确未落地的部分：

- 独立 CLI 子命令仍是后续项，当前主入口是 agent tools、gateway methods 和 UI。
- `branch_v2` 还不是完整图形化分支编辑器。
- `fan_out` 已支持基础并行分支、`fan_in` 汇合、宽度上限约束和补偿状态投影。
- `maxActiveBranches` 目前是 deploy-time 宽度校验，不是低宽度 staged 调度器。
- `fan_out` 已支持基础失败策略、重试编译和 `crawclaw_agent` 失败补偿，但还没有 service/native 补偿和更复杂的部分成功回收。

## 顶层分层

### 1. CrawClaw 控制面

- 负责首次试跑。
- 负责 `workflowize`。
- 负责 `workflow spec` 存储与版本化。
- 负责 `workflow registry`。
- 负责发布到 n8n。
- 负责查看、运行、取消、恢复工作流。
- 负责聚合 n8n 和 CrawClaw 子 agent 的执行状态。

### 2. n8n 执行面

- 负责 trigger、分支、重试、等待、恢复、外部系统集成。
- 负责 execution 记录。
- 遇到高智能步骤时，通过节点回调 CrawClaw。

### 3. CrawClaw 智能执行面

- 由专门的 `workflow-step-agent` 承担。
- 只处理单个 workflow step。
- 在受限 tools / surfaced skills / workspace 范围内运行。
- 输出结构化结果回给 n8n。
- `allowedTools` 是运行时真实 enforce 的白名单。
- `allowedSkills` 会收敛成该 step 的 surfaced skills 白名单，不再只是 prompt 提示。

## 用户主流程

### 阶段 A：先正常完成一次任务

1. 用户发出正常请求。
2. CrawClaw 正常调用 tools / skills / subagents 完成任务。
3. 同时记录 `execution trace`：
   - 使用了哪些 tools / skills
   - 关键输入输出
   - 哪些步骤稳定
   - 哪些步骤依赖人工
   - 哪些步骤依赖外部系统

### 阶段 B：用户显式 workflowize

触发方式：

- 用户说“把这个做成工作流”
- 用户使用 `/workflowize`

执行过程：

1. CrawClaw 读取最近一次成功执行的 trace。
2. 启动专用 `workflow agent` 进行蒸馏。
3. 生成 `workflow spec`。
4. 将 `workflow spec` 编译成 n8n workflow JSON。
5. 发布到 n8n，记录 `n8nWorkflowId`。
6. 在 CrawClaw `workflow registry` 注册该工作流。

### 阶段 C：后续重复执行

触发方式：

- 显式指定运行：
  - `/workflow run <name>`
  - “运行 workflow xxx”
- 主 agent 动态调用：
  - 先通过 registry 匹配候选 workflow
  - 满足自动运行条件时才执行

## 产品能力面

当前已落地的 workflow tools：

- `workflowize`
- `workflow.list`
- `workflow.describe`
- `workflow.match`
- `workflow.run`
- `workflow.status`
- `workflow.resume`
- `workflow.cancel`
- `workflow.update`
- `workflow.runs`
- `workflow.versions`
- `workflow.diff`
- `workflow.republish`
- `workflow.rollback`
- `workflow.enable`
- `workflow.disable`
- `workflow.archive`
- `workflow.unarchive`
- `workflow.delete`

当前还没有独立 `crawclaw workflow ...` CLI 子命令实现；这部分仍属于后续增强项。

## CrawClaw 内部组件

### 1. Workflow Tool

- `src/agents/tools/workflow-tool.ts`
- `src/agents/tools/workflowize-tool.ts`

职责：

- 为主 agent 提供统一工作流能力入口。
- 承接显式命令和普通 agent 的 workflow 调用。

### 2. Workflow Broker

- `src/workflows/`

当前核心文件：

- `registry.ts`
- `n8n-compiler.ts`
- `n8n-client.ts`
- `executions.ts`
- `status-view.ts`
- `version-history.ts`
- `deployments.ts`
- `diff.ts`
- `spec-patch.ts`

职责：

- 管理 `workflow spec`
- 管理部署和版本
- 管理 `workflowId <-> n8nWorkflowId`
- 管理 `executionId <-> n8nExecutionId`
- 聚合执行状态
- 接收 n8n callback

### 3. workflow-step-agent

- `src/agents/workflow-step-agent.ts`

职责：

- 处理单个高智能步骤。
- 只接受结构化输入。
- 只输出结构化结果。
- 不继承普通聊天 agent 的自由上下文。

### 4. n8n Integration Layer

当前主要落在：

- `src/workflows/n8n-client.ts`
- `src/workflows/n8n-compiler.ts`
- `src/workflows/agent-node-contract.ts`
- `src/gateway/workflow-agent-http.ts`
- `src/gateway/server-methods/workflow.ts`

职责：

- 对接 n8n API
- 发布 workflow
- 启动 execution
- 读取 execution 状态
- 处理 callback 和 resume

### 5. 当前已落地的 callback 约定

当前代码已经有一条可用的 CrawClaw callback 面：

- Gateway method:
  - `workflow.agent.run`
- HTTP endpoint:
  - `POST /workflows/agent/run`

当前 n8n 编译器支持两种 `crawclaw_agent` step 输出：

- 配置了 `workflow.n8n.callbackBaseUrl` 时：
  - 编译成 `n8n-nodes-base.httpRequest`
  - 回调 `POST <callbackBaseUrl>/workflows/agent/run`
- 未配置时：
  - 仍编译成占位 `code` 节点
  - 明确提示后续需要补 callback 地址

当前约定的配置项：

- `workflow.n8n.callbackBaseUrl`
  - n8n 能访问到的 CrawClaw Gateway 外部地址
- `workflow.n8n.callbackCredentialId`
  - 推荐。让 `crawclaw_agent` callback 节点通过 n8n credential 做 Header Auth
- `workflow.n8n.callbackCredentialName`
  - 可选，对应 credential 的展示名
- `workflow.n8n.callbackBearerToken`
  - 本地或开发环境可用的显式 bearer token
- `workflow.n8n.callbackBearerEnvVar`
  - 仅作为 token 解析来源，不建议再依赖 n8n 节点运行时 `$env`

## 数据模型

### 1. Workflow Spec

这是源事实，必须人类可读、可编辑、可版本化。

示例：

```json
{
  "name": "publish_redbook_note",
  "goal": "根据输入内容生成并发布小红书笔记",
  "topology": "branch_v2",
  "inputs": [{ "name": "topic", "type": "string", "required": true }],
  "steps": [
    { "id": "draft", "kind": "crawclaw_agent", "goal": "生成文案和封面建议" },
    {
      "id": "review",
      "kind": "human_wait",
      "path": "approval",
      "branchGroup": "publish_gate",
      "activation": {
        "mode": "conditional",
        "fromStepIds": ["draft"],
        "when": "{{ $json.requiresApproval === true }}"
      },
      "prompt": "确认是否发布"
    },
    {
      "id": "publish",
      "kind": "service",
      "path": "direct_publish",
      "branchGroup": "publish_gate",
      "activation": {
        "mode": "conditional",
        "fromStepIds": ["draft"],
        "when": "{{ $json.requiresApproval !== true }}"
      },
      "service": "redbook-publisher"
    }
  ],
  "outputs": [{ "name": "postUrl", "type": "string" }]
}
```

### 2. Workflow Registry Entry

这是 CrawClaw 控制面的注册记录。

示例字段：

- `workflowId`
- `name`
- `description`
- `owner`
- `scope`
- `specVersion`
- `deploymentVersion`
- `target`
- `n8nWorkflowId`
- `enabled`
- `safeForAutoRun`
- `requiresApproval`
- `tags`
- `inputSchema`
- `createdAt`
- `updatedAt`
- `lastRunAt`

### 3. Workflow Execution Record

这是聚合后的统一执行视图。

示例：

```json
{
  "executionId": "exec_123",
  "workflowId": "wf_redbook_publish",
  "status": "running",
  "currentStepId": "draft_post",
  "currentExecutor": "crawclaw_agent",
  "startedAt": 0,
  "updatedAt": 0,
  "steps": [
    { "id": "prepare_input", "status": "succeeded", "executor": "n8n" },
    { "id": "draft_post", "status": "running", "executor": "crawclaw_agent" },
    { "id": "human_review", "status": "pending", "executor": "n8n_wait" }
  ]
}
```

## Skills 的工作流化策略

`skill` 不能直接进入 n8n。必须先做 `workflow portability` 分类。

建议给 skill 增加元数据：

- `workflowPortability: native | service | crawclaw_agent | human | non_portable`
- `workflowTarget: n8n`
- `serviceEndpoint?: string`
- `agentProfile?: string`

含义：

- `native`
  - 可直接编译成 n8n 原生节点
- `service`
  - 编译为 HTTP/custom service node
- `crawclaw_agent`
  - 编译为 `CrawClaw Agent Node`
- `human`
  - 编译为 Wait / approval 节点
- `non_portable`
  - 不允许进入 workflow

## CrawClaw Agent Node

这是 n8n 中最关键的自定义执行节点。

### 作用

- 让 n8n 在需要高智能执行时回调 CrawClaw。
- 不让 n8n 直接运行 `skill`。
- 不让普通主会话 agent 直接承接 workflow step。

### 输入

- `workflowId`
- `executionId`
- `stepId`
- `goal`
- `inputs`
- `allowedTools`
- `allowedSkills`
- `timeoutMs`
- `resultSchema`
- `workspaceBinding`
- `sessionBinding`

### 输出

- `status`
- `output`
- `artifacts`
- `summary`

### 运行方式

1. n8n 节点调用 CrawClaw callback endpoint。
2. CrawClaw 创建一个 `workflow-step-agent`。
3. `workflow-step-agent` 在受限上下文中执行。
4. 返回结构化结果给 n8n。
5. n8n 继续后续节点。

## workflow-step-agent 设计

### 原则

- 必须是专门的 agent profile。
- 不复用普通聊天主 agent。
- 只做单个 step 执行。
- 当前执行面已支持 `linear_v1` 和 `branch_v2`。
- `branch_v2` 当前支持条件分支、显式 `fan_out`、`fan_in` 汇合、宽度上限约束，以及 `crawclaw_agent` 分支失败补偿。

### 必须约束

- 工具白名单
- skill 白名单
- 最大步数
- 超时
- 结构化输出 schema
- workspace 范围
- 审计日志
- 成本控制

### 不建议默认开放

- 任意消息外发
- 任意 git push
- 任意 destructive 系统操作

## 动态调用与指定调用

### 1. 指定调用

用户明确点名运行某个 workflow：

- `/workflow run publish_redbook_note`
- “运行 workflow xxx”

此时不需要匹配策略，直接解析并执行。

### 2. 动态调用

主 agent 在执行普通任务时，可以查询 workflow registry。

流程：

1. 调 `workflow.match`
2. 获得候选 workflow
3. 判断：
   - 是否高相似度匹配
   - 参数是否齐全
   - `safeForAutoRun` 是否为真
   - `requiresApproval` 是否为假
4. 满足条件时自动调用；否则只建议给用户

### 原则

- workflow 不能像 skill 一样纯靠名称猜测。
- 动态调用必须依赖 registry metadata。

## 执行状态可视化

工作流产品必须提供 execution 可视化，不可只提供“启动”能力。

### 用户可见状态

建议统一收敛为：

- `queued`
- `running`
- `waiting_input`
- `waiting_external`
- `succeeded`
- `failed`
- `cancelled`

step 级状态：

- `pending`
- `running`
- `succeeded`
- `failed`
- `waiting`
- `skipped`

### 必须展示的信息

- 当前有没有在跑
- 当前跑到哪一步
- 当前由谁在执行
  - `n8n`
  - `CrawClaw Agent`
  - `Waiting for You`
- 最近更新时间
- 最近错误摘要
- 可执行操作
  - `Cancel`
  - `Resume`
  - `Retry`

### 三层日志

#### 用户摘要

- 正在生成文案
- 正在等待你确认
- 发布失败：鉴权失效

#### 技术步骤

- step started
- step completed
- subagent spawned
- wait token created
- n8n execution paused/resumed

#### 原始日志

- n8n execution raw log
- workflow-step-agent 事件
- tool call 明细

默认展示前两层。

## 等待与恢复

等待态必须产品化。

建议 wait payload 规范化：

```json
{
  "kind": "human_approval",
  "title": "确认发布小红书",
  "message": "已生成标题与正文，确认后将正式发布。",
  "resumeAction": "approve_publish"
}
```

恢复流程：

1. n8n 进入 Wait。
2. CrawClaw 记录：
   - `workflowId`
   - `executionId`
   - `resumeToken`
   - `waitingReason`
3. 用户在 CrawClaw 中补充输入。
4. `workflow.resume` 调用 n8n resume。
5. execution 继续。

## UI / CLI 管理面

### UI

当前 UI 已落地的 `Workflows` 管理面：

- Workflow 列表
- Workflow 详情
- Execution 列表
- Execution 详情 Timeline
- 等待态输入 / 审批面板
- `Version Rail`
- `Change Summary`
- `Spec Workbench`

当前 UI 还额外支持：

- 比较历史 spec 版本
- 保存 spec 修改
- republish
- rollback
- archive / delete

### CLI

CLI 仍未单独落地；当前 workflow 管理主要通过：

- agent tools
- gateway methods
- control UI

## 与当前 Task Flow 的关系

当前 `Task Flow` 不再是主 workflow engine。

建议保留用途：

- 跟踪 workflowize 请求
- 跟踪 `workflowId <-> n8nWorkflowId`
- 跟踪等待中的人工输入
- 跟踪 `executionId <-> n8nExecutionId`

不再承担：

- 主业务编排
- 主等待恢复引擎
- 多步流程执行控制

## 当前验证状态

当前已经跑过并通过的验证包括：

- workflow / gateway 定向测试
- workflow UI controller 定向测试
- 全量 `typecheck`
- control UI build
- 真实本地 n8n live e2e

真实本地 n8n live e2e 已验证两条主链：

- 线性链：
  - `workflowize -> deploy -> callback -> wait -> resume -> succeeded`
- 分支链：
  - `branch_v2` 命中 `approval` 分支
  - 未命中的 `fast` 分支会被投影为 `skipped`

## 验收标准

- 用户可以先正常完成一次任务。
- 用户可以显式将该任务 workflowize。
- CrawClaw 能生成并发布 n8n workflow。
- 用户可以查看所有落地 workflow。
- 用户可以手动运行、取消、恢复和查看状态。
- 主 agent 可以在受控条件下动态调用 workflow。
- 高智能步骤可以通过 `workflow-step-agent` 在 n8n 中回调 CrawClaw 执行。
- 执行过程对用户可见，等待态可恢复。

## 最终形态

- CrawClaw 负责试跑、抽象、生成、管理、回流。
- n8n 负责 workflow 执行。
- 复杂步骤由 CrawClaw 的 `workflow-step-agent` 承接。
- workflow 对用户是显式资产，可见、可管、可运行、可观察。
